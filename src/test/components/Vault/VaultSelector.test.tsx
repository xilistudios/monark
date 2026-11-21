import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import VaultSelector from '../../../components/Vault/VaultSelector';
import { vaultSlice, type Vault } from '../../../redux/actions/vault';
import { StorageProviderType } from '../../../interfaces/cloud-storage.interface';
import { VaultManager } from '../../../services/vault';
import { vi } from 'vitest';

// Mock the translation hook.
//
// Mirrors i18next's call shapes: `t(key, fallback)` (the component's usual form)
// and `t(key, { defaultValue, ...vars })` (used by the passkey reconciliation
// notice, which interpolates `{{names}}`). Returning the raw options object
// would make React throw on it, so the mock interpolates like i18next does.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (
      key: string,
      options?: string | Record<string, unknown>,
      maybeOptions?: Record<string, unknown>,
    ) => {
      const fallback = typeof options === 'string' ? options : undefined;
      const vars =
        typeof options === 'object' && options !== null
          ? options
          : (maybeOptions ?? {});
      const template =
        typeof vars.defaultValue === 'string'
          ? vars.defaultValue
          : fallback || key;
      return template.replace(/\{\{(\w+)\}\}/g, (_match, name: string) =>
        String(vars[name] ?? ''),
      );
    },
  }),
}));

// Mock TanStack Router completely by replacing Link with a simple button
vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, onClick, ...props }: any) => (
    <button onClick={onClick} {...props}>
      {children}
    </button>
  ),
  useRouter: () => ({
    navigate: vi.fn(),
  }),
  useRouterState: () => ({
    location: {
      pathname: '/',
    },
  }),
  useLinkProps: () => ({}),
}));

// Helper function to render with all providers
const renderWithProviders = (ui: React.ReactElement, { initialState = {} } = {}) => {
  const store = createMockStore(initialState);
  return {
    store,
    ...render(
      <Provider store={store}>
        {ui}
      </Provider>
    ),
  };
};

// Mock VaultManager
const mockVaultManagerInstance = {
  loadProviders: vi.fn().mockResolvedValue(undefined),
  refreshCloudVaults: vi.fn().mockResolvedValue(undefined),
  syncWithCloud: vi.fn().mockResolvedValue(undefined),
  getInstance: vi.fn(() => ({
    syncWithCloud: vi.fn().mockResolvedValue(undefined),
  })),
};

vi.mock('../../../services/vault', () => ({
  VaultManager: {
    getInstance: vi.fn(() => mockVaultManagerInstance),
  },
}));

// Mock the VaultModalContext
vi.mock('../../../components/Vault/VaultContext', () => ({
  VaultModalContext: {
    __esModule: true,
    default: {
      openEditVaultModal: vi.fn(),
    },
  },
  useContext: () => ({
    openEditVaultModal: vi.fn(),
  }),
}));

const createMockStore = (initialState = {}) => {
  return configureStore({
    reducer: {
      vault: vaultSlice.reducer,
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
        ...initialState,
      },
    },
  });
};

