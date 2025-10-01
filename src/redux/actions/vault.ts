import {
	createSlice,
	type PayloadAction,
} from "@reduxjs/toolkit"
import type { Entry } from "../../interfaces/vault.interface"
import { settingsStore } from "../../store/settings"
import { VaultManager } from "../../services/vault"
import VaultCommands from "../../services/commands"

export interface Vault {
	id: string
	name: string
	path: string
	lastAccessed?: string
	isLocked: boolean
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
		}))
		await settingsStore.set("vaults", persistentVaults)
	} catch (error) {
		console.error("Error saving vaults to settings:", error)
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
		await settingsStore.get("savedVaults")
		if (vaults && Array.isArray(vaults)) {
			return {
				vaults: vaults.map((vault: any) => ({
					...vault,
					lastAccessed: vault.lastAccessed || undefined,
					isLocked: true,
					volatile: {
						entries: [],
						credential: "",
						navigationPath: "/",
						encryptedData: undefined,
					},
				})),
				currentVaultId: null,
			}
		} else {
			return {
				vaults: [],
				currentVaultId: null,
			}
		}
	} catch (error) {
		console.error("Error loading vaults from settings:", error)
	}
	return { vaults: [], currentVaultId: null }
}

// Action Types
export const SET_VAULT_STATE = "vault/setVaultState"

const initialState: VaultState = {
	vaults: [],
	currentVaultId: null,
	loading: false,
	error: null,
}

export const vaultSlice = createSlice({
	name: "vault",
	initialState,
	reducers: {
		addVault: (state, action: PayloadAction<Vault>) => {
			const vault = {
				...action.payload,
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
				throw new Error("Vault not found");
			}

			// If deleteFile is true, attempt to delete the file from the file system
			if (deleteFile) {
				try {
					await VaultCommands.delete(vault.path);
				} catch (error) {
					console.error("Failed to delete vault file:", error);
					throw new Error(`Failed to delete vault file: ${error}`);
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
} = vaultSlice.actions

export default vaultSlice.reducer
