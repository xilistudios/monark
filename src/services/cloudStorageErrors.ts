/**
 * Shared front-end failure contract for cloud storage operations (issue #28).
 *
 * This module is the single source of truth for how the front end interprets a
 * backend failure. It unifies three previously independent classifications:
 * - `AuthFailureClass` in `src-tauri/src/commands/errors.rs` (the backend's
 *   `transient` / `terminal` split of an auth failure), mirrored here by
 *   {@link classifyCloudFailure};
 * - the keyword ladder inlined in `CloudStorageCommands.handleError`
 *   (`src/services/cloudStorage.ts`), mirrored by {@link classifyCloudErrorType}
 *   and consumed by the wrapper itself (T3);
 * - the token-expiry and message-extraction helpers that used to be duplicated
 *   in `src/components/Vault/Forms/AddVaultForm.tsx` and
 *   `src/services/deepLinkService.ts` (the call-site copies are removed in the
 *   follow-up commits of issue #28).
 *
 * The module deliberately imports ONLY `../interfaces/cloud-storage.interface`
 * (types + enums), never `cloudStorage.ts`, so it can never introduce an import
 * cycle.
 *
 * @module cloudStorageErrors
 */

import { CloudStorageErrorType } from "../interfaces/cloud-storage.interface";

/**
 * Retryability of a cloud-storage failure, the front-end mirror of
 * `AuthFailureClass` in `src-tauri/src/commands/errors.rs` as observed through
 * `CloudStorageCommands.handleError` (`src/services/cloudStorage.ts`).
 *
 * - `"transient"`: the very same request can be retried (network / timeout /
 *   5xx / IO — the backend keeps the OAuth state so a retry can pass the `state`
 *   validation).
 * - `"terminal"`: retrying cannot succeed; the credentials must be renewed or
 *   the flow is closed.
 *
 * The **unclassified** bucket is deliberately **terminal** (conservative),
 * matching the Rust `AuthFailureClass::Other` doc ("the frontend falls back to
 * its conservative terminal bucket"). In particular a `token_persistence_failure`
 * message ("please sign in again") carries no routing keyword on purpose and
 * must land in the terminal bucket — retrying would just fail again while the
 * user is silently signed out.
 */
export type CloudFailureClass = "transient" | "terminal";

/**
 * 5-minute freshness buffer applied to an access-token expiry: a token is
 * treated as expired this long before its real expiry so it can be refreshed in
 * time instead of being used until the provider rejects it.
 *
 * Backend source of truth: `GoogleDriveConfig::is_token_expired` in
 * `src-tauri/src/storage/manager/provider_management.rs:356-358`
 * (`Utc::now() >= expires_at - chrono::Duration::minutes(5)`).
 */
export const TOKEN_EXPIRY_BUFFER_MS = 5 * 60 * 1000;

/**
 * Decide whether a Google Drive access token counts as expired.
 *
 * Exact semantics of the copy in `src/components/Vault/Forms/AddVaultForm.tsx`
 * (lines 54-66), which itself mirrors `GoogleDriveConfig::is_token_expired`
 * (backend source of truth, see {@link TOKEN_EXPIRY_BUFFER_MS}):
 *
 * - missing expiry (`null` / `undefined` / `""`) ⇒ `true` (no usable token);
 * - unparseable date (`NaN`) ⇒ `true` (fail closed);
 * - otherwise the token counts as expired from `TOKEN_EXPIRY_BUFFER_MS` before
 *   its real expiry (`Date.now() >= expiresAt - TOKEN_EXPIRY_BUFFER_MS`).
 *
 * @param tokenExpiresAt - ISO 8601 expiration date reported by the backend
 * @returns `true` when the token must be refreshed before use
 */
export function isAccessTokenExpired(tokenExpiresAt?: string | null): boolean {
	if (!tokenExpiresAt) {
		// No expiry metadata means no usable access token (backend contract)
		return true;
	}

	const expiresAt = new Date(tokenExpiresAt).getTime();
	return Number.isNaN(expiresAt)
		? true
		: Date.now() >= expiresAt - TOKEN_EXPIRY_BUFFER_MS;
}

/**
 * Read the message of a failure, whatever shape it has.
 *
 * Exact semantics of `extractErrorMessage` in `src/services/deepLinkService.ts`
 * (lines 67-83): a string is itself, an `Error` yields `.message`, an object
 * with a string `message` yields it, anything else yields `""`.
 *
 * @param error - The failure to inspect
 * @returns The message, or `""` when the failure carries none
 */
