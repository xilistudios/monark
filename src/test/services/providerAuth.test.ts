/**
 * Provider authentication-state contract tests (issue #28, T5).
 *
 * Pins `src/services/providerAuth.ts`, the merged replacement of the two
 * private copies of the provider-auth logic (VaultInstance's one-shot check
 * and VaultManager's retry ladder).
 *
 * The ★ rows are the D1 behaviour change (B1/B2/B3 in the change register):
 * a **terminal** failure is NO LONGER retried and NO LONGER reported as
 * `transientError` — it resolves immediately as `{ authenticated: false,
 * expired: true }` so the call sites prompt a re-login.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CloudStorageErrorType } from "../../interfaces/cloud-storage.interface";
import { CloudStorageCommands } from "../../services/cloudStorage";
import {
	getProviderAuthState,
	MANAGER_RETRY_POLICY,
	NO_RETRY_POLICY,
	type RetryPolicy,
} from "../../services/providerAuth";

vi.mock("../../services/cloudStorage", () => ({
	CloudStorageCommands: {
		getProviderAuthInfo: vi.fn(),
		refreshProviderAuth: vi.fn(),
	},
}));

const getProviderAuthInfo = vi.mocked(CloudStorageCommands.getProviderAuthInfo);
const refreshProviderAuth = vi.mocked(CloudStorageCommands.refreshProviderAuth);

/** A date comfortably inside the token's freshness window. */
const FRESH_EXPIRY = new Date(Date.now() + 3_600_000).toISOString();
/** A date past the 5-minute expiry buffer. */
const STALE_EXPIRY = new Date(Date.now() - 60_000).toISOString();

/**
 * The conservative unclassified message of the backend contract
 * (`AuthFailureClass::Other`): no routing keyword on purpose, so every ladder
 * rung declines it and `classifyCloudFailure` falls back to `"terminal"`.
 */
const CONTRACT_TERMINAL_MESSAGE = "Cloud storage operation failed";

/** Backend `AuthRejection` contract message (rung 1 of the keyword ladder). */
const AUTH_REJECTION_MESSAGE =
	"authentication failed while refreshing the Google Drive access token (re-authenticate): invalid_grant";

/** Backend `Transient` contract message (rung 3 of the keyword ladder). */
const TRANSIENT_MESSAGE =
	"network error while refreshing the Google Drive access token: connection reset by peer";

const info = (authenticated: boolean, token_expires_at: string | null) => ({
	authenticated,
	token_expires_at,
});

const ALL_POLICIES: ReadonlyArray<readonly [string, RetryPolicy]> = [
	["NO_RETRY_POLICY", NO_RETRY_POLICY],
	["MANAGER_RETRY_POLICY", MANAGER_RETRY_POLICY],
];

beforeEach(() => {
	vi.spyOn(console, "warn").mockImplementation(() => {});
	vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
	vi.restoreAllMocks();
	vi.clearAllMocks();
});

