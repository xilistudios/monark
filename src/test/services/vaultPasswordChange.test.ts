import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Vault } from "../../redux/actions/vault";
import { setVaultCredential, syncCloudVault } from "../../redux/actions/vault";
import type { RootState } from "../../redux/store";
import { CloudStorageCommands } from "../../services/cloudStorage";
import VaultCommands from "../../services/commands";
import { VaultInstance, VaultManager } from "../../services/vault";

// Mock the cloud storage and vault commands
vi.mock("../../services/cloudStorage");
vi.mock("../../services/commands");
vi.mock("../../redux/actions/vault");

const mockCloudStorageCommands = vi.mocked(CloudStorageCommands);
const mockVaultCommands = vi.mocked(VaultCommands);
const mockSetVaultCredential = vi.mocked(setVaultCredential);
const mockSyncCloudVault = vi.mocked(syncCloudVault);

describe("Vault Password Change", () => {
	let vaultManager: VaultManager;
	let mockDispatch: any;
	let mockGetState: any;
	let mockVault: Vault;

	beforeEach(() => {
		vi.clearAllMocks();

		vaultManager = VaultManager.getInstance();
		mockDispatch = vi.fn();
		mockGetState = vi.fn();

		vaultManager.initialize(mockDispatch, mockGetState);

		// Create a mock cloud vault
		mockVault = {
			id: "test-vault-id",
			name: "Test Vault",
			path: "test-vault-id",
			storageType: "cloud",
			providerId: "test-provider",
			cloudMetadata: {
				fileId: "test-vault-id",
				provider: "test-provider",
				lastSync: new Date().toISOString(),
			},
			isLocked: false,
			volatile: {
				entries: [
					{
						id: "entry1",
						name: "Test Entry",
						data_type: "login",
						fields: [],
						tags: [],
						created_at: new Date().toISOString(),
						updated_at: new Date().toISOString(),
					},
				],
				credential: "old-password",
				navigationPath: "/",
				encryptedData: undefined,
			},
		};

		mockGetState.mockReturnValue({
			vault: {
				vaults: [mockVault],
				providers: [],
				defaultProvider: null,
				providerStatus: {},
			},
		});
	});

	describe("VaultInstance.changePassword", () => {
		it("should change password for cloud vault successfully", async () => {
			const vaultInstance = new VaultInstance(
				mockVault,
				mockDispatch,
				mockGetState,
			);

			mockCloudStorageCommands.writeCloudVault.mockResolvedValue(
				"test-vault-id",
			);

			await vaultInstance.changePassword("new-password");

			expect(mockCloudStorageCommands.writeCloudVault).toHaveBeenCalledWith({
				vaultId: "test-vault-id",
				vaultName: "Test Vault",
				password: "new-password",
				vaultContent: {
					updated_at: expect.any(String),
					hmac: "",
					entries: mockVault.volatile!.entries,
				},
				providerName: "test-provider",
			});

			expect(mockSyncCloudVault).toHaveBeenCalledWith("test-vault-id");
			expect(mockSetVaultCredential).toHaveBeenCalledWith({
				vaultId: "test-vault-id",
				credential: "new-password",
			});
		});

		it("should change password for local vault successfully", async () => {
			const localVault = {
				...mockVault,
				storageType: "local" as const,
				providerId: undefined,
				cloudMetadata: undefined,
				path: "/path/to/local.vault",
			};

			mockGetState.mockReturnValue({
				vault: {
					vaults: [localVault],
					providers: [],
					defaultProvider: null,
					providerStatus: {},
				},
			});

			const vaultInstance = new VaultInstance(
				localVault,
				mockDispatch,
				mockGetState,
			);

			mockVaultCommands.write.mockResolvedValue();

			await vaultInstance.changePassword("new-password");

			expect(mockVaultCommands.write).toHaveBeenCalledWith(
				"/path/to/local.vault",
				"new-password",
				{
					updated_at: expect.any(String),
					hmac: "",
					entries: localVault.volatile!.entries,
				},
			);

			expect(mockSetVaultCredential).toHaveBeenCalledWith({
				vaultId: "test-vault-id",
				credential: "new-password",
			});
		});

		it("should throw error if vault is not unlocked", async () => {
			const lockedVault = {
				...mockVault,
				isLocked: true,
				volatile: {
					...mockVault.volatile!,
					credential: "",
				},
			};

			mockGetState.mockReturnValue({
				vault: {
					vaults: [lockedVault],
					providers: [],
					defaultProvider: null,
					providerStatus: {},
				},
			});

			const vaultInstance = new VaultInstance(
				lockedVault,
				mockDispatch,
				mockGetState,
			);

			await expect(
				vaultInstance.changePassword("new-password"),
			).rejects.toThrow("Vault must be unlocked to change password");
		});

		it("should throw error if new password is empty", async () => {
			const vaultInstance = new VaultInstance(
				mockVault,
				mockDispatch,
				mockGetState,
			);

			await expect(vaultInstance.changePassword("")).rejects.toThrow(
				"New password is required",
			);
		});

		it("should throw error if cloud vault update fails", async () => {
			const vaultInstance = new VaultInstance(
				mockVault,
				mockDispatch,
				mockGetState,
			);

			mockCloudStorageCommands.writeCloudVault.mockRejectedValue(
				new Error("Cloud storage error"),
			);

			await expect(
				vaultInstance.changePassword("new-password"),
			).rejects.toThrow("Failed to change vault password: Cloud storage error");
		});

		it("should throw error if local vault update fails", async () => {
			const localVault = {
				...mockVault,
				storageType: "local" as const,
				providerId: undefined,
				cloudMetadata: undefined,
				path: "/path/to/local.vault",
			};

			mockGetState.mockReturnValue({
				vault: {
					vaults: [localVault],
					providers: [],
					defaultProvider: null,
					providerStatus: {},
				},
			});

			const vaultInstance = new VaultInstance(
				localVault,
				mockDispatch,
				mockGetState,
			);

			mockVaultCommands.write.mockRejectedValue(new Error("File system error"));

			await expect(
				vaultInstance.changePassword("new-password"),
			).rejects.toThrow("Failed to change vault password: File system error");
		});
	});

	describe("VaultManager.changeVaultPassword", () => {
		it("should change password through VaultManager", async () => {
			const changePasswordSpy = vi.spyOn(
				VaultInstance.prototype,
				"changePassword",
			);
			changePasswordSpy.mockResolvedValue();

			await vaultManager.changeVaultPassword("test-vault-id", "new-password");

			expect(changePasswordSpy).toHaveBeenCalledWith("new-password");
		});

		it("should throw error if vault not found", async () => {
			await expect(
				vaultManager.changeVaultPassword("non-existent-vault", "new-password"),
			).rejects.toThrow("Vault not found");
		});
	});
});
