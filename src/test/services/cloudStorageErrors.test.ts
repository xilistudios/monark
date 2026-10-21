/**
 * Cloud storage failure contract tests (issue #28).
 *
 * Pins the shared front-end module `src/services/cloudStorageErrors.ts`:
 * - `classifyCloudErrorType`: the exact 8-rung keyword ladder of
 *   `CloudStorageCommands.handleError` (wire-contract calibration — every rung,
 *   the precedence pairs, the case sensitivity);
 * - `classifyCloudFailure`: the merged transient/terminal classifier with its
 *   documented precedence (wrapper type > HTTP status > keyword ladder > raw
 *   transient pattern > conservative terminal), including the raw-message rows
 *   pinned by `deepLinkService.test.ts` / `vault.test.ts`;
 * - `isAccessTokenExpired`: the semantics of the former AddVaultForm copy —
 *   this file IS their home now (the `Access token expiry semantics` suite of
 *   `src/test/components/Vault/AddVaultForm.test.tsx` is removed by issue #28);
 * - `isAuthFailure`: the narrow "re-login prompt" rule (type wins, 401, and the
 *   regex verbatim from `src/services/vault.ts`).
 */

import { describe, expect, it } from "vitest";
import { CloudStorageErrorType } from "../../interfaces/cloud-storage.interface";
import {
	classifyCloudErrorType,
	classifyCloudFailure,
	isAccessTokenExpired,
	isAuthFailure,
} from "../../services/cloudStorageErrors";

/**
 * The real messages of the backend contract (`AuthFailureClass`, see
 * `src-tauri/src/commands/errors.rs`), i.e. what the IPC handler rejects with.
 */
const NETWORK_MESSAGE =
	"network error while exchanging the authorization code: connection reset by peer";
const AUTH_MESSAGE =
	"authentication failed while exchanging the authorization code (re-authenticate): invalid_grant";
const LOCAL_STORAGE_MESSAGE =
	"network or local storage error while refreshing the Google Drive access token: Failed to set keychain secret";

describe("classifyCloudErrorType", () => {
	it.each([
		[
			"authentication rung (keyword 1)",
			"authentication failed",
			CloudStorageErrorType.AUTHENTICATION_FAILED,
		],
		[
			"authentication rung (keyword 2)",
			"unauthorized access",
			CloudStorageErrorType.AUTHENTICATION_FAILED,
		],
		[
			"token/expired rung (both keywords)",
			"token expired",
			CloudStorageErrorType.TOKEN_EXPIRED,
		],
		[
			"network rung (keyword 1)",
			"network error",
			CloudStorageErrorType.NETWORK_ERROR,
		],
		[
			"network rung (keyword 2)",
			"connection reset by peer",
			CloudStorageErrorType.NETWORK_ERROR,
		],
		[
			"quota rung (keyword 1)",
			"quota exceeded",
			CloudStorageErrorType.QUOTA_EXCEEDED,
		],
		[
			"storage rung (keyword 2)",
			"storage quota exceeded",
			CloudStorageErrorType.QUOTA_EXCEEDED,
		],
		[
			"not found rung",
			"vault not found",
			CloudStorageErrorType.VAULT_NOT_FOUND,
		],
		[
			"permission rung (keyword 1)",
			"permission denied by provider",
			CloudStorageErrorType.PERMISSION_DENIED,
		],
		[
			"denied rung (keyword 2)",
			"access denied",
			CloudStorageErrorType.PERMISSION_DENIED,
		],
		[
			"provider/configured rung (both keywords)",
			"provider not configured",
			CloudStorageErrorType.PROVIDER_NOT_CONFIGURED,
		],
		[
			"credentials rung (keyword 1)",
			"invalid credentials supplied",
			CloudStorageErrorType.INVALID_CREDENTIALS,
		],
		[
			"invalid rung (keyword 2)",
			"the request was invalid",
			CloudStorageErrorType.INVALID_CREDENTIALS,
		],
		[
			"no rung matches",
			"something inexplicable happened",
			CloudStorageErrorType.OPERATION_FAILED,
		],
		["empty message", "", CloudStorageErrorType.OPERATION_FAILED],
	])("classifies %s", (_label, message, expected) => {
		expect(classifyCloudErrorType(message)).toBe(expected);
	});

	it.each([
		[
			"the authentication rung wins over the token/expired rung",
			"token expired: authentication failed",
			CloudStorageErrorType.AUTHENTICATION_FAILED,
		],
		[
			"the authentication rung wins over the network rung",
			"authentication failed while reaching the token endpoint: network unreachable",
			CloudStorageErrorType.AUTHENTICATION_FAILED,
		],
		[
			"the token/expired rung wins over the network rung",
			"token expired: connection closed by peer",
			CloudStorageErrorType.TOKEN_EXPIRED,
		],
		[
			"the quota rung wins over the not found rung",
			"quota exceeded: vault not found",
			CloudStorageErrorType.QUOTA_EXCEEDED,
		],
		[
			"the permission rung wins over the credentials rung",
			"permission denied: invalid credentials",
			CloudStorageErrorType.PERMISSION_DENIED,
		],
	])("%s", (_label, message, expected) => {
		expect(classifyCloudErrorType(message)).toBe(expected);
	});

	it("requires BOTH words of the provider/configured rung", () => {
		// "provider" alone must not trip PROVIDER_NOT_CONFIGURED
		expect(classifyCloudErrorType("unknown provider name")).toBe(
			CloudStorageErrorType.OPERATION_FAILED,
		);
		// "configured" alone must not trip it either
		expect(classifyCloudErrorType("already configured")).toBe(
			CloudStorageErrorType.OPERATION_FAILED,
		);
	});

	it("requires BOTH words of the token/expired rung", () => {
		expect(classifyCloudErrorType("refresh token stored")).toBe(
			CloudStorageErrorType.OPERATION_FAILED,
		);
	});

	it("matches case-sensitively (wire-contract calibration)", () => {
		// "Network" (capital N) is NOT a keyword: it must fall through to
		// OPERATION_FAILED exactly like the inline ladder did.
		expect(classifyCloudErrorType("Network error")).toBe(
			CloudStorageErrorType.OPERATION_FAILED,
		);
	});
});