export function extractErrorMessage(error: unknown): string {
	if (typeof error === "string") {
		return error;
	}

	if (error instanceof Error) {
		return error.message;
	}

	if (error && typeof error === "object") {
		const { message } = error as { message?: unknown };
		if (typeof message === "string") {
			return message;
		}
	}

	return "";
}

/**
 * Read the `CloudStorageErrorType` of a `CloudStorageError`-shaped failure.
 *
 * Exact semantics of `extractCloudStorageErrorType` in
 * `src/services/deepLinkService.ts` (lines 91-107): the `type` field is
 * validated against `Object.values(CloudStorageErrorType)`; anything else
 * (missing `type`, non-string `type`, unknown string) is `null` (unclassified).
 *
 * @param error - The failure to inspect
 * @returns The error type, or `null` when the failure is not classified
 */
export function extractCloudStorageErrorType(
	error: unknown,
): CloudStorageErrorType | null {
	if (!error || typeof error !== "object") {
		return null;
	}

	const { type } = error as { type?: unknown };
	if (typeof type !== "string") {
		return null;
	}

	return Object.values(CloudStorageErrorType).includes(
		type as CloudStorageErrorType,
	)
		? (type as CloudStorageErrorType)
		: null;
}

/**
 * One rung of the `CloudStorageCommands.handleError` keyword ladder: a message
 * matches when, depending on `match`, *some* or *all* of `keywords` are present.
 * Keywords are matched case-sensitively with `String.prototype.includes`.
 */
export interface CloudErrorRule {
	/** Keywords tested against the message (case-sensitive). */
	readonly keywords: readonly string[];
	/** `"any"` = OR over the keywords, `"all"` = AND over the keywords. */
	readonly match: "any" | "all";
	/** The type this rung assigns to a matching message. */
	readonly type: CloudStorageErrorType;
}

/**
 * Keyword ladder of `CloudStorageCommands.handleError`
 * (`src/services/cloudStorage.ts`, the inline ladder as of commit `266720c`), in its exact order.
 *
 * **This ladder is the wire-contract calibration and must NEVER be widened.**
 * Do not add rungs or keywords such as `timeout`, `unavailable` or
 * `temporarily`: the Rust `AuthFailureClass::Other` messages intentionally
 * carry *no* classification keyword (every routing keyword found in an upstream
 * `cause` is redacted, see `ROUTING_KEYWORDS` / `redact_routing_keywords` in
 * `src-tauri/src/commands/errors.rs`), so any widening here would silently
 * re-bucket those deliberately unclassified messages into classified ones and
 * break the cross-language contract.
 *
 * Rungs are evaluated top to bottom; the first match wins:
 *
 * 1. `authentication` OR `unauthorized` ⇒ `AUTHENTICATION_FAILED` (terminal)
 * 2. `token` AND `expired` ⇒ `TOKEN_EXPIRED` (terminal)
 * 3. `network` OR `connection` ⇒ `NETWORK_ERROR` (transient)
 * 4. `quota` OR `storage` ⇒ `QUOTA_EXCEEDED` (terminal)
 * 5. `not found` ⇒ `VAULT_NOT_FOUND` (terminal)
 * 6. `permission` OR `denied` ⇒ `PERMISSION_DENIED` (terminal)
 * 7. `provider` AND `configured` ⇒ `PROVIDER_NOT_CONFIGURED` (terminal)
 * 8. `credentials` OR `invalid` ⇒ `INVALID_CREDENTIALS` (terminal)
 *
 * No match ⇒ `OPERATION_FAILED` (the conservative terminal bucket).
 *
 * Frozen at runtime: widening this table would silently re-bucket backend
 * `Other` messages (see the never-widen warning above), so the constraint is
 * enforced, not just documented.
 */
export const CLOUD_ERROR_RULES: readonly CloudErrorRule[] = Object.freeze([
	{
		keywords: ["authentication", "unauthorized"],
		match: "any",
		type: CloudStorageErrorType.AUTHENTICATION_FAILED,
	},
	{
		keywords: ["token", "expired"],
		match: "all",
		type: CloudStorageErrorType.TOKEN_EXPIRED,
	},
	{
		keywords: ["network", "connection"],
		match: "any",
		type: CloudStorageErrorType.NETWORK_ERROR,
	},
	{
		keywords: ["quota", "storage"],
		match: "any",
		type: CloudStorageErrorType.QUOTA_EXCEEDED,
	},
	{
		keywords: ["not found"],
		match: "any",
		type: CloudStorageErrorType.VAULT_NOT_FOUND,
	},
	{
		keywords: ["permission", "denied"],
		match: "any",
		type: CloudStorageErrorType.PERMISSION_DENIED,
	},
	{
		keywords: ["provider", "configured"],
		match: "all",
		type: CloudStorageErrorType.PROVIDER_NOT_CONFIGURED,
	},
	{
		keywords: ["credentials", "invalid"],
		match: "any",
		type: CloudStorageErrorType.INVALID_CREDENTIALS,
	},
]);

