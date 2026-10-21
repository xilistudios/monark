/**
 * Deep Link Service for handling OAuth callbacks globally
 * This service ensures deep links are received regardless of which component is mounted
 * @module deepLinkService
 */

import { listen } from "@tauri-apps/api/event";
import { getCurrent, onOpenUrl } from "@tauri-apps/plugin-deep-link";
import { clearOAuthState, setProviderStatus } from "../redux/actions/vault";
import type { AppDispatch, RootState } from "../redux/store";
import { CloudStorageCommands } from "./cloudStorage";
import {
	type CloudFailureClass,
	classifyCloudFailure,
	extractErrorMessage,
} from "./cloudStorageErrors";

interface DeepLinkServiceConfig {
	dispatch: AppDispatch;
	getState: () => RootState;
}

/**
 * Upper bound on the number of remembered callback identities.
 *
 * The set only has to de-duplicate *near-simultaneous* deliveries of the same
 * callback (a few channels delivering it within seconds), so the newest identities
 * are all that matter. Without a bound the set would grow for the whole lifetime of
 * a long-running session; an evicted identity can only be re-delivered by a cold
 * start, which restarts the service and therefore its bookkeeping anyway.
 */
export const MAX_PROCESSED_CALLBACKS = 64;

/**
 * Structural description of a parsed OAuth callback deep link.
 * Parsing happens before the de-duplication bookkeeping so a URL that is not an
 * OAuth callback can never consume a slot in the processed set.
 */
interface ParsedOAuthCallback {
	/** Stable identity used for de-duplication. */
	id: string;
	/** Authorization code, when present. */
	code: string | null;
	/** OAuth `state` echoed back by the provider, when present. */
	state: string | null;
	/** OAuth error code returned by the provider, when present. */
	error: string | null;
}

/**
 * Deep Link Service class
 * Manages global deep link listeners for OAuth callbacks
 */
class DeepLinkService {
	private dispatch: AppDispatch | null = null;
	private getState: (() => RootState) | null = null;
	private unlistenDeepLink: (() => void) | null = null;
	private unlistenSingleInstance: (() => void) | null = null;
	private isInitialized = false;
	/**
	 * Identities of the OAuth callbacks already handled (or currently being handled),
	 * in insertion order and bounded to {@link MAX_PROCESSED_CALLBACKS} entries.
	 * The same callback can be delivered more than once (e.g. `onOpenUrl` plus
	 * `single-instance-args` plus the cold-start `getCurrent()` check), so it must
	 * be processed only once.
	 *
	 * The set is used as a *reservation*: the identity is added right before the
	 * callback is handled. A callback whose outcome is decided — successful, rejected by
	 * the `state` validation, or a matching provider `?error=` — stays remembered as a
	 * permanent mark, while a *transient* failure releases it so the very same callback
	 * can be retried through another delivery channel (see {@link reserveCallback}).
	 */
	private processedCallbacks = new Set<string>();

	/**
	 * Initialize the deep link service
	 * @param config - Service configuration with dispatch and getState
	 */
	initialize(config: DeepLinkServiceConfig): void {
		if (this.isInitialized) {
			console.warn("[DeepLinkService] Already initialized, skipping");
			return;
		}

		this.dispatch = config.dispatch;
		this.getState = config.getState;

		console.log("[DeepLinkService] Initializing global deep link listener");

		// Set up the global deep link listener
		this.setupDeepLinkListener();

		// Set up single-instance args listener for Windows/Linux deep links
		this.setupSingleInstanceListener();

		// Process a deep link that launched the app (cold start)
		this.processInitialDeepLink();

		this.isInitialized = true;
		console.log(
			"[DeepLinkService] Global deep link listener initialized successfully",
		);
	}

