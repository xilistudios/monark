/**
 * Deep Link Service tests
 *
 * Covers the capture bugs of the Linux OAuth callback flow:
 * 1. Cold-start deep links must be read with `getCurrent()` on app load (the plugin
 *    emits the event before the webview exists, so `onOpenUrl` never sees them).
 * 2. The same callback can be delivered through several channels, so it must be
 *    processed only once (idempotency). The de-duplication is a reservation that is
 *    released when handling fails, so a transient failure can still be retried, and
 *    a URL that is not an OAuth callback never consumes a slot.
 * 3. The *class* of the failure (`AuthFailureClass` of the backend, seen through
 *    `CloudStorageCommands.handleError`) decides whether the Redux OAuth state
 *    survives: a transient (network) failure keeps it so the retry passes the state
 *    validation, a terminal one clears it and closes the flow. A provider `?error=`
 *    callback is only trusted when it echoes the pending `state`, so a forged one
 *    cannot cancel a sign-in in progress.
 * 4. The remembered callback identities are bounded, so a long session cannot grow
 *    the set without limit.
 * 5. The classification of a *raw* failure (string / `Error`) follows the keyword
 *    ladder of `handleError` in its exact order, so it never disagrees with the
 *    classification the wrapper would have produced for the same message.
 *
 * The vault slice is modelled as a *mutable* object: the action mocks mutate it and
 * `getState` reads from it, so the tests reproduce the real store sequence. A constant
 * `getState` stub would keep answering "there is a pending OAuth request" even after
 * `clearOAuthState()`, and would therefore hide exactly the defect class 3 covers.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CloudStorageErrorType } from "../../interfaces/cloud-storage.interface";

const mocks = vi.hoisted(() => ({
	getCurrent: vi.fn(),
	onOpenUrl: vi.fn(),
	listen: vi.fn(),
	handleGoogleDriveOAuthCallback: vi.fn(),
	setProviderStatus: vi.fn((payload: unknown) => ({
		type: "vault/setProviderStatus",
		payload,
	})),
	clearOAuthState: vi.fn(() => ({ type: "vault/clearOAuthState" })),
}));

vi.mock("@tauri-apps/plugin-deep-link", () => ({
	getCurrent: mocks.getCurrent,
	onOpenUrl: mocks.onOpenUrl,
}));

vi.mock("@tauri-apps/api/event", () => ({
	listen: mocks.listen,
}));

vi.mock("../../services/cloudStorage", () => ({
	CloudStorageCommands: {
		handleGoogleDriveOAuthCallback: mocks.handleGoogleDriveOAuthCallback,
	},
}));

vi.mock("../../redux/actions/vault", () => ({
	setProviderStatus: mocks.setProviderStatus,
	clearOAuthState: mocks.clearOAuthState,
}));

import type { AppDispatch, RootState } from "../../redux/store";
import { classifyCloudFailure } from "../../services/cloudStorageErrors";
import {
	deepLinkService,
	MAX_PROCESSED_CALLBACKS,
} from "../../services/deepLinkService";

const OAUTH_STATE = "state-xyz";
const PROVIDER = "google_drive";
const VALID_URL = `monark://oauth/callback?code=abc&state=${OAUTH_STATE}`;

/** Callback URL for the given authorization code / OAuth state. */
const callbackUrl = (code: string, state = OAUTH_STATE) =>
	`monark://oauth/callback?code=${code}&state=${state}`;

/** Flush pending microtasks/timers so async handlers settle. */
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

/**
 * The real messages of the backend contract (`AuthFailureClass`, see
 * `src-tauri/src/commands/errors.rs`), i.e. what the IPC handler rejects with.
 */
const NETWORK_MESSAGE =
	"network error while exchanging the authorization code: connection reset by peer";
const AUTH_MESSAGE =
	"authentication failed while exchanging the authorization code (re-authenticate): invalid_grant";
/** Fourth template of the contract (`into_command_error_local_storage`): transient
 * but caused by local keychain/IO persistence rather than the network. */
const LOCAL_STORAGE_MESSAGE =
	"network or local storage error while refreshing the Google Drive access token: Failed to set keychain secret";

