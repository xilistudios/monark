// Mock the commands before importing vault service
vi.mock("../../services/commands", () => ({
	default: {
		read: vi.fn(),
		write: vi.fn(),
		delete: vi.fn(),
	},
}));

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
	CloudVaultMetadata,
	StorageProvider,
} from "../../interfaces/cloud-storage.interface";
import {
	CloudStorageErrorType,
	type GoogleDriveConfig,
	StorageProviderType,
} from "../../interfaces/cloud-storage.interface";
import type { Entry } from "../../interfaces/vault.interface";
import type { Vault } from "../../redux/actions/vault";
import * as vaultActions from "../../redux/actions/vault";
import type { AppDispatch, RootState } from "../../redux/store";
import CloudStorageCommands from "../../services/cloudStorage";
import VaultCommands from "../../services/commands";
import { VaultInstance, VaultManager } from "../../services/vault";

// Mock the dependencies
const mockVaultCommands = {
	read: vi.fn(),
	write: vi.fn(),
	delete: vi.fn(),
};
const mockCloudStorageCommands = {
	listProviders: vi.fn(),
	addProvider: vi.fn(),
	removeProvider: vi.fn(),
	setDefaultProvider: vi.fn(),
	authenticateProvider: vi.fn(),
	getGoogleDriveOAuthUrl: vi.fn(),
	getProviderAuthInfo: vi.fn(),
	listCloudVaults: vi.fn(),
	readCloudVault: vi.fn(),
	writeCloudVault: vi.fn(),
	updateCloudVault: vi.fn(),
	deleteCloudVault: vi.fn(),
};
const mockVaultActions = {
	setVaultCredential: vi.fn(),
	setVaultEntries: vi.fn(),
	lockVault: vi.fn(),
	syncCloudVault: vi.fn(),
	setStorageProviders: vi.fn(),
	addStorageProvider: vi.fn(),
	removeStorageProvider: vi.fn(),
	setDefaultStorageProvider: vi.fn(),
	setProviderStatus: vi.fn(),
	setCloudVaults: vi.fn(),
	setOAuthState: vi.fn(),
	addVault: vi.fn(),
	setVaultLocked: vi.fn(),
};

vi.mock("../../services/commands", () => mockVaultCommands);
vi.mock("../../services/cloudStorage", () => mockCloudStorageCommands);
vi.mock("../../redux/actions/vault", () => mockVaultActions);
vi.mock("@tauri-apps/plugin-store", () => ({
	load: vi.fn().mockResolvedValue({
		get: vi.fn(),
		set: vi.fn(),
		save: vi.fn(),
	}),
}));
vi.mock("../../store/settings", () => ({
	settingsStore: {
		get: vi.fn(),
		set: vi.fn(),
	},
}));

