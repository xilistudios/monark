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
import { CloudStorageCommands } from "../../services/cloudStorage";
import VaultCommands from "../../services/commands";
import { VaultInstance, VaultManager } from "../../services/vault";

// Mock the dependencies
const mockVaultCommands = vi.hoisted(() => ({
	read: vi.fn(),
	write: vi.fn(),
	delete: vi.fn(),
}));
const mockCloudStorageCommands = vi.hoisted(() => ({
	listProviders: vi.fn(),
	addProvider: vi.fn(),
	removeProvider: vi.fn(),
	setDefaultProvider: vi.fn(),
	authenticateProvider: vi.fn(),
	getGoogleDriveOAuthUrl: vi.fn(),
	getProviderAuthInfo: vi.fn(),
	refreshProviderAuth: vi.fn(),
	listCloudVaults: vi.fn(),
	readCloudVault: vi.fn(),
	writeCloudVault: vi.fn(),
	updateCloudVault: vi.fn(),
	deleteCloudVault: vi.fn(),
}));
const mockVaultActions = vi.hoisted(() => ({
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
	setCloudVaultsRefreshing: vi.fn(),
	setOAuthState: vi.fn(),
	addVault: vi.fn(),
	setVaultLocked: vi.fn(),
}));

vi.mock("../../services/commands", () => ({
	default: mockVaultCommands,
}));
vi.mock("../../services/cloudStorage", () => ({
	CloudStorageCommands: mockCloudStorageCommands,
}));
vi.mock("../../redux/actions/vault", () => ({
	// Every name vault.ts imports must be present here: vitest replaces a name
	// missing from the factory result with a stub that THROWS when called
	// ("No 'X' export is defined on the ... mock"), which would break any call
	// site that reaches it (e.g. setCloudVaultsRefreshing in refreshCloudVaults).
	...mockVaultActions,
	setVaultEntries: mockVaultActions.setVaultEntries,
	setVaultCredential: mockVaultActions.setVaultCredential,
	lockVault: mockVaultActions.lockVault,
	syncCloudVault: mockVaultActions.syncCloudVault,
	setStorageProviders: mockVaultActions.setStorageProviders,
	removeStorageProvider: mockVaultActions.removeStorageProvider,
	setDefaultStorageProvider: mockVaultActions.setDefaultStorageProvider,
	setProviderStatus: mockVaultActions.setProviderStatus,
	setCloudVaults: mockVaultActions.setCloudVaults,
	setCloudVaultsRefreshing: mockVaultActions.setCloudVaultsRefreshing,
	setOAuthState: mockVaultActions.setOAuthState,
	addVault: mockVaultActions.addVault,
	setVaultLocked: mockVaultActions.setVaultLocked,
}));
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
		// The shared CloudStorageCommands stubs must start every test as plain
		// "return undefined" stubs: a lingering rejection from a previous test
		// would otherwise leak into the next one (the mocks are declared with
		// vi.hoisted and survive across tests within this file).
		vi.clearAllMocks();
		CloudStorageCommands.getProviderAuthInfo.mockReset();
		CloudStorageCommands.refreshProviderAuth.mockReset();

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
				"Failed to unlock vault: Invalid password",
			);
		});
	});

	describe("updateEntry", () => {
		it("should update a root-level entry successfully", async () => {
			const vault: Vault = {
				id: "test-vault",
				name: "Test",
				path: "test",
				storageType: "local",
				isLocked: false,
				volatile: {
					entries: [
						{
							id: "entry-1",
							entry_type: "entry",
							name: "Original",
							data_type: "note",
							created_at: "2025-01-01T00:00:00Z",
							updated_at: "2025-01-01T00:00:00Z",
							fields: [],
							tags: [],
						},
					],
					credential: "test-password",
					navigationPath: "/",
					encryptedData: undefined,
				},
			};
			mockState.vault.vaults = [vault];
			mockGetState.mockReturnValue(mockState);

			vi.mocked(VaultCommands.write).mockResolvedValue(undefined);

			const instance = new VaultInstance(vault, mockDispatch, mockGetState);
			await instance.updateEntry(["entry-1"], { name: "Updated" });

			expect(mockDispatch).toHaveBeenCalledWith(
				vaultActions.setVaultEntries(
					expect.objectContaining({
						vaultId: "test-vault",
						entries: expect.arrayContaining([
							expect.objectContaining({ id: "entry-1", name: "Updated" }),
						]),
					}),
				),
			);
		});

		it("should throw when path is wrong (single-segment for nested entry)", async () => {
			// This is the exact bug scenario: deriving a single-segment path
			// from currentPath + id when the entry is actually nested inside a group
			const vault: Vault = {
				id: "test-vault",
				name: "Test",
				path: "test",
				storageType: "local",
				isLocked: false,
				volatile: {
					entries: [
						{
							id: "group-1",
							entry_type: "group",
							name: "Group",
							data_type: "",
							created_at: "2025-01-01T00:00:00Z",
							updated_at: "2025-01-01T00:00:00Z",
							children: [
								{
									id: "nested-entry-1",
									entry_type: "entry",
									name: "Nested",
									data_type: "login",
									created_at: "2025-01-01T00:00:00Z",
									updated_at: "2025-01-01T00:00:00Z",
									fields: [],
									tags: [],
								},
							],
						},
					],
					credential: "test-password",
					navigationPath: "/",
					encryptedData: undefined,
				},
			};
			mockState.vault.vaults = [vault];
			mockGetState.mockReturnValue(mockState);

			const instance = new VaultInstance(vault, mockDispatch, mockGetState);

			// Single-segment path (what the buggy UI passed) should fail
			await expect(
				instance.updateEntry(["nested-entry-1"], { name: "Updated" }),
			).rejects.toThrow("Entry not found at path: nested-entry-1");
		});
	});

	describe("updateEntryById", () => {
		it("should update a nested entry by resolving its absolute path", async () => {
			const vault: Vault = {
				id: "test-vault",
				name: "Test",
				path: "test",
				storageType: "local",
				isLocked: false,
				volatile: {
					entries: [
						{
							id: "group-1",
							entry_type: "group",
							name: "Group",
							data_type: "",
							created_at: "2025-01-01T00:00:00Z",
							updated_at: "2025-01-01T00:00:00Z",
							children: [
								{
									id: "nested-entry-1",
									entry_type: "entry",
									name: "Nested Original",
									data_type: "login",
									created_at: "2025-01-01T00:00:00Z",
									updated_at: "2025-01-01T00:00:00Z",
									fields: [],
									tags: [],
								},
							],
						},
					],
					credential: "test-password",
					navigationPath: "/",
					encryptedData: undefined,
				},
			};
			mockState.vault.vaults = [vault];
			mockGetState.mockReturnValue(mockState);

			vi.mocked(VaultCommands.write).mockResolvedValue(undefined);

			const instance = new VaultInstance(vault, mockDispatch, mockGetState);
			await instance.updateEntryById("nested-entry-1", {
				name: "Nested Renamed",
			});

			// Verify the nested entry was updated in the dispatched entries
			expect(mockDispatch).toHaveBeenCalledWith(
				vaultActions.setVaultEntries(
					expect.objectContaining({
						vaultId: "test-vault",
						entries: expect.arrayContaining([
							expect.objectContaining({
								id: "group-1",
								children: expect.arrayContaining([
									expect.objectContaining({
										id: "nested-entry-1",
										name: "Nested Renamed",
									}),
								]),
							}),
						]),
					}),
				),
			);
		});

		it("should throw for a non-existent entry ID", async () => {
			const vault: Vault = {
				id: "test-vault",
				name: "Test",
				path: "test",
				storageType: "local",
				isLocked: false,
				volatile: {
					entries: [
						{
							id: "entry-1",
							entry_type: "entry",
							name: "Entry",
							data_type: "note",
							created_at: "2025-01-01T00:00:00Z",
							updated_at: "2025-01-01T00:00:00Z",
							fields: [],
							tags: [],
						},
					],
					credential: "test-password",
					navigationPath: "/",
					encryptedData: undefined,
				},
			};
			mockState.vault.vaults = [vault];
			mockGetState.mockReturnValue(mockState);

			const instance = new VaultInstance(vault, mockDispatch, mockGetState);

			await expect(
				instance.updateEntryById("does-not-exist", { name: "Nope" }),
			).rejects.toThrow("Entry not found: does-not-exist");
		});

		it("should update a root-level entry by ID", async () => {
			const vault: Vault = {
				id: "test-vault",
				name: "Test",
				path: "test",
				storageType: "local",
				isLocked: false,
				volatile: {
					entries: [
						{
							id: "root-entry",
							entry_type: "entry",
							name: "Root Original",
							data_type: "note",
							created_at: "2025-01-01T00:00:00Z",
							updated_at: "2025-01-01T00:00:00Z",
							fields: [],
							tags: [],
						},
					],
					credential: "test-password",
					navigationPath: "/",
					encryptedData: undefined,
				},
			};
			mockState.vault.vaults = [vault];
			mockGetState.mockReturnValue(mockState);

			vi.mocked(VaultCommands.write).mockResolvedValue(undefined);

			const instance = new VaultInstance(vault, mockDispatch, mockGetState);
			await instance.updateEntryById("root-entry", { name: "Root Updated" });

			expect(mockDispatch).toHaveBeenCalledWith(
				vaultActions.setVaultEntries(
					expect.objectContaining({
						vaultId: "test-vault",
						entries: expect.arrayContaining([
							expect.objectContaining({ id: "root-entry", name: "Root Updated" }),
						]),
					}),
				),
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
		// Same isolation as the VaultInstance suite: the shared
		// CloudStorageCommands stubs must not inherit call counts or
		// rejections from a previous test.
		vaultManager = VaultManager.getInstance();
		mockDispatch = vi.fn();
		mockGetState = vi.fn();

		// Reset the shared CloudStorageCommands stubs AFTER creating this test's
		// spies: a lingering rejection/call-count from a previous test must not
		// leak into this one (the mocks are declared with vi.hoisted).
		CloudStorageCommands.getProviderAuthInfo.mockReset();
		CloudStorageCommands.refreshProviderAuth.mockReset();
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

		mockGetState.mockReturnValue(mockState);
		vaultManager.initialize(mockDispatch, mockGetState);
	});

	afterEach(() => {
		vi.clearAllMocks();
	});

	describe("loadProviders", () => {
		it("should load providers successfully", async () => {
			const mockProviders: StorageProvider[] = [
				{
					name: "google-drive",
					provider_type: StorageProviderType.GOOGLE_DRIVE,
					is_default: true,
				},
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

		it("should refresh google drive auth before marking it expired", async () => {
			const mockProviders: StorageProvider[] = [
				{
					name: "google-drive",
					provider_type: StorageProviderType.GOOGLE_DRIVE,
					is_default: true,
				},
			];
			vi.mocked(CloudStorageCommands.listProviders).mockResolvedValue(
				mockProviders,
			);
			vi.mocked(CloudStorageCommands.getProviderAuthInfo).mockResolvedValue({
				authenticated: true,
				token_expires_at: new Date(Date.now() - 60_000).toISOString(),
			});
			vi.mocked(CloudStorageCommands.refreshProviderAuth).mockResolvedValue({
				authenticated: true,
				token_expires_at: new Date(Date.now() + 3_600_000).toISOString(),
			});

			await vaultManager.loadProviders();

			expect(CloudStorageCommands.refreshProviderAuth).toHaveBeenCalledWith(
				"google-drive",
			);
			expect(mockDispatch).toHaveBeenCalledWith(
				vaultActions.setProviderStatus({
					providerId: "google-drive",
					status: "authenticated",
				}),
			);
		});

		it("should mark google drive expired when refresh fails", async () => {
			const mockProviders: StorageProvider[] = [
				{
					name: "google-drive",
					provider_type: StorageProviderType.GOOGLE_DRIVE,
					is_default: true,
				},
			];
			vi.mocked(CloudStorageCommands.listProviders).mockResolvedValue(
				mockProviders,
			);
			vi.mocked(CloudStorageCommands.getProviderAuthInfo).mockResolvedValue({
				authenticated: true,
				token_expires_at: new Date(Date.now() - 60_000).toISOString(),
			});
			vi.mocked(CloudStorageCommands.refreshProviderAuth).mockRejectedValue(
				new Error("invalid_grant"),
			);

			await vaultManager.loadProviders();

			expect(mockDispatch).toHaveBeenCalledWith(
				vaultActions.setProviderStatus({
					providerId: "google-drive",
					status: "expired",
				}),
			);
		});

		it("should throw error if loading fails", async () => {
			vi.mocked(CloudStorageCommands.listProviders).mockRejectedValue(
				new Error("Network error"),
			);

			await expect(vaultManager.loadProviders()).rejects.toThrow(
				"Failed to load providers: Network error",
			);
		});
	});

	describe("addProvider", () => {
		it("should add provider successfully", async () => {
			const request = {
				name: 'google-drive',
				config: {
					type: StorageProviderType.GOOGLE_DRIVE,
					config: {
						client_id: "test",
						client_secret: "test",
						redirect_uri: "test",
					},
				},
			};
			vi.mocked(CloudStorageCommands.addProvider).mockResolvedValue(undefined);
			vi.mocked(CloudStorageCommands.listProviders).mockResolvedValue([]);

			await vaultManager.addProvider(request);

			expect(CloudStorageCommands.addProvider).toHaveBeenCalledWith(request);
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
			).rejects.toThrow("Failed to authenticate provider: Auth failed");

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
			expect(vaultId).toMatch(/^vault_[0-9a-f-]{36}$/);
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

		it("should return an instance for cloud vault with providerId but without cloudMetadata", () => {
			const cloudVault: Vault = {
				id: "cloud-vault-no-metadata",
				name: "Cloud",
				path: "cloud-file-id",
				storageType: "cloud",
				providerId: "google-drive",
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

			const instance = vaultManager.getInstance("cloud-vault-no-metadata");
			expect(instance).toBeDefined();
		});

		it("should return undefined for cloud vault missing provider information", () => {
			const cloudVault: Vault = {
				id: "cloud-vault-no-provider",
				name: "Cloud",
				path: "cloud-file-id",
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

			const instance = vaultManager.getInstance("cloud-vault-no-provider");
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

				expect(vaultId).toMatch(/^vault_[0-9a-f-]{36}$/);
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

			it("should not write cloud vault content to local storage when providerId is missing", async () => {
				// Cloud vault without providerId: _saveVault must throw instead of
				// silently writing cloud content to a local file
				const cloudVault = {
					id: "cloud-vault-missing-provider",
					name: "Cloud Missing Provider",
					path: "cloud-file-id",
					storageType: "cloud" as const,
					providerId: undefined,
					isLocked: false,
					volatile: {
						entries: [
							{
								id: "entry-1",
								entry_type: "entry" as const,
								name: "Test Entry",
								data_type: "note",
								created_at: new Date().toISOString(),
								updated_at: new Date().toISOString(),
								fields: [],
								tags: [],
							},
						],
						credential: "test-password",
						navigationPath: "/",
						encryptedData: undefined,
					},
				};

				mockState.vault.vaults = [cloudVault];
				mockGetState.mockReturnValue(mockState);

				// getInstance() correctly refuses to hand out instances for
				// provider-less cloud vaults, so build the instance directly to
				// exercise the _saveVault guard
				const vaultInstance = new VaultInstance(
					cloudVault,
					mockDispatch,
					mockGetState,
				);

				const updates: Partial<Entry> = { name: "Updated Entry" };

				await expect(
					vaultInstance.updateEntry(["entry-1"], updates),
				).rejects.toThrow(/provider/i);

				// The cloud content must never reach the local write path
				expect(VaultCommands.write).not.toHaveBeenCalled();
				expect(
					CloudStorageCommands.writeCloudVault,
				).not.toHaveBeenCalled();
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
				vi.mocked(CloudStorageCommands.writeCloudVault).mockRejectedValue(
					new Error("invalid_grant"),
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

				expect(cloudVaultId).toMatch(/^vault_[0-9a-f-]{36}$/);
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


/**
 * Provider-auth classification pins (issue #28, T6 — the D1 behaviour change).
 *
 * These rows pin the DELTAS of the shared failure contract BEFORE any future
 * tightening, i.e. what the call sites must do with the merged
 * `providerAuth.getProviderAuthState` semantics:
 *
 * - B1: an expired provider whose refresh fails with a TERMINAL failure
 *   (here the conservative `Cloud storage operation failed` message) is
 *   `expired` after exactly ONE refresh call (the manager used to retry three
 *   times and report a transient/"idle" status).
 * - B2: the same failure raised by `getProviderAuthInfo` itself (the
 *   loadProviders / vsync path) surfaces as `expired`, not as
 *   `transientError` → "idle".
 * - B3: in `refreshCloudVaults` a terminal failure means the genuine re-auth
 *   path (hadGenuineAuthErrors), while a transient one means the network
 *   path (hadNetworkErrors) with NO re-auth prompt.
 * - B4: a transient failure under the instance's one-shot policy resolves as
 *   `transientError: true` (so `authenticated === false`) — the callers'
 *   `!authState.authenticated` gate still converges on the re-auth prompt.
 * - B5: the `syncWithCloud` catch prompts a re-auth ONLY for auth-shaped
 *   failures (`isAuthFailure`) — and dispatches the "error" provider status
 *   inside that same guard. Compared with the old
 *   `isAuthRelatedCloudError` regex this is BOTH narrowed (quota, permission,
 *   operation and network failures no longer prompt) AND broadened (a
 *   wrapper-typed auth failure such as `{type: AUTHENTICATION_FAILED}` now
 *   prompts, where the old message-only regex did not).
 * - B6: the merged ladder retries ONLY the rung that failed (the old
 *   `VaultManager.getProviderAuthState` re-ran `getProviderAuthInfo` before
 *   every refresh retry: 4 info + 4 refresh; the new code: 1 info + 4
 *   refresh). Fewer IPC calls, same verdicts — pinned in the exhausted-ladder
 *   row below and in `providerAuth.test.ts`.
 */
/**
 * `true` if any `setProviderStatus` payload carried this exact object.
 *
 * The action creators of the mocked `../../redux/actions/vault` module are
 * `vi.hoisted` spies, so each action is recorded by the spy ITSELF with its
 * REAL payload. `dispatch.mock.calls` records the action objects as
 * `undefined` (a creator-spy returns `undefined`), so payload assertions must
 * always go through this helper (or directly through
 * `vaultActions.<creator>.mock.calls`).
 */
const dispatchedProviderStatus = (
	spy: typeof vaultActions.setProviderStatus,
	payload: { providerId: string; status: string },
): boolean =>
	spy.mock.calls.some(([argument]) => {
		const candidate = argument as
			| { providerId?: string; status?: string }
			| undefined;
		return (
			candidate?.providerId === payload.providerId &&
			candidate?.status === payload.status
		);
	});

/**
 * `true` if a `setCloudVaults([])` cleanup was dispatched.
 *
 * The action creators of the mocked `../../redux/actions/vault` module are
 * `vi.hoisted` spies (see the factories above), so each action is recorded by
 * the spy ITSELF — this helper reads the payloads those spies received, which
 * stays reliable even though `dispatch.mock.calls` records the action objects
 * as `undefined` (see the `dispatchedProviderStatus` doc below).
 */
const dispatchedEmptyCloudVaultClear = (): boolean =>
	vaultActions.setCloudVaults.mock.calls.some(
		([vaults]) => Array.isArray(vaults) && vaults.length === 0,
	);

/**
 * `MANAGER_RETRY_POLICY` sleeps in real time (1s + 2s + 4s = 7s of backoff for
 * a fully-exhausted transient ladder), which blows past vitest's 5s default.
 * These tests care about the CALL COUNT and the resulting status, never about
 * the wall-clock timing, so every row that exercises the retry ladder wraps the
 * call in `withoutRealBackoff()` (fake timers advanced by the backoff itself).
 */
const withoutRealBackoff = async <T>(run: () => Promise<T>): Promise<T> => {
	vi.useFakeTimers();
	try {
		const promise = run();
		// Let the awaited retry loop register its `setTimeout`, then fast-forward
		// past every pending backoff (7s ladder) as each one is scheduled.
		for (let tick = 0; tick < 16; tick++) {
			await vi.advanceTimersByTimeAsync(8_000);
		}
		return await promise;
	} finally {
		vi.useRealTimers();
	}
};

describe("provider auth classification", () => {
	const CONTRACT_TERMINAL_MESSAGE = "Cloud storage operation failed";
	const AUTH_REJECTION_MESSAGE =
		"authentication failed while refreshing the Google Drive access token (re-authenticate): invalid_grant";
	// The action/command spies are `vi.hoisted` and therefore SHARED by every row
	// of this file: without an explicit reset a call recorded by an earlier row
	// would be counted again by the next one (vitest only auto-clears on config).
	afterEach(() => {
		vi.mocked(CloudStorageCommands.getProviderAuthInfo).mockReset();
		vi.mocked(CloudStorageCommands.refreshProviderAuth).mockReset();
		vi.mocked(CloudStorageCommands.getGoogleDriveOAuthUrl).mockReset();
		vi.mocked(CloudStorageCommands.listProviders).mockReset();
		vi.mocked(CloudStorageCommands.listCloudVaults).mockReset();
		vi.mocked(CloudStorageCommands.readCloudVault).mockReset();
		vaultActions.setProviderStatus.mockClear();
		vaultActions.setOAuthState.mockClear();
		vaultActions.setCloudVaults.mockClear();
		vaultActions.setCloudVaultsRefreshing.mockClear();
	});

	// Backoff is real time (1s+2s+4s), which overflows vitest's 5s default.
	const TRANSIENT_MESSAGE =
		"network error while refreshing the Google Drive access token: connection reset by peer";
	const STALE_EXPIRY = new Date(Date.now() - 60_000).toISOString();
	const FRESH_EXPIRY = new Date(Date.now() + 3_600_000).toISOString();

	/** A provider whose access token is already past the expiry buffer. */
	const expiredProvider = (): StorageProvider => ({
		name: "google-drive",
		provider_type: StorageProviderType.GOOGLE_DRIVE,
		is_default: true,
	});

	describe("VaultManager.loadProviders (B1 / B2)", () => {
		let manager: VaultManager;
		let dispatch: AppDispatch;
		let getState: () => RootState;
		let state: RootState;

		beforeEach(() => {
			manager = VaultManager.getInstance();
			dispatch = vi.fn();
			getState = vi.fn();
			state = {
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
			getState.mockReturnValue(state);
			manager.initialize(dispatch, getState);
			CloudStorageCommands.getProviderAuthInfo.mockReset();
			CloudStorageCommands.refreshProviderAuth.mockReset();
			CloudStorageCommands.getGoogleDriveOAuthUrl.mockReset();
			CloudStorageCommands.listProviders.mockReset();
			dispatch.mockClear();
		});

		it("★ B1: expired provider + terminal refresh failure ⇒ 'expired' with ONE refresh call", async () => {
			vi.mocked(CloudStorageCommands.listProviders).mockResolvedValue([
				expiredProvider(),
			]);
			vi.mocked(CloudStorageCommands.getProviderAuthInfo).mockResolvedValue({
				authenticated: true,
				token_expires_at: STALE_EXPIRY,
			});
			vi.mocked(CloudStorageCommands.refreshProviderAuth).mockRejectedValue(
				new Error(CONTRACT_TERMINAL_MESSAGE),
			);

			await withoutRealBackoff(() => manager.loadProviders());

			// The creator spy records the REAL payload (dispatch.mock.calls only
			// sees `undefined`, see `dispatchedProviderStatus`).
			expect(vaultActions.setProviderStatus).toHaveBeenCalledWith({
				providerId: "google-drive",
				status: "expired",
			});
			// B1: exactly one refresh — the terminal failure is NOT retried.
			expect(CloudStorageCommands.refreshProviderAuth).toHaveBeenCalledTimes(
				1,
			);
		});

		it("★ B1: expired provider + auth-shaped refresh failure ⇒ 'expired' with ONE refresh call", async () => {
			vi.mocked(CloudStorageCommands.listProviders).mockResolvedValue([
				expiredProvider(),
			]);
			vi.mocked(CloudStorageCommands.getProviderAuthInfo).mockResolvedValue({
				authenticated: true,
				token_expires_at: STALE_EXPIRY,
			});
			vi.mocked(CloudStorageCommands.refreshProviderAuth).mockRejectedValue(
				new Error(AUTH_REJECTION_MESSAGE),
			);

			await withoutRealBackoff(() => manager.loadProviders());

			expect(vaultActions.setProviderStatus).toHaveBeenCalledWith({
				providerId: "google-drive",
				status: "expired",
			});
			expect(
				vi.mocked(CloudStorageCommands.refreshProviderAuth).mock.calls,
			).toEqual([["google-drive"]]);
		});

		it("★ B2: getProviderAuthInfo rejecting with the terminal contract message ⇒ 'expired' (was 'idle')", async () => {
			vi.mocked(CloudStorageCommands.listProviders).mockResolvedValue([
				expiredProvider(),
			]);
			vi.mocked(CloudStorageCommands.getProviderAuthInfo).mockRejectedValue(
				new Error(CONTRACT_TERMINAL_MESSAGE),
			);

			await withoutRealBackoff(() => manager.loadProviders());

			expect(vaultActions.setProviderStatus).toHaveBeenCalledWith({
				providerId: "google-drive",
				status: "expired",
			});
			// B2: one call only — no retry ladder for a terminal failure.
			expect(CloudStorageCommands.getProviderAuthInfo).toHaveBeenCalledTimes(
				1,
			);
			// B2 (pre-D1 behaviour): NO "idle" status may be dispatched for this
			// provider. The creator spy carries the REAL payload, so a payload scan
			// is the only way to make this negative assertion load-bearing.
			expect(dispatchedProviderStatus(vaultActions.setProviderStatus, {
				providerId: "google-drive",
				status: "idle",
			})).toBe(false);
			expect(
				CloudStorageCommands.refreshProviderAuth,
			).not.toHaveBeenCalled();
		});

		it("B2 (preserved): a transient getProviderAuthInfo failure stays 'idle' with no re-auth", async () => {

			vi.mocked(CloudStorageCommands.listProviders).mockResolvedValue([
				expiredProvider(),
			]);
			vi.mocked(CloudStorageCommands.getProviderAuthInfo).mockRejectedValue(
				new Error(TRANSIENT_MESSAGE),
			);

			await withoutRealBackoff(() => manager.loadProviders());

			// 1 attempt + MANAGER_RETRY_POLICY.retries (3) = 4 calls, then
			// {authenticated:false, expired:false, transientError:true} ⇒ "idle".
			expect(CloudStorageCommands.getProviderAuthInfo).toHaveBeenCalledTimes(
				4,
			);
			expect(vaultActions.setProviderStatus).toHaveBeenCalledWith({
				providerId: "google-drive",
				status: "idle",
			});
			expect(
				CloudStorageCommands.getGoogleDriveOAuthUrl,
			).not.toHaveBeenCalled();
			expect(
				CloudStorageCommands.refreshProviderAuth,
			).not.toHaveBeenCalled();
		});

		it("B2 (preserved): a transient refresh failure stays 'idle' with no re-auth prompt", async () => {
			vi.mocked(CloudStorageCommands.listProviders).mockResolvedValue([
				expiredProvider(),
			]);
			vi.mocked(CloudStorageCommands.getProviderAuthInfo).mockResolvedValue({
				authenticated: true,
				token_expires_at: STALE_EXPIRY,
			});
			vi.mocked(CloudStorageCommands.refreshProviderAuth).mockRejectedValue(
				new Error(TRANSIENT_MESSAGE),
			);

			await withoutRealBackoff(() => manager.loadProviders());

			// B6: the transient ladder retries ONLY the failing rung — the info
			// call succeeded once and is NOT re-run before each refresh retry (the
			// old `VaultManager` re-ran it: 4 info + 4 refresh).
			expect(CloudStorageCommands.getProviderAuthInfo).toHaveBeenCalledTimes(
				1,
			);
			expect(CloudStorageCommands.refreshProviderAuth).toHaveBeenCalledTimes(
				4,
			);
			expect(vaultActions.setProviderStatus).toHaveBeenCalledWith({
				providerId: "google-drive",
				status: "idle",
			});
			expect(
				CloudStorageCommands.getGoogleDriveOAuthUrl,
			).not.toHaveBeenCalled();
		});
	});

	describe("VaultManager.refreshCloudVaults (B3)", () => {
		let manager: VaultManager;
		let dispatch: AppDispatch;
		let getState: () => RootState;
		let state: RootState;

		beforeEach(() => {
			manager = VaultManager.getInstance();
			dispatch = vi.fn();
			// The action spies are hoisted and shared across this file: a
			// `setCloudVaults([])` recorded by the previous B3 row would otherwise
			// leak into the next row's "no cleanup was dispatched" assertion.
			vaultActions.setCloudVaults.mockClear();
			vaultActions.setProviderStatus.mockClear();
			vaultActions.setOAuthState.mockClear();
			vaultActions.setCloudVaultsRefreshing.mockClear();
			getState = vi.fn();
			state = {
				vault: {
					vaults: [],
					currentVaultId: null,
					loading: false,
					error: null,
					providers: [expiredProvider()],
					defaultProvider: null,
					providerStatus: {},
					// `promptProviderReauth` reads `oauthState.isOpen` directly (no
					// `?? {}` fallback), so the fixture needs the slice's initial
					// value or the re-auth prompt throws before it can open.
					oauthState: {
						providerName: null,
						authUrl: null,
						state: null,
						isOpen: false,
					},
				},
			} as RootState;
			getState.mockReturnValue(state);
			manager.initialize(dispatch, getState);

			CloudStorageCommands.getProviderAuthInfo.mockReset();
			CloudStorageCommands.refreshProviderAuth.mockReset();
			CloudStorageCommands.getGoogleDriveOAuthUrl.mockReset();
			CloudStorageCommands.listCloudVaults.mockReset();

			vi.mocked(CloudStorageCommands.getProviderAuthInfo).mockResolvedValue({
				authenticated: true,
				token_expires_at: STALE_EXPIRY,
			});
			vi.mocked(CloudStorageCommands.getGoogleDriveOAuthUrl).mockResolvedValue(
				{
					url: "https://accounts.google.com/o/oauth2/auth",
					state: "oauth-state",
				},
			);
		});

		it("★ B3: terminal refresh failure ⇒ re-auth path (hadGenuineAuthErrors)", async () => {
			vi.mocked(CloudStorageCommands.refreshProviderAuth).mockRejectedValue(
				new Error(CONTRACT_TERMINAL_MESSAGE),
			);

			await withoutRealBackoff(() => manager.refreshCloudVaults());

			// Genuine-auth cleanup: the cached cloud vaults ARE cleared.
			expect(dispatchedEmptyCloudVaultClear()).toBe(true);
			// The genuine-auth cleanup runs AFTER the re-auth prompt was opened —
			// asserted through the action spies' invocation order, because this
			// mock factory records the dispatched objects as `undefined` in
			// `dispatch.mock.calls` (so only the spies themselves carry the payload).
			expect(
				vaultActions.setCloudVaults.mock.invocationCallOrder[0],
			).toBeGreaterThan(vaultActions.setOAuthState.mock.invocationCallOrder[0]);
			expect(CloudStorageCommands.refreshProviderAuth).toHaveBeenCalledTimes(
				1,
			);
		});

		it("★ B3: transient refresh failure ⇒ network path, NO re-auth prompt", async () => {
			vi.mocked(CloudStorageCommands.refreshProviderAuth).mockRejectedValue(
				new Error(TRANSIENT_MESSAGE),
			);

			await withoutRealBackoff(() => manager.refreshCloudVaults());

			// transientError:true ⇒ hadNetworkErrors ⇒ the cached vaults stay
			// untouched (no setCloudVaults([]) cleanup) and no OAuth flow opens.
			expect(dispatchedEmptyCloudVaultClear()).toBe(false);
			expect(
				CloudStorageCommands.getGoogleDriveOAuthUrl,
			).not.toHaveBeenCalled();
		});
	});

	describe("VaultInstance.unlock (B4)", () => {
		it("★ B4: a transient auth-state failure still prompts the re-auth flow (!authenticated gate)", async () => {
			const vault: Vault = {
				id: "auth-class-vault",
				name: "Auth Class Vault",
				path: "cloud-file-id",
				storageType: "cloud",
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
			const dispatch = vi.fn();
			const getState = vi.fn();
			const state = {
				vault: {
					vaults: [vault],
					currentVaultId: null,
					loading: false,
					error: null,
					providers: [],
					defaultProvider: null,
					providerStatus: {},
				},
			} as RootState;
			getState.mockReturnValue(state);
			const instance = new VaultInstance(vault, dispatch, getState);

			vi.mocked(CloudStorageCommands.getProviderAuthInfo).mockRejectedValue(
				new Error(TRANSIENT_MESSAGE),
			);
			vi.mocked(CloudStorageCommands.getGoogleDriveOAuthUrl).mockResolvedValue(
				{
					url: "https://accounts.google.com/o/oauth2/auth",
					state: "oauth-state",
				},
			);
			// The vault content read still fails, so unlock rejects as usual.
			vi.mocked(CloudStorageCommands.readCloudVault).mockRejectedValue(
				new Error("no credentials"),
			);

			await expect(instance.unlock("password")).rejects.toThrow(
				"Failed to unlock vault",
			);


			// B4: NO_RETRY_POLICY ⇒ a single info call, no refresh, and the
			// transient verdict (`authenticated:false`) still opens the OAuth flow.
			expect(CloudStorageCommands.getProviderAuthInfo).toHaveBeenCalledTimes(
				1,
			);
			expect(
				CloudStorageCommands.refreshProviderAuth,
			).not.toHaveBeenCalled();
			// The OAuth side effect is asserted through the action-creator spy
			// (the REAL payload): dispatch.mock.calls only ever sees `undefined`.
			expect(vaultActions.setOAuthState).toHaveBeenCalledWith({
				providerName: "google-drive",
				authUrl: "https://accounts.google.com/o/oauth2/auth",
				state: "oauth-state",
				isOpen: true,
			});
			expect(CloudStorageCommands.getGoogleDriveOAuthUrl).toHaveBeenCalledWith(
				"google-drive",
			);
		});
	});

	describe("VaultInstance.syncWithCloud catch (B5)", () => {
		const syncFailingWith = async (error: unknown) => {
			const vault: Vault = {
				id: "b5-vault",
				name: "B5 Vault",
				path: "cloud-file-id",
				storageType: "cloud",
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
			const dispatch = vi.fn((action: unknown) => action);
			const getState = vi.fn();
			const state = {
				vault: {
					vaults: [vault],
					currentVaultId: null,
					loading: false,
					error: null,
					providers: [],
					defaultProvider: null,
					providerStatus: {},
					oauthState: {
						providerName: null,
						authUrl: null,
						state: null,
						isOpen: false,
					},
				},
			} as RootState;
			getState.mockReturnValue(state);

			vi.mocked(CloudStorageCommands.getProviderAuthInfo).mockResolvedValue({
				authenticated: true,
				token_expires_at: null,
			});
			vi.mocked(CloudStorageCommands.readCloudVault).mockRejectedValue(error);
			CloudStorageCommands.getGoogleDriveOAuthUrl.mockClear();
			vi.mocked(CloudStorageCommands.getGoogleDriveOAuthUrl).mockResolvedValue(
				{
					url: "https://accounts.google.com/o/oauth2/auth",
					state: "oauth-state",
				},
			);

			const instance = new VaultInstance(vault, dispatch, getState);
			try {
				await instance.syncWithCloud();
			} catch {
				// Expected: every B5 row syncs into a thrown error.
			}
			return dispatch;
		};

		it.each([
			[
				"an auth-shaped raw error (invalid_grant)",
				new Error("invalid_grant"),
				"(unchanged: the old regex already matched invalid_grant)",
			],
			[
				"an AUTHENTICATION_FAILED CloudStorageError",
				{
					type: CloudStorageErrorType.AUTHENTICATION_FAILED,
					message: "authentication failed",
				},
				"(broadened: wrapper-typed now prompts)",
			],
		])(
			"prompts the re-auth flow for %s %s",
			async (_label, error, _regime) => {
				await syncFailingWith(error);

				// Creator-spy payloads (dispatch.mock.calls only sees `undefined`).
				expect(vaultActions.setProviderStatus).toHaveBeenCalledWith({
					providerId: "google-drive",
					status: "error",
				});
				expect(vaultActions.setOAuthState).toHaveBeenCalledWith({
					providerName: "google-drive",
					authUrl: "https://accounts.google.com/o/oauth2/auth",
					state: "oauth-state",
					isOpen: true,
				});
				expect(CloudStorageCommands.getGoogleDriveOAuthUrl).toHaveBeenCalledWith(
					"google-drive",
				);
			},
		);

		it.each([
			["a network-shaped error", new Error("Network connection failed")],
			[
				"a QUOTA_EXCEEDED CloudStorageError",
				{
					type: CloudStorageErrorType.QUOTA_EXCEEDED,
					message: "quota exceeded",
				},
			],
			[
				"a PERMISSION_DENIED CloudStorageError",
				{
					type: CloudStorageErrorType.PERMISSION_DENIED,
					message: "permission denied",
				},
			],
			[
				"the terminal OPERATION_FAILED contract message",
				new Error(CONTRACT_TERMINAL_MESSAGE),
			],
		])(
			"does NOT prompt a re-auth flow for %s (B5: isAuthFailure narrows the prompt)",
			async (_label, error) => {
				await syncFailingWith(error);

				// M2 pin: the "error" status is dispatched ONLY for auth-shaped
				// failures (HEAD's behaviour, restored). A non-auth failure must
				// leave the provider status untouched.
				expect(dispatchedProviderStatus(vaultActions.setProviderStatus, {
					providerId: "google-drive",
					status: "error",
				})).toBe(false);
				expect(
					CloudStorageCommands.getGoogleDriveOAuthUrl,
				).not.toHaveBeenCalled();
			},
		);
	});
});