/** The shapes a transient (network) failure reaches the service in. */
const transientFailures: Array<[string, () => unknown]> = [
	["a raw contract message (string)", () => NETWORK_MESSAGE],
	["an Error carrying the contract message", () => new Error(NETWORK_MESSAGE)],
	[
		"a CloudStorageError from the wrapper (NETWORK_ERROR)",
		(): unknown => ({
			type: CloudStorageErrorType.NETWORK_ERROR,
			message: NETWORK_MESSAGE,
			originalError: NETWORK_MESSAGE,
		}),
	],
	["a local-storage contract message (string)", () => LOCAL_STORAGE_MESSAGE],
	[
		"an Error carrying the local-storage message",
		() => new Error(LOCAL_STORAGE_MESSAGE),
	],
	[
		"a NETWORK_ERROR wrapping the local-storage message",
		(): unknown => ({
			type: CloudStorageErrorType.NETWORK_ERROR,
			message: LOCAL_STORAGE_MESSAGE,
			originalError: LOCAL_STORAGE_MESSAGE,
		}),
	],
];

/** The shapes a terminal failure reaches the service in. */
const terminalFailures: Array<[string, () => unknown]> = [
	["an authentication rejection (string)", () => AUTH_MESSAGE],
	[
		"an AUTHENTICATION_FAILED wrapped by the wrapper",
		(): unknown => ({
			type: CloudStorageErrorType.AUTHENTICATION_FAILED,
			message: AUTH_MESSAGE,
			originalError: AUTH_MESSAGE,
		}),
	],
	[
		"a TOKEN_EXPIRED wrapped by the wrapper",
		(): unknown => ({
			type: CloudStorageErrorType.TOKEN_EXPIRED,
			message: "token expired while refreshing the access token",
		}),
	],
	[
		"an unclassified failure (conservative fallback)",
		() => new Error("keyring unavailable"),
	],
];

interface OAuthStateModel {
	providerName: string | null;
	authUrl: string | null;
	state: string | null;
	isOpen: boolean;
}

/**
 * Mutable model of the `vault` slice, initialised like the real slice: no pending
 * OAuth request.
 */
let vaultModel: { oauthState: OAuthStateModel };

let mockDispatch: AppDispatch;

/** The vault slice, as `getState` sees it. */
const buildGetState = (): (() => RootState) => () =>
	({ vault: vaultModel }) as unknown as RootState;

/**
 * Apply a dispatched (mocked) vault action to the model, mirroring the reducer.
 * Only `clearOAuthState` can be observed by the service; `setProviderStatus` does not
 * touch the OAuth state, so it needs no reducer here.
 */
const applyAction = (action: unknown): void => {
	const type = (action as { type?: string } | null)?.type;

	if (type === "vault/clearOAuthState") {
		vaultModel.oauthState = {
			providerName: null,
			authUrl: null,
			state: null,
			isOpen: false,
		};
	}
};

/**
 * Simulate the app starting an OAuth flow (or restarting one after a failure): the
 * pending request is installed in the store, which is what makes the callback pass
 * the `state` validation.
 */
const startOAuthFlow = (
	state: string | null = OAUTH_STATE,
	providerName: string | null = PROVIDER,
): void => {
	vaultModel.oauthState = {
		providerName,
		authUrl: `https://accounts.google.com/o/oauth2/auth?state=${state}`,
		state,
		isOpen: true,
	};
};

/** Console spies so the service logging does not flood the test output. */
let consoleSpies: ReturnType<typeof vi.spyOn>[] = [];

/**
 * Captures the handler registered through `onOpenUrl` and returns a sender that
 * simulates an incoming deep link delivered by the plugin event / single instance args.
 */
const captureOpenUrlHandler = () => {
	let handler: ((urls: string[]) => void) | null = null;
	mocks.onOpenUrl.mockImplementation((cb: (urls: string[]) => void) => {
		handler = cb;
		return Promise.resolve(() => {});
	});

	return (urls: string[]) => {
		if (!handler) {
			throw new Error("onOpenUrl handler was not registered");
		}
		handler(urls);
	};
};

/**
 * Captures the `single-instance-args` listener and returns a sender that simulates
 * the event emitted by the second process (Windows/Linux deep-link launch).
 */
