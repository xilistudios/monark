/**
 * Provider authentication-state resolution (issue #28, T5).
 *
 * This module is the single source of truth for "is provider X still
 * authenticated?" and replaces the TWO private copies that used to live in
 * `src/services/vault.ts`:
 *
 * - `VaultInstance.getProviderAuthState` (one call, no backoff);
 * - `VaultManager.getProviderAuthState` (3 retries with 1s→2s→4s backoff, and
 *   a distinguishable `transientError: true` result instead of a thrown
 *   error).
 *
 * AddVaultForm's `ensureProviderAuthenticated` is now a thin mapping over this
 * module; the local classification ladder that remains in its
 * `handleCreateVault` is a known duplicate pending migration.
 *
 * The merged semantics are the manager's (its callers read `transientError`),
 * parameterised by a {@link RetryPolicy} so the instance keeps its one-shot
 * behaviour and the manager keeps its retry ladder. The failure classification
 * is delegated to the shared contract module (`./cloudStorageErrors`):
 * `classifyCloudFailure` decides *retry* vs *terminal*, `isAccessTokenExpired`
 * decides *expired* vs *fresh*.
 *
 * ## Why the terminal bucket never retries
 *
 * A **terminal** failure (`classifyCloudFailure(error) === "terminal"`, the
 * conservative default of the shared contract) means retrying the very same
 * request cannot succeed: the credentials were refused, the quota is gone, the
 * provider is misconfigured, or the failure is unclassified on purpose (the
 * backend's `AuthFailureClass::Other`). Retrying would just burn time and
 * backoff slots before reaching the same verdict, so the state resolves
 * IMMEDIATELY as `{ authenticated: false, expired: true }`.
 *
 * A **transient** failure is retried per the policy and, once exhausted,
 * resolves as `{ authenticated: false, expired: false, transientError: true }`.
 *
 * ## Reading the two "failure" results (load-bearing shapes)
 *
 * - `{ authenticated: false, expired: true }` ⇒ the provider must be treated
 *   as **needs re-auth**: the call sites open the OAuth flow / show the
 *   "expired" status (`unlock`, `loadProviders`, `refreshCloudVaults`).
 * - `{ authenticated: false, expired: false, transientError: true }` ⇒ the
 *   check itself failed for possibly-transient reasons: the credentials may
 *   still be fine, so the call sites must **NOT** prompt a re-login. In
 *   `loadProviders` this stays an "idle" status (the provider is simply not
 *   classified), in `refreshCloudVaults` it counts as a network error that
 *   keeps the cached vaults. This exact shape is load-bearing: it must never
 *   be collapsed into `expired: true`, otherwise a network cut would sign the
 *   user out.
 *
 * The module imports ONLY `./cloudStorage` and `./cloudStorageErrors` — never
 * `./vault` — so `vault.ts` can import it without creating an import cycle.
 *
 * @module providerAuth
 */

import { CloudStorageCommands } from "./cloudStorage";
import {
	classifyCloudFailure,
	isAccessTokenExpired,
} from "./cloudStorageErrors";

/**
 * How many extra attempts (beyond the first) a transient provider-auth failure
 * gets, and the base delay of the exponential backoff
 * (`baseDelayMs * 2^attempt`).
 */
export interface RetryPolicy {
	/** Extra attempts after the first one (0 = one call total). */
	readonly retries: number;
	/** Base backoff delay in milliseconds (0 = no backoff). */
	readonly baseDelayMs: number;
}

/**
 * Policy of `VaultInstance` (unlock / sync) and of `AddVaultForm`
 * (`ensureProviderAuthenticated`): a single auth-state call, no backoff. The
 * unlock path already prompts a re-auth on `!authenticated || expired`, so a
 * transient check failure resolving as `transientError: true` (i.e.
 * `authenticated: false`) converges on the same prompt as today (behaviour
 * change B4).
 *
 * NOTE the two consumers read `transientError` DIFFERENTLY: while the unlock
 * path converges on its re-auth prompt, `AddVaultForm` maps
 * `transientError` to its retryable "refresh failed" UI ("Could not renew the
 * cloud session…", `vaultSelector.authRefreshFailed`) — it is NOT a re-auth
 * prompt.
 */
export const NO_RETRY_POLICY: RetryPolicy = Object.freeze({
	retries: 0,
	baseDelayMs: 0,
});

/**
 * Policy of `VaultManager` (`loadProviders` / `refreshCloudVaults`): 3 extra
 * attempts with 1s→2s→4s backoff — the ladder
 * `VaultManager.getProviderAuthState` used to implement inline (same retry
 * count, same backoff).
 */
export const MANAGER_RETRY_POLICY: RetryPolicy = Object.freeze({
	retries: 3,
	baseDelayMs: 1000,
});

/**
 * Authentication state of a storage provider.
 *
 * `transientError` is only present (and `true`) when the check could not be
 * completed for a possibly-transient reason; see the module doc for why it must
 * never be read as an auth failure.
 */
export interface ProviderAuthState {
	readonly authenticated: boolean;
	readonly expired: boolean;
	readonly transientError?: boolean;
}

/** Resolve after `ms` (0 still yields to the event loop for one tick). */
const sleep = (ms: number): Promise<void> =>
	new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Back off for the given attempt (0-based) and report it.
 */
