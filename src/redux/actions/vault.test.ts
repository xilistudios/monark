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
    lastAccessed: new Date('2025-01-01')
  }

  const mockVault2: Vault = {
    id: 'test-vault-2',
    name: 'Test Vault 2',
    path: '/path/to/vault2',
    isLocked: true,
    lastAccessed: new Date('2025-01-02')
  }

  describe('Initial State', () => {
    it('should have correct initial state', () => {
      const state = store.getState().vault
      expect(state).toEqual({
        savedVaults: [],
        currentVault: null,
        loading: false,
        error: null,
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
      const initialDate = new Date('2025-01-01')
      const vaultWithDate = { ...mockVault, lastAccessed: initialDate }
      
      store.dispatch(addVault(vaultWithDate))
      
      // Mock current time
      const mockDate = new Date('2025-01-15')
      vi.useFakeTimers()
      vi.setSystemTime(mockDate)
      
      store.dispatch(updateLastAccessed(mockVault.id))
      const state = store.getState().vault
      
      expect(state.savedVaults[0].lastAccessed).toEqual(mockDate)
      
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
      expect(state.currentVault).toEqual(restoredState.currentVault)
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
      expect(state.currentVault).toEqual(mockVault) // Should remain unchanged
    })
  })
})

describe('Settings Store Integration', () => {
  it('should load vault state from settings with date conversion', async () => {
    const { settingsStore } = await import('../../store/settings')
    const mockGet = vi.mocked(settingsStore.get)
    
    const savedState = {
      savedVaults: [{
        id: 'test-vault',
        name: 'Test Vault',
        path: '/test/path',
        isLocked: false,
        lastAccessed: '2025-01-01T00:00:00.000Z'
      }],
      currentVault: {
        id: 'current-vault',
        name: 'Current Vault',
        path: '/current/path',
        isLocked: true,
        lastAccessed: '2025-01-02T00:00:00.000Z'
      }
    }
    
    mockGet.mockResolvedValue(savedState)
    
    const result = await loadVaultStateFromSettings()
    
    expect(result.savedVaults).toHaveLength(1)
    expect(result.savedVaults![0].lastAccessed).toBeInstanceOf(Date)
    expect(result.savedVaults![0].lastAccessed).toEqual(new Date('2025-01-01T00:00:00.000Z'))
    expect(result.currentVault?.lastAccessed).toBeInstanceOf(Date)
    expect(result.currentVault?.lastAccessed).toEqual(new Date('2025-01-02T00:00:00.000Z'))
  })

  it('should handle missing lastAccessed dates', async () => {
    const { settingsStore } = await import('../../store/settings')
    const mockGet = vi.mocked(settingsStore.get)
    
    const savedState = {
      savedVaults: [{
        id: 'test-vault',
        name: 'Test Vault',
        path: '/test/path',
        isLocked: false
      }],
      currentVault: {
        id: 'current-vault',
        name: 'Current Vault',
        path: '/current/path',
        isLocked: true
      }
    }
    
    mockGet.mockResolvedValue(savedState)
    
    const result = await loadVaultStateFromSettings()
    
    expect(result.savedVaults![0].lastAccessed).toBeUndefined()
    expect(result.currentVault?.lastAccessed).toBeUndefined()
  })

  it('should return empty object when no saved state', async () => {
    const { settingsStore } = await import('../../store/settings')
    const mockGet = vi.mocked(settingsStore.get)
    
    mockGet.mockResolvedValue(null)
    
    const result = await loadVaultStateFromSettings()
    
    expect(result).toEqual({})
  })

  it('should handle settings store errors', async () => {
    const { settingsStore } = await import('../../store/settings')
    const mockGet = vi.mocked(settingsStore.get)
    
    mockGet.mockRejectedValue(new Error('Settings store error'))
    
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    
    const result = await loadVaultStateFromSettings()
    
    expect(result).toEqual({})
    expect(consoleSpy).toHaveBeenCalledWith('Failed to load vault state from settings:', expect.any(Error))
    
    consoleSpy.mockRestore()
  })
})