const captureSingleInstanceHandler = () => {
	let handler: ((event: { payload: string[] }) => void) | null = null;
	mocks.listen.mockImplementation(
		(_event: string, cb: (event: { payload: string[] }) => void) => {
			if (_event === "single-instance-args") {
				handler = cb;
			}
			return Promise.resolve(() => {});
		},
	);

	return (args: string[]) => {
		if (!handler) {
			throw new Error("single-instance-args listener was not registered");
		}
		handler({ payload: args });
	};
};

/**
 * Calls the private `handleDeepLink` directly (TS `private` is compile-time only),
 * so its `Promise<boolean>` return contract can be asserted without going through
 * a delivery channel.
 */
const invokeHandleDeepLink = (url: string): Promise<boolean> =>
	(
		deepLinkService as unknown as {
			handleDeepLink: (url: string) => Promise<boolean>;
		}
	).handleDeepLink(url);

/** Initializes the service with spies and returns the deep link sender. */
const initializeService = (): ((urls: string[]) => void) => {
	const sendOpenUrl = captureOpenUrlHandler();
	deepLinkService.initialize({
		dispatch: mockDispatch,
		getState: buildGetState(),
	});
	return sendOpenUrl;
};

/**
 * Initializes the service and returns the single-instance args sender. The listener
 * must be *captured before* `initialize()` registers it (it resolves asynchronously),
 * so this helper wires the capture first.
 */
const initializeServiceWithSingleInstance = (): ((args: string[]) => void) => {
	const sendSingleInstance = captureSingleInstanceHandler();
	deepLinkService.initialize({
		dispatch: mockDispatch,
		getState: buildGetState(),
	});
	return sendSingleInstance;
};

const authCall = [PROVIDER, "abc", OAUTH_STATE];

