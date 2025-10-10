import {
	createSlice,
	type PayloadAction,
} from "@reduxjs/toolkit"
import type { Entry } from "../../interfaces/vault.interface"
import type { StorageProvider } from '../../interfaces/cloud-storage.interface';
import { settingsStore } from "../../store/settings"
import { VaultManager } from "../../services/vault"
import VaultCommands from "../../services/commands"

export interface Vault {
	id: string
	name: string
	path: string
	lastAccessed?: string
	isLocked: boolean
	// New: Cloud storage support
	storageType: 'local' | 'cloud'
	providerId?: string
	cloudMetadata?: {
		fileId: string
		provider: string
		lastSync?: string
	}
	// Multi-vault: volatile in-memory state, not persisted
	volatile: {
		credential: string
		entries: Entry[]
		navigationPath?: string
		encryptedData?: string
	}
}

// Types for vault entry operations - using the new unified structure

export interface VaultState {
	vaults: Vault[]
	currentVaultId: string | null
	loading: boolean
	error: string | null
	// New: Storage provider state
	providers: StorageProvider[]
	defaultProvider: string | null
	providerStatus: Record<string, 'idle' | 'authenticating' | 'authenticated' | 'error'>
}

/**
 * Save vaults array to settings store.
 * Mirrors savePreferencesToSettings pattern.
 */
const saveVaultStateToSettings = async (vaults: Vault[]) => {
	try {
		const persistentVaults = vaults.map((v) => ({
			id: v.id,
			name: v.name,
			path: v.path,
			lastAccessed: v.lastAccessed,
			isLocked: v.isLocked,
			storageType: v.storageType,
			providerId: v.providerId,
			cloudMetadata: v.cloudMetadata,
		}))
		await settingsStore.set("vaults", persistentVaults)
	} catch (error) {
		console.error("Error saving vaults to settings:", error)
	}
}

/**
 * Save storage providers to settings store.
 */
const saveStorageProvidersToSettings = async (providers: StorageProvider[], defaultProvider: string | null) => {
	try {
		await settingsStore.set("storageProviders", providers)
		await settingsStore.set("defaultStorageProvider", defaultProvider)
	} catch (error) {
		console.error("Error saving storage providers to settings:", error)
	}
}

/**
 * Load vault state from settings store.
 * Mirrors loadPreferencesFromSettings return type/style.
 */
export const loadVaultStateFromSettings = async (): Promise<
	Partial<VaultState>
> => {
	try {
		const vaults = await settingsStore.get("vaults")
		const providers = await settingsStore.get("storageProviders")
		const defaultProvider = await settingsStore.get("defaultStorageProvider")

		let loadedVaults: Vault[] = [];
    if (vaults && Array.isArray(vaults)) {
      loadedVaults = vaults.map((vault: any) => ({
        ...vault,
        // Migrate existing vaults to local storage type
        storageType: vault.storageType || 'local',
        lastAccessed: vault.lastAccessed || undefined,
        isLocked: true,
        volatile: {
          entries: [],
          credential: '',
          navigationPath: '/',
          encryptedData: undefined,
        },
      }));
    }

		return {
			vaults: loadedVaults,
			currentVaultId: null,
			providers: providers || [],
			defaultProvider: defaultProvider || null,
			providerStatus: {},
		}
	} catch (error) {
		console.error("Error loading vaults from settings:", error)
	}
	return {
		vaults: [],
		currentVaultId: null,
		providers: [],
		defaultProvider: null,
		providerStatus: {},
	}
}

// Action Types
export const SET_VAULT_STATE = "vault/setVaultState"

const initialState: VaultState = {
	vaults: [],
	currentVaultId: null,
	loading: false,
	error: null,
	providers: [],
	defaultProvider: null,
	providerStatus: {},
}

