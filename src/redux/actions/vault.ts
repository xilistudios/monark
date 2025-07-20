import { createSlice, PayloadAction } from '@reduxjs/toolkit'
import { settingsStore } from '../../store/settings'

export interface Vault {
  id: string
  name: string
  path: string
  lastAccessed?: string
  isLocked: boolean
}

interface VaultState {
  savedVaults: Vault[]
  currentVault: Vault | null
  loading: boolean
  error: string | null
}

// Helper function to save vault state to settings store
const saveVaultStateToSettings = async (state: VaultState) => {
  try {
    // Only save 
    await settingsStore.set('vaults', state.savedVaults)
  } catch (error) {
    console.error('Failed to save vault state to settings:', error)
  }
}

// Helper function to load vault state from settings store
export const loadVaultStateFromSettings = async (): Promise<Partial<VaultState>> => {
  try {
    const savedState = await settingsStore.get('vaults')
    if (savedState) {
      // Convert lastAccessed strings back to Date objects
      const processedState = {
        ...savedState,
        savedVaults: savedState?.map((vault: any) => ({
          ...vault,
          lastAccessed: vault.lastAccessed ? new Date(vault.lastAccessed) : undefined,
          isLocked: true
        })) || [],
        currentVault: null,
      }
      return processedState
    }
  } catch (error) {
    console.error('Failed to load vault state from settings:', error)
  }
  return {}
}

const initialState: VaultState = {
  savedVaults: [],
  currentVault: null,
  loading: false,
  error: null,
}

export const vaultSlice = createSlice({
  name: 'vault',
  initialState,
  reducers: {
    addVault: (state, action: PayloadAction<Vault>) => {
      state.savedVaults.push(action.payload)
      // Save to settings store asynchronously
      saveVaultStateToSettings(state)
    },
    removeVault: (state, action: PayloadAction<string>) => {
      state.savedVaults = state.savedVaults.filter(vault => vault.id !== action.payload)
      // Save to settings store asynchronously
      saveVaultStateToSettings(state)
    },
    updateVault: (state, action: PayloadAction<Vault>) => {
      const index = state.savedVaults.findIndex(vault => vault.id === action.payload.id)
      if (index !== -1) {
        state.savedVaults[index] = action.payload
      }
      // Save to settings store asynchronously
      saveVaultStateToSettings(state)
    },
    setCurrentVault: (state, action: PayloadAction<Vault | null>) => {
      state.currentVault = action.payload
      // Save to settings store asynchronously
      saveVaultStateToSettings(state)
    },
    updateLastAccessed: (state, action: PayloadAction<string>) => {
      const vault = state.savedVaults.find(vault => vault.id === action.payload)
      if (vault) {
        vault.lastAccessed = new Date().toISOString()
      }
      // Save to settings store asynchronously
      saveVaultStateToSettings(state)
    },
    setLoading: (state, action: PayloadAction<boolean>) => {
      state.loading = action.payload
      // Don't save loading state to persistent storage
    },
    setError: (state, action: PayloadAction<string | null>) => {
      state.error = action.payload
      // Don't save error state to persistent storage
    },
    clearError: (state) => {
      state.error = null
      // Don't save error state to persistent storage
    },
    // New action to restore state from settings
    restoreVaultState: (state, action: PayloadAction<Partial<VaultState>>) => {
      const { savedVaults, currentVault } = action.payload
      if (savedVaults) {
        state.savedVaults = savedVaults
      }
      if (currentVault !== undefined) {
        state.currentVault = currentVault
      }
    },
  },
})

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
} = vaultSlice.actions

export default vaultSlice.reducer