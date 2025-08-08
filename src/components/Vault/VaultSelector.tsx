import { Link } from '@tanstack/react-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useDispatch, useSelector } from 'react-redux';
import {
  setCurrentVault,
  updateLastAccessed,
  type Vault,
} from '../../redux/actions/vault';
import type { RootState } from '../../redux/store';

const VaultSelector = ({ onAddVault }: { onAddVault: () => void }) => {
  const { t } = useTranslation('home');
  const dispatch = useDispatch();
  const vaults = useSelector((state: RootState) => state.vault.vaults);
  const currentVaultId = useSelector(
    (state: RootState) => state.vault.currentVaultId
  );
  const loading = useSelector((state: RootState) => state.vault.loading);
  const [modalOpen, setModalOpen] = useState(false);
  const handleVaultSelect = (vault: Vault) => {
    dispatch(setCurrentVault(vault.id));
    dispatch(updateLastAccessed(vault.id));
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
          <div tabIndex={0} role="button" className="btn btn-outline btn-sm">
            •••
          </div>
          <ul
            tabIndex={0}
            className="dropdown-content z-[1] menu p-2 shadow bg-base-100 rounded-box w-52"
          >
            <li>
              <a onClick={onAddVault}>
                {t('vaultSelector.addVault')}
              </a>
            </li>
            <li>
              <Link to="/settings">{t('vaultSelector.settings')}</Link>
            </li>
          </ul>
        </div>
      </div>
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
      <ul className="menu rounded-box h-full w-full p-2">
        {vaults.map((vault) => (
          <li key={vault.id} className="w-full">
            <a
              className={`w-full flex flex-col items-start p-3 ${
                currentVaultId === vault.id ? 'menu-active' : ''
              }`}
              onClick={() => handleVaultSelect(vault)}
            >
              <div className="flex items-center justify-between w-full">
                <span className="font-medium">{vault.name}</span>
                {vault.isLocked ? (
                  <span
                    className="flex items-center gap-1"
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
                    <span className="text-warning text-xs">
                      {t('vaultSelector.locked', 'Locked')}
                    </span>
                  </span>
                ) : (
                  <span
                    className="flex items-center gap-1"
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
                    <span className="text-success text-xs">
                      {t('vaultSelector.unlocked', 'Unlocked')}
                    </span>
                  </span>
                )}
              </div>
              <div className="text-xs  mt-1">
                {t('vaultSelector.lastAccessed')}:{' '}
                {formatLastAccessed(vault.lastAccessed)}
              </div>
              <div className="text-xs truncate w-full">{vault.path}</div>
            </a>
          </li>
        ))}
      </ul>

    </div>
  );
};

export default VaultSelector;
