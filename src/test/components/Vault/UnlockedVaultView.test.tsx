import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
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

  it('calls updateEntryById (not updateEntry with buggy path) when saving an entry from the sidebar', async () => {
    const { VaultManager, VaultInstance } = await import('../../../services/vault');

    const dataEntry: import('../../../interfaces/vault.interface').DataEntry = {
      id: 'entry-abc',
      entry_type: 'entry',
      name: 'My Entry',
      data_type: 'login',
      fields: [
        {
          title: 'Username',
          property: 'text',
          value: 'original-user',
          secret: false,
        },
      ],
      tags: [],
      created_at: '2025-01-01T00:00:00Z',
      updated_at: '2025-01-01T00:00:00Z',
    };

    const vaultWithEntries = {
      ...mockVault,
      volatile: {
        ...mockVault.volatile,
        entries: [dataEntry],
      },
    };

    // Spy on VaultInstance.prototype.updateEntryById before render
    const updateByIdSpy = jest.spyOn(VaultInstance.prototype, 'updateEntryById').mockResolvedValue(undefined);
    // Also spy on the OLD updateEntry to verify it is NOT called from handleSaveEntry
    const updateByPathSpy = jest.spyOn(VaultInstance.prototype, 'updateEntry');

    // Initialize VaultManager with the test store so getInstance() works
    const store = configureStore({
      reducer: { vault: vaultReducer },
      preloadedState: {
        vault: {
          vaults: [vaultWithEntries],
          currentVaultId: vaultWithEntries.id,
          loading: false,
          error: null,
          providers: [],
          defaultProvider: null,
          providerStatus: {},
          oauthState: {
            providerName: null,
            authUrl: null,
            state: null,
            isOpen: false,
          },
        },
      },
    });
    VaultManager.getInstance().initialize(store.dispatch, store.getState);

    const Wrapper = ({ children }: { children: React.ReactNode }) => (
      <Provider store={store}>
        <I18nextProvider i18n={i18n}>
          <VaultModalProvider>{children}</VaultModalProvider>
        </I18nextProvider>
      </Provider>
    );

    render(
      <UnlockedVaultView
        {...mockProps}
        currentVault={vaultWithEntries}
        currentPath={[]}
        entries={[dataEntry]}
      />,
      { wrapper: Wrapper }
    );

    // Click on the entry in the tree to select it (opens mobile sidebar)
    fireEvent.click(screen.getByText('My Entry'));

    // On mobile (jsdom default viewport), the mobile overlay renders.
    // The sidebar header "Entry Details" should be visible.
    expect(screen.getByText('Entry Details')).toBeInTheDocument();

    // Click "Edit" in the mobile sidebar overlay (second Edit button, index 1)
    // Note: EntryDetailsSidebar uses real i18n, not the test's t prop
    const editButtons = screen.getAllByText('Edit');
    expect(editButtons.length).toBeGreaterThanOrEqual(2);
    fireEvent.click(editButtons[1]);

    // After edit mode activates, the Save button appears with translated text
    await waitFor(() => {
      expect(screen.getAllByText('Save').length).toBeGreaterThanOrEqual(1);
    });
    const saveButtons = screen.getAllByText('Save');
    fireEvent.click(saveButtons[0]);

    await waitFor(() => {
      // The fix: updateEntryById must be called with the entry ID
      expect(updateByIdSpy).toHaveBeenCalledWith('entry-abc', expect.any(Object));
      // The old buggy path-based updateEntry must NOT be called from handleSaveEntry
      expect(updateByPathSpy).not.toHaveBeenCalled();
    });

    updateByIdSpy.mockRestore();
    updateByPathSpy.mockRestore();
  });

  it('saves a nested entry from the sidebar using its absolute path', async () => {
    // This test proves the updateEntryById fix resolves the absolute path for
    // a nested entry.  By selecting the entry via search (not tree navigation),
    // currentPath remains [] — the exact scenario where the old buggy code
    // (vaultInstance.updateEntry([...currentPath, selectedEntry.id], ...))
    // would produce the wrong path ['nested-entry-1'] instead of the correct
    // absolute path ['group-1', 'nested-entry-1'].

    const { VaultManager, VaultInstance } = await import(
      '../../../services/vault'
    );

    const nestedEntry: import('../../../interfaces/vault.interface').DataEntry = {
      id: 'nested-entry-1',
      entry_type: 'entry',
      name: 'Nested Entry',
      data_type: 'login',
      fields: [
        {
          title: 'Username',
          property: 'text',
          value: 'testuser',
          secret: false,
        },
      ],
      tags: [],
      created_at: '2025-01-01T00:00:00Z',
      updated_at: '2025-01-01T00:00:00Z',
    };

    const group: import('../../../interfaces/vault.interface').GroupEntry = {
      id: 'group-1',
      entry_type: 'group',
      name: 'Group',
      data_type: 'group',
      children: [nestedEntry],
      created_at: '2025-01-01T00:00:00Z',
      updated_at: '2025-01-01T00:00:00Z',
    };

    const vaultWithNestedEntries = {
      ...mockVault,
      volatile: {
        ...mockVault.volatile,
        entries: [group],
        credential: 'test-password',
      },
    };

    const store = configureStore({
      reducer: { vault: vaultReducer },
      preloadedState: {
        vault: {
          vaults: [vaultWithNestedEntries],
          currentVaultId: vaultWithNestedEntries.id,
          loading: false,
          error: null,
          providers: [],
          defaultProvider: null,
          providerStatus: {},
          oauthState: {
            providerName: null,
            authUrl: null,
            state: null,
            isOpen: false,
          },
        },
      },
    });

    // Initialize VaultManager so getInstance(vaultId) returns a real VaultInstance
    VaultManager.getInstance().initialize(store.dispatch, store.getState);
    // Clear any cached instance from prior tests (VaultManager is a singleton)
    VaultManager.getInstance().removeInstance(vaultWithNestedEntries.id);

    // Spy on the LOW-LEVEL updateEntry — updateEntryById must run for real
    // so that findPathById path resolution is exercised.
    const updateEntrySpy = jest
      .spyOn(VaultInstance.prototype, 'updateEntry')
      .mockResolvedValue(undefined);

    const Wrapper = ({ children }: { children: React.ReactNode }) => (
      <Provider store={store}>
        <I18nextProvider i18n={i18n}>
          <VaultModalProvider>{children}</VaultModalProvider>
        </I18nextProvider>
      </Provider>
    );

    render(
      <UnlockedVaultView
        {...mockProps}
        currentVault={vaultWithNestedEntries}
        currentPath={[]}
        entries={[group]}
      />,
      { wrapper: Wrapper }
    );

    // Use the search flow to select the nested entry while currentPath stays [].
    // This simulates the real bug scenario: the entry's absolute path
    // ['group-1', 'nested-entry-1'] differs from the view-derived path
    // [...currentPath, entry.id] = ['nested-entry-1'].
    const searchButton = screen.getByLabelText('vault.manager.search');
    fireEvent.click(searchButton);

    const searchInput = screen.getByPlaceholderText('Search');
    fireEvent.change(searchInput, { target: { value: 'Nested Entry' } });

    // The search result should appear (VaultSearchBar flattens nested entries)
    await waitFor(() => {
      expect(screen.getAllByText('Nested Entry').length).toBeGreaterThanOrEqual(1);
    });

    const searchResults = screen.getAllByText('Nested Entry');
    fireEvent.click(searchResults[searchResults.length - 1]);

    // After search result select: mobile sidebar should open
    expect(screen.getByText('Entry Details')).toBeInTheDocument();

    // Click "Edit" in the mobile sidebar overlay (second Edit button, index 1)
    const editButtons = screen.getAllByText('Edit');
    expect(editButtons.length).toBeGreaterThanOrEqual(2);
    fireEvent.click(editButtons[1]);

    // Wait for Save button and click it
    await waitFor(() => {
      expect(screen.getAllByText('Save').length).toBeGreaterThanOrEqual(1);
    });
    const saveButtons = screen.getAllByText('Save');
    fireEvent.click(saveButtons[0]);

    await waitFor(() => {
      // Core assertion: updateEntry MUST be called with the ABSOLUTE path
      // resolved by updateEntryById → findPathById, not the view-derived path.
      expect(updateEntrySpy).toHaveBeenCalledWith(
        ['group-1', 'nested-entry-1'],
        expect.any(Object)
      );
      // The buggy single-segment path must NOT be used.
      expect(updateEntrySpy).not.toHaveBeenCalledWith(
        ['nested-entry-1'],
        expect.any(Object)
      );
    });

    updateEntrySpy.mockRestore();
  });

  it('shows the save error inside the mobile sidebar overlay when the save fails', async () => {
    const { VaultManager, VaultInstance } = await import('../../../services/vault');

    const dataEntry: import('../../../interfaces/vault.interface').DataEntry = {
      id: 'entry-err',
      entry_type: 'entry',
      name: 'Error Entry',
      data_type: 'login',
      fields: [
        {
          title: 'Username',
          property: 'text',
          value: 'test-user',
          secret: false,
        },
      ],
      tags: [],
      created_at: '2025-01-01T00:00:00Z',
      updated_at: '2025-01-01T00:00:00Z',
    };

    const vaultWithEntries = {
      ...mockVault,
      volatile: {
        ...mockVault.volatile,
        entries: [dataEntry],
        credential: 'test-password',
      },
    };

    const updateByIdSpy = jest
      .spyOn(VaultInstance.prototype, 'updateEntryById')
      .mockRejectedValue(new Error('Entry not found'));

    const store = configureStore({
      reducer: { vault: vaultReducer },
      preloadedState: {
        vault: {
          vaults: [vaultWithEntries],
          currentVaultId: vaultWithEntries.id,
          loading: false,
          error: null,
          providers: [],
          defaultProvider: null,
          providerStatus: {},
          oauthState: {
            providerName: null,
            authUrl: null,
            state: null,
            isOpen: false,
          },
        },
      },
    });
    VaultManager.getInstance().initialize(store.dispatch, store.getState);

    const Wrapper = ({ children }: { children: React.ReactNode }) => (
      <Provider store={store}>
        <I18nextProvider i18n={i18n}>
          <VaultModalProvider>{children}</VaultModalProvider>
        </I18nextProvider>
      </Provider>
    );

    render(
      <UnlockedVaultView
        {...mockProps}
        currentVault={vaultWithEntries}
        currentPath={[]}
        entries={[dataEntry]}
      />,
      { wrapper: Wrapper }
    );

    // Click the entry in the tree to open the mobile sidebar
    fireEvent.click(screen.getByText('Error Entry'));
    expect(screen.getByText('Entry Details')).toBeInTheDocument();

    // Click "Edit" in the mobile sidebar overlay (second Edit button)
    const editButtons = screen.getAllByText('Edit');
    expect(editButtons.length).toBeGreaterThanOrEqual(2);
    fireEvent.click(editButtons[1]);

    // Wait for Save button and click it
    await waitFor(() => {
      expect(screen.getAllByText('Save').length).toBeGreaterThanOrEqual(1);
    });
    const saveButtons = screen.getAllByText('Save');
    fireEvent.click(saveButtons[0]);

    // The mobile-save-error banner should appear with the error message
    const errorBanner = await screen.findByTestId('mobile-save-error');
    expect(errorBanner).toBeInTheDocument();
    expect(errorBanner).toHaveTextContent(/Entry not found/);

    // Click Dismiss and the banner should disappear
    const dismissButton = within(errorBanner).getByLabelText('Dismiss');
    fireEvent.click(dismissButton);
    expect(screen.queryByTestId('mobile-save-error')).not.toBeInTheDocument();

    updateByIdSpy.mockRestore();
  });

  it('refreshes the sidebar with the updated entry after a successful save', async () => {
    const { VaultManager, VaultInstance } = await import('../../../services/vault');
    const { setVaultEntries } = await import('../../../redux/actions/vault');

    const dataEntry: import('../../../interfaces/vault.interface').DataEntry = {
      id: 'entry-refresh',
      entry_type: 'entry',
      name: 'Original Entry',
      data_type: 'login',
      fields: [
        {
          title: 'Username',
          property: 'text',
          value: 'original-user',
          secret: false,
        },
      ],
      tags: [],
      created_at: '2025-01-01T00:00:00Z',
      updated_at: '2025-01-01T00:00:00Z',
    };

    const vaultWithEntries = {
      ...mockVault,
      volatile: {
        ...mockVault.volatile,
        entries: [dataEntry],
        credential: 'test-password',
      },
    };

    const store = configureStore({
      reducer: { vault: vaultReducer },
      preloadedState: {
        vault: {
          vaults: [vaultWithEntries],
          currentVaultId: vaultWithEntries.id,
          loading: false,
          error: null,
          providers: [],
          defaultProvider: null,
          providerStatus: {},
          oauthState: {
            providerName: null,
            authUrl: null,
            state: null,
            isOpen: false,
          },
        },
      },
    });
    VaultManager.getInstance().initialize(store.dispatch, store.getState);

    // Mock updateEntryById to actually update the store
    const updatedEntry = {
      ...dataEntry,
      name: 'Updated Entry',
      fields: [
        {
          title: 'Username',
          property: 'text',
          value: 'new-user',
          secret: false,
        },
      ],
    };

    const spy = jest
      .spyOn(VaultInstance.prototype, 'updateEntryById')
      .mockImplementation(async () => {
        store.dispatch(
          setVaultEntries({
            vaultId: vaultWithEntries.id,
            entries: [updatedEntry],
          })
        );
      });

    const Wrapper = ({ children }: { children: React.ReactNode }) => (
      <Provider store={store}>
        <I18nextProvider i18n={i18n}>
          <VaultModalProvider>{children}</VaultModalProvider>
        </I18nextProvider>
      </Provider>
    );

    const { rerender } = render(
      <UnlockedVaultView
        {...mockProps}
        currentVault={vaultWithEntries}
        currentPath={[]}
        entries={[dataEntry]}
      />,
      { wrapper: Wrapper }
    );

    // Click the entry to select it
    fireEvent.click(screen.getByText('Original Entry'));
    expect(screen.getByText('Entry Details')).toBeInTheDocument();

    // Click "Edit" in the mobile sidebar overlay (second Edit button)
    const editButtons = screen.getAllByText('Edit');
    expect(editButtons.length).toBeGreaterThanOrEqual(2);
    fireEvent.click(editButtons[1]);

    // Wait for edit mode: the input with the current field value should appear
    // (two sidebars render — desktop hidden, mobile visible — so use the second one)
    await waitFor(() => {
      expect(screen.getAllByDisplayValue('original-user').length).toBeGreaterThanOrEqual(2);
    });

    // Change the field value in the mobile sidebar's input (second one)
    const valueInputs = screen.getAllByDisplayValue('original-user');
    fireEvent.change(valueInputs[1], {
      target: { value: 'new-user' },
    });

    // Click Save in the mobile sidebar (second Save button)
    await waitFor(() => {
      expect(screen.getAllByText('Save').length).toBeGreaterThanOrEqual(2);
    });
    fireEvent.click(screen.getAllByText('Save')[1]);

    // Wait for the save to complete and the component to switch to view mode
    await waitFor(() => {
      expect(spy).toHaveBeenCalled();
    });

    // Simulate the parent re-rendering with updated vault data (as the store would trigger)
    const updatedVault = {
      ...vaultWithEntries,
      volatile: {
        ...vaultWithEntries.volatile,
        entries: [updatedEntry],
      },
    };
    rerender(
      <UnlockedVaultView
        {...mockProps}
        currentVault={updatedVault}
        currentPath={[]}
        entries={[updatedEntry]}
      />
    );

    // After save + re-render: sidebar should show the updated entry name
    await waitFor(() => {
      expect(screen.getAllByText('Updated Entry').length).toBeGreaterThanOrEqual(2);
    });

    spy.mockRestore();
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
