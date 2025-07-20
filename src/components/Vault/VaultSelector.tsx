import { useState } from 'react';
import { useSelector, useDispatch } from 'react-redux';
import { RootState } from '../../redux/store';
import { setCurrentVault, updateLastAccessed, Vault } from '../../redux/actions/vault';

import { Modal } from '../UI/Modal';
import { VaultTabs } from './VaultTabs';
import { Link } from '@tanstack/react-router';

import { useTranslation } from "react-i18next";

const VaultSelector = () => {
    const { t } = useTranslation("home");
    const dispatch = useDispatch();
    const { savedVaults, currentVault, loading } = useSelector((state: RootState) => state.vault);
    const [modalOpen, setModalOpen] = useState(false);
    const handleVaultSelect = (vault: Vault) => {
        dispatch(setCurrentVault(vault));
        dispatch(updateLastAccessed(vault.id));
    };

    const formatLastAccessed = (date?: Date) => {
        if (!date) return t("vaultSelector.never");
        return date.toLocaleDateString();
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center h-full w-full">
                <span className="loading loading-spinner loading-md"></span>
            </div>
        );
    }

    return (
        <div className="h-full w-full">
            <div className='flex p-2'>
                <div className="dropdown">
                    <div tabIndex={0} role="button" className="btn btn-outline btn-sm">
                        •••
                    </div>
                    <ul tabIndex={0} className="dropdown-content z-[1] menu p-2 shadow bg-base-100 rounded-box w-52">
                        <li><a onClick={() => setModalOpen(true)}>{t("vaultSelector.addVault")}</a></li>
                        <li>
                            <Link to="/settings">{t("vaultSelector.settings")}</Link>
                        </li>
                    </ul>
                </div>
            </div>
            {savedVaults.length === 0 && (
                <div className="text-center p-4">
                    <div className="text-base-content/60 mb-2">{t("vaultSelector.noVaults")}</div>
                    <div className="text-sm text-base-content/40">{t("vaultSelector.emptyState")}</div>
                </div>
            )}
            <ul className="menu rounded-box h-full w-full p-2">

                {savedVaults.map((vault) => (
                    <li key={vault.id}>
                        <a
                            className={`flex flex-col items-start p-3 ${currentVault?.id === vault.id ? 'menu-active' : ''
                                }`}
                            onClick={() => handleVaultSelect(vault)}
                        >
                            <div className="flex items-center justify-between w-full">
                                <span className="font-medium">{vault.name}</span>
                                {vault.isLocked ? (
                                    <span className="flex items-center gap-1" aria-label={t("vaultSelector.locked", "Locked")}>
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
                                        <span className="text-warning text-xs">{t("vaultSelector.locked", "Locked")}</span>
                                    </span>
                                ) : (
                                    <span className="flex items-center gap-1" aria-label={t("vaultSelector.unlocked", "Unlocked")}>
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
                                        <span className="text-success text-xs">{t("vaultSelector.unlocked", "Unlocked")}</span>
                                    </span>
                                )}
                            </div>
                            <div className="text-xs  mt-1">
                                {t("vaultSelector.lastAccessed")}: {formatLastAccessed(vault.lastAccessed)}
                            </div>
                            <div className="text-xs truncate w-full">
                                {vault.path}
                            </div>
                        </a>
                    </li>
                ))}
            </ul>

            <Modal isOpen={modalOpen} onClose={() => setModalOpen(false)}>
                <VaultTabs
                    onSuccess={() => setModalOpen(false)}
                    onCancel={() => setModalOpen(false)}
                />
            </Modal>
        </div>
    );
}

export default VaultSelector;