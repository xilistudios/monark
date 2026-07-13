import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSelector } from 'react-redux';
import type { GroupEntry } from '../../../interfaces/vault.interface';
import type { RootState } from '../../../redux/store';
import { VaultManager } from '../../../services/vault';
import { Modal } from '../../UI/Modal';
import { useContext } from 'react';
import { VaultModalContext } from '../VaultContext';

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
      <div className="space-y-6">
        <div className="flex items-start gap-4">
          <div className="p-3 rounded-2xl bg-primary/10 text-primary">
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 13h6m-3-3v6m-9 1V7a2 2 0 012-2h6l2 2h6a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z" />
            </svg>
          </div>
          <div>
            <h3 className="font-bold text-xl text-base-content">{t('addGroup.title')}</h3>
            <p className="text-xs text-base-content/60 mt-1">
              {t('addGroup.description')}
            </p>
          </div>
        </div>

        <div className="form-control w-full flex flex-col gap-2">
          <label className="label py-0" htmlFor="new-group-name-input">
            <span className="label-text font-semibold text-sm text-base-content/85">{t('addGroup.name')} *</span>
          </label>
          <input
            id="new-group-name-input"
            type="text"
            placeholder={t('addGroup.namePlaceholder')}
            className="input input-bordered w-full"
            value={groupName}
            onChange={(e) => setGroupName(e.target.value)}
            onKeyPress={(e) => e.key === 'Enter' && handleSubmit()}
          />
        </div>

        {error && (
          <div className="alert alert-error py-2.5 text-sm">
            <span>{error}</span>
          </div>
        )}

        <div className="modal-action gap-2 mt-8">
          <button
            type="button"
            className="btn btn-primary flex-1 sm:flex-initial active:scale-95 transition-all duration-150"
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
          <button
            type="button"
            className="btn btn-ghost flex-1 sm:flex-initial active:scale-95 transition-all duration-150"
            onClick={handleCancel}
            disabled={loading}
          >
            {t('addGroup.cancel')}
          </button>
        </div>
      </div>
    </Modal>
  );
};