/** Wrapper factory for the table below. */
const wrap = (type: CloudStorageErrorType, message = "ignored") => ({
	type,
	message,
});

describe("classifyCloudFailure", () => {
	describe("wrapper type wins over everything", () => {
		it.each([
			[CloudStorageErrorType.NETWORK_ERROR, "transient"],
			[CloudStorageErrorType.AUTHENTICATION_FAILED, "terminal"],
			[CloudStorageErrorType.TOKEN_EXPIRED, "terminal"],
			[CloudStorageErrorType.QUOTA_EXCEEDED, "terminal"],
			[CloudStorageErrorType.VAULT_NOT_FOUND, "terminal"],
			[CloudStorageErrorType.PERMISSION_DENIED, "terminal"],
			[CloudStorageErrorType.PROVIDER_NOT_CONFIGURED, "terminal"],
			[CloudStorageErrorType.INVALID_CREDENTIALS, "terminal"],
			[CloudStorageErrorType.OPERATION_FAILED, "terminal"],
		] as const)("type %s ⇒ %s", (type, expected) => {
			expect(classifyCloudFailure(wrap(type))).toBe(expected);
		});

		it("ignores a transient status and a transient message when the type is terminal", () => {
			expect(
				classifyCloudFailure({
					type: CloudStorageErrorType.OPERATION_FAILED,
					status: 503,
					message: "network network",
				}),
			).toBe("terminal");
		});

		it("ignores a terminal message when the type is NETWORK_ERROR", () => {
			expect(
				classifyCloudFailure({
					type: CloudStorageErrorType.NETWORK_ERROR,
					message: "authentication failed: invalid credentials",
				}),
			).toBe("transient");
		});

		it("ignores an unknown wrapper type string (validation)", () => {
			// Not a CloudStorageErrorType member ⇒ treated as a raw error and
			// classified by the message rungs ("network" ⇒ NETWORK_ERROR).
			expect(
				classifyCloudFailure({ type: "TRANSIENT", message: "network error" }),
			).toBe("transient");
		});
	});

	describe("HTTP status rung (raw errors only)", () => {
		it.each([401, 403])("status %s ⇒ terminal", (status) => {
			expect(classifyCloudFailure({ status })).toBe("terminal");
			expect(classifyCloudFailure({ statusCode: status })).toBe("terminal");
			// A terminal status wins over a transient-looking message.
			expect(classifyCloudFailure({ status, message: "network error" })).toBe(
				"terminal",
			);
		});

		it.each([408, 425, 429, 500, 502, 503, 504])(
			"status %s ⇒ transient",
			(status) => {
				expect(classifyCloudFailure({ status })).toBe("transient");
				expect(classifyCloudFailure({ statusCode: status })).toBe("transient");
			},
		);

		it("any other numeric status is undecided and falls through to the message rungs", () => {
			// With no classifiable message the conservative bucket applies.
			expect(classifyCloudFailure({ status: 400 })).toBe("terminal");
			expect(classifyCloudFailure({ statusCode: 418 })).toBe("terminal");
			expect(classifyCloudFailure({ status: 404 })).toBe("terminal");
			// But a classifiable message is never silenced by an unrelated status:
			// {status: 400, message: "timeout …"} was transient in both legacy
			// call-site copies and must stay transient.
			expect(
				classifyCloudFailure({
					status: 400,
					message: "timeout while refreshing",
				}),
			).toBe("transient");
			expect(
				classifyCloudFailure({
					status: 404,
					message: "authentication failed: invalid_grant",
				}),
			).toBe("terminal");
		});

		it("prefers status over statusCode (status ?? statusCode)", () => {
			expect(classifyCloudFailure({ status: 503, statusCode: 401 })).toBe(
				"transient",
			);
		});

		it("ignores a non-numeric status", () => {
			// Falls through to the message rungs; empty message ⇒ terminal
			expect(classifyCloudFailure({ status: "503" })).toBe("terminal");
		});
	});

	describe("raw-message rows (kept green from the existing suites)", () => {
		it.each([
			["the backend Transient contract message", NETWORK_MESSAGE, "transient"],
			["the backend AuthRejection contract message", AUTH_MESSAGE, "terminal"],
			[
				"a token/expired message carrying a network keyword (token rung before network)",
				"token expired: connection closed by peer",
				"terminal",
			],
			[
				"the backend local-storage Transient contract message",
				LOCAL_STORAGE_MESSAGE,
				"transient",
			],
			["the keyring unclassified message", "keyring unavailable", "terminal"],
			[
				"a 'temporarily unavailable' message (excluded words stay terminal)",
				"temporarily unavailable",
				"terminal",
			],
			["an invalid_grant Error", new Error("invalid_grant"), "terminal"],
			["a fetch-failed TypeError", new TypeError("fetch failed"), "transient"],
			["a timeout message", "timeout while refreshing", "transient"],
		] as const)("classifies %s", (_label, error, expected) => {
			expect(classifyCloudFailure(error)).toBe(expected);
		});

		it.each([
			["null", null],
			["undefined", undefined],
			["an empty object", {}],
			["an empty string", ""],
		] as const)("classifies %s as terminal (conservative)", (_label, error) => {
			expect(classifyCloudFailure(error)).toBe("terminal");
		});
	});
});