describe("VaultInstance", () => {
	let vaultInstance: VaultInstance;
	let mockVault: Vault;
	let mockDispatch: AppDispatch;
	let mockGetState: () => RootState;
	let mockState: RootState;

	beforeEach(() => {
		mockVault = {
			id: "test-vault-id",
			name: "Test Vault",
			path: "test-path",
			storageType: "local",
			isLocked: true,
			volatile: {
				entries: [],
				credential: "",
				navigationPath: "/",
				encryptedData: undefined,
			},
		};

		mockDispatch = vi.fn();
		mockGetState = vi.fn();
		mockState = {
			vault: {
				vaults: [mockVault],
				currentVaultId: null,
				loading: false,
				error: null,
				providers: [],
				defaultProvider: null,
				providerStatus: {},
			},
		} as RootState;

		mockGetState.mockReturnValue(mockState);

		vaultInstance = new VaultInstance(mockVault, mockDispatch, mockGetState);
	});

	describe("unlock", () => {
		it("should unlock a local vault successfully", async () => {
			const mockVaultContent = {
				entries: [{ id: "entry1", type: "note", title: "Test Entry" }],
			};
			mockVaultCommands.read.mockResolvedValue(mockVaultContent);

			await vaultInstance.unlock("test-password");

			expect(VaultCommands.read).toHaveBeenCalledWith(
				"test-path",
				"test-password",
			);
			expect(mockDispatch).toHaveBeenCalledWith(
				vaultActions.setVaultCredential({
					vaultId: "test-vault-id",
					credential: "test-password",
				}),
			);
			expect(mockDispatch).toHaveBeenCalledWith(
				vaultActions.setVaultEntries({
					vaultId: "test-vault-id",
					entries: mockVaultContent.entries,
				}),
			);
			expect(mockDispatch).toHaveBeenCalledWith(
				vaultActions.setVaultLocked({
					vaultId: "test-vault-id",
					isLocked: false,
				}),
			);
		});

		it("should unlock a cloud vault successfully", async () => {
			const cloudVault = {
				...mockVault,
				storageType: "cloud" as const,
				providerId: "google-drive",
				cloudMetadata: {
					fileId: "cloud-file-id",
					provider: "google-drive",
					lastSync: new Date().toISOString(),
				},
			};
			const cloudVaultInstance = new VaultInstance(
				cloudVault,
				mockDispatch,
				mockGetState,
			);

			const mockVaultContent = {
				entries: [{ id: "entry1", type: "note", title: "Test Entry" }],
			};
			mockCloudStorageCommands.readCloudVault.mockResolvedValue(
				mockVaultContent,
			);

			await cloudVaultInstance.unlock("test-password");

			expect(CloudStorageCommands.readCloudVault).toHaveBeenCalledWith({
				vaultId: "cloud-file-id",
				password: "test-password",
				providerName: "google-drive",
			});
			expect(mockDispatch).toHaveBeenCalledWith(
				vaultActions.setVaultCredential({
					vaultId: "test-vault-id",
					credential: "test-password",
				}),
			);
			expect(mockDispatch).toHaveBeenCalledWith(
				vaultActions.setVaultEntries({
					vaultId: "test-vault-id",
					entries: mockVaultContent.entries,
				}),
			);
			expect(mockDispatch).toHaveBeenCalledWith(
				vaultActions.setVaultLocked({
					vaultId: "test-vault-id",
					isLocked: false,
				}),
			);
		});

		it("should throw error if unlock fails", async () => {
			vi.mocked(VaultCommands.read).mockRejectedValue(
				new Error("Invalid password"),
			);

			await expect(vaultInstance.unlock("wrong-password")).rejects.toThrow(
				"Failed to unlock vault: Error: Invalid password",
			);
		});
	});

	describe("lock", () => {
		it("should lock the vault", () => {
			vaultInstance.lock();

			expect(mockDispatch).toHaveBeenCalledWith(
				vaultActions.lockVault("test-vault-id"),
			);
		});
	});

	describe("addEntry", () => {
		it("should add entry to root level", async () => {
			const newEntry: Entry = {
				id: "new-entry",
				type: "note",
				title: "New Entry",
			};
			const mockVaultContent = {
				updated_at: new Date().toISOString(),
				hmac: "",
				entries: [newEntry],
			};
			vi.mocked(VaultCommands.write).mockResolvedValue(undefined);

			const unlockedVault = {
				...mockVault,
				isLocked: false,
				volatile: {
					...mockVault.volatile,
					credential: "test-password",
				},
			};
			mockState.vault.vaults = [unlockedVault];
			mockGetState.mockReturnValue(mockState);

			await vaultInstance.addEntry([], newEntry);

			expect(mockDispatch).toHaveBeenCalledWith(
				vaultActions.setVaultEntries({
					vaultId: "test-vault-id",
					entries: [newEntry],
				}),
			);
		});

		it("should throw error if parent group not found", async () => {
			const newEntry: Entry = {
				id: "new-entry",
				type: "note",
				title: "New Entry",
			};

			await expect(
				vaultInstance.addEntry(["nonexistent-group"], newEntry),
			).rejects.toThrow("Parent group not found at path: nonexistent-group");
		});
	});

	describe("syncWithCloud", () => {
		it("should sync cloud vault successfully", async () => {
			const cloudVault = {
				...mockVault,
				storageType: "cloud" as const,
				providerId: "google-drive",
				cloudMetadata: {
					fileId: "cloud-file-id",
					provider: "google-drive",
					lastSync: new Date().toISOString(),
				},
			};
			const cloudVaultInstance = new VaultInstance(
				cloudVault,
				mockDispatch,
				mockGetState,
			);

			const mockVaultContent = {
				entries: [{ id: "entry1", type: "note", title: "Synced Entry" }],
			};
			vi.mocked(CloudStorageCommands.readCloudVault).mockResolvedValue(
				mockVaultContent,
			);
			vi.mocked(CloudStorageCommands.getProviderAuthInfo).mockResolvedValue({
				authenticated: true,
				token_expires_at: null,
			});

			const unlockedCloudVault = {
				...cloudVault,
				isLocked: false,
				volatile: {
					...cloudVault.volatile,
					credential: "test-password",
				},
			};
			mockState.vault.vaults = [unlockedCloudVault];
			mockGetState.mockReturnValue(mockState);

			await cloudVaultInstance.syncWithCloud();

			expect(CloudStorageCommands.readCloudVault).toHaveBeenCalledWith({
				vaultId: "cloud-file-id",
				password: "test-password",
				providerName: "google-drive",
			});
			expect(mockDispatch).toHaveBeenCalledWith(
				vaultActions.setVaultEntries({
					vaultId: "test-vault-id",
					entries: mockVaultContent.entries,
				}),
			);
			expect(mockDispatch).toHaveBeenCalledWith(
				vaultActions.syncCloudVault("test-vault-id"),
			);
		});

		it("should prompt reauth when cloud sync fails due to expired token", async () => {
			const cloudVault = {
				...mockVault,
				storageType: "cloud" as const,
				providerId: "google-drive",
				cloudMetadata: {
					fileId: "cloud-file-id",
					provider: "google-drive",
					lastSync: new Date().toISOString(),
				},
			};
			const cloudVaultInstance = new VaultInstance(
				cloudVault,
				mockDispatch,
				mockGetState,
			);

			const unlockedCloudVault = {
				...cloudVault,
				isLocked: false,
				volatile: {
					...cloudVault.volatile,
					credential: "test-password",
				},
			};
			mockState.vault.vaults = [unlockedCloudVault];
			mockGetState.mockReturnValue(mockState);

			vi.mocked(CloudStorageCommands.readCloudVault).mockRejectedValue(
				new Error("Access token has expired"),
			);
			vi.mocked(CloudStorageCommands.getProviderAuthInfo).mockResolvedValue({
				authenticated: false,
				token_expires_at: null,
			});
			vi.mocked(CloudStorageCommands.getGoogleDriveOAuthUrl).mockResolvedValue({
				url: "https://accounts.google.com/o/oauth2/auth",
				state: "oauth-state",
			});

			await expect(cloudVaultInstance.syncWithCloud()).rejects.toThrow(
				"Failed to sync with cloud: Access token has expired",
			);

			expect(mockDispatch).toHaveBeenCalledWith(
				vaultActions.setProviderStatus({
					providerId: "google-drive",
					status: "error",
				}),
			);
			expect(mockDispatch).toHaveBeenCalledWith(
				vaultActions.setOAuthState({
					providerName: "google-drive",
					authUrl: "https://accounts.google.com/o/oauth2/auth",
					state: "oauth-state",
					isOpen: true,
				}),
			);
		});

		it("should throw error for non-cloud vault", async () => {
			await expect(vaultInstance.syncWithCloud()).rejects.toThrow(
				"Cannot sync non-cloud vault",
			);
		});
	});

	describe("getCloudMetadata", () => {
		it("should return cloud metadata for cloud vault", () => {
			const cloudVault = {
				...mockVault,
				storageType: "cloud" as const,
				providerId: "google-drive",
				cloudMetadata: {
					fileId: "cloud-file-id",
					provider: "google-drive",
					lastSync: "2023-01-01T00:00:00.000Z",
				},
			};
			const cloudVaultInstance = new VaultInstance(
				cloudVault,
				mockDispatch,
				mockGetState,
			);

			const metadata = cloudVaultInstance.getCloudMetadata();

			expect(metadata).toEqual({
				id: "cloud-file-id",
				name: "Test Vault",
				providerName: "google-drive",
				providerType: "google_drive",
				createdAt: "2023-01-01T00:00:00.000Z",
				modifiedAt: "2023-01-01T00:00:00.000Z",
				path: "test-path",
				isFolder: false,
				mimeType: "application/json",
				parentId: undefined,
				metadata: {},
			});
		});

		it("should return null for local vault", () => {
			const metadata = vaultInstance.getCloudMetadata();

			expect(metadata).toBeNull();
		});
	});
});

