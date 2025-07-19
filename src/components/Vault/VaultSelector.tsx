import { useSelector, useDispatch } from 'react-redux';
import { RootState } from '../../redux/store';
import { setCurrentVault, updateLastAccessed, Vault } from '../../redux/actions/vault';

import { Modal } from '../UI/Modal';
import { VaultTabs } from './VaultTabs';
import { useState } from 'react';
const VaultSelector = () => {
    const dispatch = useDispatch();
    const { savedVaults, currentVault, loading } = useSelector((state: RootState) => state.vault);
    const [modalOpen, setModalOpen] = useState(false);
    const handleVaultSelect = (vault: Vault) => {
        dispatch(setCurrentVault(vault));
        dispatch(updateLastAccessed(vault.id));
    };

    const formatLastAccessed = (date?: Date) => {
        if (!date) return 'Never';
        return date.toLocaleDateString();
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center h-full w-full">
                <span className="loading loading-spinner loading-md"></span>
            </div>
        );
    }

    if (savedVaults.length === 0) {
        return (
            <div className="flex flex-col items-center justify-center h-full w-full p-4 text-center">
                <div className="text-base-content/60 mb-2">No vaults found</div>
                <div className="text-sm text-base-content/40">Create a new vault to get started</div>
                <hr />
                <button className="btn" onClick={() => setModalOpen(true)}>Add Vault</button>
                <Modal isOpen={modalOpen} onClose={() => setModalOpen(false)}>
                    <VaultTabs
                        onSuccess={() => setModalOpen(false)}
                        onCancel={() => setModalOpen(false)}
                    />
                </Modal>
            </div>
        );
    }

    return (
        <div className="h-full w-full">
            <div className="p-2">
                <button
                    className="btn btn-outline btn-sm w-full"
                    onClick={() => setModalOpen(true)}
                >
                    Add New Vault
                </button>
            </div>
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
                                {vault.isLocked && (
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
                                )}
                            </div>
                            <div className="text-xs text-base-content/60 mt-1">
                                Last accessed: {formatLastAccessed(vault.lastAccessed)}
                            </div>
                            <div className="text-xs text-base-content/40 truncate w-full">
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