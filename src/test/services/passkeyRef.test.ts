import { describe, expect, it } from "vitest";
import type { VaultRef } from "../../interfaces/passkey.interface";
import type { Vault } from "../../redux/actions/vault";
import { vaultRefFor } from "../../services/passkey";

/**
 * `vaultRefFor` (T08) must produce exactly the wire shape the Rust
 * `passkey::store::VaultRef` deserializes — an internally tagged enum with
 * snake_case members. These assertions pin the *payload*, not just the TS type:
 * a camelCase member (`vaultId`) would type-check here and fail at runtime with
 * a serde error.
 */

function baseVault(overrides: Partial<Vault> = {}): Vault {
	return {
		id: "vault-1",
		name: "Personal",
		path: "/home/user/personal.monark",
		isLocked: false,
		storageType: "local",
		biometricEnabled: false,
		volatile: { credential: "", entries: [] },
		...overrides,
	};
}

describe("vaultRefFor (T08)", () => {
	it("maps a local vault to a local ref", () => {
		const ref = vaultRefFor(baseVault());
		expect(ref).toEqual({
			kind: "local",
			file_path: "/home/user/personal.monark",
		});
		// The Rust side reads `file_path`; a camelCase member would be ignored.
		expect(Object.keys(ref).sort()).toEqual(["file_path", "kind"]);
	});

	it("maps a cloud vault to a cloud ref with the provider file id", () => {
		const ref = vaultRefFor(
			baseVault({
				storageType: "cloud",
				path: "/Monark/personal.monark",
				providerId: "google_drive",
				cloudMetadata: {
					fileId: "file-123",
					provider: "google_drive",
					lastSync: "2026-01-02T03:04:05Z",
				},
			}),
		);
		expect(ref).toEqual({
			kind: "cloud",
			vault_id: "file-123",
			provider_name: "google_drive",
		});
	});

	it("falls back to vault.path when cloudMetadata has no fileId", () => {
		// Older persisted vaults only carry the cloud file id in `path`; the rest
		// of the app (`services/vault.ts`) uses the same fallback.
		const ref = vaultRefFor(
			baseVault({
				storageType: "cloud",
				path: "legacy-file-id",
				providerId: "webdav",
			}),
		);
		expect(ref).toEqual({
			kind: "cloud",
			vault_id: "legacy-file-id",
			provider_name: "webdav",
		});
	});

	it("omits provider_name when the vault has no providerId", () => {
		const ref = vaultRefFor(
			baseVault({
				storageType: "cloud",
				path: "file-123",
			}),
		);
		expect(ref).toEqual({ kind: "cloud", vault_id: "file-123" });
		// `provider_name: undefined` must not be serialized as a member: the Rust
		// side treats an absent member as "use the default provider".
		expect("provider_name" in ref && ref.provider_name === undefined).toBe(
			true,
		);
		expect(JSON.parse(JSON.stringify(ref))).toEqual({
			kind: "cloud",
			vault_id: "file-123",
		});
	});

	it("serializes to the exact serde shape of VaultRef", () => {
		const local: VaultRef = vaultRefFor(baseVault());
		expect(JSON.parse(JSON.stringify(local))).toEqual({
			kind: "local",
			file_path: "/home/user/personal.monark",
		});
	});
});