describe("getProviderAuthState", () => {
	describe("rungs 1-3 (no refresh needed)", () => {
		it.each(ALL_POLICIES)(
			"getProviderAuthInfo null ⇒ {false, true} (%s)",
			async (_label, policy) => {
				getProviderAuthInfo.mockResolvedValue(null as never);

				expect(await getProviderAuthState("google-drive", policy)).toEqual({
					authenticated: false,
					expired: true,
				});
				expect(getProviderAuthInfo).toHaveBeenCalledTimes(1);
				expect(refreshProviderAuth).not.toHaveBeenCalled();
			},
		);

		it("a stateless provider (token_expires_at null) is authenticated without ever refreshing", async () => {
			getProviderAuthInfo.mockResolvedValue(info(true, null));

			expect(
				await getProviderAuthState("webdav", MANAGER_RETRY_POLICY),
			).toEqual({ authenticated: true, expired: false });
			expect(refreshProviderAuth).not.toHaveBeenCalled();
		});

		it("a stateless provider that reports unauthenticated is {false, false}", async () => {
			getProviderAuthInfo.mockResolvedValue(info(false, null));

			expect(
				await getProviderAuthState("webdav", MANAGER_RETRY_POLICY),
			).toEqual({ authenticated: false, expired: false });
			expect(refreshProviderAuth).not.toHaveBeenCalled();
		});

		it("a fresh token with authenticated:true ⇒ {true, false} (no refresh)", async () => {
			getProviderAuthInfo.mockResolvedValue(info(true, FRESH_EXPIRY));

			expect(
				await getProviderAuthState("google-drive", MANAGER_RETRY_POLICY),
			).toEqual({ authenticated: true, expired: false });
			expect(refreshProviderAuth).not.toHaveBeenCalled();
		});

		it("a fresh token with authenticated:false ⇒ {false, false} (no refresh)", async () => {
			getProviderAuthInfo.mockResolvedValue(info(false, FRESH_EXPIRY));

			expect(
				await getProviderAuthState("google-drive", MANAGER_RETRY_POLICY),
			).toEqual({ authenticated: false, expired: false });
			expect(refreshProviderAuth).not.toHaveBeenCalled();
		});
	});

	describe("★ rung 4 failure classification (D1 delta: terminal ⇒ no retry)", () => {
		it("★ expired + CONTRACT_TERMINAL_MESSAGE ⇒ {false, true}, ONE refresh call, NO backoff", async () => {
			getProviderAuthInfo.mockResolvedValue(info(true, STALE_EXPIRY));
			refreshProviderAuth.mockRejectedValue(
				new Error(CONTRACT_TERMINAL_MESSAGE),
			);

			const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");

			expect(
				await getProviderAuthState("google-drive", MANAGER_RETRY_POLICY),
			).toEqual({ authenticated: false, expired: true });
			expect(refreshProviderAuth).toHaveBeenCalledTimes(1);
			// D1: a terminal failure must not sleep/backoff at all, not even for a
			// single millisecond — the verdict does not depend on time passing.
			expect(setTimeoutSpy).not.toHaveBeenCalled();
		});

		it("★ expired + AUTHENTICATION_FAILED-shaped rejection ⇒ {false, true}, ONE refresh call", async () => {
			getProviderAuthInfo.mockResolvedValue(info(true, STALE_EXPIRY));
			refreshProviderAuth.mockRejectedValue(new Error(AUTH_REJECTION_MESSAGE));

			expect(
				await getProviderAuthState("google-drive", MANAGER_RETRY_POLICY),
			).toEqual({ authenticated: false, expired: true });
			expect(refreshProviderAuth).toHaveBeenCalledTimes(1);
		});

		it("★ a NETWORK_ERROR wrapper during refresh is retried (contrast row: transient ≠ terminal)", async () => {
			getProviderAuthInfo.mockResolvedValue(info(true, STALE_EXPIRY));
			refreshProviderAuth.mockRejectedValue({
				type: CloudStorageErrorType.NETWORK_ERROR,
				message: TRANSIENT_MESSAGE,
			});

			expect(
				await getProviderAuthState("google-drive", NO_RETRY_POLICY),
			).toEqual({ authenticated: false, expired: false, transientError: true });
			expect(refreshProviderAuth).toHaveBeenCalledTimes(1);
		});
	});

	describe("rung 4 transient retry ladder", () => {
		it("transient rejection + NO_RETRY_POLICY ⇒ ONE refresh call, {false, false, transientError:true}", async () => {
			getProviderAuthInfo.mockResolvedValue(info(true, STALE_EXPIRY));
			refreshProviderAuth.mockRejectedValue(new Error(TRANSIENT_MESSAGE));

			expect(
				await getProviderAuthState("google-drive", NO_RETRY_POLICY),
			).toEqual({ authenticated: false, expired: false, transientError: true });
			expect(refreshProviderAuth).toHaveBeenCalledTimes(1);
		});

		it("transient rejection + {retries:1, baseDelayMs:1} ⇒ TWO refresh calls, then transientError:true", async () => {
			vi.spyOn(console, "warn").mockImplementation(() => {});
			getProviderAuthInfo.mockResolvedValue(info(true, STALE_EXPIRY));
			refreshProviderAuth.mockRejectedValue(new Error(TRANSIENT_MESSAGE));

			expect(
				await getProviderAuthState("google-drive", {
					retries: 1,
					baseDelayMs: 1,
				}),
			).toEqual({ authenticated: false, expired: false, transientError: true });
			expect(refreshProviderAuth).toHaveBeenCalledTimes(2);
		});

		it("transient rejection + MANAGER_RETRY_POLICY ⇒ the exact exponential ladder 1000, 2000, 4000 ms", async () => {
			vi.spyOn(console, "warn").mockImplementation(() => {});
			getProviderAuthInfo.mockResolvedValue(info(true, STALE_EXPIRY));
			refreshProviderAuth.mockRejectedValue(new Error(TRANSIENT_MESSAGE));

			vi.useFakeTimers();
			// Spy on `setTimeout` AFTER `useFakeTimers()` so the spy wraps the fake
			// scheduler itself: the recorded delays are the ones the backoff really
			// requested (`baseDelayMs * 2^attempt`) while the timers still fire via
			// `advanceTimersByTimeAsync` below.
			const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");
			try {
				const promise = getProviderAuthState(
					"google-drive",
					MANAGER_RETRY_POLICY,
				);
				// Drain each backoff as it is scheduled (1s + 2s + 4s ladder).
				for (let tick = 0; tick < 16; tick++) {
					await vi.advanceTimersByTimeAsync(8_000);
				}

				expect(await promise).toEqual({
					authenticated: false,
					expired: false,
					transientError: true,
				});
				// 1 attempt + MANAGER_RETRY_POLICY.retries (3) = 4 refresh calls…
				expect(refreshProviderAuth).toHaveBeenCalledTimes(4);
				// …separated by exactly `baseDelayMs * 2^attempt`: 1000, 2000, 4000.
				// (A constant delay would survive every other row in this file.)
				expect(setTimeoutSpy.mock.calls.map(([, ms]) => ms as number)).toEqual([
					1000, 2000, 4000,
				]);
			} finally {
				setTimeoutSpy.mockRestore();
				vi.useRealTimers();
			}
		});

		it("transient then success ⇒ {true, false} after exactly 2 refresh calls", async () => {
			getProviderAuthInfo.mockResolvedValue(info(true, STALE_EXPIRY));
			refreshProviderAuth
				.mockRejectedValueOnce(new Error(TRANSIENT_MESSAGE))
				.mockResolvedValueOnce({
					authenticated: true,
					token_expires_at: FRESH_EXPIRY,
				});

			expect(
				await getProviderAuthState("google-drive", {
					retries: 1,
					baseDelayMs: 0,
				}),
			).toEqual({ authenticated: true, expired: false });
			expect(refreshProviderAuth).toHaveBeenCalledTimes(2);
		});
	});

	describe("rung 4 success shapes", () => {
		it("refresh resolves falsy ⇒ {false, true}", async () => {
			getProviderAuthInfo.mockResolvedValue(info(true, STALE_EXPIRY));
			refreshProviderAuth.mockResolvedValue(undefined as never);

			expect(
				await getProviderAuthState("google-drive", NO_RETRY_POLICY),
			).toEqual({ authenticated: false, expired: true });
			expect(refreshProviderAuth).toHaveBeenCalledTimes(1);
		});

		it("refresh resolves a fresh token ⇒ {true, false}", async () => {
			getProviderAuthInfo.mockResolvedValue(info(true, STALE_EXPIRY));
			refreshProviderAuth.mockResolvedValue({
				authenticated: true,
				token_expires_at: FRESH_EXPIRY,
			});

			expect(
				await getProviderAuthState("google-drive", NO_RETRY_POLICY),
			).toEqual({ authenticated: true, expired: false });
			expect(refreshProviderAuth).toHaveBeenCalledTimes(1);
		});

		it("refresh resolves an already-stale token ⇒ {true, true} (backend kept a dead token)", async () => {
			getProviderAuthInfo.mockResolvedValue(info(true, STALE_EXPIRY));
			refreshProviderAuth.mockResolvedValue({
				authenticated: true,
				token_expires_at: STALE_EXPIRY,
			});

			expect(
				await getProviderAuthState("google-drive", NO_RETRY_POLICY),
			).toEqual({ authenticated: true, expired: true });
		});
	});

	describe("★ outer catch (getProviderAuthInfo throws)", () => {
		it("★ CONTRACT_TERMINAL_MESSAGE from getProviderAuthInfo ⇒ {false, true}, ONE call, NO transientError", async () => {
			getProviderAuthInfo.mockRejectedValue(
				new Error(CONTRACT_TERMINAL_MESSAGE),
			);

			expect(
				await getProviderAuthState("google-drive", MANAGER_RETRY_POLICY),
			).toEqual({ authenticated: false, expired: true });
			// B2: the unclassified `Other` message used to fall through the manager's
			// ladder-2 regexes into the transient bucket (3 retries → "idle").
			expect(getProviderAuthInfo).toHaveBeenCalledTimes(1);
		});

		it("transient rejection from getProviderAuthInfo ⇒ retry ladder, then transientError:true", async () => {
			getProviderAuthInfo.mockRejectedValue(new Error(TRANSIENT_MESSAGE));

			expect(
				await getProviderAuthState("google-drive", {
					retries: 1,
					baseDelayMs: 0,
				}),
			).toEqual({ authenticated: false, expired: false, transientError: true });
			expect(getProviderAuthInfo).toHaveBeenCalledTimes(2);
		});

		it("m2: the ladder retries re-run only the failing rung (getProviderAuthInfo ×1, refresh ×4)", async () => {
			// Delta vs. the old `VaultManager.getProviderAuthState`, which
			// re-ran `getProviderAuthInfo` before EVERY refresh retry (4 info + 4
			// refresh). The merged ladder retries ONLY the rung that failed, so a
			// failing refresh costs 1 info call + 4 refresh calls — same verdicts,
			// fewer IPC calls. `retries: 3, baseDelayMs: 0` mirrors the manager's
			// retry count with the backoff zeroed, so no sleeping is involved.
			getProviderAuthInfo.mockResolvedValue(info(true, STALE_EXPIRY));
			refreshProviderAuth.mockRejectedValue(new Error(TRANSIENT_MESSAGE));

			expect(
				await getProviderAuthState("google-drive", {
					retries: 3,
					baseDelayMs: 0,
				}),
			).toEqual({ authenticated: false, expired: false, transientError: true });
			expect(getProviderAuthInfo).toHaveBeenCalledTimes(1);
			expect(refreshProviderAuth).toHaveBeenCalledTimes(4);
		});
	});

	describe("exact-shape pins", () => {
		it("a transient result is exactly {false, false, transientError:true}", async () => {
			getProviderAuthInfo.mockRejectedValue(new Error(TRANSIENT_MESSAGE));

			const state = await getProviderAuthState("google-drive", NO_RETRY_POLICY);

			expect(state).toEqual({
				authenticated: false,
				expired: false,
				transientError: true,
			});
			// Load-bearing: a transient check failure must NOT read as an auth
			// failure at the call sites (`expired` false) and must carry the
			// `transientError` flag they branch on.
			expect(state.expired).toBe(false);
			expect(state.authenticated).toBe(false);
		});

		it("a terminal failure is exactly {false, true} with no transientError key", async () => {
			getProviderAuthInfo.mockResolvedValue(info(true, STALE_EXPIRY));
			refreshProviderAuth.mockRejectedValue(
				new Error(CONTRACT_TERMINAL_MESSAGE),
			);

			const state = await getProviderAuthState(
				"google-drive",
				MANAGER_RETRY_POLICY,
			);

			expect(state).toEqual({ authenticated: false, expired: true });
			expect(state.expired).toBe(true);
			expect(state.transientError).toBeUndefined();
		});
	});

	describe("policies", () => {
		it("the exported policies are frozen constants", () => {
			expect(NO_RETRY_POLICY).toEqual({ retries: 0, baseDelayMs: 0 });
			expect(MANAGER_RETRY_POLICY).toEqual({ retries: 3, baseDelayMs: 1000 });
			expect(Object.isFrozen(NO_RETRY_POLICY)).toBe(true);
			expect(Object.isFrozen(MANAGER_RETRY_POLICY)).toBe(true);
		});
	});
});
