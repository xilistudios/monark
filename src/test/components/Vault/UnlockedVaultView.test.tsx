import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { I18nextProvider } from 'react-i18next';
import i18n from '../../../i18n';
import UnlockedVaultView, {
  UnlockedVaultViewProps,
} from '../../../components/Vault/UnlockedVaultView';
import { VaultModalProvider } from '../../../components/Vault/VaultContext';
import vaultReducer from '../../../redux/actions/vault';
import type { StorageProvider } from '../../../interfaces/cloud-storage.interface';
import { StorageProviderType } from '../../../interfaces/cloud-storage.interface';

const mockVault = {
  id: 'vault1',
  name: 'Test Vault',
  path: '/path/to/vault.monark',
  storageType: 'local' as const,
  isLocked: false,
  volatile: {
    navigationPath: 'root',
    entries: [],
    credential: '',
  },
};

const mockProps: UnlockedVaultViewProps = {
  currentVault: mockVault,
  currentPath: [],
  entries: [],
  handleNavigate: jest.fn(),
  handleLockVault: jest.fn(),
  t: (key: string) => key,
};

function renderWithProvider(ui: React.ReactElement) {
  const store = configureStore({
    reducer: {
      vault: vaultReducer,
    },
    preloadedState: {
      vault: {
        vaults: [mockVault],
        currentVaultId: mockVault.id,
        loading: false,
        error: null,
        providers: [
          {
            name: 'google-drive',
            providerType: StorageProviderType.GOOGLE_DRIVE,
            isDefault: false,
          },
          {
            name: 'dropbox',
            providerType: StorageProviderType.LOCAL,
            isDefault: false,
          },
        ],
        defaultProvider: null,
        providerStatus: {
          'google-drive': 'authenticated',
          'dropbox': 'idle',
        },
        oauthState: {
          providerName: null,
          authUrl: null,
          state: null,
          isOpen: false,
        },
      },
    },
  });

  const Wrapper = ({ children }: { children: React.ReactNode }) => (
    <Provider store={store}>
      <I18nextProvider i18n={i18n}>
        <VaultModalProvider>{children}</VaultModalProvider>
      </I18nextProvider>
    </Provider>
  );

  return render(ui, { wrapper: Wrapper });
}

describe('UnlockedVaultView', () => {
  it('renders empty vault state', () => {
    renderWithProvider(<UnlockedVaultView {...mockProps} />);
    expect(screen.getByText('vault.manager.emptyVault')).toBeInTheDocument();
  });

  it('renders VaultTree when entries exist', () => {
    const entry: import('../../../interfaces/vault.interface').DataEntry = {
      id: 'entry1',
      entry_type: 'entry',
      name: 'Test Entry',
      data_type: 'login',
      fields: [],
      tags: [],
      created_at: '2025-01-01T00:00:00Z',
      updated_at: '2025-01-01T00:00:00Z',
    };
    renderWithProvider(<UnlockedVaultView {...mockProps} entries={[entry]} />);
    expect(
      screen.queryByText('vault.manager.emptyVault')
    ).not.toBeInTheDocument();
  });

  it('applies fade-in animation classes', async () => {
    renderWithProvider(<UnlockedVaultView {...mockProps} />);
    const container = screen.getByTestId('unlocked-vault-view');
    
    // Wait for the fade-in animation to complete
    await waitFor(() => {
      expect(container).toHaveClass('transition-opacity', 'duration-300', 'opacity-100');
    });
  });

  it('keeps mobile sidebar open when a search result is selected', async () => {
    const entry: import('../../../interfaces/vault.interface').DataEntry = {
      id: 'entry1',
      entry_type: 'entry',
      name: 'Test Entry',
      data_type: 'login',
      fields: [{ name: 'username', value: 'testuser', type: 'text' }],
      tags: [],
      created_at: '2025-01-01T00:00:00Z',
      updated_at: '2025-01-01T00:00:00Z',
    };

    const vaultWithEntries = {
      ...mockVault,
      volatile: {
        ...mockVault.volatile,
        entries: [entry],
      },
    };

    const { rerender } = renderWithProvider(
      <UnlockedVaultView
        {...mockProps}
        entries={[entry]}
        currentVault={vaultWithEntries}
      />
    );

    // Click the search button to open search modal
    const searchButton = screen.getByLabelText('vault.manager.search');
    fireEvent.click(searchButton);

    // Enter query into search input
    const searchInput = screen.getByPlaceholderText('Search');
    fireEvent.change(searchInput, { target: { value: 'Test Entry' } });

    // Click the search result
    const searchResults = screen.getAllByText('Test Entry');
    const searchResult = searchResults[searchResults.length - 1];
    fireEvent.click(searchResult);

    // Rerender with the updated/navigated path, simulating handleNavigate callback updating currentPath
    rerender(
      <UnlockedVaultView
        {...mockProps}
        currentPath={['some', 'path']}
        entries={[entry]}
        currentVault={vaultWithEntries}
      />
    );

    // The mobile sidebar header "Entry Details" should remain in the document
    expect(screen.getByText('Entry Details')).toBeInTheDocument();
  });
});