describe("isAccessTokenExpired", () => {
	const MINUTE_MS = 60 * 1000;

	it("treats a missing expiry as expired (backend contract)", () => {
		expect(isAccessTokenExpired(null)).toBe(true);
		expect(isAccessTokenExpired(undefined)).toBe(true);
		expect(isAccessTokenExpired("")).toBe(true);
	});

	it("treats an unparseable expiry as expired", () => {
		expect(isAccessTokenExpired("not-a-date")).toBe(true);
	});

	it("treats an already expired token as expired", () => {
		expect(
			isAccessTokenExpired(new Date(Date.now() - MINUTE_MS).toISOString()),
		).toBe(true);
	});

	it("treats a token expiring outside the 5 minute buffer as valid", () => {
		expect(
			isAccessTokenExpired(new Date(Date.now() + 6 * MINUTE_MS).toISOString()),
		).toBe(false);
	});

	it("treats a token expiring within the 5 minute buffer as expired", () => {
		// 30 seconds in the future: inside the buffer ⇒ expired.
		expect(
			isAccessTokenExpired(new Date(Date.now() + 30 * 1000).toISOString()),
		).toBe(true);
		// 1 minute in the future: inside the buffer ⇒ expired
		expect(
			isAccessTokenExpired(new Date(Date.now() + MINUTE_MS).toISOString()),
		).toBe(true);
		// 4 minutes in the future: also inside the buffer ⇒ expired
		expect(
			isAccessTokenExpired(new Date(Date.now() + 4 * MINUTE_MS).toISOString()),
		).toBe(true);
	});
});

describe("isAuthFailure", () => {
	it.each([
		[CloudStorageErrorType.AUTHENTICATION_FAILED, true],
		[CloudStorageErrorType.TOKEN_EXPIRED, true],
		[CloudStorageErrorType.INVALID_CREDENTIALS, true],
		[CloudStorageErrorType.NETWORK_ERROR, false],
		[CloudStorageErrorType.QUOTA_EXCEEDED, false],
		[CloudStorageErrorType.VAULT_NOT_FOUND, false],
		[CloudStorageErrorType.PERMISSION_DENIED, false],
		[CloudStorageErrorType.PROVIDER_NOT_CONFIGURED, false],
		[CloudStorageErrorType.OPERATION_FAILED, false],
	] as const)("wrapper type %s ⇒ %s", (type, expected) => {
		expect(isAuthFailure(wrap(type))).toBe(expected);
	});

	it("ignores the message when the wrapper type is present (type wins)", () => {
		expect(
			isAuthFailure({
				type: CloudStorageErrorType.QUOTA_EXCEEDED,
				message: "authentication failed",
			}),
		).toBe(false);
	});

	it.each([
		["an invalid_grant Error", new Error("invalid_grant"), true],
		["a 401 status", { status: 401 }, true],
		["a re-authenticate message", new Error("Please re-authenticate"), true],
		// Both alternatives of the token/expired regex are load-bearing:
		// `token.*expired` ("Access token has expired") and `expired.*token`.
		["an expired-token message", new Error("Access token has expired"), true],
		["an expired token message", new Error("expired token"), true],
		["an unrelated message", new Error("boom"), false],
		["a 403 status", { status: 403 }, false],
	] as const)("raw error: %s ⇒ %s", (_label, error, expected) => {
		expect(isAuthFailure(error)).toBe(expected);
	});
});
