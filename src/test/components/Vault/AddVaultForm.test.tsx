import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { invoke } from '@tauri-apps/api/core'
import { Provider } from 'react-redux'
import { configureStore } from '@reduxjs/toolkit'
import { I18nextProvider } from 'react-i18next'
import i18n from '../../../i18n'
import { AddVaultForm, classifyRefreshFailure, isAccessTokenExpired } from '../../../components/Vault/Forms/AddVaultForm'
import { CloudStorageCommands } from '../../../services/cloudStorage'
import vaultReducer from '../../../redux/actions/vault'
import { CloudStorageErrorType, StorageProviderType } from '../../../interfaces/cloud-storage.interface'
import type { CloudStorageError } from '../../../interfaces/cloud-storage.interface'

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

// NOTE: CloudStorageCommands is deliberately NOT mocked. The globally mocked
// `@tauri-apps/api/core` `invoke` (src/test/setup.ts) makes these tests go
// through the REAL `CloudStorageCommands`, so the values the form receives are
// the `CloudStorageError` objects built by `CloudStorageCommands.handleError`
// (src/services/cloudStorage.ts) — exactly like in production. That is what
// turns the fixtures below into a cross-language contract test against the
// backend message contract instead of a self-fulfilling mock.

const HOUR_MS = 60 * 60 * 1000

/**
 * Backend message contract (cross-language fixtures).
 *
 * `AuthFailureClass::message` (src-tauri/src/commands/errors.rs) renders:
 *   - AuthRejection: `authentication failed while {context} (re-authenticate): {cause}`
 *   - Transient:     `network error while {context}: {cause}`
 *   - Other:         `unexpected failure while {context}: {cause}`
 * and the refresh path (`classify_refresh_failure`,
 * src-tauri/src/commands/storage.rs) uses the context
 * "refreshing the Google Drive access token". The Rust test
 * `refresh_failure_taxonomy_matches_the_command_contract` asserts the same
 * keyword contract on these strings, so the two sides cannot drift.
 */
const REFRESH_CONTEXT = 'refreshing the Google Drive access token'

const backendTransientMessage = (cause: string) =>
  `network error while ${REFRESH_CONTEXT}: ${cause}`

const backendAuthRejectionMessage = (cause: string) =>
  `authentication failed while ${REFRESH_CONTEXT} (re-authenticate): ${cause}`

const backendOtherMessage = (cause: string) =>
  `unexpected failure while ${REFRESH_CONTEXT}: ${cause}`

/** Causes taken from the Rust tests / the real provider messages. */
const TRANSIENT_CAUSE = 'Network error during token refresh: error sending request'
const TRANSIENT_5XX_CAUSE =
  'Failed to refresh access token (503 Service Unavailable): upstream hiccup'
const AUTH_REJECTION_CAUSE =
  'Google Drive refresh token is invalid or has been revoked. Please re-authenticate.'
const OTHER_CAUSE = 'Failed to parse token response'

const TRANSIENT_MESSAGE = backendTransientMessage(TRANSIENT_CAUSE)
const AUTH_REJECTION_MESSAGE = backendAuthRejectionMessage(AUTH_REJECTION_CAUSE)
const OTHER_MESSAGE = backendOtherMessage(OTHER_CAUSE)

/**
 * Makes the (globally mocked) Tauri `invoke` reject once for a refresh attempt.
 * `refresh_provider_auth` is the only command the form reaches through `invoke`
 * in these tests (`getProviderAuthInfo` is stubbed at the wrapper level).
 */
const mockRefreshFailure = (message: string) => {
  vi.mocked(invoke).mockRejectedValueOnce(new Error(message))
}

/**
 * Runs a failing refresh through the REAL wrapper and returns the
 * `CloudStorageError` the form actually receives, so the classification tests
 * assert the end-to-end contract instead of a hand-built object.
 */
const wrappedRefreshError = async (
  message: string
): Promise<CloudStorageError> => {
  vi.mocked(invoke).mockRejectedValueOnce(new Error(message))
  try {
    await CloudStorageCommands.refreshProviderAuth('google-drive')
  } catch (error) {
    return error as CloudStorageError
  }
  throw new Error('refreshProviderAuth was expected to reject')
}

/** Auth info of a provider with a still valid access token */
const freshAuthInfo = () => ({
  authenticated: true,
  token_expires_at: new Date(Date.now() + HOUR_MS).toISOString(),
})

