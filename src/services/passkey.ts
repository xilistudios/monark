import { invoke } from "@tauri-apps/api/core";
import type {
	PasskeyAssertRequest,
	PasskeyAssertResponse,
	PasskeyCreateRequest,
	PasskeyCreateResponse,
	PasskeySummary,
	VaultRef,
} from "../interfaces/passkey.interface";
import type { Vault } from "../redux/actions/vault";

/**
 * Maps a redux `Vault` to the backend's `VaultRef` (T08).
 *
 * - **local** vaults are addressed by their filesystem path (`vault.path`);
 * - **cloud** vaults are addressed by the provider file id. `vault.path` is the
 *   fallback because older persisted vaults only carry the id there — the same
 *   `cloudMetadata?.fileId || vault.path` rule `VaultInstance` uses for
 *   `readCloudVault`/`writeCloudVault` (see `services/vault.ts`), so a passkey
 *   command always targets the same file the rest of the app reads and writes.
 *
 * `provider_name` is `vault.providerId` (the storage provider name, e.g.
 * `google_drive`); when it is absent the backend falls back to the default
 * provider, exactly like the vault commands.
 */
export function vaultRefFor(vault: Vault): VaultRef {
	if (vault.storageType === "cloud") {
		return {
			kind: "cloud",
			vault_id: vault.cloudMetadata?.fileId || vault.path,
			provider_name: vault.providerId,
		};
	}
	return { kind: "local", file_path: vault.path };
}

/**
 * IPC wrappers for the passkey commands.
 *
 * Each command task adds its own static wrapper (T09 `create`, T10
 * `assert`/`listForRp`/`delete`, T16/T17 the CXF commands) so the frontend has a
 * single import surface. Every wrapper forwards the vault **by reference**
 * (`VaultRef`, see {@link vaultRefFor}) plus the vault password: the backend
 * unlocks the vault itself, so no plaintext vault content crosses the IPC
 * boundary in either direction.
 *
 * **One deliberate exception: {@link PasskeyCommands.exportCxf}.** It returns
 * the exported CXF document, which contains the passkeys' private keys in plain
 * text — that is the whole point of an export, and it only happens behind the
 * explicit `consent` gate (F1). It is the *only* command that hands secret
 * material to the webview; every other wrapper returns metadata, a spec-shaped
 * public response, or nothing at all. Callers of `exportCxf` must therefore
 * treat its result as secret material (see its own JSDoc).
 */
export default class PasskeyCommands {
	/**
	 * Runs the WebAuthn registration ceremony (`passkey_create`, T09).
	 *
	 * The whole ceremony — validation, key generation, attestation, persistence —
	 * happens in Rust; this wrapper only forwards the RP's options object. The
	 * backend rejects (before touching the vault) any request that is not
	 * ES256-only, discoverable-credential-required and attestation `"none"`.
	 *
	 * @param vault - Vault to store the passkey in (see {@link vaultRefFor}).
	 * @param password - Vault password, used to unlock the vault.
	 * @param request - `PublicKeyCredentialCreationOptions` subset.
	 * @returns The spec-shaped `PublicKeyCredential` JSON plus the vault entry id.
	 */
	static async create(
		vault: VaultRef,
		password: string,
		request: PasskeyCreateRequest,
	): Promise<PasskeyCreateResponse> {
		return await invoke<PasskeyCreateResponse>("passkey_create", {
			vault,
			password,
			request,
		});
	}

	/**
	 * Runs the WebAuthn authentication ceremony (`passkey_assert`, T10).
	 *
	 * The backend selects the credential (exact `rpId` match, `allowCredentials`
	 * intersection, explicit `credentialId` disambiguation), signs
	 * `authenticatorData || SHA-256(clientDataJSON)` with the stored ES256 key and
	 * returns the assertion. The ceremony is **read-only**: the vault file is not
	 * modified and the stored `signCount` stays `0`.
	 *
	 * A request that matches several credentials without naming one is rejected
	 * (`Validation`); resolve the choice with {@link listForRp} first. A request
	 * that matches none is a `NotFound`.
	 *
	 * @param vault - Vault holding the passkey (see {@link vaultRefFor}).
	 * @param password - Vault password, used to unlock the vault.
	 * @param request - `PublicKeyCredentialRequestOptions` subset.
	 * @returns The spec-shaped `PublicKeyCredential` JSON plus the vault entry id.
	 */
	static async assert(
		vault: VaultRef,
		password: string,
		request: PasskeyAssertRequest,
	): Promise<PasskeyAssertResponse> {
		return await invoke<PasskeyAssertResponse>("passkey_assert", {
			vault,
			password,
			request,
		});
	}

	/**
	 * Lists the passkeys stored for one relying party (`passkey_list_for_rp`,
	 * T10), for the account picker.
	 *
	 * The summaries carry no secret material (no private key, no user handle).
	 * An empty list is a valid answer, not an error.
	 *
	 * @param vault - Vault to query (see {@link vaultRefFor}).
	 * @param password - Vault password, used to unlock the vault.
	 * @param rpId - Relying party id (bare host name, exact match).
	 */
	static async listForRp(
		vault: VaultRef,
		password: string,
		rpId: string,
	): Promise<PasskeySummary[]> {
		return await invoke<PasskeySummary[]>("passkey_list_for_rp", {
			vault,
			password,
			rpId,
		});
	}

	/**
	 * Deletes a stored passkey (`passkey_delete`, T10).
	 *
	 * This is the **only** way to delete a passkey: the write-merge preserves
	 * every passkey it finds on disk, so a full-vault write that omits one does
	 * not remove it. `entryId` must name a passkey entry — a data entry or a
	 * group is rejected (`Validation`), and an unknown id is a `NotFound`.
	 *
	 * @param vault - Vault holding the passkey (see {@link vaultRefFor}).
	 * @param password - Vault password, used to unlock the vault.
	 * @param entryId - Vault entry id of the passkey.
	 */
	static async delete(
		vault: VaultRef,
		password: string,
		entryId: string,
	): Promise<void> {
		return await invoke<void>("passkey_delete", {
			vault,
			password,
			entryId,
		});
	}

	/**
	 * Exports the vault's passkeys as a CXF JSON document (`export_cxf`, T17).
	 *
	 * ⚠️ **The returned string contains the passkeys' PRIVATE KEYS in plain
	 * text.** Anyone holding it can sign in as the user on every relying party
	 * the vault covers, so it must never be logged, put on the clipboard without
	 * a warning, or sent anywhere the user did not explicitly choose.
	 *
	 * `consent` is a hard gate, not a hint: the backend refuses (before touching
	 * the vault file at all) unless it is exactly `true`. The UI is responsible
	 * for collecting **informed** consent first — show the warning, require an
	 * explicit acknowledgement — and only then call this wrapper with `true`.
	 *
	 * @param vault - Vault to export from (see {@link vaultRefFor}).
	 * @param password - Vault password, used to unlock the vault.
	 * @param consent - `true` only after the user acknowledged the warning.
	 * @returns The CXF document as a JSON string (secret material).
	 */
	static async exportCxf(
		vault: VaultRef,
		password: string,
		consent: boolean,
	): Promise<string> {
		return await invoke<string>("export_cxf", { vault, password, consent });
	}
}
