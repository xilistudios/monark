import { Link } from '@tanstack/react-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useDispatch, useSelector } from 'react-redux';
import {
  setCurrentVault,
  updateLastAccessed,
  removeVault,
  deleteVault,
  type Vault,
} from '../../redux/actions/vault';
import type { RootState } from '../../redux/store';
import { useContext } from 'react';
import { VaultModalContext } from './VaultContext';

const VaultSelector = ({
  onAddVault,
  onDeleteVault,
}: {
  onAddVault: () => void;
  onDeleteVault: (vault: Vault) => void;
}) => {
  const { t } = useTranslation('home');
  const dispatch = useDispatch();
  const vaults = useSelector((state: RootState) => state.vault.vaults);
  const currentVaultId = useSelector(
    (state: RootState) => state.vault.currentVaultId
  );
  const loading = useSelector((state: RootState) => state.vault.loading);
  const error = useSelector((state: RootState) => state.vault.error);
  const context = useContext(VaultModalContext);

  const handleVaultSelect = (vault: Vault) => {
    dispatch(setCurrentVault(vault.id));
    dispatch(updateLastAccessed(vault.id));
  };

  const handleEditVault = (vault: Vault) => {
    if (context) {
      // Set the current vault as the one being edited
      dispatch(setCurrentVault(vault.id));
      context.openEditVaultModal();
    }
  };

  const handleDeleteVault = (vault: Vault) => {
    onDeleteVault(vault);
  };

  const handleCloseModal = () => {
    // This function is no longer needed as delete modal is handled in Home.tsx
  };

  const formatLastAccessed = (dateStr?: string) => {
    if (!dateStr) return t('vaultSelector.never');
    const date = new Date(dateStr);
    return isNaN(date.getTime())
      ? t('vaultSelector.never')
      : date.toLocaleDateString();
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full w-full">
        <span className="loading loading-spinner loading-md text-primary"></span>
      </div>
    );
  }

  return (
    <div className="h-full w-full">
      <div className="flex p-2">
        <div className="dropdown">
          <div
            tabIndex={0}
            role="button"
            className="btn btn-outline btn-sm touch-manipulation"
          >
            •••
          </div>
          <ul
            tabIndex={0}
            className="dropdown-content z-[1] menu p-2 shadow bg-base-100 rounded-box w-52 max-w-[calc(100vw-2rem)]"
          >
            <li>
              <a onClick={onAddVault}>{t('vaultSelector.addVault')}</a>
            </li>
            <li>
              <Link to="/settings">{t('vaultSelector.settings')}</Link>
            </li>
          </ul>
        </div>
      </div>
      {error && (
        <div className="alert alert-error mx-2 mb-2">
          <span>{error}</span>
        </div>
      )}
      {vaults.length === 0 && (
        <div className="text-center p-4">
          <div className="text-base-content opacity-60 mb-2">
            {t('vaultSelector.noVaults')}
          </div>
          <div className="text-sm text-base-content opacity-40">
            {t('vaultSelector.emptyState')}
          </div>
        </div>
      )}
      <ul className="menu rounded-box h-full w-full p-2 overflow-y-auto">
        {vaults.map((vault) => (
          <li key={vault.id} className="w-full">
            <div className="flex items-center justify-between w-full gap-1">
              <a
                className={`flex-1 flex flex-col items-start p-3 min-w-0 ${
                  currentVaultId === vault.id ? 'menu-active' : ''
                }`}
                onClick={() => handleVaultSelect(vault)}
              >
                <div className="flex items-center justify-between w-full min-w-0">
                  <span className="font-medium truncate flex-1 mr-2">
                    {vault.name}
                  </span>
                  {vault.isLocked ? (
                    <span
                      className="flex items-center gap-1 flex-shrink-0"
                      aria-label={t('vaultSelector.locked', 'Locked')}
                    >
                      <svg
                        className="w-4 h-4 text-warning"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
                        />
                      </svg>
                      <span className="text-warning text-xs hidden sm:inline">
                        {t('vaultSelector.locked', 'Locked')}
                      </span>
                    </span>
                  ) : (
                    <span
                      className="flex items-center gap-1 flex-shrink-0"
                      aria-label={t('vaultSelector.unlocked', 'Unlocked')}
                    >
                      <svg
                        className="w-4 h-4 text-success"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M5 13l4 4L19 7"
                        />
                      </svg>
                      <span className="text-success text-xs hidden sm:inline">
                        {t('vaultSelector.unlocked', 'Unlocked')}
                      </span>
                    </span>
                  )}
                </div>
                <div className="text-xs mt-1 truncate w-full">
                  {t('vaultSelector.lastAccessed')}:{' '}
                  {formatLastAccessed(vault.lastAccessed)}
                </div>
                <div className="text-xs truncate w-full" title={vault.path}>
                  {vault.path}
                </div>
              </a>
              <div className="dropdown dropdown-end">
                <div
                  tabIndex={0}
                  role="button"
                  className="btn btn-ghost btn-sm min-h-[36px] h-[36px] px-2 touch-manipulation"
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    className="h-4 w-4"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth="2"
                      d="M5 12h.01M12 12h.01M19 12h.01"
                    />
                  </svg>
                </div>
                <ul
                  tabIndex={0}
                  className="dropdown-content z-[1] menu p-2 shadow bg-base-100 rounded-box w-52 max-w-[calc(100vw-2rem)] dropdown-end"
                >
                  <li>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleEditVault(vault);
                      }}
                    >
                      {t('edit', 'Edit')}
                    </button>
                  </li>
                  <li>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDeleteVault(vault);
                      }}
                    >
                      {t('delete', 'Delete')}
                    </button>
                  </li>
                </ul>
              </div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
};

export default VaultSelector;
