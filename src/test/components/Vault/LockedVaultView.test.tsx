import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LockedVaultView } from '../../../components/Vault/LockedVaultView';

// Mock the translation hook
jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

describe('LockedVaultView', () => {
  const defaultProps = {
    currentVault: {
      id: 'test-vault-1',
      name: 'Test Vault',
    },
    password: '',
    setPassword: jest.fn(),
    handleUnlockVault: jest.fn(),
    unlockError: '',
    loading: false,
    t: (key: string) => key,
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders correctly for local vault', () => {
    render(<LockedVaultView {...defaultProps} />);

    expect(screen.getByText('vault.unlock.title')).toBeInTheDocument();
    expect(screen.getByText(/Test Vault/)).toBeInTheDocument();
    expect(screen.getByPlaceholderText('vault.unlock.passwordPlaceholder')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'vault.unlock.unlockButton' })).toBeInTheDocument();
  });

  it('renders cloud badge for cloud vaults', () => {
    const cloudVaultProps = {
      ...defaultProps,
      currentVault: {
        ...defaultProps.currentVault,
        isCloudVault: true,
      },
    };

    render(<LockedVaultView {...cloudVaultProps} />);

    expect(screen.getByText('Cloud')).toBeInTheDocument();
    expect(screen.getByText('This vault is stored in the cloud. It will be downloaded when unlocked.')).toBeInTheDocument();
  });

  it('does not render cloud badge for local vaults', () => {
    render(<LockedVaultView {...defaultProps} />);

    expect(screen.queryByText('Cloud')).not.toBeInTheDocument();
    expect(screen.queryByText('This vault is stored in the cloud')).not.toBeInTheDocument();
  });

  it('shows cloud unlock message when provided', () => {
    const propsWithCloudMessage = {
      ...defaultProps,
      cloudUnlockMessage: 'Downloading from cloud...',
    };

    render(<LockedVaultView {...propsWithCloudMessage} />);

    expect(screen.getByText('Downloading from cloud...')).toBeInTheDocument();
  });

  it('does not show cloud unlock message when not provided', () => {
    render(<LockedVaultView {...defaultProps} />);

    expect(screen.queryByText('Downloading from cloud')).not.toBeInTheDocument();
  });

  it('calls setPassword when password input changes', async () => {
    const user = userEvent.setup();
    render(<LockedVaultView {...defaultProps} />);

    const passwordInput = screen.getByPlaceholderText('vault.unlock.passwordPlaceholder');
    await user.type(passwordInput, 'test-password');

    expect(defaultProps.setPassword).toHaveBeenCalledWith('test-password');
  });

  it('calls handleUnlockVault when unlock button is clicked', async () => {
    const user = userEvent.setup();
    const propsWithPassword = {
      ...defaultProps,
      password: 'test-password',
    };

    render(<LockedVaultView {...propsWithPassword} />);

    const unlockButton = screen.getByRole('button', { name: 'vault.unlock.unlockButton' });
    await user.click(unlockButton);

    expect(defaultProps.handleUnlockVault).toHaveBeenCalled();
  });

  it('calls handleUnlockVault when Enter key is pressed in password field', async () => {
    const user = userEvent.setup();
    const propsWithPassword = {
      ...defaultProps,
      password: 'test-password',
    };

    render(<LockedVaultView {...propsWithPassword} />);

    const passwordInput = screen.getByPlaceholderText('vault.unlock.passwordPlaceholder');
    await user.type(passwordInput, '{Enter}');

    expect(defaultProps.handleUnlockVault).toHaveBeenCalled();
  });

  it('disables unlock button when loading', () => {
    const loadingProps = {
      ...defaultProps,
      loading: true,
      password: 'test-password',
    };

    render(<LockedVaultView {...loadingProps} />);

    const unlockButton = screen.getByRole('button', { name: /vault.unlock.unlocking/ });
    expect(unlockButton).toBeDisabled();
  });

  it('disables unlock button when password is empty', () => {
    render(<LockedVaultView {...defaultProps} />);

    const unlockButton = screen.getByRole('button', { name: 'vault.unlock.unlockButton' });
    expect(unlockButton).toBeDisabled();
  });

  it('enables unlock button when password is provided and not loading', () => {
    const propsWithPassword = {
      ...defaultProps,
      password: 'test-password',
    };

    render(<LockedVaultView {...propsWithPassword} />);

    const unlockButton = screen.getByRole('button', { name: 'vault.unlock.unlockButton' });
    expect(unlockButton).not.toBeDisabled();
  });

  it('shows loading spinner when loading', () => {
    const loadingProps = {
      ...defaultProps,
      loading: true,
    };

    render(<LockedVaultView {...loadingProps} />);

    expect(screen.getByRole('status')).toBeInTheDocument(); // loading spinner
  });

  it('shows unlock error when provided', () => {
    const propsWithError = {
      ...defaultProps,
      unlockError: 'Invalid password',
    };

    render(<LockedVaultView {...propsWithError} />);

    expect(screen.getByText('Invalid password')).toBeInTheDocument();
  });

  it('shows cloud unlock message instead of generic loading text for cloud vaults', () => {
    const cloudVaultLoadingProps = {
      ...defaultProps,
      currentVault: {
        ...defaultProps.currentVault,
        isCloudVault: true,
      },
      loading: true,
      cloudUnlockMessage: 'Downloading from cloud...',
    };

    render(<LockedVaultView {...cloudVaultLoadingProps} />);

    expect(screen.getByText('Downloading from cloud...')).toBeInTheDocument();
    expect(screen.getByRole('status')).toBeInTheDocument(); // loading spinner
  });

  it('shows generic loading text for local vaults when loading', () => {
    const localVaultLoadingProps = {
      ...defaultProps,
      loading: true,
    };

    render(<LockedVaultView {...localVaultLoadingProps} />);

    expect(screen.getByText('vault.unlock.unlocking')).toBeInTheDocument();
    expect(screen.getByRole('status')).toBeInTheDocument(); // loading spinner
  });

  it('returns null when currentVault is null', () => {
    const propsWithoutVault = {
      ...defaultProps,
      currentVault: null,
    };

    const { container } = render(<LockedVaultView {...propsWithoutVault} />);
    expect(container.firstChild).toBeNull();
  });

  it('shows both cloud message and unlock error when both are provided', () => {
    const propsWithBoth = {
      ...defaultProps,
      currentVault: {
        ...defaultProps.currentVault,
        isCloudVault: true,
      },
      cloudUnlockMessage: 'Downloading from cloud...',
      unlockError: 'Invalid password',
    };

    render(<LockedVaultView {...propsWithBoth} />);

    expect(screen.getByText('Downloading from cloud...')).toBeInTheDocument();
    expect(screen.getByText('Invalid password')).toBeInTheDocument();
  });

  it('applies fade-in animation classes', () => {
    render(<LockedVaultView {...defaultProps} />);
    const container = screen.getByTestId('locked-vault-view');
    expect(container).toHaveClass('transition-opacity', 'duration-300', 'opacity-100');
  });
});