describe("deepLinkService", () => {
	beforeEach(() => {
		consoleSpies = [
			vi.spyOn(console, "log"),
			vi.spyOn(console, "warn"),
			vi.spyOn(console, "error"),
		].map((spy) => spy.mockImplementation(() => {}));

		vi.clearAllMocks();
		deepLinkService.cleanup();

		vaultModel = {
			oauthState: {
				providerName: null,
				authUrl: null,
				state: null,
				isOpen: false,
			},
		};
		mockDispatch = vi.fn(applyAction) as unknown as AppDispatch;

		// Defaults: no pending deep link, listeners registered fine.
		// The handler mock is *reset* (not only cleared) so a `...Once` implementation left
		// over by a failing test cannot leak into the next one.
		mocks.getCurrent.mockResolvedValue(null);
		mocks.onOpenUrl.mockResolvedValue(() => {});
		mocks.listen.mockResolvedValue(() => {});
		mocks.handleGoogleDriveOAuthCallback
			.mockReset()
			.mockResolvedValue(undefined);
	});

	afterEach(() => {
		deepLinkService.cleanup();

		for (const spy of consoleSpies) {
			spy.mockRestore();
		}
	});

	describe("cold start (getCurrent)", () => {
		it("processes the deep link that launched the app", async () => {
			mocks.getCurrent.mockResolvedValue([VALID_URL]);
			startOAuthFlow();

			initializeService();

			await vi.waitFor(() =>
				expect(
					mocks.handleGoogleDriveOAuthCallback,
				).toHaveBeenCalledExactlyOnceWith(...authCall),
			);
			// A successful callback consumes the pending request
			expect(mocks.clearOAuthState).toHaveBeenCalledTimes(1);
			expect(vaultModel.oauthState.state).toBeNull();
		});

		it.each([
			["an empty array", [] as string[]],
			["null", null],
		])(
			"is a silent no-op when getCurrent returns %s",
			async (_label, result) => {
				mocks.getCurrent.mockResolvedValue(result);
				startOAuthFlow();

				expect(() => initializeService()).not.toThrow();

				await flush();
				expect(mocks.handleGoogleDriveOAuthCallback).not.toHaveBeenCalled();
				expect(mocks.clearOAuthState).not.toHaveBeenCalled();
			},
		);

		it("does not break initialization when getCurrent fails", async () => {
			mocks.getCurrent.mockRejectedValue(new Error("plugin unavailable"));

			expect(() => initializeService()).not.toThrow();

			await flush();
			expect(mocks.handleGoogleDriveOAuthCallback).not.toHaveBeenCalled();
			expect(deepLinkService.isReady()).toBe(true);
		});

		it("processes the cold-start callback when it is not the first URL", async () => {
			// A stale/non-OAuth URL ahead of the real callback must not swallow it
			mocks.getCurrent.mockResolvedValue([
				"not a url at all",
				`https://example.com/oauth/callback?code=abc&state=${OAUTH_STATE}`,
				VALID_URL,
			]);
			startOAuthFlow();

			initializeService();

			await vi.waitFor(() =>
				expect(
					mocks.handleGoogleDriveOAuthCallback,
				).toHaveBeenCalledExactlyOnceWith(...authCall),
			);
			expect(mocks.clearOAuthState).toHaveBeenCalledTimes(1);
		});
	});

	describe("idempotency", () => {
		it("processes the same callback only once across delivery channels", async () => {
			mocks.getCurrent.mockResolvedValue([VALID_URL]);
			startOAuthFlow();
			const sendOpenUrl = initializeService();

			// The very same callback is also delivered by onOpenUrl...
			sendOpenUrl([VALID_URL]);
			// ...and by the single-instance args event
			sendOpenUrl([VALID_URL]);

			await flush();
			await flush();

			expect(
				mocks.handleGoogleDriveOAuthCallback,
			).toHaveBeenCalledExactlyOnceWith(...authCall);
		});

		it("processes distinct callbacks normally", async () => {
			mocks.getCurrent.mockResolvedValue([callbackUrl("abc")]);
			startOAuthFlow();
			const sendOpenUrl = initializeService();

			// Cold-start callback first...
			await vi.waitFor(() =>
				expect(
					mocks.handleGoogleDriveOAuthCallback,
				).toHaveBeenCalledExactlyOnceWith(...authCall),
			);

			// ...then a different callback (new code) of a new OAuth flow is processed normally
			startOAuthFlow();
			sendOpenUrl([callbackUrl("def")]);

			await vi.waitFor(() =>
				expect(mocks.handleGoogleDriveOAuthCallback).toHaveBeenCalledTimes(2),
			);
			expect(mocks.handleGoogleDriveOAuthCallback).toHaveBeenNthCalledWith(
				2,
				PROVIDER,
				"def",
				OAUTH_STATE,
			);
		});

		it("ignores a duplicate callback that was rejected by state validation", async () => {
			const sendOpenUrl = initializeService();

			// No pending OAuth request in the store (nothing started a flow)
			sendOpenUrl([VALID_URL]);
			await flush();

			// Rejected once (no pending OAuth request) -> OAuth state cleared once
			expect(mocks.handleGoogleDriveOAuthCallback).not.toHaveBeenCalled();
			expect(mocks.clearOAuthState).toHaveBeenCalledTimes(1);

			// The duplicate delivery must not be processed again
			sendOpenUrl([VALID_URL]);
			await flush();

			expect(mocks.clearOAuthState).toHaveBeenCalledTimes(1);
		});
	});

	describe("reservation with release", () => {
		it("processes the callback again when the handler failed transiently", async () => {
			mocks.handleGoogleDriveOAuthCallback
				.mockRejectedValueOnce(new Error(NETWORK_MESSAGE))
				.mockResolvedValueOnce(undefined);
			startOAuthFlow();
			const sendOpenUrl = initializeService();

			// First delivery dies inside the IPC handler (network error)
			sendOpenUrl([VALID_URL]);
			await vi.waitFor(() =>
				expect(mocks.handleGoogleDriveOAuthCallback).toHaveBeenCalledTimes(1),
			);

			// The retry of the very same callback must not be discarded as duplicate
			sendOpenUrl([VALID_URL]);
			await vi.waitFor(() =>
				expect(mocks.handleGoogleDriveOAuthCallback).toHaveBeenCalledTimes(2),
			);

			expect(mocks.handleGoogleDriveOAuthCallback).toHaveBeenNthCalledWith(
				1,
				...authCall,
			);
			expect(mocks.handleGoogleDriveOAuthCallback).toHaveBeenNthCalledWith(
				2,
				...authCall,
			);
			// The failed attempt reports the error, the successful retry authenticates
			expect(mocks.setProviderStatus).toHaveBeenNthCalledWith(1, {
				providerId: PROVIDER,
				status: "error",
			});
			expect(mocks.setProviderStatus).toHaveBeenNthCalledWith(2, {
				providerId: PROVIDER,
				status: "authenticated",
			});
			// The transient failure keeps the OAuth state, so only the successful retry
			// consumes it
			expect(mocks.clearOAuthState).toHaveBeenCalledTimes(1);
		});

		it("discards a duplicate delivered while the invocation is still in flight", async () => {
			let completeFirstInvocation: () => void = () => {};
			mocks.handleGoogleDriveOAuthCallback.mockImplementation(
				() =>
					new Promise<void>((resolve) => {
						completeFirstInvocation = resolve;
					}),
			);
			startOAuthFlow();
			const sendOpenUrl = initializeService();

			sendOpenUrl([VALID_URL]);
			// The same callback arrives through another channel before the first settles
			sendOpenUrl([VALID_URL]);

			await flush();

			expect(mocks.handleGoogleDriveOAuthCallback).toHaveBeenCalledTimes(1);

			completeFirstInvocation();
			await flush();

			expect(mocks.handleGoogleDriveOAuthCallback).toHaveBeenCalledTimes(1);
			expect(mocks.clearOAuthState).toHaveBeenCalledTimes(1);
		});

		it("ignores non-callback URLs without consuming their slot", async () => {
			startOAuthFlow();
			const sendOpenUrl = initializeService();

			// Callback-shaped URL from another scheme: it is not ours
			sendOpenUrl([
				`https://evil.example/oauth/callback?code=abc&state=${OAUTH_STATE}`,
			]);
			// A monark deep link without any OAuth parameter is not a callback
			sendOpenUrl(["monark://vault/open?path=/vault"]);
			// A malformed URL cannot even be parsed
			sendOpenUrl(["not a url at all"]);

			await flush();

			expect(mocks.handleGoogleDriveOAuthCallback).not.toHaveBeenCalled();
			expect(mocks.setProviderStatus).not.toHaveBeenCalled();
			expect(mocks.clearOAuthState).not.toHaveBeenCalled();

			// The same code/state delivered by the real callback is still processed
			sendOpenUrl([VALID_URL]);

			await vi.waitFor(() =>
				expect(
					mocks.handleGoogleDriveOAuthCallback,
				).toHaveBeenCalledExactlyOnceWith(...authCall),
			);
		});
	});

	describe("failure classification (transient vs terminal)", () => {
		it.each(transientFailures)(
			"keeps the OAuth state on a transient failure so the retry can authenticate (%s)",
			async (_label, buildFailure) => {
				mocks.handleGoogleDriveOAuthCallback
					.mockRejectedValueOnce(buildFailure())
					.mockResolvedValueOnce(undefined);
				startOAuthFlow();
				const sendOpenUrl = initializeService();

				sendOpenUrl([VALID_URL]);
				await vi.waitFor(() =>
					expect(mocks.handleGoogleDriveOAuthCallback).toHaveBeenCalledTimes(1),
				);

				// The failure is reported, but the pending OAuth request survives: clearing it
				// here is what used to make the retry die on the state validation.
				expect(mocks.clearOAuthState).not.toHaveBeenCalled();
				expect(vaultModel.oauthState.state).toBe(OAUTH_STATE);
				expect(mocks.setProviderStatus).toHaveBeenCalledExactlyOnceWith({
					providerId: PROVIDER,
					status: "error",
				});

				// Retry of the very same callback: the reservation was released and the state is
				// still pending, so the backend is reached again and the flow completes
				sendOpenUrl([VALID_URL]);
				await vi.waitFor(() =>
					expect(mocks.handleGoogleDriveOAuthCallback).toHaveBeenCalledTimes(2),
				);

				expect(mocks.handleGoogleDriveOAuthCallback).toHaveBeenNthCalledWith(
					2,
					...authCall,
				);
				expect(mocks.setProviderStatus).toHaveBeenNthCalledWith(2, {
					providerId: PROVIDER,
					status: "authenticated",
				});
				// Only the successful retry consumed the state
				expect(mocks.clearOAuthState).toHaveBeenCalledTimes(1);
				expect(vaultModel.oauthState.state).toBeNull();
			},
		);

		it.each(terminalFailures)(
			"clears the OAuth state on a terminal failure (%s)",
			async (_label, buildFailure) => {
				mocks.handleGoogleDriveOAuthCallback.mockRejectedValue(buildFailure());
				startOAuthFlow();
				const sendOpenUrl = initializeService();

				sendOpenUrl([VALID_URL]);
				await vi.waitFor(() =>
					expect(mocks.handleGoogleDriveOAuthCallback).toHaveBeenCalledTimes(1),
				);

				// Terminal: the flow is closed and the pending request is dropped
				expect(mocks.clearOAuthState).toHaveBeenCalledTimes(1);
				expect(vaultModel.oauthState.state).toBeNull();
				expect(mocks.setProviderStatus).toHaveBeenCalledExactlyOnceWith({
					providerId: PROVIDER,
					status: "error",
				});

				// The terminal failure keeps the callback identity (a permanent mark), so the
				// re-delivery is discarded as a duplicate; the backend is out of reach anyway,
				// since the pending state is gone.
				sendOpenUrl([VALID_URL]);
				await flush();

				expect(mocks.handleGoogleDriveOAuthCallback).toHaveBeenCalledTimes(1);
				expect(mocks.setProviderStatus).not.toHaveBeenCalledWith({
					providerId: PROVIDER,
					status: "authenticated",
				});
			},
		);

		it("treats a provider error callback (?error=) as terminal", async () => {
			startOAuthFlow();
			const sendOpenUrl = initializeService();

			sendOpenUrl([
				`monark://oauth/callback?error=access_denied&state=${OAUTH_STATE}`,
			]);
			await flush();

			expect(mocks.handleGoogleDriveOAuthCallback).not.toHaveBeenCalled();
			expect(mocks.clearOAuthState).toHaveBeenCalledTimes(1);
			// The pending request is gone: the flow is closed
			expect(vaultModel.oauthState.state).toBeNull();
			// The access_denied retry cannot succeed either: the URL is remembered
			sendOpenUrl([
				`monark://oauth/callback?error=access_denied&state=${OAUTH_STATE}`,
			]);
			await flush();
			expect(mocks.clearOAuthState).toHaveBeenCalledTimes(1);
		});

		it.each([
			["a foreign state", "state=forged-state"],
			["no state parameter at all", "provider=google"],
		])(
			"ignores an injected error callback with %s without aborting the pending flow",
			async (_label, query) => {
				startOAuthFlow();
				const sendOpenUrl = initializeService();

				sendOpenUrl([`monark://oauth/callback?error=access_denied&${query}`]);
				await flush();

				// The forged callback must not be able to cancel the sign-in in progress:
				// the pending OAuth request is left untouched
				expect(mocks.handleGoogleDriveOAuthCallback).not.toHaveBeenCalled();
				expect(mocks.clearOAuthState).not.toHaveBeenCalled();
				expect(mocks.setProviderStatus).not.toHaveBeenCalled();
				expect(vaultModel.oauthState.state).toBe(OAUTH_STATE);

				// ...and the legitimate callback still completes
				sendOpenUrl([VALID_URL]);
				await vi.waitFor(() =>
					expect(
						mocks.handleGoogleDriveOAuthCallback,
					).toHaveBeenCalledExactlyOnceWith(...authCall),
				);
				expect(mocks.clearOAuthState).toHaveBeenCalledTimes(1);
				expect(mocks.setProviderStatus).toHaveBeenCalledExactlyOnceWith({
					providerId: PROVIDER,
					status: "authenticated",
				});
			},
		);
	});

	describe("processed callbacks bookkeeping", () => {
		it("bounds the remembered callbacks and still de-duplicates the recent ones", async () => {
			startOAuthFlow();
			const sendOpenUrl = initializeService();

			const overflow = 2;
			const total = MAX_PROCESSED_CALLBACKS + overflow;

			// Deliver more distinct callbacks than the cap allows
			for (let i = 0; i < total; i++) {
				startOAuthFlow();
				sendOpenUrl([callbackUrl(`code-${i}`)]);
			}
			await vi.waitFor(() =>
				expect(mocks.handleGoogleDriveOAuthCallback).toHaveBeenCalledTimes(
					total,
				),
			);

			// The `overflow` oldest identities were evicted, so they are processed again...
			for (let i = 0; i < overflow; i++) {
				startOAuthFlow();
				sendOpenUrl([callbackUrl(`code-${i}`)]);
			}
			await vi.waitFor(() =>
				expect(mocks.handleGoogleDriveOAuthCallback).toHaveBeenCalledTimes(
					total + overflow,
				),
			);

			// ...while the newest identities are still de-duplicated
			for (let i = total - 6; i < total; i++) {
				startOAuthFlow();
				sendOpenUrl([callbackUrl(`code-${i}`)]);
			}
			await flush();

			expect(mocks.handleGoogleDriveOAuthCallback).toHaveBeenCalledTimes(
				total + overflow,
			);
		});
	});

	describe("multi-URL batch iteration (onOpenUrl)", () => {
		it("processes the callback delivered after a non-OAuth URL in the same batch", async () => {
			startOAuthFlow();
			const sendOpenUrl = initializeService();

			sendOpenUrl([
				"not a url at all",
				`https://example.com/x?code=abc&state=${OAUTH_STATE}`,
				VALID_URL,
			]);

			await vi.waitFor(() =>
				expect(
					mocks.handleGoogleDriveOAuthCallback,
				).toHaveBeenCalledExactlyOnceWith(...authCall),
			);
			// ...and only once: iteration stops at the first claimed callback
			expect(mocks.setProviderStatus).toHaveBeenCalledExactlyOnceWith({
				providerId: PROVIDER,
				status: "authenticated",
			});
			expect(mocks.clearOAuthState).toHaveBeenCalledTimes(1);
		});

		it("stops at the first claimed callback even when its state validation failed", async () => {
			// No pending OAuth request: the first callback is *claimed* (parse accepted
			// it) and rejected by the state validation, so iteration must stop there —
			// a claimed callback consumes the batch even when its outcome is an error.
			const sendOpenUrl = initializeService();

			sendOpenUrl([
				`monark://oauth/callback?code=first&state=${OAUTH_STATE}`,
				`monark://oauth/callback?code=second&state=${OAUTH_STATE}`,
			]);

			await flush();
			// The first one was claimed (and rejected), so the loop stopped there and the
			// second callback was NOT processed: claiming stops the iteration.
			expect(mocks.clearOAuthState).toHaveBeenCalledTimes(1);
			expect(mocks.handleGoogleDriveOAuthCallback).not.toHaveBeenCalled();
		});
	});

	describe("single-instance args", () => {
		it("handles an uppercase-scheme callback (parser lowercases the protocol)", async () => {
			startOAuthFlow();
			const sendSingleInstance = initializeServiceWithSingleInstance();
			sendSingleInstance([
				`Monark://oauth/callback?code=abc&state=${OAUTH_STATE}`,
			]);

			await vi.waitFor(() =>
				expect(
					mocks.handleGoogleDriveOAuthCallback,
				).toHaveBeenCalledExactlyOnceWith(...authCall),
			);
			expect(mocks.clearOAuthState).toHaveBeenCalledTimes(1);
		});

		it("handles the callback when it is not the first arg", async () => {
			startOAuthFlow();
			const sendSingleInstance = initializeServiceWithSingleInstance();

			sendSingleInstance(["https://example.com/x", VALID_URL]);

			await vi.waitFor(() =>
				expect(
					mocks.handleGoogleDriveOAuthCallback,
				).toHaveBeenCalledExactlyOnceWith(...authCall),
			);
		});

		it("warns 'No deep link found' only when no arg is a callback", async () => {
			const sendSingleInstance = initializeServiceWithSingleInstance();

			sendSingleInstance(["https://example.com/x", "monark://vault/open"]);
			await flush();

			expect(mocks.handleGoogleDriveOAuthCallback).not.toHaveBeenCalled();
			expect(console.warn).toHaveBeenCalledWith(
				"[DeepLinkService] No deep link found in single-instance args",
			);

			// With a claimed callback the warning must NOT fire
			vi.mocked(console.warn).mockClear();
			startOAuthFlow();
			sendSingleInstance([VALID_URL]);
			await vi.waitFor(() =>
				expect(
					mocks.handleGoogleDriveOAuthCallback,
				).toHaveBeenCalledExactlyOnceWith(...authCall),
			);
			expect(console.warn).not.toHaveBeenCalledWith(
				"[DeepLinkService] No deep link found in single-instance args",
			);
		});
	});

	describe("handleDeepLink return contract", () => {
		it("returns false for URLs that are not monark OAuth callbacks", async () => {
			initializeService();

			await expect(invokeHandleDeepLink("not a url at all")).resolves.toBe(
				false,
			);
			await expect(
				invokeHandleDeepLink(
					`https://example.com/x?code=abc&state=${OAUTH_STATE}`,
				),
			).resolves.toBe(false);
			// monark scheme but none of code/state/error → not a callback
			await expect(
				invokeHandleDeepLink("monark://vault/open?path=/vault"),
			).resolves.toBe(false);
			expect(mocks.setProviderStatus).not.toHaveBeenCalled();
			expect(mocks.clearOAuthState).not.toHaveBeenCalled();
		});

		it("returns true for a claimed callback, even when the dedupe set ignores it", async () => {
			startOAuthFlow();
			initializeService();

			await expect(invokeHandleDeepLink(VALID_URL)).resolves.toBe(true);
			expect(
				mocks.handleGoogleDriveOAuthCallback,
			).toHaveBeenCalledExactlyOnceWith(...authCall);

			// The duplicate is ignored by the reservation but still claimed: the caller
			// must stop iterating at it.
			await expect(invokeHandleDeepLink(VALID_URL)).resolves.toBe(true);
			expect(mocks.handleGoogleDriveOAuthCallback).toHaveBeenCalledTimes(1);
		});

		it("returns true for a claimed callback rejected by state validation", async () => {
			// No pending OAuth request → handled and rejected, but still claimed
			initializeService();

			await expect(invokeHandleDeepLink(VALID_URL)).resolves.toBe(true);
			expect(mocks.handleGoogleDriveOAuthCallback).not.toHaveBeenCalled();
			expect(mocks.clearOAuthState).toHaveBeenCalledTimes(1);
		});
	});

	describe("classifyCloudFailure (shared contract)", () => {
		it.each([
			["transient (network) contract message", NETWORK_MESSAGE, "transient"],
			[
				"transient local-storage contract message (network or local storage error)",
				LOCAL_STORAGE_MESSAGE,
				"transient",
			],
			[
				"unclassified message containing 'connection'",
				"connection reset by peer",
				"transient",
			],
			[
				"NETWORK_ERROR type from the wrapper",
				{ type: CloudStorageErrorType.NETWORK_ERROR, message: "opaque" },
				"transient",
			],
			["authentication rejection", AUTH_MESSAGE, "terminal"],
			[
				"AUTHENTICATION_FAILED wins over a network-looking message",
				{
					type: CloudStorageErrorType.AUTHENTICATION_FAILED,
					message: NETWORK_MESSAGE,
				},
				"terminal",
			],
			[
				"a raw message with both an auth and a network keyword (handleError precedence: auth first)",
				"authentication failed while reaching the token endpoint: network unreachable",
				"terminal",
			],
			[
				"a raw message with both a token/expired and a network keyword (token rung before network)",
				"token expired: connection closed by peer",
				"terminal",
			],
			[
				"TOKEN_EXPIRED type",
				{ type: CloudStorageErrorType.TOKEN_EXPIRED, message: "token expired" },
				"terminal",
			],
			[
				"OPERATION_FAILED (conservative fallback)",
				{
					type: CloudStorageErrorType.OPERATION_FAILED,
					message: "keyring unavailable",
				},
				"terminal",
			],
			["unclassified Error", new Error("keyring unavailable"), "terminal"],
			["a value without message", undefined, "terminal"],
		])("classifies %s as %s", (_label, error, expected) => {
			expect(classifyCloudFailure(error)).toBe(expected);
		});
	});

	describe("windows message fallback", () => {
		it("no longer reacts to window messages (dead code removed)", async () => {
			startOAuthFlow();
			initializeService();

			window.dispatchEvent(
				new MessageEvent("message", {
					origin: window.location.origin,
					data: { type: "oauth_callback", url: VALID_URL },
				}),
			);

			await flush();
			expect(mocks.handleGoogleDriveOAuthCallback).not.toHaveBeenCalled();
		});
	});
});