	/**
	 * Set up the Tauri deep link listener
	 */
	private setupDeepLinkListener(): void {
		console.log("[DeepLinkService] Setting up Tauri onOpenUrl listener");

		onOpenUrl((urls) => {
			console.log("[DeepLinkService] Deep link URLs received");
			console.log("[DeepLinkService] Number of URLs:", urls.length);

			if (urls.length > 0) {
				// Iterate every delivered URL and stop at the first claimed OAuth callback,
				// so a stale/non-OAuth URL at the front cannot swallow the real callback.
				// Fire-and-forget: the callback stays sync, and `handleDeepLink` never
				// rejects (it catches internally), so no unhandled rejection can escape.
				void (async () => {
					for (const url of urls) {
						if (await this.handleDeepLink(url)) {
							break;
						}
					}
				})();
			} else {
				console.warn("[DeepLinkService] Received empty URLs array");
			}
		})
			.then((unlisten) => {
				this.unlistenDeepLink = unlisten;
				console.log(
					"[DeepLinkService] Tauri onOpenUrl listener registered successfully",
				);
			})
			.catch((error) => {
				console.error(
					"[DeepLinkService] Failed to register Tauri onOpenUrl listener:",
					error,
				);
			});
	}

	/**
	 * Set up the single-instance args listener for Windows/Linux deep links
	 */
	private setupSingleInstanceListener(): void {
		console.log("[DeepLinkService] Setting up single-instance args listener");

		listen<string[]>("single-instance-args", (event) => {
			console.log("[DeepLinkService] Single instance args received");

			const args = event.payload;
			// Every arg is handed to the parser (no `startsWith("monark://")` filter):
			// `parseOAuthCallback` accepts any case variant of the scheme — the URL parser
			// lowercases `protocol` — and only it can tell a callback from a plain arg.
			void (async () => {
				let claimed = false;
				for (const arg of args) {
					if (await this.handleDeepLink(arg)) {
						claimed = true;
						break;
					}
				}

				if (claimed) {
					console.log(
						"[DeepLinkService] Deep link found in single-instance args",
					);
				} else {
					console.warn(
						"[DeepLinkService] No deep link found in single-instance args",
					);
				}
			})();
		})
			.then((unlisten) => {
				this.unlistenSingleInstance = unlisten;
				console.log(
					"[DeepLinkService] Single instance args listener registered successfully",
				);
			})
			.catch((error) => {
				console.error(
					"[DeepLinkService] Failed to register single instance args listener:",
					error,
				);
			});
	}

	/**
	 * Process the deep link that launched the app, if any (cold start).
	 *
	 * The plugin emits the deep link event during the Rust `setup` hook, before this
	 * webview exists, so `onOpenUrl` cannot catch that first URL. `getCurrent()` exposes
	 * it and must be consulted on app load.
	 *
	 * This runs after the `onOpenUrl` listener is registered, so a URL delivered while
	 * the check is in flight is still caught by the listener and de-duplicated afterwards.
	 */
	private processInitialDeepLink(): void {
		console.log("[DeepLinkService] Checking for a cold-start deep link");

		try {
			getCurrent()
				.then((urls) => {
					if (!urls || urls.length === 0) {
						console.log("[DeepLinkService] No cold-start deep link found");
						return;
					}

					console.log("[DeepLinkService] Cold-start deep link found");
					// Iterate every cold-start URL and stop at the first claimed OAuth
					// callback, so a stale URL at the front cannot swallow the real one.
					// `handleDeepLink` never rejects, so no unhandled rejection can escape
					// this `.then` (the `.catch` below still guards `getCurrent()` itself).
					return (async () => {
						for (const url of urls) {
							if (await this.handleDeepLink(url)) {
								break;
							}
						}
					})();
				})
				.catch((error) => {
					// A failing plugin must not break the service initialization
					console.warn(
						"[DeepLinkService] Failed to read the current deep link:",
						error,
					);
				});
		} catch (error) {
			console.warn(
				"[DeepLinkService] Failed to read the current deep link:",
				error,
			);
		}
	}

