import { describe, it, expect, vi, beforeEach } from 'vitest'
import { configureStore } from '@reduxjs/toolkit'
import vaultReducer, {
  addVault,
  removeVault,
  updateVault,
  setCurrentVault,
  updateLastAccessed,
  setLoading,
  setError,
  clearError,
  restoreVaultState,
  setVaultState,
  lockVault,
  readVault,
  updateVaultEntries,
  saveVault,
  SET_VAULT_STATE,
  Vault,
  loadVaultStateFromSettings
} from './vault'

// Mock the settings store
vi.mock('../../store/settings', () => ({
  settingsStore: {
    get: vi.fn(),
    set: vi.fn(),
    remove: vi.fn()
  }
}))

describe('Vault State', () => {
  let store: ReturnType<typeof configureStore<{ vault: ReturnType<typeof vaultReducer> }>>

  beforeEach(() => {
    store = configureStore({
      reducer: {
        vault: vaultReducer,
      },
    })
  })

  const mockVault: Vault = {
    id: 'test-vault-1',
    name: 'Test Vault',
    path: '/path/to/vault',
    isLocked: false,
    lastAccessed: '2025-01-01T00:00:00.000Z' // Store as ISO string
  }

  const mockVault2: Vault = {
    id: 'test-vault-2',
    name: 'Test Vault 2',
    path: '/path/to/vault2',
    isLocked: true,
    lastAccessed: '2025-01-02T00:00:00.000Z' // Store as ISO string
  }

  describe('Initial State', () => {
    it('should have correct initial state', () => {
      const state = store.getState().vault
      expect(state).toEqual({
        savedVaults: [],
        currentVault: null,
        loading: false,
        error: null,
        vaultState: {
          isLocked: true,
          entries: []
        }
      })
    })
  })

  describe('Vault Management', () => {
    it('should add a vault', () => {
      store.dispatch(addVault(mockVault))
      const state = store.getState().vault
      
      expect(state.savedVaults).toHaveLength(1)
      expect(state.savedVaults[0]).toEqual(mockVault)
    })

    it('should add multiple vaults', () => {
      store.dispatch(addVault(mockVault))
      store.dispatch(addVault(mockVault2))
      const state = store.getState().vault
      
      expect(state.savedVaults).toHaveLength(2)
      expect(state.savedVaults).toContain(mockVault)
      expect(state.savedVaults).toContain(mockVault2)
    })

    it('should remove a vault by id', () => {
      store.dispatch(addVault(mockVault))
      store.dispatch(addVault(mockVault2))
      store.dispatch(removeVault(mockVault.id))
      const state = store.getState().vault
      
      expect(state.savedVaults).toHaveLength(1)
      expect(state.savedVaults[0]).toEqual(mockVault2)
      expect(state.savedVaults.find(v => v.id === mockVault.id)).toBeUndefined()
    })

    it('should update an existing vault', () => {
      store.dispatch(addVault(mockVault))
      
      const updatedVault: Vault = {
        ...mockVault,
        name: 'Updated Vault Name',
        isLocked: true
      }
      
      store.dispatch(updateVault(updatedVault))
      const state = store.getState().vault
      
      expect(state.savedVaults).toHaveLength(1)
      expect(state.savedVaults[0]).toEqual(updatedVault)
      expect(state.savedVaults[0].name).toBe('Updated Vault Name')
      expect(state.savedVaults[0].isLocked).toBe(true)
    })

    it('should not update non-existing vault', () => {
      store.dispatch(addVault(mockVault))
      
      const nonExistingVault: Vault = {
        id: 'non-existing',
        name: 'Non Existing',
        path: '/non/existing',
        isLocked: false
      }
      
      store.dispatch(updateVault(nonExistingVault))
      const state = store.getState().vault
      
      expect(state.savedVaults).toHaveLength(1)
      expect(state.savedVaults[0]).toEqual(mockVault)
    })
  })

  describe('Current Vault Management', () => {
    it('should set current vault', () => {
      store.dispatch(setCurrentVault(mockVault))
      const state = store.getState().vault
      
      expect(state.currentVault).toEqual(mockVault)
    })

    it('should clear current vault', () => {
      store.dispatch(setCurrentVault(mockVault))
      store.dispatch(setCurrentVault(null))
      const state = store.getState().vault
      
      expect(state.currentVault).toBeNull()
    })

    it('should update last accessed date', () => {
      const initialDate = '2025-01-01T00:00:00.000Z'
      const vaultWithDate = { ...mockVault, lastAccessed: initialDate }
      
      store.dispatch(addVault(vaultWithDate))
      
      // Mock current time
      const mockDate = new Date('2025-01-15')
      vi.useFakeTimers()
      vi.setSystemTime(mockDate)
      
      store.dispatch(updateLastAccessed(mockVault.id))
      const state = store.getState().vault
      
      expect(state.savedVaults[0].lastAccessed).toBe(mockDate.toISOString())
      
      vi.useRealTimers()
    })

    it('should not update last accessed for non-existing vault', () => {
      store.dispatch(addVault(mockVault))
      store.dispatch(updateLastAccessed('non-existing-id'))
      const state = store.getState().vault
      
      expect(state.savedVaults[0].lastAccessed).toEqual(mockVault.lastAccessed)
    })
  })

  describe('Loading and Error States', () => {
    it('should set loading state', () => {
      store.dispatch(setLoading(true))
      let state = store.getState().vault
      expect(state.loading).toBe(true)
      
      store.dispatch(setLoading(false))
      state = store.getState().vault
      expect(state.loading).toBe(false)
    })

    it('should set error state', () => {
      const errorMessage = 'Something went wrong'
      store.dispatch(setError(errorMessage))
      const state = store.getState().vault
      
      expect(state.error).toBe(errorMessage)
    })

    it('should clear error state', () => {
      store.dispatch(setError('Some error'))
      store.dispatch(clearError())
      const state = store.getState().vault
      
      expect(state.error).toBeNull()
    })
  })

  describe('State Restoration', () => {
    it('should restore vault state', () => {
      const restoredState = {
        savedVaults: [mockVault, mockVault2],
        currentVault: mockVault
      }
      
      store.dispatch(restoreVaultState(restoredState))
      const state = store.getState().vault
      
      expect(state.savedVaults).toEqual(restoredState.savedVaults)
      expect(state.currentVault).toBeNull()
      expect(state.loading).toBe(false) // Should remain unchanged
      expect(state.error).toBeNull() // Should remain unchanged
    })

    it('should restore partial state', () => {
      store.dispatch(addVault(mockVault))
      store.dispatch(setCurrentVault(mockVault))
      
      const partialState = {
        savedVaults: [mockVault2]
      }
      
      store.dispatch(restoreVaultState(partialState))
      const state = store.getState().vault
      
      expect(state.savedVaults).toEqual([mockVault2])
      expect(state.currentVault).toBeNull()
    })
  })
})