export const vaultSlice = createSlice({
	name: "vault",
	initialState,
	reducers: {
		/**
		 * Add a new vault to the state
		 * Supports both local and cloud vaults
		 */
		addVault: (state, action: PayloadAction<Vault>) => {
			const vault = {
				...action.payload,
				storageType: action.payload.storageType || 'local',
				volatile: {
					entries: action.payload.volatile?.entries || [],
					credential: action.payload.volatile?.credential || "",
					navigationPath: action.payload.volatile?.navigationPath || "/",
					encryptedData: action.payload.volatile?.encryptedData || undefined,
				},
			}
			state.vaults.push(vault)
			void saveVaultStateToSettings(state.vaults)
			// VaultManager will create instances on-demand when getInstance() is called
		},
		removeVault: (state, action: PayloadAction<string>) => {
			state.vaults = state.vaults.filter(
				(vault: Vault) => vault.id !== action.payload
			)
			void saveVaultStateToSettings(state.vaults)
			if (state.currentVaultId === action.payload) {
				state.currentVaultId = null
			}
			// Clean up the vault instance from VaultManager
			VaultManager.getInstance().removeInstance(action.payload)
		},
		updateVault: (state, action: PayloadAction<Vault>) => {
			const index = state.vaults.findIndex(
				(vault: Vault) => vault.id === action.payload.id
			)
			if (index !== -1) {
				state.vaults[index] = action.payload
			}
			void saveVaultStateToSettings(state.vaults)
		},
		setCurrentVault: (state, action: PayloadAction<string | null>) => {
			state.currentVaultId = action.payload
		},
		updateLastAccessed: (state, action: PayloadAction<string>) => {
			const vault = state.vaults.find(
				(vault: Vault) => vault.id === action.payload
			)
			if (vault) {
				vault.lastAccessed = new Date().toISOString()
			}
			void saveVaultStateToSettings(state.vaults)
		},
		setLoading: (state, action: PayloadAction<boolean>) => {
			state.loading = action.payload
		},
		setError: (state, action: PayloadAction<string | null>) => {
			state.error = action.payload
		},
		clearError: (state) => {
			state.error = null
		},
		restoreVaultState: (
			state,
			action: PayloadAction<Partial<VaultState>>
		) => {
			if (action.payload.vaults && Array.isArray(action.payload.vaults)) {
				state.vaults = action.payload.vaults
			} else {
				state.vaults = []
			}
			if (action.payload.providers && Array.isArray(action.payload.providers)) {
				state.providers = action.payload.providers
			} else {
				state.providers = []
			}
			if (action.payload.defaultProvider) {
				state.defaultProvider = action.payload.defaultProvider
			} else {
				state.defaultProvider = null
			}
			if (action.payload.providerStatus) {
				state.providerStatus = action.payload.providerStatus
			} else {
				state.providerStatus = {}
			}
			state.currentVaultId = null
		},
		setVaultCredential: (
			state,
			action: PayloadAction<{ vaultId: string; credential: string }>
		) => {
			const vault = state.vaults.find(
				(v) => v.id === action.payload.vaultId
			)
			if (vault) {
				if (!vault.volatile) {
					vault.volatile = {
						entries: [],
						credential: "",
						navigationPath: "/",
						encryptedData: undefined,
					}
				}
				vault.volatile.credential = action.payload.credential
			}
		},
		setNavigationPath: (
			state,
			action: PayloadAction<{ vaultId: string; navigationPath: string }>
		) => {
			const vault = Array.isArray(state.vaults)
				? state.vaults.find((v) => v.id === action.payload.vaultId)
				: undefined
			if (vault) {
				if (!vault.volatile) {
					vault.volatile = {
						entries: [],
						credential: "",
						navigationPath: "/",
						encryptedData: undefined,
					}
				}
				vault.volatile.navigationPath = action.payload.navigationPath
			}
		},
		setVaultEntries: (
			state,
			action: PayloadAction<{ vaultId: string; entries: Entry[] }>
		) => {
			const vault = Array.isArray(state.vaults)
				? state.vaults.find((v) => v.id === action.payload.vaultId)
				: undefined
			if (vault) {
				if (!vault.volatile) {
					vault.volatile = {
						entries: [],
						credential: "",
						navigationPath: "/",
						encryptedData: undefined,
					}
				}
				vault.volatile.entries = action.payload.entries
			}
		},
		lockVault: (state, action: PayloadAction<string>) => {
					const vault = state.vaults.find((v) => v.id === action.payload)
					if (vault) {
						if (!vault.volatile) {
							vault.volatile = {
								entries: [],
								credential: "",
								navigationPath: "/",
								encryptedData: undefined,
							}
						}
						vault.volatile.entries = []
						vault.volatile.encryptedData = undefined
						vault.isLocked = true
						vault.volatile.credential = "" // Clear credential on lock
						vault.volatile.navigationPath = "/"
					}
				},
		// New reducer for setting vault locked state
		setVaultLocked: (state, action: PayloadAction<{ vaultId: string; isLocked: boolean }>) => {
			const vault = state.vaults.find((v) => v.id === action.payload.vaultId)
			if (vault) {
				vault.isLocked = action.payload.isLocked
			}
		},
		// Storage Provider Actions
		/**
		 * Set the list of storage providers
		 */
		setStorageProviders: (state, action: PayloadAction<StorageProvider[]>) => {
			state.providers = action.payload
			void saveStorageProvidersToSettings(state.providers, state.defaultProvider)
		},
		/**
		 * Add a new storage provider
		 */
		addStorageProvider: (state, action: PayloadAction<StorageProvider>) => {
			state.providers.push(action.payload)
			void saveStorageProvidersToSettings(state.providers, state.defaultProvider)
		},
		/**
		 * Remove a storage provider by ID
		 */
		removeStorageProvider: (state, action: PayloadAction<string>) => {
			state.providers = state.providers.filter(p => p.name !== action.payload)
			// Update vaults that use this provider
			state.vaults.forEach(vault => {
				if (vault.providerId === action.payload) {
					vault.providerId = undefined
					vault.storageType = 'local'
					vault.cloudMetadata = undefined
				}
			})
			// Clear provider status
			delete state.providerStatus[action.payload]
			// Update default provider if necessary
			if (state.defaultProvider === action.payload) {
				state.defaultProvider = state.providers.length > 0 ? state.providers[0].name : null
			}
			void saveStorageProvidersToSettings(state.providers, state.defaultProvider)
			void saveVaultStateToSettings(state.vaults)
		},
		/**
		 * Set the default storage provider
		 */
		setDefaultStorageProvider: (state, action: PayloadAction<string>) => {
			state.defaultProvider = action.payload
			void saveStorageProvidersToSettings(state.providers, state.defaultProvider)
		},
		/**
		 * Set the authentication status for a provider
		 */
		setProviderStatus: (state, action: PayloadAction<{ providerId: string; status: 'idle' | 'authenticating' | 'authenticated' | 'error' }>) => {
			state.providerStatus[action.payload.providerId] = action.payload.status
		},
		/**
		 * Set cloud vaults list
		 */
		setCloudVaults: (state, action: PayloadAction<Vault[]>) => {
			// This action is used to update the vaults list with cloud vaults
			// It merges with existing vaults, updating cloud vault information
			const cloudVaults = action.payload
			cloudVaults.forEach(cloudVault => {
				const existingIndex = state.vaults.findIndex(v => v.id === cloudVault.id)
				if (existingIndex !== -1) {
					// Update existing vault with cloud information
					state.vaults[existingIndex] = {
						...state.vaults[existingIndex],
						...cloudVault,
					}
				} else {
					// Add new cloud vault
					state.vaults.push(cloudVault)
				}
			})
			void saveVaultStateToSettings(state.vaults)
		},
		/**
		 * Trigger cloud sync for a vault
		 */
		syncCloudVault: (state, action: PayloadAction<string>) => {
			const vault = state.vaults.find(v => v.id === action.payload)
			if (vault && vault.cloudMetadata) {
				vault.cloudMetadata.lastSync = new Date().toISOString()
				void saveVaultStateToSettings(state.vaults)
			}
		},
	},
	extraReducers: (builder) => {
		builder
		// All async thunk cases have been removed as they are now handled by VaultManager
	},
})

