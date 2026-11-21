/**
 * Passkey IPC contract (F0/F1) — TypeScript mirror of the Rust types.
 *
 * Two families live here:
 *
 * 1. **`VaultRef`** (T08): the reference every passkey/CXF command sends instead
 *    of a path. It is the wire shape of `passkey::store::VaultRef` — an
 *    internally tagged enum (`kind`), snake_case members — so the backend can
 *    `serde`-deserialize it directly.
 * 2. **Ceremony request/response shapes** (T02, mirrored here in T08 so T09/T10
 *    only add wrappers): the WebAuthn JSON member names (`camelCase`,
 *    `type` instead of `type_`), all binary members URL_SAFE_NO_PAD base64.
 *
 * Invariant: no type in this file has a field for private key material. The
 * backend never sends one (`PasskeyView` has no such field), so a leaked key
 * cannot even be *represented* on this side of the IPC boundary.
 */

/**
 * Which vault a passkey command operates on.
 *
 * Mirrors `passkey::store::VaultRef`:
 * - local: `{ kind: "local", file_path }`
 * - cloud: `{ kind: "cloud", vault_id, provider_name? }` — `provider_name`
 *   omitted means "the storage manager's default provider".
 */
export type VaultRef =
	| { kind: "local"; file_path: string }
	| { kind: "cloud"; vault_id: string; provider_name?: string };

/** `type` member of every credential descriptor and response. */
export const PUBLIC_KEY_TYPE = "public-key" as const;

/** Relying party entity (`PublicKeyCredentialRpEntity`). */
export interface RpEntity {
	id: string;
	name: string;
}

/** User entity (`PublicKeyCredentialUserEntity`); `id` is base64url. */
export interface UserEntity {
	id: string;
	name: string;
	displayName: string;
}

/** Accepted algorithm (`PublicKeyCredentialParameters`). */
export interface PubKeyCredParam {
	type: typeof PUBLIC_KEY_TYPE;
	alg: number;
}

/** Credential descriptor (`PublicKeyCredentialDescriptor`); `id` is base64url. */
export interface PublicKeyCredentialDescriptor {
	type: typeof PUBLIC_KEY_TYPE;
	id: string;
}

/** Authenticator selection criteria (`AuthenticatorSelectionCriteria`). */
export interface AuthenticatorSelection {
	residentKey?: string;
	userVerification?: string;
	authenticatorAttachment?: string;
}

/**
 * Input of `passkey_create` (registration ceremony).
 *
 * The backend validates every member before touching the vault, and refuses
 * (rather than silently adjusting) anything outside Monark's capabilities:
 *
 * - `pubKeyCredParams` must contain `{ type: "public-key", alg: -7 }` (ES256 is
 *   the only algorithm implemented);
 * - `authenticatorSelection` is **mandatory** and `residentKey` must be
 *   `"required"` — only discoverable credentials are issued;
 * - `attestation` must be omitted or `"none"` (no attestation identity);
 * - `rp.id` is a bare host name (no scheme, path, port or whitespace);
 * - `user.id` decodes to 1..=64 bytes, `user.name`/`displayName` ≤ 256 chars;
 * - `challenge` decodes to 16..=1024 bytes; `origin` is an `http(s)` origin;
 * - `excludeCredentials` is the only deduplication mechanism: a duplicate
 *   registration for the same RP and user is otherwise allowed.
 */
export interface PasskeyCreateRequest {
	rp: RpEntity;
	user: UserEntity;
	/** base64url challenge, 16..=1024 bytes once decoded. */
	challenge: string;
	/** WebAuthn origin, e.g. `https://webauthn.io`. */
	origin: string;
	pubKeyCredParams: PubKeyCredParam[];
	/** Mandatory: Monark only issues discoverable credentials. */
	authenticatorSelection?: AuthenticatorSelection;
	excludeCredentials?: PublicKeyCredentialDescriptor[];
	/** Omitted or `"none"`. */
	attestation?: string;
}

/** `AuthenticatorAttestationResponse` in JSON form (binary members base64url). */
export interface AttestationResponse {
	clientDataJSON: string;
	attestationObject: string;
	transports: string[];
}

