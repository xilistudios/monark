// Import necessary types from vault.interface
/**
 * Vault interface for toolbar props (matches Home.tsx)
 */
interface Vault {
  id: string;
  volatile: {
    navigationPath?: string;
    entries: any[];
  };
}

/**
 * VaultToolbar component for displaying the toolbar header in the vault manager.
 *
 * @param {Object} props - Component props
 * @param {Vault} props.currentVault - Current vault object
 * @param {string[]} props.currentPath - Current navigation path
 * @param {Function} props.handleLockVault - Function to handle vault locking
 * @param {Function} props.t - Translation function
 * @param {boolean} props.isSearchActive - Whether search is currently active
 * @param {Function} props.setIsSearchActive - Function to set search active state
 * @param {Function} props.onSearchToggle - Function to toggle search modal
 */
import { useContext } from 'react';
import { VaultModalContext } from './VaultContext';

/**
 * VaultToolbar component for displaying the toolbar header in the vault manager.
 *
 * @param {Object} props - Component props
 * @param {Vault} props.currentVault - Current vault object
 * @param {string[]} props.currentPath - Current navigation path
 * @param {Function} props.handleLockVault - Function to handle vault locking
 * @param {Function} props.t - Translation function
 * @param {Function} props.onSearchToggle - Function to toggle search modal
 */
const VaultToolbar = ({
  currentPath,
  handleLockVault,
  t,
  onSearchToggle,
}: {
  currentVault: Vault;
  currentPath: string[];
  handleLockVault: () => void;
  t: (key: string) => string;
  onSearchToggle: () => void;
}) => {
  const context = useContext(VaultModalContext);
  if (!context)
    throw new Error(
      'VaultModalContext must be used within a VaultModalProvider'
    );
  const { openAddEntryModal, openAddGroupModal, openImportCsvModal } = context;

  return (
    <div className="flex items-center justify-between p-4 border-b border-base-300">
      <div className="flex items-center gap-2">
        <button
          className="btn btn-primary btn-sm"
          onClick={() => openAddEntryModal(currentPath)}
        >
          {t('vault.manager.addEntry')}
        </button>
        <button
          className="btn btn-outline btn-sm"
          onClick={() => openAddGroupModal(currentPath)}
        >
          {t('vault.manager.addGroup')}
        </button>
        <button
          className="btn btn-accent btn-sm"
          onClick={() => openImportCsvModal(currentPath)}
        >
          {t('vault.manager.importCsv')}
        </button>
        <button className="btn btn-ghost btn-sm" onClick={handleLockVault}>
          {t('vault.manager.lock')}
        </button>
      </div>
      <div className="flex items-center">
        <button
          className={`btn btn-ghost btn-sm`}
          onClick={onSearchToggle}
          aria-label={t('vault.manager.search')}
        >
          <svg
            className="w-5 h-5"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
            />
          </svg>
        </button>
      </div>
    </div>
  );
};

export default VaultToolbar;
