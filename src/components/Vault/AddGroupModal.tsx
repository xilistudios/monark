import { useState } from 'react';
import { useDispatch } from 'react-redux';
import { useTranslation } from 'react-i18next';
import { addVaultEntry } from '../../redux/actions/vault';
import { GroupEntry } from '../../interfaces/vault.interface';
import { Modal } from '../UI/Modal';
import { AppDispatch } from '../../redux/store';

interface AddGroupModalProps {
  isOpen: boolean;
  onClose: () => void;
  parentId: string | null;
  onSuccess?: () => void;
}

export const AddGroupModal = ({ isOpen, onClose, parentId, onSuccess }: AddGroupModalProps) => {
  const dispatch = useDispatch<AppDispatch>();
  const { t } = useTranslation('home');
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
        children: [],
      };

      await dispatch(addVaultEntry({ parentId, newEntry: newGroup })).unwrap();
      
      setGroupName('');
      onSuccess?.();
      onClose();
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
    onClose();
  };

  return (
    <Modal isOpen={isOpen} onClose={handleCancel}>
      <div className="space-y-4">
        <h3 className="font-bold text-lg">{t('addGroup.title')}</h3>
        
        <div className="form-control">
          <label className="label">
            <span className="label-text">{t('addGroup.groupName')} *</span>
          </label>
          <input
            type="text"
            placeholder={t('addGroup.groupNamePlaceholder')}
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
          <button
            className="btn"
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