describe('VaultSelector', () => {
  const mockLocalVault: Vault = {
    id: 'local-vault-1',
    name: 'Local Vault',
    path: '/path/to/local.vault',
    storageType: 'local',
    isLocked: true,
    volatile: {
      credential: '',
      entries: [],
      navigationPath: '/',
    },
  };

  const mockCloudVault: Vault = {
    id: 'cloud-vault-1',
    name: 'Cloud Vault',
    path: 'cloud-file-id-123',
    storageType: 'cloud',
    providerId: 'google-drive-provider',
    cloudMetadata: {
      fileId: 'cloud-file-id-123',
      provider: 'google-drive-provider',
      lastSync: '2023-12-01T10:00:00Z',
    },
    isLocked: true,
    volatile: {
      credential: '',
      entries: [],
      navigationPath: '/',
    },
  };

  const mockProviders = [
    {
      name: 'google-drive-provider',
      provider_type: StorageProviderType.GOOGLE_DRIVE,
      is_default: true,
    },
  ];

  const defaultProps = {
    onAddVault: vi.fn(),
    onDeleteVault: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders loading state correctly', () => {
    renderWithProviders(<VaultSelector {...defaultProps} />, { initialState: { loading: true } });

    expect(document.querySelector('.loading-spinner')).toBeInTheDocument();
  });

  it('renders empty state when no vaults exist', () => {
    renderWithProviders(<VaultSelector {...defaultProps} />);

    expect(screen.getByText('vaultSelector.noVaults')).toBeInTheDocument();
    expect(screen.getByText('vaultSelector.emptyState')).toBeInTheDocument();
  });

  it('renders local vault correctly', () => {
    renderWithProviders(<VaultSelector {...defaultProps} />, {
      initialState: {
        vaults: [mockLocalVault],
        providers: mockProviders,
      },
    });

    expect(screen.getByText('Local Vault')).toBeInTheDocument();
    expect(screen.getByTitle('vaultSelector.localVault')).toBeInTheDocument();
  });

  it('renders cloud vault correctly', () => {
    renderWithProviders(<VaultSelector {...defaultProps} />, {
      initialState: {
        vaults: [mockCloudVault],
        providers: mockProviders,
      },
    });

    expect(screen.getByText('Cloud Vault')).toBeInTheDocument();
    expect(screen.getByTitle('vaultSelector.cloudVault')).toBeInTheDocument();
    expect(screen.getByText('Google Drive')).toBeInTheDocument();
  });

  it('calls onAddVault when add vault button is clicked', () => {
    renderWithProviders(<VaultSelector {...defaultProps} />);

    // Click the add vault button directly by title
    const addButton = screen.getByTitle('vaultSelector.addVault');
    fireEvent.click(addButton);

    expect(defaultProps.onAddVault).toHaveBeenCalled();
  });

  it('calls refresh cloud vaults when refresh button is clicked', async () => {
    renderWithProviders(<VaultSelector {...defaultProps} />, {
      initialState: {
        vaults: [mockCloudVault],
        providers: mockProviders,
      },
    });

    // Click the refresh button directly by title
    const refreshButton = screen.getByTitle('vaultSelector.refreshVaults');
    fireEvent.click(refreshButton);

    await waitFor(() => {
      expect(VaultManager.getInstance().refreshCloudVaults).toHaveBeenCalled();
    });
  });

  it('shows sync option for cloud vaults in dropdown menu', () => {
    renderWithProviders(<VaultSelector {...defaultProps} />, {
      initialState: {
        vaults: [mockCloudVault],
        providers: mockProviders,
      },
    });

    // Open vault dropdown menu
    const vaultDropdownButton = screen.getAllByRole('button')[1]; // Second button is vault dropdown
    fireEvent.click(vaultDropdownButton);

    // Should show sync option for cloud vault
    expect(screen.getByText('vaultSelector.syncNow')).toBeInTheDocument();
    expect(screen.getByText('vaultSelector.migrateToLocal')).toBeInTheDocument();
  });

  it('shows migrate to cloud option for local vaults in dropdown menu', () => {
    renderWithProviders(<VaultSelector {...defaultProps} />, {
      initialState: {
        vaults: [mockLocalVault],
        providers: mockProviders,
      },
    });

    // Open vault dropdown menu
    const vaultDropdownButton = screen.getAllByRole('button')[1]; // Second button is vault dropdown
    fireEvent.click(vaultDropdownButton);

    // Should show migrate to cloud option for local vault
    expect(screen.getByText('vaultSelector.migrateToCloud')).toBeInTheDocument();
  });

  it('handles vault selection correctly', () => {
    const { store } = renderWithProviders(<VaultSelector {...defaultProps} />, {
      initialState: {
        vaults: [mockLocalVault],
        providers: mockProviders,
      },
    });

    // Click on vault
    const vaultElement = screen.getByText('Local Vault');
    fireEvent.click(vaultElement);

    const state = store.getState();
    expect(state.vault.currentVaultId).toBe(mockLocalVault.id);
  });

  it('handles sync operation for cloud vaults', async () => {
    const mockVaultSync = vi.fn().mockResolvedValue(undefined);
    mockVaultManagerInstance.getInstance.mockReturnValue({
      syncWithCloud: mockVaultSync,
    });

    renderWithProviders(<VaultSelector {...defaultProps} />, {
      initialState: {
        vaults: [mockCloudVault],
        providers: mockProviders,
      },
    });

    // Open vault dropdown menu
    const vaultDropdownButton = screen.getAllByRole('button')[1];
    fireEvent.click(vaultDropdownButton);

    // Click sync option
    const syncOption = screen.getByText('vaultSelector.syncNow');
    fireEvent.click(syncOption);

    await waitFor(() => {
      expect(mockVaultManagerInstance.getInstance).toHaveBeenCalledWith('cloud-vault-1');
      expect(mockVaultSync).toHaveBeenCalled();
    });
  });

  it('disables migrate to cloud when no providers available', () => {
    renderWithProviders(<VaultSelector {...defaultProps} />, {
      initialState: {
        vaults: [mockLocalVault],
        providers: [], // No providers
      },
    });

    // Open vault dropdown menu
    const vaultDropdownButton = screen.getAllByRole('button')[1];
    fireEvent.click(vaultDropdownButton);

    // Migrate to cloud should be disabled
    const migrateToCloudOption = screen.getByText('vaultSelector.migrateToCloud');
    expect(migrateToCloudOption.closest('button')).toBeDisabled();
  });

  it('surfaces a failed sync instead of swallowing it (E13c)', async () => {
    const mockVaultSync = vi
      .fn()
      .mockRejectedValue(new Error('Failed to sync with cloud: quota exceeded'));
    mockVaultManagerInstance.getInstance.mockReturnValue({
      syncWithCloud: mockVaultSync,
    });
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    renderWithProviders(<VaultSelector {...defaultProps} />, {
      initialState: {
        vaults: [mockCloudVault],
        providers: mockProviders,
      },
    });

    // Open the vault dropdown and trigger the sync action.
    const vaultDropdownButton = screen.getAllByRole('button')[1];
    fireEvent.click(vaultDropdownButton);
    fireEvent.click(screen.getByText('vaultSelector.syncNow'));

    await waitFor(() => {
      expect(mockVaultSync).toHaveBeenCalled();
    });

    // The failure is visible to the user. This file mocks `useTranslation`
    // with `t: (key, fallback) => fallback || key`, so the rendered text is the
    // English fallback passed at the call site.
    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(
        /Failed to sync the vault with cloud storage/,
      );
    });
    // ...and sanitized: the underlying error text never reaches the UI or logs.
    expect(screen.getByRole('alert')).not.toHaveTextContent('quota exceeded');
    for (const call of consoleError.mock.calls) {
      expect(JSON.stringify(call)).not.toContain('quota exceeded');
    }
    consoleError.mockRestore();
  });

  it('clears the sync error when dismissed', async () => {
    const mockVaultSync = vi.fn().mockRejectedValue(new Error('boom'));
    mockVaultManagerInstance.getInstance.mockReturnValue({
      syncWithCloud: mockVaultSync,
    });
    vi.spyOn(console, 'error').mockImplementation(() => {});

    renderWithProviders(<VaultSelector {...defaultProps} />, {
      initialState: {
        vaults: [mockCloudVault],
        providers: mockProviders,
      },
    });

    const vaultDropdownButton = screen.getAllByRole('button')[1];
    fireEvent.click(vaultDropdownButton);
    fireEvent.click(screen.getByText('vaultSelector.syncNow'));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('Dismiss'));

    await waitFor(() => {
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });
  });

  /**
   * MAYOR-1: a sync that dropped passkey views (deleted on another device)
   * leaves a non-fatal notice in Redux. It is rendered apart from the error
   * banner and names the passkeys from our own dropped views.
   */
  it('renders the passkey reconciliation notice for the current vault', () => {
    renderWithProviders(<VaultSelector {...defaultProps} />, {
      initialState: {
        vaults: [mockCloudVault],
        providers: mockProviders,
        currentVaultId: mockCloudVault.id,
        syncNotice: {
          vaultId: mockCloudVault.id,
          passkeys: [
            { id: 'pk-1', name: 'GitHub' },
            { id: 'pk-2', name: 'Example' },
          ],
        },
      },
    });

    const notice = screen.getByRole('status');
    expect(notice).toHaveTextContent(
      /These passkeys were deleted on another device/,
    );
    expect(notice).toHaveTextContent('GitHub, Example');
  });

  it('hides the reconciliation notice for another vault', () => {
    renderWithProviders(<VaultSelector {...defaultProps} />, {
      initialState: {
        vaults: [mockCloudVault],
        providers: mockProviders,
        currentVaultId: 'some-other-vault',
        syncNotice: {
          vaultId: mockCloudVault.id,
          passkeys: [{ id: 'pk-1', name: 'GitHub' }],
        },
      },
    });

    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('clears the reconciliation notice when dismissed', () => {
    const { store } = renderWithProviders(<VaultSelector {...defaultProps} />, {
      initialState: {
        vaults: [mockCloudVault],
        providers: mockProviders,
        currentVaultId: mockCloudVault.id,
        syncNotice: {
          vaultId: mockCloudVault.id,
          passkeys: [{ id: 'pk-1', name: 'GitHub' }],
        },
      },
    });

    fireEvent.click(screen.getByText('Dismiss'));

    expect(store.getState().vault.syncNotice).toBeNull();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('shows error message when refresh fails', async () => {
    mockVaultManagerInstance.refreshCloudVaults.mockRejectedValue(new Error('Network error'));

    renderWithProviders(<VaultSelector {...defaultProps} />, {
      initialState: {
        vaults: [mockCloudVault],
        providers: mockProviders,
      },
    });

    // Click the refresh button to trigger the error
    const refreshButton = screen.getByTitle('vaultSelector.refreshVaults');
    fireEvent.click(refreshButton);

    await waitFor(() => {
      expect(screen.getByText(/Failed to refresh cloud vaults/)).toBeInTheDocument();
    });
  });
});