	/**
	 * Handle incoming deep link URL.
	 *
	 * Return contract: `true` iff `parseOAuthCallback` accepted the URL, i.e. the URL
	 * *is* a monark OAuth callback and was therefore **claimed** — regardless of the
	 * dedupe outcome (duplicate ignored), a transient failure, or a state mismatch.
	 * `false` means the URL was not a monark OAuth callback (unparseable URL, another
	 * scheme, or no `code`/`state`/`error` parameter) or the service is not
	 * initialized, so callers iterating over several URLs can keep going.
	 * The parse-then-reserve ordering makes iteration safe: a rejected URL never
	 * consumes a slot of a later, valid callback in the same batch.
	 *
	 * Never throws: every failure is caught and reported internally.
	 *
	 * @param url - The deep link URL to process
	 * @returns `true` when the URL was claimed as an OAuth callback, `false` otherwise
	 */
	private async handleDeepLink(url: string): Promise<boolean> {
		console.log("[DeepLinkService] Processing deep link");

		if (!this.dispatch || !this.getState) {
			console.error(
				"[DeepLinkService] Service not initialized - dispatch or getState is null",
			);
			return false;
		}

		// Parse and validate the URL *before* touching the de-duplication set: a URL
		// that is not an OAuth callback must not consume a slot for a later, valid one.
		console.log("[DeepLinkService] Parsing URL parameters");
		const callback = this.parseOAuthCallback(url);

		if (!callback) {
			console.log(
				"[DeepLinkService] Not a monark OAuth callback URL - ignoring",
			);
			return false;
		}

		const { id, code, state, error } = callback;

		console.log("[DeepLinkService] URL parameters parsed:");
		console.log("[DeepLinkService]   - code:", code ? "[REDACTED]" : "null");
		console.log("[DeepLinkService]   - state:", state ? "[REDACTED]" : "null");
		console.log("[DeepLinkService]   - error:", error);

		// Reserve the callback before handling it, so a concurrent delivery of the same
		// callback through another channel is discarded...
		if (!this.reserveCallback(id)) {
			console.log(
				"[DeepLinkService] Duplicate OAuth callback, already processed - ignoring",
			);
			// Claimed (parse accepted it): the caller must stop iterating at this URL.
			return true;
		}

		try {
			// Get current OAuth state from Redux
			const currentState = this.getState();
			const oauthState = currentState.vault.oauthState;

			// A provider-side rejection (`?error=`, e.g. `access_denied`) cannot be fixed by
			// retrying the very same URL, so it is terminal — but only when it echoes the
			// `state` of the pending request. Anyone able to open a `monark://` URL could
			// otherwise inject `?error=x&state=whatever` and abort a legitimate sign-in in
			// progress, so a callback with a foreign (or missing) `state` is ignored without
			// touching the store, exactly like any other mismatching callback.
			if (error) {
				if (!state || state !== oauthState.state) {
					console.warn(
						"[DeepLinkService] OAuth error callback with a mismatching state - ignoring:",
						error,
					);
					return true;
				}

				console.error("[DeepLinkService] OAuth error received:", error);
				this.handleOAuthError(error, "terminal");
				return true;
			}

			console.log("[DeepLinkService] Current OAuth state from Redux:");
			console.log(
				"[DeepLinkService]   - providerName:",
				oauthState.providerName,
			);
			console.log(
				"[DeepLinkService]   - state:",
				oauthState.state ? "[REDACTED]" : "null",
			);
			console.log("[DeepLinkService]   - isOpen:", oauthState.isOpen);

			// Validate state parameter
			if (!state) {
				console.error("[DeepLinkService] No state parameter in URL");
				this.handleOAuthError("Missing state parameter in callback URL");
				return true;
			}

			if (!oauthState.state) {
				console.warn(
					"[DeepLinkService] No OAuth state in Redux - may have been cleared",
				);
				this.handleOAuthError("No pending OAuth request found");
				return true;
			}

			if (state !== oauthState.state) {
				console.error("[DeepLinkService] State mismatch!");
				this.handleOAuthError("State mismatch - possible CSRF attack");
				return true;
			}

			if (!code) {
				console.error("[DeepLinkService] No code parameter in URL");
				this.handleOAuthError("Missing authorization code in callback URL");
				return true;
			}

			if (!oauthState.providerName) {
				console.error("[DeepLinkService] No provider name in OAuth state");
				this.handleOAuthError("Missing provider name in OAuth state");
				return true;
			}

			// State matches, process the OAuth callback
			console.log(
				"[DeepLinkService] State validation successful, processing OAuth callback",
			);
			console.log("[DeepLinkService] Provider:", oauthState.providerName);

			// `handleGoogleDriveOAuthCallback` returns `void` and reports every failure by
			// throwing a `CloudStorageError`, so there is no resolved-failure payload to
			// inspect here: a resolving call means the provider is authenticated.
			await CloudStorageCommands.handleGoogleDriveOAuthCallback(
				oauthState.providerName,
				code,
				state,
			);

			console.log("[DeepLinkService] OAuth callback processed successfully");
			this.dispatch(
				setProviderStatus({
					providerId: oauthState.providerName,
					status: "authenticated",
				}),
			);

			// Clear OAuth state after successful authentication
			this.dispatch(clearOAuthState());
			console.log("[DeepLinkService] OAuth state cleared");
			return true;
		} catch (error) {
			const failureClass = classifyCloudFailure(error);
			const message =
				extractErrorMessage(error) || "Failed to complete authentication";
			console.error(
				"[DeepLinkService] Failed to handle OAuth callback:",
				message,
			);
			// OAuth lifecycle semantics of the shared class (`CloudFailureClass` in
			// `./cloudStorageErrors`, the generic contract):
			// - `transient`: the backend *keeps* the PKCE state for the retry, so the Redux
			//   OAuth state must survive too (clearing it would fail the retry's `state`
			//   validation with "No pending OAuth request found") and the callback identity
			//   is *released* so a re-delivery of the same callback is handled again.
			// - `terminal`: retrying cannot succeed, so the flow is closed, the state
			//   cleared, and the callback identity stays remembered as a permanent mark —
			//   re-delivering it can only repeat a decision that is already made. The same
			//   holds for callbacks rejected locally (state validation, matching `?error=`)
			//   and for successful ones.
			if (failureClass === "transient") {
				this.releaseCallback(id);
			}
			// A transient failure keeps the Redux OAuth state, because the backend keeps
			// its PKCE state precisely so that this retry can succeed.
			this.handleOAuthError(message, failureClass);
			// The failure does not change the claim: the URL *was* a monark OAuth callback.
			return true;
		}
	}