describe("VaultManager", () => {
	let vaultManager: VaultManager;
	let mockDispatch: AppDispatch;
	let mockGetState: () => RootState;
	let mockState: RootState;

	beforeEach(() => {
		vaultManager = VaultManager.getInstance();
		mockDispatch = vi.fn();
		mockGetState = vi.fn();
		mockState = {
			vault: {
				vaults: [],
				currentVaultId: null,
				loading: false,
				error: null,
				providers: [],
				defaultProvider: null,
				providerStatus: {},
			},
		} as RootState;

		vaultManager.initialize(mockDispatch, mockGetState);
	});

	afterEach(() => {
		vi.clearAllMocks();
	});

	describe("loadProviders", () => {
		it("should load providers successfully", async () => {
			const mockProviders: StorageProvider[] = [
				{ name: "google-drive", providerType: "google_drive", isDefault: true },
			];
			vi.mocked(CloudStorageCommands.listProviders).mockResolvedValue(
				mockProviders,
			);

			await vaultManager.loadProviders();

			expect(CloudStorageCommands.listProviders).toHaveBeenCalled();
			expect(mockDispatch).toHaveBeenCalledWith(
				vaultActions.setStorageProviders(mockProviders),
			);
		});

		it("should throw error if loading fails", async () => {
			vi.mocked(CloudStorageCommands.listProviders).mockRejectedValue(
				new Error("Network error"),
			);

			await expect(vaultManager.loadProviders()).rejects.toThrow(
				"Failed to load providers: Error: Network error",
			);
		});
	});

	describe("addProvider", () => {
		it("should add provider successfully", async () => {
			const config: {
				type: StorageProviderType.GOOGLE_DRIVE;
				config: GoogleDriveConfig;
			} = {
				type: StorageProviderType.GOOGLE_DRIVE,
				config: {
					client_id: "test",
					client_secret: "test",
					redirect_uri: "test",
				},
			};
			vi.mocked(CloudStorageCommands.addProvider).mockResolvedValue(undefined);
			vi.mocked(CloudStorageCommands.listProviders).mockResolvedValue([]);

			await vaultManager.addProvider(config);

			expect(CloudStorageCommands.addProvider).toHaveBeenCalledWith({
				name: expect.stringMatching(/^provider_\d+$/),
				config,
			});
			expect(CloudStorageCommands.listProviders).toHaveBeenCalled();
		});
	});

	describe("authenticateProvider", () => {
		it("should authenticate provider successfully", async () => {
			vi.mocked(CloudStorageCommands.authenticateProvider).mockResolvedValue(
				undefined,
			);

			await vaultManager.authenticateProvider("google-drive");

			expect(mockDispatch).toHaveBeenCalledWith(
				vaultActions.setProviderStatus({
					providerId: "google-drive",
					status: "authenticating",
				}),
			);
			expect(CloudStorageCommands.authenticateProvider).toHaveBeenCalledWith(
				"google-drive",
			);
			expect(mockDispatch).toHaveBeenCalledWith(
				vaultActions.setProviderStatus({
					providerId: "google-drive",
					status: "authenticated",
				}),
			);
		});

		it("should handle authentication failure", async () => {
			vi.mocked(CloudStorageCommands.authenticateProvider).mockRejectedValue(
				new Error("Auth failed"),
			);

			await expect(
				vaultManager.authenticateProvider("google-drive"),
			).rejects.toThrow("Failed to authenticate provider: Error: Auth failed");

			expect(mockDispatch).toHaveBeenCalledWith(
				vaultActions.setProviderStatus({
					providerId: "google-drive",
					status: "error",
				}),
			);
		});
	});

	describe("listCloudVaults", () => {
		it("should list cloud vaults successfully", async () => {
			const mockCloudVaults: CloudVaultMetadata[] = [
				{
					id: "vault1",
					name: "Cloud Vault 1",
					providerName: "google-drive",
					providerType: "google_drive",
					createdAt: "2023-01-01T00:00:00.000Z",
					modifiedAt: "2023-01-01T00:00:00.000Z",
					path: "/vault1",
					isFolder: false,
					mimeType: "application/json",
				},
			];
			vi.mocked(CloudStorageCommands.listCloudVaults).mockResolvedValue(
				mockCloudVaults,
			);

			const vaults = await vaultManager.listCloudVaults();

			expect(CloudStorageCommands.listCloudVaults).toHaveBeenCalledWith(
				undefined,
			);
			expect(vaults).toHaveLength(1);
			expect(vaults[0]).toMatchObject({
				id: "vault1",
				name: "Cloud Vault 1",
				storageType: "cloud",
				providerId: "google-drive",
			});
		});
	});

	describe("createVault", () => {
		it("should create cloud vault successfully", async () => {
			const cloudVaultId = "cloud-vault-id";
			vi.mocked(CloudStorageCommands.writeCloudVault).mockResolvedValue(
				cloudVaultId,
			);

			const vaultId = await vaultManager.createVault(
				"Test Vault",
				"password",
				"cloud",
				"google-drive",
			);

			expect(CloudStorageCommands.writeCloudVault).toHaveBeenCalledWith({
				vaultName: "Test Vault",
				password: "password",
				vaultContent: {
					updated_at: expect.any(String),
					hmac: "",
					entries: [],
				},
				providerName: "google-drive",
				parentId: undefined,
			});
			expect(mockDispatch).toHaveBeenCalledWith(
				vaultActions.addVault(
					expect.objectContaining({
						name: "Test Vault",
						storageType: "cloud",
						providerId: "google-drive",
					}),
				),
			);
			expect(vaultId).toMatch(/^vault_\d+_[a-z0-9]+$/);
		});

		it("should create local vault successfully", async () => {
			vi.mocked(VaultCommands.write).mockResolvedValue(undefined);

			const vaultId = await vaultManager.createVault(
				"Local Vault",
				"password",
				"local",
				undefined,
				"local.vault",
			);

			expect(VaultCommands.write).toHaveBeenCalledWith(
				"local.vault",
				"password",
				{
					updated_at: expect.any(String),
					hmac: "",
					entries: [],
				},
			);
			expect(mockDispatch).toHaveBeenCalledWith(
				vaultActions.addVault(
					expect.objectContaining({
						name: "Local Vault",
						storageType: "local",
						path: "local.vault",
					}),
				),
			);
		});

		it("should throw error if provider ID missing for cloud vault", async () => {
			await expect(
				vaultManager.createVault("Test", "password", "cloud"),
			).rejects.toThrow("Provider ID is required for cloud vaults");
		});
	});

	describe("getInstance", () => {
		it("should return existing instance", () => {
			const vault: Vault = {
				id: "test-vault",
				name: "Test",
				path: "test",
				storageType: "local",
				isLocked: true,
				volatile: {
					entries: [],
					credential: "",
					navigationPath: "/",
					encryptedData: undefined,
				},
			};
			mockState.vault.vaults = [vault];
			mockGetState.mockReturnValue(mockState);

			const instance1 = vaultManager.getInstance("test-vault");
			const instance2 = vaultManager.getInstance("test-vault");

			expect(instance1).toBe(instance2);
		});

		it("should return undefined for non-existent vault", () => {
			const instance = vaultManager.getInstance("non-existent");
			expect(instance).toBeUndefined();
		});

		it("should return undefined for cloud vault missing metadata", () => {
			const cloudVault: Vault = {
				id: "cloud-vault",
				name: "Cloud",
				path: "cloud",
				storageType: "cloud",
				isLocked: true,
				volatile: {
					entries: [],
					credential: "",
					navigationPath: "/",
					encryptedData: undefined,
				},
			};
			mockState.vault.vaults = [cloudVault];
			mockGetState.mockReturnValue(mockState);

			const instance = vaultManager.getInstance("cloud-vault");
			expect(instance).toBeUndefined();
		});

		describe("Cloud Storage Integration", () => {
			it("should handle cloud vault creation with proper error handling", async () => {
				const config: {
					type: StorageProviderType.GOOGLE_DRIVE;
					config: GoogleDriveConfig;
				} = {
					type: StorageProviderType.GOOGLE_DRIVE,
					config: {
						client_id: "test",
						client_secret: "test",
						redirect_uri: "test",
					},
				};
				vi.mocked(CloudStorageCommands.addProvider).mockResolvedValue(
					undefined,
				);
				vi.mocked(CloudStorageCommands.listProviders).mockResolvedValue([]);
				vi.mocked(CloudStorageCommands.writeCloudVault).mockResolvedValue(
					"cloud-vault-id",
				);

				await vaultManager.addProvider(config);
				const vaultId = await vaultManager.createVault(
					"Cloud Vault",
					"password",
					"cloud",
					"provider_123",
				);

				expect(vaultId).toMatch(/^vault_\d+_[a-z0-9]+$/);
				expect(mockDispatch).toHaveBeenCalledWith(
					vaultActions.addVault(
						expect.objectContaining({
							name: "Cloud Vault",
							storageType: "cloud",
							providerId: "provider_123",
						}),
					),
				);
			});

			it("should handle cloud vault operations with authentication failures", async () => {
				const cloudVault = {
					id: "cloud-vault-test",
					name: "Cloud Test Vault",
					path: "cloud-file-id",
					storageType: "cloud" as const,
					providerId: "google-drive",
					cloudMetadata: {
						fileId: "cloud-file-id",
						provider: "google-drive",
						lastSync: new Date().toISOString(),
					},
					isLocked: true,
					volatile: {
						entries: [],
						credential: "",
						navigationPath: "/",
						encryptedData: undefined,
					},
				};

				mockState.vault.vaults = [cloudVault];
				mockGetState.mockReturnValue(mockState);

				const vaultInstance = vaultManager.getInstance("cloud-vault-test");
				expect(vaultInstance).toBeDefined();

				// Mock authentication failure
				vi.mocked(CloudStorageCommands.readCloudVault).mockRejectedValue(
					new Error("Authentication failed"),
				);

				await expect(vaultInstance!.unlock("wrong-password")).rejects.toThrow();
			});

			it("should handle cloud vault sync with network errors", async () => {
				const cloudVault = {
					id: "sync-test-vault",
					name: "Sync Test Vault",
					path: "cloud-file-id",
					storageType: "cloud" as const,
					providerId: "google-drive",
					cloudMetadata: {
						fileId: "cloud-file-id",
						provider: "google-drive",
						lastSync: new Date().toISOString(),
					},
					isLocked: false,
					volatile: {
						entries: [],
						credential: "test-password",
						navigationPath: "/",
						encryptedData: undefined,
					},
				};

				mockState.vault.vaults = [cloudVault];
				mockGetState.mockReturnValue(mockState);

				const vaultInstance = vaultManager.getInstance("sync-test-vault");

				// Mock network error
				vi.mocked(CloudStorageCommands.readCloudVault).mockRejectedValue(
					new Error("Network connection failed"),
				);

				await expect(vaultInstance!.syncWithCloud()).rejects.toThrow(
					"Failed to sync with cloud",
				);
			});

			it("should handle provider management with proper state updates", async () => {
				const providers: StorageProvider[] = [
					{
						name: "google-drive",
						providerType: "google_drive" as StorageProviderType,
						isDefault: true,
					},
				];

				vi.mocked(CloudStorageCommands.listProviders).mockResolvedValue(
					providers,
				);

				await vaultManager.loadProviders();

				expect(mockDispatch).toHaveBeenCalledWith(
					vaultActions.setStorageProviders(providers),
				);
			});

			it("should handle cloud vault listing with empty results", async () => {
				vi.mocked(CloudStorageCommands.listCloudVaults).mockResolvedValue([]);

				const vaults = await vaultManager.listCloudVaults();

				expect(vaults).toEqual([]);
				expect(CloudStorageCommands.listCloudVaults).toHaveBeenCalledWith(
					undefined,
				);
			});

			it("should handle cloud vault operations with token expiration", async () => {
				const cloudVault = {
					id: "token-expire-vault",
					name: "Token Expire Vault",
					path: "cloud-file-id",
					storageType: "cloud" as const,
					providerId: "google-drive",
					cloudMetadata: {
						fileId: "cloud-file-id",
						provider: "google-drive",
						lastSync: new Date().toISOString(),
					},
					isLocked: false,
					volatile: {
						entries: [],
						credential: "test-password",
						navigationPath: "/",
						encryptedData: undefined,
					},
				};

				mockState.vault.vaults = [cloudVault];
				mockGetState.mockReturnValue(mockState);

				const vaultInstance = vaultManager.getInstance("token-expire-vault");

				// Mock token expiration during update
				vi.mocked(CloudStorageCommands.updateCloudVault).mockRejectedValue(
					new Error("Token expired"),
				);

				const newEntry: Entry = {
					id: "new-entry",
					type: "note",
					title: "New Entry",
					created_at: new Date().toISOString(),
					updated_at: new Date().toISOString(),
					tags: [],
				};

				await expect(vaultInstance!.addEntry([], newEntry)).rejects.toThrow();
			});

			it("should handle cloud vault migration scenarios", async () => {
				const localVault: Vault = {
					id: "local-to-cloud",
					name: "Local Vault",
					path: "/local/path.vault",
					storageType: "local",
					isLocked: false,
					volatile: {
						entries: [],
						credential: "test-password",
						navigationPath: "/",
						encryptedData: undefined,
					},
				};

				mockState.vault.vaults = [localVault];
				mockGetState.mockReturnValue(mockState);

				// Test creating cloud vault from local vault data
				vi.mocked(CloudStorageCommands.writeCloudVault).mockResolvedValue(
					"migrated-vault-id",
				);

				const cloudVaultId = await vaultManager.createVault(
					"Migrated Vault",
					"test-password",
					"cloud",
					"google-drive",
				);

				expect(cloudVaultId).toMatch(/^vault_\d+_[a-z0-9]+$/);
				expect(CloudStorageCommands.writeCloudVault).toHaveBeenCalledWith({
					vaultName: "Migrated Vault",
					password: "test-password",
					vaultContent: expect.objectContaining({
						entries: [],
						updated_at: expect.any(String),
						hmac: "",
					}),
					providerName: "google-drive",
				});
			});

			it("should handle concurrent cloud vault operations", async () => {
				const cloudVault = {
					id: "concurrent-cloud-vault",
					name: "Concurrent Cloud Vault",
					path: "cloud-file-id",
					storageType: "cloud" as const,
					providerId: "google-drive",
					cloudMetadata: {
						fileId: "cloud-file-id",
						provider: "google-drive",
						lastSync: new Date().toISOString(),
					},
					isLocked: false,
					volatile: {
						entries: [],
						credential: "test-password",
						navigationPath: "/",
						encryptedData: undefined,
					},
				};

				mockState.vault.vaults = [cloudVault];
				mockGetState.mockReturnValue(mockState);

				const vaultInstance = vaultManager.getInstance(
					"concurrent-cloud-vault",
				);

				// Mock successful operations
				vi.mocked(CloudStorageCommands.updateCloudVault).mockResolvedValue(
					undefined,
				);

				const entry1: Entry = {
					id: "concurrent-1",
					type: "note",
					title: "Concurrent 1",
					created_at: new Date().toISOString(),
					updated_at: new Date().toISOString(),
					tags: [],
				};

				const entry2: Entry = {
					id: "concurrent-2",
					type: "note",
					title: "Concurrent 2",
					created_at: new Date().toISOString(),
					updated_at: new Date().toISOString(),
					tags: [],
				};

				// Perform concurrent operations
				const operations = [
					vaultInstance!.addEntry([], entry1),
					vaultInstance!.addEntry([], entry2),
				];

				await expect(Promise.all(operations)).resolves.toBeDefined();
			});
		});
	});
});
