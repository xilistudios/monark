import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { Provider } from 'react-redux'
import { configureStore } from '@reduxjs/toolkit'
import { I18nextProvider } from 'react-i18next'
import i18n from '../../../i18n'
import { AddVaultForm } from '../../../components/Vault/Forms/AddVaultForm'
import vaultReducer from '../../../redux/actions/vault'
import type { StorageProvider } from '../../../interfaces/cloud-storage.interface'
import { StorageProviderType } from '../../../interfaces/cloud-storage.interface'

// Mock @tauri-apps/plugin-os (used by utils/platform.ts -> isMobile)
vi.mock('@tauri-apps/plugin-os', () => ({
  platform: () => 'linux',
}))

// Mock Tauri APIs
vi.mock('@tauri-apps/plugin-dialog', () => ({
  open: vi.fn(),
}))

vi.mock('@tauri-apps/api/path', () => ({
  join: vi.fn((...args: string[]) => Promise.resolve(args.join('/'))),
  appDataDir: vi.fn(() => Promise.resolve('/home/user/.local/share/monark')),
}))

// Mock CloudStorageCommands (used by AddVaultForm for checkProviderAuthStatus)
vi.mock('../../../services/cloudStorage', () => ({
  CloudStorageCommands: {
    checkProviderAuthStatus: vi.fn().mockResolvedValue(true),
  },
}))

// Consistent VaultManager mock instance (hoisted so it's available in vi.mock factory)
const { mockVaultManagerInstance } = vi.hoisted(() => {
  return {
    mockVaultManagerInstance: {
      createVault: vi.fn(),
      initialize: vi.fn(),
      changeVaultPassword: vi.fn(),
      listCloudVaults: vi.fn(),
      unlock: vi.fn(),
    },
  }
})

vi.mock('../../../services/vault', () => ({
  VaultManager: {
    getInstance: vi.fn(() => mockVaultManagerInstance),
  },
}))