const backoff = async (
	name: string,
	scope: string,
	attempt: number,
	policy: RetryPolicy,
	error: unknown,
): Promise<void> => {
	const delay = policy.baseDelayMs * 2 ** attempt;
	console.warn(
		`Transient error ${scope} provider ${name}, retrying in ${delay}ms (attempt ${attempt + 1}/${policy.retries}):`,
		error,
	);
	await sleep(delay);
};

/**
 * Resolve the authentication state of a provider, refresh-aware and
 * retry-aware.
 *
 * Decision ladder (first match wins):
 *
 * 1. `getProviderAuthInfo` falsy ⇒ no credentials stored ⇒
 *    `{ authenticated: false, expired: true }`.
 * 2. `token_expires_at == null` (stateless credentials: WebDAV Basic auth)
 *    ⇒ `{ authenticated: authInfo.authenticated, expired: false }`; there is
 *    nothing to refresh, so the refresh flow is skipped entirely.
 * 3. Token still fresh (within the `isAccessTokenExpired` buffer)
 *    ⇒ `{ authenticated: authInfo.authenticated, expired: false }`.
 * 4. Token expired ⇒ one `refreshProviderAuth` call (plus `policy.retries`
 *    more only if the failure is transient):
 *    - refresh succeeds (truthy) ⇒ `{ authenticated: refreshed.authenticated,
 *      expired: isAccessTokenExpired(refreshed.token_expires_at) }`;
 *    - refresh resolves falsy ⇒ `{ authenticated: false, expired: true }`;
 *    - refresh throws ⇒ the `classify` ladder below decides retry vs terminal.
 * 5. `getProviderAuthInfo` itself throws ⇒ the same `classify` ladder.
 *
 * ## `classify` (shared by the info and the refresh rungs)
 *
 * - `terminal` (DELTA ★, behaviour change B1/B2/B3): resolves IMMEDIATELY as
 *   `{ authenticated: false, expired: true }` — no retry, no backoff. Before
 *   this module the manager retried operational errors three times and then
 *   reported `transientError` (an "idle" status); an unclassified or
 *   credential-shaped failure now surfaces as "expired" so the user is asked
 *   to re-login.
 * - `transient`: retries up to `policy.retries` more times with exponential
 *   backoff (`baseDelayMs * 2^attempt`) and, once exhausted, resolves as
 *   `{ authenticated: false, expired: false, transientError: true }` (the
 *   manager's behaviour today).
 *
 * @param name - Backend name of the storage provider
 * @param policy - Retry policy (see {@link NO_RETRY_POLICY} / {@link MANAGER_RETRY_POLICY})
 * @returns The provider authentication state (never rejects)
 */
export async function getProviderAuthState(
	name: string,
	policy: RetryPolicy,
): Promise<ProviderAuthState> {
	const classify = (error: unknown): ProviderAuthState => {
		if (classifyCloudFailure(error) === "terminal") {
			console.warn(
				`Terminal auth failure for provider ${name}, not retrying:`,
				error,
			);
			return { authenticated: false, expired: true };
		}
		return { authenticated: false, expired: false, transientError: true };
	};

	/** `true` while another attempt is allowed under `policy`. */
	const canRetry = (attempt: number): boolean => attempt < policy.retries;

	const exhausted = (): ProviderAuthState => {
		// Under NO_RETRY_POLICY nothing was ever retried, so "all retries
		// exhausted" would be misleading — only log when a ladder was run.
		if (policy.retries > 0) {
			console.warn(
				`All retries exhausted for provider ${name}, marking as transient error`,
			);
		}
		return { authenticated: false, expired: false, transientError: true };
	};

	// ---- rung 4: refresh-aware --------------------------------------------
	const refresh = async (): Promise<ProviderAuthState> => {
		for (let attempt = 0; ; attempt++) {
			try {
				const refreshed = await CloudStorageCommands.refreshProviderAuth(name);
				if (!refreshed) {
					return { authenticated: false, expired: true };
				}
				return {
					authenticated: refreshed.authenticated === true,
					expired: isAccessTokenExpired(refreshed.token_expires_at),
				};
			} catch (error) {
				const verdict = classify(error);
				if (!verdict.transientError) {
					return verdict;
				}
				if (!canRetry(attempt)) {
					return exhausted();
				}
				await backoff(name, "refreshing", attempt, policy, error);
			}
		}
	};

	// ---- rungs 1-3 + outer catch ------------------------------------------
	for (let attempt = 0; ; attempt++) {
		try {
			const authInfo =
				(await CloudStorageCommands.getProviderAuthInfo(name)) ?? null;

			if (!authInfo) {
				// No credentials stored for this provider.
				return { authenticated: false, expired: true };
			}

			// Stateless credentials (e.g. WebDAV with Basic auth) report no
			// expiry and have nothing to refresh — never route them through
			// the refresh flow.
			if (authInfo.token_expires_at == null) {
				return {
					authenticated: authInfo.authenticated === true,
					expired: false,
				};
			}

			if (!isAccessTokenExpired(authInfo.token_expires_at)) {
				return {
					authenticated: authInfo.authenticated === true,
					expired: false,
				};
			}

			return refresh();
		} catch (error) {
			const verdict = classify(error);
			if (!verdict.transientError) {
				return verdict;
			}
			if (!canRetry(attempt)) {
				return exhausted();
			}
			await backoff(name, "checking", attempt, policy, error);
		}
	}
}