describe('Settings Store Integration', () => {
  it('should load vault state from settings with date conversion', async () => {
    const { settingsStore } = await import('../../store/settings')
    const mockGet = vi.mocked(settingsStore.get)
    
    const savedVaults = [{
      id: 'test-vault',
      name: 'Test Vault',
      path: '/test/path',
      isLocked: false,
      lastAccessed: '2025-01-01T00:00:00.000Z'
    }]
    
    mockGet.mockResolvedValue(savedVaults)
    
    const result = await loadVaultStateFromSettings()
    
    expect(result.savedVaults).toHaveLength(1)
    expect(result.savedVaults![0].lastAccessed).toBe('2025-01-01T00:00:00.000Z')
    expect(result.savedVaults![0].isLocked).toBe(true)
    expect(result.currentVault).toBeNull()
  })

  it('should handle missing lastAccessed dates', async () => {
    const { settingsStore } = await import('../../store/settings')
    const mockGet = vi.mocked(settingsStore.get)
    
    const savedVaults = [{
      id: 'test-vault',
      name: 'Test Vault',
      path: '/test/path',
      isLocked: false
    }]
    
    mockGet.mockResolvedValue(savedVaults)
    
    const result = await loadVaultStateFromSettings()
    
    expect(result.savedVaults![0].lastAccessed).toBeUndefined()
    expect(result.currentVault).toBeNull()
  })

  it('should return empty object when no saved state', async () => {
    const { settingsStore } = await import('../../store/settings')
    const mockGet = vi.mocked(settingsStore.get)
    
    mockGet.mockResolvedValue(null)
    
    const result = await loadVaultStateFromSettings()
    
    expect(result).toEqual({ currentVault: null })
  })

  it('should handle settings store errors', async () => {
    const { settingsStore } = await import('../../store/settings')
    const mockGet = vi.mocked(settingsStore.get)
    
    mockGet.mockRejectedValue(new Error('Settings store error'))
    
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    
    const result = await loadVaultStateFromSettings()
    
    expect(result).toEqual({ currentVault: null })
    expect(consoleSpy).toHaveBeenCalledWith('Error loading vaults from settings:', expect.any(Error))
    
    consoleSpy.mockRestore()
  })
})

