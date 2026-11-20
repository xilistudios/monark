import { invoke } from "@tauri-apps/api/core";
import type {
	PasskeyCreateRequest,
	PasskeyCreateResponse,
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
 * unlocks the vault itself, so no plaintext vault content ever crosses the IPC
 * boundary in either direction.
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
}