// Async thunk for deleting a vault with optional file deletion
export const deleteVault = (vaultId: string, deleteFile: boolean = false) => {
	return async (dispatch: any, getState: any) => {
		try {
      // First, get the vault to access its path
      const state = getState();
      const vault = state.vault.vaults.find((v: Vault) => v.id === vaultId);

      if (!vault) {
        throw new Error('Vault not found');
      }

      // If deleteFile is true, attempt to delete the file from storage
      if (deleteFile) {
        try {
          // Use the unified deleteVault command that handles both local and cloud vaults
          await VaultCommands.deleteVault(vault.path, vault.providerId);
        } catch (error) {
          console.error('Failed to delete vault file:', error);
          const errorMessage =
            (error as any)?.message ||
            (error instanceof Error ? error.message : String(error));
          throw new Error(`Failed to delete vault file: ${errorMessage}`);
        }
      }

      // Remove the vault from Redux state (this will also clean up VaultManager)
      dispatch(removeVault(vaultId));
    } catch (error) {
			throw error;
		}
	};
};

export const {
	addVault,
	removeVault,
	updateVault,
	setCurrentVault,
	updateLastAccessed,
	setLoading,
	setError,
	clearError,
	restoreVaultState,
	lockVault,
	setVaultCredential,
	setNavigationPath,
	setVaultEntries,
	setVaultLocked,
	setStorageProviders,
	addStorageProvider,
	removeStorageProvider,
	setDefaultStorageProvider,
	setProviderStatus,
	setCloudVaults,
	syncCloudVault,
} = vaultSlice.actions