// New tests for vault operations
describe('Vault Operations', () => {
  let store: ReturnType<typeof configureStore<{ vault: ReturnType<typeof vaultReducer> }>>

  beforeEach(() => {
    store = configureStore({
      reducer: {
        vault: vaultReducer,
      },
    })
  })

  describe('Vault State Management', () => {
    it('should set vault state', () => {
      const mockDataEntry = {
        id: 'entry-1',
        entry_type: 'entry' as const,
        name: 'Test Entry',
        data_type: 'website',
        created_at: '2025-01-01T00:00:00.000Z',
        updated_at: '2025-01-01T00:00:00.000Z',
        fields: [],
        tags: []
      }
      
      const mockGroupEntry = {
        id: 'group-1',
        entry_type: 'group' as const,
        name: 'Test Group',
        data_type: 'group',
        children: []
      }

      const allEntries = [mockDataEntry, mockGroupEntry]

      store.dispatch(setVaultState({
        isLocked: false,
        entries: allEntries
      }))

      const state = store.getState().vault
      expect(state.vaultState.isLocked).toBe(false)
      expect(state.vaultState.entries).toEqual(allEntries)
    })

    it('should lock vault and clear sensitive data', () => {
      const mockDataEntry = {
        id: 'test',
        entry_type: 'entry' as const,
        name: 'test',
        data_type: 'website',
        created_at: '2025-01-01T00:00:00.000Z',
        updated_at: '2025-01-01T00:00:00.000Z',
        fields: [],
        tags: []
      }

      // First set some data
      store.dispatch(setVaultState({
        isLocked: false,
        entries: [mockDataEntry]
      }))
      // removed: updateEncryptedVault test (action no longer exists)

      // Then lock the vault
      store.dispatch(lockVault())

      const state = store.getState().vault
      expect(state.vaultState.isLocked).toBe(true)
      expect(state.vaultState.entries).toEqual([])
      expect(state.vaultState.encryptedData).toBeUndefined()
    })

    it('should update encrypted vault data', () => {
      const encryptedData = 'mock-encrypted-data'
      // removed: updateEncryptedVault test (action no longer exists)

      const state = store.getState().vault
      expect(state.vaultState.encryptedData).toBe(encryptedData)
    })
  })

  describe('Action Types', () => {
    it('should export correct action type constants', () => {
      expect(SET_VAULT_STATE).toBe('vault/setVaultState')
      // Removed: expect(UPDATE_VAULT_ENTRIES).toBe('vault/addVaultEntry')
      // Removed: expect(UPDATE_VAULT_ENTRIES).toBe('vault/addVaultGroup')
    })
  })

  describe('Async Thunks', () => {
    it('should have correct thunk action types', () => {
      expect(readVault.pending.type).toBe('vault/readVault/pending')
      expect(readVault.fulfilled.type).toBe('vault/readVault/fulfilled')
      expect(readVault.rejected.type).toBe('vault/readVault/rejected')


      expect(saveVault.pending.type).toBe('vault/saveVault/pending')
      expect(saveVault.fulfilled.type).toBe('vault/saveVault/fulfilled')
      expect(saveVault.rejected.type).toBe('vault/saveVault/rejected')
    })
  })
})
