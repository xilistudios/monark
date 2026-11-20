import type { VaultRef } from "../interfaces/passkey.interface";
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
 * T08 only establishes the module and `vaultRefFor`; each command task adds its
 * own static wrapper here (T09 `create`, T10 `assert`/`listForRp`/`delete`,
 * T16/T17 the CXF commands) so the frontend has a single import surface.
 */
export default class PasskeyCommands {}