/**
 * Helper function to check if a vault is cloud-based
 */
export const isCloudVault = (vault: Vault): boolean => {
	return vault.storageType === 'cloud' && !!vault.providerId
}

/**
 * Helper function to get the storage provider for a vault
 */
export const getVaultProvider = (
	vault: Vault,
	providers: StorageProvider[]
): StorageProvider | undefined => {
	if (!isCloudVault(vault) || !vault.providerId) {
		return undefined
	}
	return providers.find(provider => provider.name === vault.providerId)
}

/**
 * Helper function to create a cloud vault object
 */
export const createCloudVault = (
	id: string,
	name: string,
	providerId: string,
	fileId: string,
	password?: string
): Vault => {
	return {
		id,
		name,
		path: fileId, // Use cloud file ID as path
		storageType: 'cloud',
		providerId,
		cloudMetadata: {
			fileId,
			provider: providerId,
			lastSync: new Date().toISOString(),
		},
		isLocked: true,
		volatile: {
			credential: password || "",
			entries: [],
			navigationPath: "/",
			encryptedData: undefined,
		},
	}
}

/**
 * Helper function to migrate a local vault to cloud storage
 */
export const migrateVaultToCloud = (
	vault: Vault,
	providerId: string,
	fileId: string
): Vault => {
	return {
		...vault,
		storageType: 'cloud' as const,
		providerId,
		cloudMetadata: {
			fileId,
			provider: providerId,
			lastSync: new Date().toISOString(),
		},
		path: fileId, // Update path to use cloud file ID
	}
}

/**
 * Helper function to migrate a cloud vault to local storage
 */
export const migrateVaultToLocal = (
	vault: Vault,
	localPath: string
): Vault => {
	return {
		...vault,
		storageType: 'local' as const,
		providerId: undefined,
		cloudMetadata: undefined,
		path: localPath,
	}
}

export default vaultSlice.reducer