/**
 * Map a raw backend message to a `CloudStorageErrorType` with the EXACT
 * 8-rung keyword ladder previously inlined in `CloudStorageCommands.handleError`
 * (`src/services/cloudStorage.ts`, the inline ladder as of commit `266720c`).
 *
 * This is a pure refactor of that inline block: the same rungs, in the same
 * order, with the same case-sensitive `String.prototype.includes` matching — so
 * the wrapper's behaviour is unchanged and `cloudStorage.test.ts`'s "Error
 * Handling" suite keeps passing. See {@link CLOUD_ERROR_RULES} for the
 * calibration rules (never widen the ladder).
 *
 * @param message - The error message extracted from the failure
 * @returns The classified type; `OPERATION_FAILED` when no rung matches
 */
export function classifyCloudErrorType(message: string): CloudStorageErrorType {
	for (const rule of CLOUD_ERROR_RULES) {
		const matched =
			rule.match === "any"
				? rule.keywords.some((keyword) => message.includes(keyword))
				: rule.keywords.every((keyword) => message.includes(keyword));

		if (matched) {
			return rule.type;
		}
	}

	return CloudStorageErrorType.OPERATION_FAILED;
}

/**
 * Case-insensitive pattern of raw messages that describe a failure worth
 * retrying. Used only as the *last* rung of {@link classifyCloudFailure}, after
 * the wrapper type, the HTTP status and the keyword ladder have all declined to
 * classify the error.
 *
 * Deliberately EXCLUDED generic words: `unavailable`, `temporarily`,
 * `try again`. They are too generic — they also sit in the middle of terminal
 * causes (e.g. `keyring unavailable`, pinned as terminal by
 * `src/test/services/deepLinkService.test.ts`) — so matching them here would
 * re-bucket conservative-terminal messages as transient.
 */
const RAW_TRANSIENT_PATTERN =
	/fetch failed|networkerror|err_network|timeout|timed out|econnrefused|econnreset|econnaborted|enotfound|ehostunreach|enetunreach|rate limit|too many requests|offline/i;

/** HTTP statuses that mean "the credentials were rejected" (terminal). */
const TERMINAL_STATUSES = new Set([401, 403]);

/**
 * HTTP statuses that mean "retry later" (transient). 408/429/5xx come from the
 * Rust `AuthFailureClass::Transient` doc; 425/502/504 mirror the historical
 * `TRANSIENT_AUTH_STATUSES` of `AddVaultForm.tsx`.
 */
const TRANSIENT_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504]);

/**
 * Read the numeric HTTP status of a raw (non-wrapper) failure.
 * `CloudStorageError` has NO status field, so this only ever fires for errors
 * that other layers put a `status` / `statusCode` on (as today).
 */
function extractStatus(error: unknown): number | undefined {
	if (!error || typeof error !== "object") {
		return undefined;
	}

	const { status, statusCode } = error as {
		status?: unknown;
		statusCode?: unknown;
	};

	const candidate = status ?? statusCode;
	return typeof candidate === "number" ? candidate : undefined;
}

/**
 * Merged failure classifier — the front-end decision of issue #28 (unify the
 * cloud-storage failure contract). Mirrors `AuthFailureClass` in
 * `src-tauri/src/commands/errors.rs` as observed through
 * `CloudStorageCommands.handleError`.
 *
 * Precedence, most authoritative first:
 *
 * a. **Valid wrapper `type`** (via {@link extractCloudStorageErrorType}):
 *    `"transient"` iff `NETWORK_ERROR`, `"terminal"` for the other 8 types
 *    (`AUTHENTICATION_FAILED`, `TOKEN_EXPIRED`, `OPERATION_FAILED`,
 *    `QUOTA_EXCEEDED`, `VAULT_NOT_FOUND`, `PERMISSION_DENIED`,
 *    `PROVIDER_NOT_CONFIGURED`, `INVALID_CREDENTIALS`). A valid type wins over
 *    everything below.
 * b. **Numeric HTTP status** on the raw error (`status ?? statusCode`):
 *    `401`/`403` ⇒ terminal; `408`/`425`/`429`/`500`/`502`/`503`/`504` ⇒
 *    transient (408/429/5xx per the Rust `Transient` doc, 425/502/504 per
 *    `AddVaultForm`'s historical `TRANSIENT_AUTH_STATUSES`). Any **other**
 *    numeric status (400, 404, …) is *undecided* and falls through to rungs
 *    c–e so a classifiable message is never silenced by an unrelated status
 *    (`{status: 400, message: "timeout …"}` stays transient, as both legacy
 *    call-site copies classified it).
 *    (`CloudStorageError` carries no status, so this rung only fires for
 *    non-wrapper errors, as today.)
 * c. **Keyword ladder** ({@link classifyCloudErrorType}) on
 *    {@link extractErrorMessage}: any classified result ⇒ transient iff it is
 *    `NETWORK_ERROR`, i.e. every other classified type (including the auth
 *    rungs, which precede the network rung in the ladder) ⇒ terminal. This
 *    mirrors the wrapper's precedence so this classifier "never disagrees with
 *    the type the wrapper would have produced" for the same message.
 * d. **Raw transient pattern** ({@link RAW_TRANSIENT_PATTERN},
 *    case-insensitive) when the ladder fell through to `OPERATION_FAILED` or
 *    the message is empty: a match ⇒ transient.
 * e. **Conservative fallback**: `"terminal"` — the unclassified bucket, matching
 *    the Rust `Other` doc (see {@link CloudFailureClass}).
 *
 * @param error - The failure (raw or `CloudStorageError` wrapper)
 * @returns `"transient"` when the very same request may be retried
 */