/** `AuthenticatorAssertionResponse` in JSON form (binary members base64url). */
export interface AssertionResponse {
	clientDataJSON: string;
	authenticatorData: string;
	signature: string;
	userHandle?: string;
}

/** Response of `passkey_create` (`PublicKeyCredential` + attestation). */
export interface PasskeyCreateResponse {
	/** Vault entry id of the stored passkey. */
	entryId: string;
	id: string;
	rawId: string;
	type: typeof PUBLIC_KEY_TYPE;
	response: AttestationResponse;
	authenticatorAttachment: string;
	clientExtensionResults: Record<string, unknown>;
}

/** Input of `passkey_assert` (authentication ceremony). */
export interface PasskeyAssertRequest {
	rpId: string;
	/** base64url challenge, 16..=1024 bytes once decoded. */
	challenge: string;
	origin: string;
	allowCredentials?: PublicKeyCredentialDescriptor[];
	/** Explicit credential selection (base64url) when several match. */
	credentialId?: string;
	userVerification?: string;
}

/** Response of `passkey_assert` (`PublicKeyCredential` + assertion). */
export interface PasskeyAssertResponse {
	/** Vault entry id of the passkey that signed. */
	entryId: string;
	id: string;
	rawId: string;
	type: typeof PUBLIC_KEY_TYPE;
	response: AssertionResponse;
	authenticatorAttachment: string;
	clientExtensionResults: Record<string, unknown>;
}

/** Sanitized passkey summary returned by `passkey_list_for_rp`. */
export interface PasskeySummary {
	entryId: string;
	credentialId: string;
	rpId: string;
	userName: string;
	userDisplayName: string;
	createdAt: string;
	transports: string[];
}

/**
 * One per-credential outcome of a CXF import that did **not** carry over in
 * full, with the reason shown to the user.
 *
 * Mirrors `passkey::cxf::CxfSkipped` (`#[serde(rename_all = "camelCase")]`):
 * `credentialType` is the exact `type` string found in the file (`"totp"`,
 * `"basic-auth"`, …) or `"(missing)"` when the member was absent.
 *
 * **A row here does not always mean the credential failed.** Two kinds of row
 * share this shape:
 *
 * 1. **Rejected** — the credential was *not* imported (unsupported type,
 *    invalid field, …). `reason` is the rejection reason.
 * 2. **Imported but lossy** — the credential *was* imported, but something the
 *    vault cannot represent was dropped. Today the only case is
 *    `fido2Extensions`, and its `reason` is exactly
 *    `"extension data ignored (fido2Extensions)"`
 *    (`passkey::cxf::EXTENSIONS_IGNORED_NOTE`). Render it as a **warning**, not
 *    as a failure: the passkey is in the vault.
 *
 * The `reason` string is the only discriminator (the report has no separate
 * note channel), so a UI that needs to tell the two apart must compare it
 * against that constant — or simply show every row as a non-fatal notice.
 */
export interface CxfSkipped {
	/** `item.title` of the item the credential belongs to. */
	itemTitle: string;
	/** Exact credential `type` from the file, or `"(missing)"`. */
	credentialType: string;
	/** User-facing reason (never contains key material). */
	reason: string;
}

/**
 * Report of a CXF import (`import_cxf`, T16).
 *
 * Mirrors `passkey::cxf::CxfImportReport` (`camelCase`):
 *
 * - `imported` — passkeys written to the vault;
 * - `duplicates` — credentials already present (dedup by `(rpId, credentialId)`,
 *   ruling Q8), counted, not listed;
 * - `skipped` — per-credential outcomes that did not carry over in full: both
 *   **rejected** credentials (not imported) and **imported** credentials whose
 *   `fido2Extensions` were dropped (see {@link CxfSkipped}).
 *
 * ⚠️ `imported + duplicates + skipped` is **not** a strict partition of the
 * document's credentials. A credential that is imported *and* carries
 * `fido2Extensions` counts once in `imported` **and** once in `skipped`, so
 * `skipped.length` can be non-zero on a fully successful import. Never render
 * `skipped.length` as "N failed" — see {@link CxfSkipped} for the two kinds of
 * row and the `reason` string that tells them apart.
 *
 * A report with `imported === 0` means the vault file was not written at all.
 */
export interface CxfImportReport {
	imported: number;
	duplicates: number;
	skipped: CxfSkipped[];
}
