import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSelector } from 'react-redux';
import type { GroupEntry } from '../../interfaces/vault.interface';
import type { RootState } from '../../redux/store';
import { VaultManager } from '../../services/vault';
import { Modal } from '../UI/Modal';
import { useContext } from 'react';
import { VaultModalContext } from './VaultContext';

/**
 * Modal component for adding a new group to the vault
 * Uses VaultModalContext to manage state and actions
 */
export const AddGroupModal = () => {
  const { t } = useTranslation('home');
  const currentVaultId = useSelector(
    (state: RootState) => state.vault.currentVaultId
  );
  const context = useContext(VaultModalContext);
  if (!context)
    throw new Error(
      'VaultModalContext must be used within a VaultModalProvider'
    );
  const {
    isAddGroupModalOpen,
    closeAddGroupModal,
    addGroupPath,
    addGroupOnSuccess,
  } = context;
  const [groupName, setGroupName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async () => {
    if (!groupName.trim()) {
      setError(t('addGroup.errors.nameRequired'));
      return;
    }

    setError('');
    setLoading(true);

    try {
      const newGroup: GroupEntry = {
        id: crypto.randomUUID(),
        entry_type: 'group',
        name: groupName.trim(),
        data_type: 'group',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        children: [],
      };

      // Use the current vault ID from Redux
      if (currentVaultId) {
        // Get the VaultInstance from VaultManager
        const vaultInstance =
          VaultManager.getInstance().getInstance(currentVaultId);
        if (vaultInstance) {
          // Add the entry using VaultManager
          await vaultInstance.addEntry(addGroupPath, newGroup);
        }
      }

      setGroupName('');
      addGroupOnSuccess?.();
      closeAddGroupModal();
    } catch (err) {
      console.error('Error adding group:', err);
      setError(t('addGroup.errors.addFailed'));
    } finally {
      setLoading(false);
    }
  };

  const handleCancel = () => {
    setGroupName('');
    setError('');
    closeAddGroupModal();
  };

  return (
    <Modal isOpen={isAddGroupModalOpen} onClose={handleCancel}>
      <div className="space-y-4">
        <h3 className="font-bold text-lg">{t('addGroup.title')}</h3>

        <div className="form-control">
          <label className="label">
            <span className="label-text">{t('addGroup.name')} *</span>
          </label>
          <input
            type="text"
            placeholder={t('addGroup.namePlaceholder')}
            className="input input-bordered"
            value={groupName}
            onChange={(e) => setGroupName(e.target.value)}
          />
        </div>

        {error && (
          <div className="alert alert-error">
            <span>{error}</span>
          </div>
        )}

        <div className="modal-action">
          <button
            className="btn btn-primary"
            onClick={handleSubmit}
            disabled={loading}
          >
            {loading ? (
              <>
                <span className="loading loading-spinner loading-sm"></span>
                {t('addGroup.adding')}
              </>
            ) : (
              t('addGroup.addGroup')
            )}
          </button>
          <button className="btn" onClick={handleCancel} disabled={loading}>
            {t('addGroup.cancel')}
          </button>
        </div>
      </div>
    </Modal>
  );
};
