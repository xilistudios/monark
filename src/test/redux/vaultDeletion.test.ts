import { configureStore } from "@reduxjs/toolkit";
import { beforeEach, describe, expect, it, vi } from "vitest";
import vaultReducer, {
	addVault,
	deleteVault,
	removeVault,
	type Vault,
} from "../../redux/actions/vault";

const mockVaultStateCommands = vi.hoisted(() => ({
	load: vi.fn().mockResolvedValue({
		vaults: [],
		defaultProvider: null,
		providerStatus: {},
	}),
	save: vi.fn(),
	persistVaultsSnapshot: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../services/vaultState", () => ({
	VaultStateCommands: mockVaultStateCommands,
}));

const mockVaultCommands = vi.hoisted(() => ({
	deleteVault: vi.fn(),
}));

vi.mock("../../services/commands", () => ({
	default: mockVaultCommands,
}));

describe("Vault Deletion", () => {
	let store: any;

	beforeEach(() => {
		mockVaultStateCommands.load.mockClear();
		mockVaultStateCommands.save.mockClear();
		mockVaultStateCommands.persistVaultsSnapshot.mockClear();
		mockVaultCommands.deleteVault.mockClear();

		vi.clearAllMocks();

		store = configureStore({
			reducer: {
				vault: vaultReducer,
			},
		});
	});

	const createTestVault = (overrides: Partial<Vault> = {}): Vault => ({
		id: overrides.id ?? "test-vault-1",
		name: overrides.name ?? "Test Vault",
		path: overrides.path ?? "/path/to/vault.bc",
		storageType: overrides.storageType ?? "local",
		isLocked: true,
		volatile: {
			credential: "",
			entries: [],
			navigationPath: "/",
		},
		...overrides,
	});

	describe("deleteVault thunk", () => {
		it("should remove vault from state when deleteFile is false", async () => {
			const vault = createTestVault({ id: "vault-1", name: "Test Vault" });
			store.dispatch(addVault(vault));

			expect(store.getState().vault.vaults).toHaveLength(1);

			await store.dispatch(deleteVault("vault-1", false));

			expect(store.getState().vault.vaults).toHaveLength(0);
			expect(mockVaultCommands.deleteVault).not.toHaveBeenCalled();
		});

		it("should remove vault from state and delete file when deleteFile is true", async () => {
			const vault = createTestVault({ id: "vault-1", name: "Test Vault" });
			store.dispatch(addVault(vault));

			expect(store.getState().vault.vaults).toHaveLength(1);

			mockVaultCommands.deleteVault.mockResolvedValue(undefined);

			await store.dispatch(deleteVault("vault-1", true));

			expect(store.getState().vault.vaults).toHaveLength(0);
			expect(mockVaultCommands.deleteVault).toHaveBeenCalledWith(
				vault.path,
				undefined,
			);
		});

		it("should remove vault from state even when VaultCommands.deleteVault fails", async () => {
			const vault = createTestVault({
				id: "vault-1",
				name: "Test Vault",
				path: "/path/to/vault.bc",
			});
			store.dispatch(addVault(vault));

			expect(store.getState().vault.vaults).toHaveLength(1);

			// Simulate VaultCommands.deleteVault throwing an error
			const cloudError = new Error("Failed to delete file from cloud storage");
			mockVaultCommands.deleteVault.mockRejectedValue(cloudError);

			// The thunk should throw, but the vault should still be removed
			await expect(
				store.dispatch(deleteVault("vault-1", true)),
			).rejects.toThrow("Failed to delete file from cloud storage");

			// Verify the vault was removed from state despite the error
			expect(store.getState().vault.vaults).toHaveLength(0);
			expect(mockVaultCommands.deleteVault).toHaveBeenCalledWith(
				vault.path,
				undefined,
			);
		});

		it("should remove cloud vault from state even when cloud deletion fails", async () => {
			const cloudVault = createTestVault({
				id: "cloud-vault-1",
				name: "Cloud Vault",
				path: "cloud-file-id-123",
				storageType: "cloud",
				providerId: "google-drive",
				cloudMetadata: {
					fileId: "cloud-file-id-123",
					provider: "google-drive",
				},
			});
			store.dispatch(addVault(cloudVault));

			expect(store.getState().vault.vaults).toHaveLength(1);

			// Simulate cloud deletion failing
			const cloudError = new Error(
				"Network error: Cannot connect to Google Drive",
			);
			mockVaultCommands.deleteVault.mockRejectedValue(cloudError);

			// The thunk should throw, but the vault should still be removed
			await expect(
				store.dispatch(deleteVault("cloud-vault-1", true)),
			).rejects.toThrow("Network error: Cannot connect to Google Drive");

			// Verify the vault was removed from state despite the error
			expect(store.getState().vault.vaults).toHaveLength(0);
			expect(mockVaultCommands.deleteVault).toHaveBeenCalledWith(
				"cloud-file-id-123",
				"google-drive",
			);
		});

		it("should throw error when vault is not found", async () => {
			await expect(
				store.dispatch(deleteVault("non-existent-vault", true)),
			).rejects.toThrow("Vault not found");
		});

		it("should preserve other vaults when one vault deletion fails", async () => {
			const vault1 = createTestVault({ id: "vault-1", name: "Vault 1" });
			const vault2 = createTestVault({ id: "vault-2", name: "Vault 2" });
			store.dispatch(addVault(vault1));
			store.dispatch(addVault(vault2));

			expect(store.getState().vault.vaults).toHaveLength(2);

			// Make deleteVault for vault-1 fail
			mockVaultCommands.deleteVault.mockRejectedValue(
				new Error("Delete failed"),
			);

			// Try to delete vault-1 (should throw but still remove it)
			await expect(
				store.dispatch(deleteVault("vault-1", true)),
			).rejects.toThrow("Delete failed");

			// vault-1 should be removed, vault-2 should still exist
			expect(store.getState().vault.vaults).toHaveLength(1);
			expect(store.getState().vault.vaults[0].id).toBe("vault-2");
		});

		it("should handle error with non-Error objects", async () => {
			const vault = createTestVault({ id: "vault-1", name: "Test Vault" });
			store.dispatch(addVault(vault));

			expect(store.getState().vault.vaults).toHaveLength(1);

			// Simulate error with string instead of Error object
			mockVaultCommands.deleteVault.mockRejectedValue("String error message");

			await expect(
				store.dispatch(deleteVault("vault-1", true)),
			).rejects.toThrow("String error message");

			expect(store.getState().vault.vaults).toHaveLength(0);
		});

		it("should handle error with object without message property", async () => {
			const vault = createTestVault({ id: "vault-1", name: "Test Vault" });
			store.dispatch(addVault(vault));

			expect(store.getState().vault.vaults).toHaveLength(1);

			// Simulate error with object without message property
			mockVaultCommands.deleteVault.mockRejectedValue({ code: "ENOENT" });

			// String() on object gives "[object Object]", so the error message will be that
			await expect(
				store.dispatch(deleteVault("vault-1", true)),
			).rejects.toThrow("[object Object]");

			expect(store.getState().vault.vaults).toHaveLength(0);
		});
	});

	describe("removeVault reducer", () => {
		it("should remove vault by id", () => {
			const vault1 = createTestVault({ id: "vault-1" });
			const vault2 = createTestVault({ id: "vault-2" });

			store.dispatch(addVault(vault1));
			store.dispatch(addVault(vault2));

			expect(store.getState().vault.vaults).toHaveLength(2);

			store.dispatch(removeVault("vault-1"));

			expect(store.getState().vault.vaults).toHaveLength(1);
			expect(store.getState().vault.vaults[0].id).toBe("vault-2");
		});

		it("should clear currentVaultId when removing current vault", () => {
			const vault = createTestVault({ id: "vault-1" });
			store.dispatch(addVault(vault));
			store.dispatch({ type: "vault/setCurrentVault", payload: "vault-1" });

			expect(store.getState().vault.currentVaultId).toBe("vault-1");

			store.dispatch(removeVault("vault-1"));

			expect(store.getState().vault.currentVaultId).toBeNull();
		});
	});
});
