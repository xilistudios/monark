import { render, screen } from '@testing-library/react';
import UnlockedVaultView, {
  UnlockedVaultViewProps,
} from '../../../components/Vault/UnlockedVaultView';
import { VaultModalProvider } from '../../../components/Vault/VaultContext';

const mockVault = {
  id: 'vault1',
  volatile: {
    navigationPath: 'root',
    entries: [],
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
  return render(<VaultModalProvider>{ui}</VaultModalProvider>);
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
});