	/**
	 * Parse a deep link URL into an OAuth callback descriptor.
	 *
	 * Returns `null` for anything that cannot carry an OAuth callback:
	 * unparsable URLs, URLs using another scheme, and `monark://` URLs without any
	 * OAuth parameter. Such URLs are ignored and never touch the processed set, so
	 * they cannot block a later, valid callback.
	 *
	 * @param url - The deep link URL to parse
	 * @returns The parsed callback, or `null` when the URL is not an OAuth callback
	 */
	private parseOAuthCallback(url: string): ParsedOAuthCallback | null {
		let urlObj: URL;

		try {
			urlObj = new URL(url);
		} catch {
			return null;
		}

		if (urlObj.protocol !== "monark:") {
			return null;
		}

		const code = urlObj.searchParams.get("code");
		const state = urlObj.searchParams.get("state");
		const error = urlObj.searchParams.get("error");

		if (!code && !state && !error) {
			return null;
		}

		return {
			id: this.buildCallbackId(url, code, state),
			code,
			state,
			error,
		};
	}

	/**
	 * Build a stable identity for a deep link callback.
	 * An OAuth callback is identified by its `code` + `state` pair; URLs without them
	 * (e.g. error callbacks) fall back to the raw URL.
	 */
	private buildCallbackId(
		url: string,
		code: string | null,
		state: string | null,
	): string {
		if (code && state) {
			return `code:${code}|state:${state}`;
		}

		return `url:${url}`;
	}

	/**
	 * Reserve a callback identity before it is handled, so concurrent deliveries of
	 * the same callback through other channels are discarded.
	 *
	 * The reservation is a *permanent mark* for every outcome that is already decided:
	 * a successful hand-over, a callback rejected by the `state` validation, and a
	 * matching provider `?error=` all keep their identity remembered, because
	 * re-delivering them cannot produce a different result. Only a *transient* failure
	 * releases the identity again (see {@link releaseCallback}), so the callback can be
	 * retried through another delivery channel.
	 *
	 * Keeps the remembered identities bounded: a `Set` iterates in insertion order, so
	 * once the cap is exceeded the oldest identities are dropped first. Eviction only
	 * matters for callbacks older than the last {@link MAX_PROCESSED_CALLBACKS}
	 * deliveries, which cannot be re-delivered while the service stays alive.
	 *
	 * @param id - The callback identity to reserve
	 * @returns `true` when the reservation was granted, `false` when it was taken
	 */
	private reserveCallback(id: string): boolean {
		if (this.processedCallbacks.has(id)) {
			return false;
		}

		this.processedCallbacks.add(id);

		while (this.processedCallbacks.size > MAX_PROCESSED_CALLBACKS) {
			const oldest = this.processedCallbacks.values().next().value;
			if (oldest === undefined) {
				break;
			}

			this.processedCallbacks.delete(oldest);
		}

		return true;
	}

