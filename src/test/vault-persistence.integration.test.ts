import { describe, it, expect, vi, beforeEach } from 'vitest'
import { configureStore } from '@reduxjs/toolkit'
import vaultReducer, {
  addVault,
  setCurrentVault,
  Vault,
  loadVaultStateFromSettings
} from '../redux/actions/vault'
import { initializeVaultState } from '../redux/store'

// Mock the settings store
const mockSettingsStore = {
  get: vi.fn(),
  set: vi.fn(),
  remove: vi.fn()
}

vi.mock('../store/settings', () => ({
  settingsStore: mockSettingsStore
}))

describe('Vault State Persistence Integration', () => {
  let store: ReturnType<typeof configureStore<{ vault: ReturnType<typeof vaultReducer> }>>

  beforeEach(() => {
    vi.clearAllMocks()
    store = configureStore({
      reducer: {
        vault: vaultReducer,
      },
    })
  })

  const mockVault: Vault = {
    id: 'integration-vault-1',
    name: 'Integration Test Vault',
    path: '/test/integration/vault',
    isLocked: false,
    lastAccessed: new Date('2025-01-20')
  }

  const mockVault2: Vault = {
    id: 'integration-vault-2',
    name: 'Second Integration Vault',
    path: '/test/integration/vault2',
    isLocked: true,
    lastAccessed: new Date('2025-01-21')
  }

  describe('Complete Persistence Flow', () => {
    it('should save vault state to settings when actions are dispatched', async () => {
      mockSettingsStore.set.mockResolvedValue(undefined)

      // Add a vault
      store.dispatch(addVault(mockVault))

      // Wait for async operations
      await new Promise(resolve => setTimeout(resolve, 0))

      // Verify settings store was called with correct data
      expect(mockSettingsStore.set).toHaveBeenCalledWith('vaultState', {
        savedVaults: [mockVault],
        currentVault: null,
      })
    })

    it('should save current vault when set', async () => {
      mockSettingsStore.set.mockResolvedValue(undefined)

      // Add vault first
      store.dispatch(addVault(mockVault))
      
      // Set as current vault
      store.dispatch(setCurrentVault(mockVault))

      // Wait for async operations
      await new Promise(resolve => setTimeout(resolve, 0))

      // Should be called twice - once for addVault, once for setCurrentVault
      expect(mockSettingsStore.set).toHaveBeenCalledTimes(2)
      expect(mockSettingsStore.set).toHaveBeenLastCalledWith('vaultState', {
        savedVaults: [mockVault],
        currentVault: mockVault,
      })
    })

    it('should handle multiple vaults persistence', async () => {
      mockSettingsStore.set.mockResolvedValue(undefined)

      // Add multiple vaults
      store.dispatch(addVault(mockVault))
      store.dispatch(addVault(mockVault2))
      store.dispatch(setCurrentVault(mockVault2))

      // Wait for async operations
      await new Promise(resolve => setTimeout(resolve, 0))

      // Should save all vaults
      expect(mockSettingsStore.set).toHaveBeenLastCalledWith('vaultState', {
        savedVaults: [mockVault, mockVault2],
        currentVault: mockVault2,
      })
    })
  })

  describe('State Restoration', () => {
    it('should restore vault state from settings on initialization', async () => {
      const savedState = {
        savedVaults: [
          {
            ...mockVault,
            lastAccessed: '2025-01-20T00:00:00.000Z'
          },
          {
            ...mockVault2,
            lastAccessed: '2025-01-21T00:00:00.000Z'
          }
        ],
        currentVault: {
          ...mockVault,
          lastAccessed: '2025-01-20T00:00:00.000Z'
        }
      }

      mockSettingsStore.get.mockResolvedValue(savedState)

      await initializeVaultState()

      // Check that state was restored correctly
      const state = store.getState().vault
      expect(state.savedVaults).toHaveLength(2)
      expect(state.savedVaults[0].name).toBe('Integration Test Vault')
      expect(state.savedVaults[1].name).toBe('Second Integration Vault')
      expect(state.currentVault?.name).toBe('Integration Test Vault')
      
      // Check date conversion
      expect(state.savedVaults[0].lastAccessed).toBeInstanceOf(Date)
      expect(state.savedVaults[1].lastAccessed).toBeInstanceOf(Date)
      expect(state.currentVault?.lastAccessed).toBeInstanceOf(Date)
    })

    it('should handle partial state restoration', async () => {
      const partialState = {
        savedVaults: [mockVault]
        // No currentVault
      }

      mockSettingsStore.get.mockResolvedValue(partialState)

      const result = await loadVaultStateFromSettings()

      expect(result.savedVaults).toEqual([mockVault])
      expect(result.currentVault).toBeNull()
    })

    it('should handle empty settings gracefully', async () => {
      mockSettingsStore.get.mockResolvedValue(null)

      const result = await loadVaultStateFromSettings()

      expect(result).toEqual({})
    })
  })

  describe('Error Handling', () => {
    it('should handle settings store save errors gracefully', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      mockSettingsStore.set.mockRejectedValue(new Error('Save failed'))

      // This should not throw
      store.dispatch(addVault(mockVault))

      // Wait for async operations
      await new Promise(resolve => setTimeout(resolve, 0))

      // Should have logged the error but not crashed
      expect(consoleSpy).toHaveBeenCalledWith('Failed to save vault state to settings:', expect.any(Error))
      
      consoleSpy.mockRestore()
    })

    it('should handle settings store load errors gracefully', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      mockSettingsStore.get.mockRejectedValue(new Error('Load failed'))

      const result = await loadVaultStateFromSettings()

      expect(result).toEqual({})
      expect(consoleSpy).toHaveBeenCalledWith('Failed to load vault state from settings:', expect.any(Error))
      
      consoleSpy.mockRestore()
    })

    it('should handle initialization errors gracefully', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      mockSettingsStore.get.mockRejectedValue(new Error('Initialization failed'))

      // This should not throw
      await initializeVaultState()

      expect(consoleSpy).toHaveBeenCalledWith('Failed to initialize vault state:', expect.any(Error))
      
      consoleSpy.mockRestore()
    })
  })

  describe('Data Integrity', () => {
    it('should maintain data integrity through save/load cycle', async () => {
      let savedData: any = null
      
      // Mock settings store to capture saved data
      mockSettingsStore.set.mockImplementation(async (key, data) => {
        if (key === 'vaultState') {
          savedData = data
        }
      })
      
      mockSettingsStore.get.mockImplementation(async (key) => {
        if (key === 'vaultState') {
          return savedData
        }
        return null
      })

      // Save some data
      store.dispatch(addVault(mockVault))
      store.dispatch(setCurrentVault(mockVault))

      // Wait for save
      await new Promise(resolve => setTimeout(resolve, 0))

      // Load the data back
      const restored = await loadVaultStateFromSettings()

      // Verify data integrity
      expect(restored.savedVaults).toHaveLength(1)
      expect(restored.savedVaults![0].id).toBe(mockVault.id)
      expect(restored.savedVaults![0].name).toBe(mockVault.name)
      expect(restored.savedVaults![0].path).toBe(mockVault.path)
      expect(restored.savedVaults![0].isLocked).toBe(mockVault.isLocked)
      expect(restored.currentVault?.id).toBe(mockVault.id)
    })

    it('should handle Date serialization correctly', async () => {
      let savedData: any = null
      
      mockSettingsStore.set.mockImplementation(async (_key, data) => {
        // Simulate JSON serialization that happens in real settings store
        savedData = JSON.parse(JSON.stringify(data))
      })
      
      mockSettingsStore.get.mockImplementation(async (_key) => {
        return savedData
      })

      const vaultWithDate = {
        ...mockVault,
        lastAccessed: new Date('2025-01-20T15:30:00.000Z')
      }

      store.dispatch(addVault(vaultWithDate))

      // Wait for save
      await new Promise(resolve => setTimeout(resolve, 0))

      // Load back
      const restored = await loadVaultStateFromSettings()

      // Date should be converted back to Date object
      expect(restored.savedVaults![0].lastAccessed).toBeInstanceOf(Date)
      expect(restored.savedVaults![0].lastAccessed).toEqual(new Date('2025-01-20T15:30:00.000Z'))
    })
  })
})