export function classifyCloudFailure(error: unknown): CloudFailureClass {
	// a. A valid wrapper type is authoritative.
	const errorType = extractCloudStorageErrorType(error);
	if (errorType) {
		return errorType === CloudStorageErrorType.NETWORK_ERROR
			? "transient"
			: "terminal";
	}

	// b. Numeric HTTP status on non-wrapper errors.
	const status = extractStatus(error);
	if (status !== undefined) {
		if (TERMINAL_STATUSES.has(status)) {
			return "terminal";
		}
		if (TRANSIENT_STATUSES.has(status)) {
			return "transient";
		}
		// Undecided status (400, 404, …): fall through to the message rungs
		// below instead of forcing terminal — see precedence note b.
	}

	// c. The wrapper's keyword ladder, same precedence (auth rungs win).
	const message = extractErrorMessage(error);
	const ladderType = classifyCloudErrorType(message);
	if (ladderType !== CloudStorageErrorType.OPERATION_FAILED) {
		return ladderType === CloudStorageErrorType.NETWORK_ERROR
			? "transient"
			: "terminal";
	}

	// d. Last resort for unclassified raw messages: known transient patterns.
	if (RAW_TRANSIENT_PATTERN.test(message)) {
		return "transient";
	}

	// e. Conservative fallback: the unclassified bucket is terminal.
	return "terminal";
}

/**
 * Narrow "credentials were rejected ⇒ prompt re-login" rule — NOT the same as
 * the terminal class (`{@link classifyCloudFailure}`): a terminal failure such
 * as `QUOTA_EXCEEDED` or `OPERATION_FAILED` must NOT prompt a re-login.
 *
 * Source of truth: the `type` produced by `CloudStorageCommands.handleError`
 * for credential rejections, plus the `isAuthRelatedCloudError` rule in
 * `src/services/vault.ts:42-50` (its regex is kept verbatim here because
 * `src/test/services/vault.test.ts` pins it).
 *
 * - Valid wrapper `type`: true iff `AUTHENTICATION_FAILED`, `TOKEN_EXPIRED` or
 *   `INVALID_CREDENTIALS`; any other valid type ⇒ `false`.
 * - Raw errors (no valid type): `status === 401` ⇒ `true`; otherwise the
 *   message is tested against `/invalid_grant|invalid_token|token.*expired|
 *   expired.*token|invalid credentials|re-?authenticate/i`.
 *
 * Use this to drive re-login prompts. `QUOTA_EXCEEDED`, `PERMISSION_DENIED`,
 * `OPERATION_FAILED` and `NETWORK_ERROR` must NOT prompt re-login.
 *
 * @param error - The failure (raw or `CloudStorageError` wrapper)
 * @returns `true` when the stored credentials were rejected
 */
export function isAuthFailure(error: unknown): boolean {
	const errorType = extractCloudStorageErrorType(error);
	if (errorType) {
		return (
			errorType === CloudStorageErrorType.AUTHENTICATION_FAILED ||
			errorType === CloudStorageErrorType.TOKEN_EXPIRED ||
			errorType === CloudStorageErrorType.INVALID_CREDENTIALS
		);
	}

	if (extractStatus(error) === 401) {
		return true;
	}

	return /invalid_grant|invalid_token|token.*expired|expired.*token|invalid credentials|re-?authenticate/i.test(
		extractErrorMessage(error),
	);
}