	/**
	 * Release a reservation so the callback can be retried later.
	 * Only used for a *transient* failure: every other outcome keeps its permanent mark.
	 * @param id - The callback identity to release
	 */
	private releaseCallback(id: string): void {
		this.processedCallbacks.delete(id);
	}

	/**
	 * Handle an OAuth error.
	 *
	 * The class decides the *state* policy, which is what makes a retry possible:
	 * - `terminal` (default): the Redux OAuth state is cleared, the flow is over.
	 * - `transient`: the state is **kept**, because the backend keeps the PKCE state for
	 *   the retryable cases. Clearing it here would make the retry of the very same
	 *   callback fail the `state` validation ("No pending OAuth request found") and die
	 *   as a terminal rejection.
	 *
	 * The UI policy is identical for both classes: the reason is logged and the provider
	 * is marked as `error`, so a transient failure still surfaces (and can be retried by
	 * re-delivering the callback, or by starting the flow again).
	 *
	 * @param errorMessage - The error message to log and report
	 * @param failureClass - Whether the failure can be retried (defaults to terminal).
	 *   The class comes from the shared contract (`CloudFailureClass` in
	 *   `./cloudStorageErrors`) with OAuth lifecycle semantics attached: `transient`
	 *   means the backend kept its PKCE state, so this method must **keep** the Redux
	 *   OAuth state as well or the retry would die on the `state` validation; `terminal`
	 *   closes the flow and clears the state for good.
	 */
	private handleOAuthError(
		errorMessage: string,
		failureClass: CloudFailureClass = "terminal",
	): void {
		console.error(
			"[DeepLinkService] Handling OAuth error:",
			errorMessage,
			`(${failureClass})`,
		);

		if (!this.dispatch) {
			console.error(
				"[DeepLinkService] Cannot dispatch error - dispatch is null",
			);
			return;
		}

		if (!this.getState) {
			console.error("[DeepLinkService] Cannot get state - getState is null");
			return;
		}

		const currentState = this.getState();
		const oauthState = currentState.vault.oauthState;

		if (oauthState.providerName) {
			this.dispatch(
				setProviderStatus({
					providerId: oauthState.providerName,
					status: "error",
				}),
			);
			console.log(
				"[DeepLinkService] Provider status set to error:",
				oauthState.providerName,
			);
		}

		if (failureClass === "transient") {
			console.warn(
				"[DeepLinkService] Transient failure - keeping OAuth state so the callback can be retried",
			);
			return;
		}

		// Clear OAuth state on a terminal error
		this.dispatch(clearOAuthState());
		console.log("[DeepLinkService] OAuth state cleared due to error");
	}

	/**
	 * Cleanup the deep link service
	 */
	cleanup(): void {
		console.log("[DeepLinkService] Cleaning up deep link service");

		if (this.unlistenDeepLink) {
			this.unlistenDeepLink();
			this.unlistenDeepLink = null;
			console.log("[DeepLinkService] Tauri onOpenUrl listener unregistered");
		}

		if (this.unlistenSingleInstance) {
			this.unlistenSingleInstance();
			this.unlistenSingleInstance = null;
			console.log("[DeepLinkService] Single instance listener unregistered");
		}

		this.processedCallbacks.clear();
		this.dispatch = null;
		this.getState = null;
		this.isInitialized = false;

		console.log("[DeepLinkService] Cleanup complete");
	}

	/**
	 * Check if the service is initialized
	 */
	isReady(): boolean {
		return this.isInitialized;
	}
}

// Export singleton instance
export const deepLinkService = new DeepLinkService();