describe('AddVaultForm with Cloud Storage', () => {
  let store: any
  const mockOnSuccess = vi.fn()
  const mockOnCancel = vi.fn()

  beforeEach(() => {
    store = configureStore({
      reducer: {
        vault: vaultReducer,
      },
      preloadedState: {
        vault: {
          vaults: [],
          currentVaultId: null,
          loading: false,
          error: null,
          providers: [
            {
              name: 'google-drive',
              provider_type: StorageProviderType.GOOGLE_DRIVE,
              isDefault: false,
            },
            {
              name: 'dropbox',
              provider_type: StorageProviderType.LOCAL,
              isDefault: false,
            },
          ],
          defaultProvider: null,
          providerStatus: {
            'google-drive': 'authenticated',
            'dropbox': 'idle',
          },
        },
      },
    })

    vi.clearAllMocks()
  })

  const renderComponent = () => {
    return render(
      <Provider store={store}>
        <I18nextProvider i18n={i18n}>
          <AddVaultForm onSuccess={mockOnSuccess} onCancel={mockOnCancel} />
        </I18nextProvider>
      </Provider>
    )
  }

  describe('Storage Location Selection', () => {
    it('should show storage location selector', () => {
      renderComponent()
      
      expect(screen.getByText('Storage Location')).toBeInTheDocument()
      expect(screen.getByText('Local Storage')).toBeInTheDocument()
      expect(screen.getByText('Cloud Storage')).toBeInTheDocument()
    })

    it('should default to local storage', () => {
      renderComponent()
      
      // Component uses buttons, not radio inputs - check button has primary class
      const localButton = screen.getByText('Local Storage').closest('button')
      expect(localButton?.className).toContain('btn-primary')
    })

    it('should show file path input for local storage', () => {
      renderComponent()
      
      expect(screen.getByText('File Path')).toBeInTheDocument()
    })

    it('should hide file path input when cloud storage is selected', async () => {
      renderComponent()
      
      const cloudButton = screen.getByText('Cloud Storage')
      fireEvent.click(cloudButton)
      
      await waitFor(() => {
        expect(screen.queryByText('File Path')).not.toBeInTheDocument()
      })
    })
  })

  describe('Cloud Provider Selection', () => {
    it('should show provider selector when cloud storage is selected', async () => {
      renderComponent()
      
      const cloudButton = screen.getByText('Cloud Storage')
      fireEvent.click(cloudButton)
      
      await waitFor(() => {
        // "Select Provider" appears in both a label and an option placeholder
        const matches = screen.getAllByText('Select Provider')
        expect(matches.length).toBeGreaterThanOrEqual(1)
      })
    })

    it('should only show authenticated providers', async () => {
      renderComponent()
      
      const cloudButton = screen.getByText('Cloud Storage')
      fireEvent.click(cloudButton)
      
      await waitFor(() => {
        const select = screen.getByDisplayValue('Select Provider')
        const options = select.querySelectorAll('option')
        
        // Should have placeholder + authenticated providers only
        expect(options).toHaveLength(2) // placeholder + google-drive
        expect(Array.from(options).map(opt => opt.textContent)).toContain('google-drive (google_drive)')
      })
    })

    it('should show warning when no authenticated providers', async () => {
      store = configureStore({
        reducer: {
          vault: vaultReducer,
        },
        preloadedState: {
          vault: {
            vaults: [],
            currentVaultId: null,
            loading: false,
            error: null,
            providers: [],
            defaultProvider: null,
            providerStatus: {},
          },
        },
      })

      render(
        <Provider store={store}>
          <I18nextProvider i18n={i18n}>
            <AddVaultForm onSuccess={mockOnSuccess} onCancel={mockOnCancel} />
          </I18nextProvider>
        </Provider>
      )
      
      const cloudButton = screen.getByText('Cloud Storage')
      fireEvent.click(cloudButton)
      
      await waitFor(() => {
        expect(screen.getByText('No cloud storage providers configured')).toBeInTheDocument()
        expect(screen.getByText('Go to Settings')).toBeInTheDocument()
      })
    })
  })

  describe('Form Validation', () => {
    it('should validate required fields for local vault', async () => {
      renderComponent()
      
      const createButton = screen.getByText('Create Vault')
      fireEvent.click(createButton)
      
      await waitFor(() => {
        expect(screen.getByText(/Please fill in all fields/)).toBeInTheDocument()
      })
    })

    it('should validate provider selection for cloud vault', async () => {
      renderComponent()
      
      const cloudButton = screen.getByText('Cloud Storage')
      fireEvent.click(cloudButton)
      
      // Fill in name and password so we get past the missing-fields check
      await waitFor(() => {
        fireEvent.change(screen.getByPlaceholderText('Enter vault name'), {
          target: { value: 'Test Vault' }
        })
        fireEvent.change(screen.getByPlaceholderText('Enter password'), {
          target: { value: 'password123' }
        })
        fireEvent.change(screen.getByPlaceholderText('Confirm password'), {
          target: { value: 'password123' }
        })
      })
      
      const createButton = screen.getByText('Create Vault')
      fireEvent.click(createButton)
      
      await waitFor(() => {
        expect(screen.getByText(/Please select a cloud storage provider/)).toBeInTheDocument()
      })
    })

    it('should enable create button when all fields are filled for local vault', async () => {
      renderComponent()
      
      fireEvent.change(screen.getByPlaceholderText('Enter vault name'), {
        target: { value: 'Test Vault' }
      })
      fireEvent.change(screen.getByPlaceholderText('Enter password'), {
        target: { value: 'password123' }
      })
      
      const createButton = screen.getByText('Create Vault')
      expect(createButton).not.toBeDisabled()
    })

    it('should enable create button when all fields are filled for cloud vault', async () => {
      renderComponent()
      
      const cloudButton = screen.getByText('Cloud Storage')
      fireEvent.click(cloudButton)
      
      await waitFor(() => {
        fireEvent.change(screen.getByPlaceholderText('Enter vault name'), {
          target: { value: 'Test Vault' }
        })
        fireEvent.change(screen.getByPlaceholderText('Enter password'), {
          target: { value: 'password123' }
        })
        
        const providerSelect = screen.getByDisplayValue('Select Provider')
        fireEvent.change(providerSelect, { target: { value: 'google-drive' } })
        
        const createButton = screen.getByText('Create Vault')
        expect(createButton).not.toBeDisabled()
      })
    })
  })

  describe('Form Submission', () => {
    it('should call VaultManager.createVault for local vault', async () => {
      mockVaultManagerInstance.createVault.mockResolvedValue('vault-id-123')
      
      renderComponent()
      
      fireEvent.change(screen.getByPlaceholderText('Enter vault name'), {
        target: { value: 'Test Vault' }
      })
      fireEvent.change(screen.getByPlaceholderText('Enter password'), {
        target: { value: 'password123' }
      })
      fireEvent.change(screen.getByPlaceholderText('Confirm password'), {
        target: { value: 'password123' }
      })
      
      const createButton = screen.getByText('Create Vault')
      fireEvent.click(createButton)
      
      await waitFor(() => {
        expect(mockVaultManagerInstance.createVault).toHaveBeenCalledWith(
          'Test Vault',
          'password123',
          'local',
          undefined,
          '/home/user/.local/share/monark/Test Vault.monark'
        )
      })
    })

    it('should call VaultManager.createVault for cloud vault', async () => {
      mockVaultManagerInstance.createVault.mockResolvedValue('vault-id-123')
      
      renderComponent()
      
      const cloudButton = screen.getByText('Cloud Storage')
      fireEvent.click(cloudButton)
      
      await waitFor(() => {
        fireEvent.change(screen.getByPlaceholderText('Enter vault name'), {
          target: { value: 'Test Vault' }
        })
        fireEvent.change(screen.getByPlaceholderText('Enter password'), {
          target: { value: 'password123' }
        })
        fireEvent.change(screen.getByPlaceholderText('Confirm password'), {
          target: { value: 'password123' }
        })
        
        const providerSelect = screen.getByDisplayValue('Select Provider')
        fireEvent.change(providerSelect, { target: { value: 'google-drive' } })
      })
      
      const createButton = screen.getByText('Create Vault')
      fireEvent.click(createButton)
      
      await waitFor(() => {
        expect(mockVaultManagerInstance.createVault).toHaveBeenCalledWith(
          'Test Vault',
          'password123',
          'cloud',
          'google-drive',
          undefined,
          undefined
        )
      })
    })
  })

  describe('Edit Mode', () => {
    it('should not show storage location selector in edit mode', () => {
      const editVault = {
        id: 'vault-1',
        name: 'Existing Vault',
        path: '/path/to/vault.monark',
        storageType: 'local' as const,
        isLocked: false,
        volatile: {
          credential: '',
          entries: [],
          navigationPath: '/',
        },
      }

      render(
        <Provider store={store}>
          <I18nextProvider i18n={i18n}>
            <AddVaultForm 
              onSuccess={mockOnSuccess} 
              onCancel={mockOnCancel} 
              vault={editVault}
            />
          </I18nextProvider>
        </Provider>
      )
      
      expect(screen.queryByText('Storage Location')).not.toBeInTheDocument()
    })

    it('should show file path as disabled in edit mode', () => {
      const editVault = {
        id: 'vault-1',
        name: 'Existing Vault',
        path: '/path/to/vault.monark',
        storageType: 'local' as const,
        isLocked: false,
        volatile: {
          credential: '',
          entries: [],
          navigationPath: '/',
        },
      }

      render(
        <Provider store={store}>
          <I18nextProvider i18n={i18n}>
            <AddVaultForm 
              onSuccess={mockOnSuccess} 
              onCancel={mockOnCancel} 
              vault={editVault}
            />
          </I18nextProvider>
        </Provider>
      )
      
      const filePathInput = screen.getByDisplayValue('/path/to/vault.monark')
      expect(filePathInput).toBeDisabled()
    })
  })
})