/** Auth info of a provider whose access token expired an hour ago */
const expiredAuthInfo = () => ({
  authenticated: true,
  token_expires_at: new Date(Date.now() - HOUR_MS).toISOString(),
})

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

    // Healthy provider by default: valid access token available.
    // getProviderAuthInfo is stubbed at the wrapper level; the refresh call goes
    // through the REAL wrapper, which calls the mocked `invoke`.
    vi.mocked(CloudStorageCommands.getProviderAuthInfo).mockResolvedValue(
      freshAuthInfo()
    )
    vi.mocked(invoke).mockResolvedValue(freshAuthInfo())
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

  describe('Cloud Provider Authentication Check', () => {
    const notAuthenticatedMessage = /Provider is not authenticated/
    const transientMessage = /Could not renew the cloud session/

    /** Selects cloud storage and fills the form up to the auth check */
    const fillCloudVaultForm = async () => {
      fireEvent.click(screen.getByText('Cloud Storage'))

      await waitFor(() => {
        expect(screen.getByDisplayValue('Select Provider')).toBeInTheDocument()
      })

      fireEvent.change(screen.getByPlaceholderText('Enter vault name'), {
        target: { value: 'Test Vault' },
      })
      fireEvent.change(screen.getByPlaceholderText('Enter password'), {
        target: { value: 'password123' },
      })
      fireEvent.change(screen.getByPlaceholderText('Confirm password'), {
        target: { value: 'password123' },
      })
      fireEvent.change(screen.getByDisplayValue('Select Provider'), {
        target: { value: 'google-drive' },
      })
    }

    it('should silently refresh an expired access token and continue', async () => {
      mockVaultManagerInstance.createVault.mockResolvedValue('vault-id-123')
      vi.mocked(CloudStorageCommands.getProviderAuthInfo).mockResolvedValue(
        expiredAuthInfo()
      )
      // The default `invoke` mock (beforeEach) resolves a fresh auth info, so the
      // REAL refreshProviderAuth wrapper succeeds.

      renderComponent()
      await fillCloudVaultForm()

      fireEvent.click(screen.getByText('Create Vault'))

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

      expect(CloudStorageCommands.refreshProviderAuth).toHaveBeenCalledWith(
        'google-drive'
      )
      expect(screen.queryByText(notAuthenticatedMessage)).not.toBeInTheDocument()
      // The raw, non refresh-aware check is no longer used
      expect(CloudStorageCommands.checkProviderAuthStatus).not.toHaveBeenCalled()
    })

    it('should block when the refresh is rejected with an auth error (backend AuthRejection)', async () => {
      // m6 (b): a genuine authentication failure must keep the current copy and
      // send the user to Settings. The message is the exact backend contract
      // string, pushed through the REAL CloudStorageCommands.handleError.
      vi.mocked(CloudStorageCommands.getProviderAuthInfo).mockResolvedValue(
        expiredAuthInfo()
      )
      mockRefreshFailure(AUTH_REJECTION_MESSAGE)

      renderComponent()
      await fillCloudVaultForm()

      fireEvent.click(screen.getByText('Create Vault'))

      await waitFor(() => {
        expect(screen.getByText(notAuthenticatedMessage)).toBeInTheDocument()
      })
      expect(screen.queryByText(transientMessage)).not.toBeInTheDocument()
      expect(mockVaultManagerInstance.createVault).not.toHaveBeenCalled()
    })

    it('should block when the stored refresh token is missing (backend AuthRejection)', async () => {
      // "No refresh token available" is another terminal AuthRejection case
      // (classify_refresh_failure maps every non-transient Authentication error
      // to AuthRejection).
      vi.mocked(CloudStorageCommands.getProviderAuthInfo).mockResolvedValue(
        expiredAuthInfo()
      )
      mockRefreshFailure(
        backendAuthRejectionMessage('No refresh token available')
      )

      renderComponent()
      await fillCloudVaultForm()

      fireEvent.click(screen.getByText('Create Vault'))

      await waitFor(() => {
        expect(screen.getByText(notAuthenticatedMessage)).toBeInTheDocument()
      })
      expect(screen.queryByText(transientMessage)).not.toBeInTheDocument()
      expect(mockVaultManagerInstance.createVault).not.toHaveBeenCalled()
    })

    it('should block with the conservative message when the refresh fails with an unclassified (Other) error', async () => {
      // Backend `Other`: no classification keyword, so the wrapper reports
      // OPERATION_FAILED and the form falls back to the terminal "not
      // authenticated" copy (conservative default).
      vi.mocked(CloudStorageCommands.getProviderAuthInfo).mockResolvedValue(
        expiredAuthInfo()
      )
      mockRefreshFailure(OTHER_MESSAGE)

      renderComponent()
      await fillCloudVaultForm()

      fireEvent.click(screen.getByText('Create Vault'))

      await waitFor(() => {
        expect(screen.getByText(notAuthenticatedMessage)).toBeInTheDocument()
      })
      expect(screen.queryByText(transientMessage)).not.toBeInTheDocument()
      expect(mockVaultManagerInstance.createVault).not.toHaveBeenCalled()
    })

    // m6 (a): a transient (network/IO) refresh failure is NOT a logout. It must
    // show a retryable message and leave the submit button enabled.
    it('should show a retryable message (not "not authenticated") when the refresh fails with a network error', async () => {
      mockVaultManagerInstance.createVault.mockResolvedValue('vault-id-123')
      vi.mocked(CloudStorageCommands.getProviderAuthInfo).mockResolvedValue(
        expiredAuthInfo()
      )
      mockRefreshFailure(TRANSIENT_MESSAGE)

      renderComponent()
      await fillCloudVaultForm()

      fireEvent.click(screen.getByText('Create Vault'))

      await waitFor(() => {
        expect(screen.getByText(transientMessage)).toBeInTheDocument()
      })
      // A momentary network cut must never look like an expired session
      expect(screen.queryByText(notAuthenticatedMessage)).not.toBeInTheDocument()
      expect(mockVaultManagerInstance.createVault).not.toHaveBeenCalled()
      // ... and the submit button stays usable, so the user can simply retry
      expect(screen.getByText('Create Vault')).not.toBeDisabled()

      // Retrying once the network is back succeeds without any re-login
      vi.mocked(invoke).mockResolvedValue(freshAuthInfo())
      fireEvent.click(screen.getByText('Create Vault'))

      await waitFor(() => {
        expect(mockVaultManagerInstance.createVault).toHaveBeenCalled()
      })
      expect(CloudStorageCommands.refreshProviderAuth).toHaveBeenCalledTimes(2)
      expect(screen.queryByText(notAuthenticatedMessage)).not.toBeInTheDocument()
    })

    it('should show the retryable message when the refresh is rate limited (429) or a 5xx (backend Transient)', async () => {
      vi.mocked(CloudStorageCommands.getProviderAuthInfo).mockResolvedValue(
        expiredAuthInfo()
      )
      mockRefreshFailure(backendTransientMessage(TRANSIENT_5XX_CAUSE))

      renderComponent()
      await fillCloudVaultForm()

      fireEvent.click(screen.getByText('Create Vault'))

      await waitFor(() => {
        expect(screen.getByText(transientMessage)).toBeInTheDocument()
      })
      expect(screen.queryByText(notAuthenticatedMessage)).not.toBeInTheDocument()
    })

    it('should not refresh providers without token expiry metadata (stateless credentials)', async () => {
      mockVaultManagerInstance.createVault.mockResolvedValue('vault-id-123')
      // WebDAV style provider: Basic auth, no OAuth access token, no expiry.
      // The provider level rule (skip the token flow) mirrors
      // VaultManager.getProviderAuthState in src/services/vault.ts, while
      // isAccessTokenExpired keeps the backend semantics for tokens (see the
      // 'Access token expiry semantics' suite).
      vi.mocked(CloudStorageCommands.getProviderAuthInfo).mockResolvedValue({
        authenticated: true,
        token_expires_at: null,
      })

      renderComponent()
      await fillCloudVaultForm()

      fireEvent.click(screen.getByText('Create Vault'))

      await waitFor(() => {
        expect(mockVaultManagerInstance.createVault).toHaveBeenCalled()
      })
      expect(CloudStorageCommands.refreshProviderAuth).not.toHaveBeenCalled()
      expect(screen.queryByText(notAuthenticatedMessage)).not.toBeInTheDocument()
    })

    it('should block when there are no credentials at all', async () => {
      // Backend reports no stored credentials for the provider
      vi.mocked(CloudStorageCommands.getProviderAuthInfo).mockResolvedValue(
        null as never
      )

      renderComponent()
      await fillCloudVaultForm()

      fireEvent.click(screen.getByText('Create Vault'))

      await waitFor(() => {
        expect(screen.getByText(notAuthenticatedMessage)).toBeInTheDocument()
      })
      expect(CloudStorageCommands.refreshProviderAuth).not.toHaveBeenCalled()
      expect(mockVaultManagerInstance.createVault).not.toHaveBeenCalled()
    })

    it('should not refresh when the access token is still valid', async () => {
      mockVaultManagerInstance.createVault.mockResolvedValue('vault-id-123')

      renderComponent()
      await fillCloudVaultForm()

      fireEvent.click(screen.getByText('Create Vault'))

      await waitFor(() => {
        expect(mockVaultManagerInstance.createVault).toHaveBeenCalled()
      })
      expect(CloudStorageCommands.refreshProviderAuth).not.toHaveBeenCalled()
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
/**
 * m2: the expiry helper must follow the backend contract
 * (`GoogleDriveConfig::is_token_expired` in
 * src-tauri/src/storage/manager/provider_management.rs) and the module-private
 * `isTokenExpired` in src/services/vault.ts:52 — a missing expiry means "not
 * usable" and the 5 minute refresh-ahead buffer applies.
 */
describe('Access token expiry semantics', () => {
  const MINUTE_MS = 60 * 1000

  it('treats a missing expiry as expired (backend contract)', () => {
    expect(isAccessTokenExpired(null)).toBe(true)
    expect(isAccessTokenExpired(undefined)).toBe(true)
    expect(isAccessTokenExpired('')).toBe(true)
  })

  it('treats an unparseable expiry as expired', () => {
    expect(isAccessTokenExpired('not-a-date')).toBe(true)
  })

  it('treats a token expiring within the 5 minute buffer as expired', () => {
    expect(
      isAccessTokenExpired(new Date(Date.now() + 4 * MINUTE_MS).toISOString())
    ).toBe(true)
  })

  it('treats a token expiring outside the 5 minute buffer as valid', () => {
    expect(
      isAccessTokenExpired(new Date(Date.now() + 6 * MINUTE_MS).toISOString())
    ).toBe(false)
  })

  it('treats an already expired token as expired', () => {
    expect(
      isAccessTokenExpired(new Date(Date.now() - MINUTE_MS).toISOString())
    ).toBe(true)
  })
})

/**
 * G2: the refresh verdict is driven by the `CloudStorageError.type` produced by
 * `CloudStorageCommands.handleError` from the backend message contract
 * (`AuthFailureClass::message`). Every fixture is therefore pushed through the
 * REAL wrapper (`refreshProviderAuth` + a mocked `invoke`), so these tests fail
 * if either side of the cross-language contract drifts.
 */
describe('Refresh failure classification', () => {
  it('classifies the backend Transient message as transient (NETWORK_ERROR)', async () => {
    const wrapped = await wrappedRefreshError(TRANSIENT_MESSAGE)

    // The wrapper must derive the type from the backend message …
    expect(wrapped.type).toBe(CloudStorageErrorType.NETWORK_ERROR)
    // … and the classifier must honor it (never "auth").
    expect(classifyRefreshFailure(wrapped)).toBe('transient')
  })

  it('classifies the backend 5xx/429 Transient message as transient', async () => {
    const wrapped = await wrappedRefreshError(
      backendTransientMessage(TRANSIENT_5XX_CAUSE)
    )

    expect(wrapped.type).toBe(CloudStorageErrorType.NETWORK_ERROR)
    expect(classifyRefreshFailure(wrapped)).toBe('transient')
  })

  it('classifies the backend AuthRejection message as auth (AUTHENTICATION_FAILED)', async () => {
    const wrapped = await wrappedRefreshError(AUTH_REJECTION_MESSAGE)

    expect(wrapped.type).toBe(CloudStorageErrorType.AUTHENTICATION_FAILED)
    expect(classifyRefreshFailure(wrapped)).toBe('auth')
  })

  it('classifies the backend Other message conservatively as auth (OPERATION_FAILED)', async () => {
    const wrapped = await wrappedRefreshError(OTHER_MESSAGE)

    expect(wrapped.type).toBe(CloudStorageErrorType.OPERATION_FAILED)
    expect(classifyRefreshFailure(wrapped)).toBe('auth')
  })

  /**
   * Secondary signal: only reached when the error did NOT come through the
   * wrapper (a raw throw before `handleError`, e.g. a synchronous guard). These
   * are the pre-G2 assertions, kept to prove the fallback still works with
   * status/message-only errors.
   */
  describe('secondary signal for unwrapped errors', () => {
    it('classifies network level failures as transient', () => {
      expect(classifyRefreshFailure(new TypeError('fetch failed'))).toBe(
        'transient'
      )
      expect(
        classifyRefreshFailure(
          new Error('timeout while contacting the provider')
        )
      ).toBe('transient')
      expect(
        classifyRefreshFailure({ status: 503, message: 'Service Unavailable' })
      ).toBe('transient')
    })

    it('classifies rejected credentials as auth failures', () => {
      expect(classifyRefreshFailure(new Error('invalid_grant'))).toBe('auth')
      expect(
        classifyRefreshFailure({ status: 401, message: 'Unauthorized' })
      ).toBe('auth')
    })

    it('defaults to auth when the error cannot be classified (conservative)', () => {
      // An unwrapped error carries no machine readable class, so it must not be
      // treated as retryable.
      expect(
        classifyRefreshFailure(new Error('Failed to refresh provider auth'))
      ).toBe('auth')
      expect(classifyRefreshFailure(null)).toBe('auth')
    })
  })
})