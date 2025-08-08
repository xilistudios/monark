import { open } from "@tauri-apps/plugin-dialog";
import * as path from '@tauri-apps/api/path';
import { useMemo, useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useDispatch } from 'react-redux';
import { addVault, updateVault, type Vault } from '../../redux/actions/vault';
import VaultCommands from '../../services/commands';
import { isMobile } from '../../utils/platform';

interface AddVaultFormProps {
  onSuccess: () => void;
  onCancel: () => void;
  vault?: Vault;
}

export const AddVaultForm = ({ onSuccess, onCancel, vault }: AddVaultFormProps) => {
  const dispatch = useDispatch();
  const { t } = useTranslation('home');
  const [filePath, setFilePath] = useState('');
  const [password, setPassword] = useState('');
  const [vaultName, setVaultName] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const mobile = useMemo(() => isMobile(), []);
  const isEditMode = !!vault;

  // Prefill form when editing
  useEffect(() => {
    if (vault) {
      setVaultName(vault.name);
      setFilePath(vault.path);
    }
  }, [vault]);

  const generateVaultId = () => {
    return crypto.randomUUID();
  };

  const extractVaultNameFromPath = (path: string) => {
    const fileName = path.split('/').pop() || '';
    return fileName.replace('.monark', '');
  };

  const handleCreateVault = async () => {
    if (!password || !vaultName) {
      setError(t('errors.missingFields'));
      return;
    }

    setError('');
    setLoading(true);

    try {
      const filepath = await path.join(
        filePath || (await path.appDataDir()),
        `${vaultName}.monark`
      );
      const initialContent = {
        updated_at: new Date().toISOString(),
        hmac: '',
        entries: [],
      };
      await VaultCommands.write(filepath, password, initialContent);

      const newVault: Vault = {
        id: generateVaultId(),
        name: vaultName,
        path: filepath,
        lastAccessed: new Date().toISOString(),
        isLocked: false,
        volatile: {
          credential: password,
          entries: [],
          navigationPath: '/',
          encryptedData: undefined,
        },
      };

      dispatch(addVault(newVault));
      onSuccess();
    } catch (err) {
      console.error('Error creating vault:', err);
      setError(String(err));
    } finally {
      setLoading(false);
    }
  };

  const handleUpdateVault = async () => {
    if (!vault || !vaultName) {
      setError(t('errors.missingFields'));
      return;
    }

    // Prevent password updates when vault is locked
    if (vault.isLocked && password) {
      setError(t('editVault.errors.vaultLocked'));
      return;
    }

    setError('');
    setLoading(true);

    try {
      // Only update password if new value is provided
      if (password) {
        try {
          const credential = vault.volatile?.credential || '';
          if (!credential) {
            throw new Error('Vault credential is missing');
          }
          const vaultContent = await VaultCommands.read(vault.path, credential);
          await VaultCommands.write(vault.path, password, vaultContent);
        } catch (err) {
          console.error('Error accessing vault credentials:', err);
          setError(t('errors.unlockFailed') || 'Failed to access vault credentials');
          setLoading(false);
          return;
        }
      }

      const updatedVault: Vault = {
        ...vault,
        name: vaultName,
        path: filePath || vault.path, // Preserve existing path if not changed
        volatile: {
          ...vault.volatile,
          credential: password || vault.volatile.credential, // Use new password or keep existing
        },
      };

      dispatch(updateVault(updatedVault));
      onSuccess();
    } catch (err) {
      console.error('Error updating vault:', err);
      setError(String(err));
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async () => {
    if (isEditMode) {
      await handleUpdateVault();
    } else {
      await handleCreateVault();
    }
  };

  const handleSelectFile = async () => {
    try {
      const result = await open({
        multiple: false,
        directory: true,
        filters: [{ name: 'Monark Vault', extensions: ['monark'] }],
      });

      if (result) {
        setFilePath(result);
        // Auto-generate vault name from file path if not already set
        if (!vaultName && !isEditMode) {
          setVaultName(extractVaultNameFromPath(result));
        }
      }
    } catch (err) {
      console.error('Error selecting file:', err);
      setError(t('addVault.errors.fileDialog'));
    }
  };

  return (
    <div className="space-y-4 p-4">
      <h3 className="font-bold text-lg">{isEditMode ? t('editVault.title') : t('addVault.title')}</h3>

      <div className="form-control">
        <label className="label">
          <span className="label-text">{t('addVault.name')}</span>
        </label>
        <input
          type="text"
          placeholder={t('addVault.namePlaceholder')}
          className="input input-bordered"
          value={vaultName}
          onChange={(e) => setVaultName(e.target.value)}
        />
      </div>
      {!mobile && (
        <div className="form-control">
          <label className="label">
            <span className="label-text">{t('addVault.filePath')}</span>
          </label>
          <div className="join">
            <input
              type="text"
              placeholder={t('addVault.filePathPlaceholder')}
              className="input input-bordered join-item flex-1"
              value={filePath}
              onChange={(e) => setFilePath(e.target.value)}
              disabled={isEditMode} // Disable file path editing in edit mode
            />
            {!isEditMode && (
              <button
                className="btn join-item"
                onClick={handleSelectFile}
                type="button"
              >
                {t('addVault.browse')}
              </button>
            )}
          </div>
          {isEditMode && (
            <div className="text-xs text-base-content opacity-60 mt-1">
              {t('editVault.filePathHelp')}
            </div>
          )}
        </div>
      )}

      {isEditMode && vault?.isLocked && (
        <div className="alert alert-warning mb-4">
          <svg xmlns="http://www.w3.org/2000/svg" className="stroke-current shrink-0 h-6 w-6" fill="none" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
          <span>{t('editVault.errors.vaultLocked')}</span>
        </div>
      )}
      <div className="form-control">
        <label className="label">
          <span className="label-text">
            {isEditMode ? t('editVault.newPassword') : t('addVault.password')}
            {!isEditMode && ' *'}
          </span>
        </label>
        <input
          type="password"
          placeholder={isEditMode ? t('editVault.newPasswordPlaceholder') : t('addVault.passwordPlaceholder')}
          className="input input-bordered"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          disabled={isEditMode && vault?.isLocked}
        />
        {isEditMode && (
          <div className="text-xs text-base-content opacity-60 mt-1">
            {t('editVault.passwordHelp')}
          </div>
        )}
      </div>

      {error && (
        <div className="alert alert-error">
          <span>{JSON.stringify(error.toString())}</span>
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
              {isEditMode ? t('editVault.saving') : t('addVault.creating')}
            </>
          ) : (
            isEditMode ? t('editVault.save') : t('addVault.createVault')
          )}
        </button>
        <button className="btn" onClick={onCancel} disabled={loading}>
          {t('addVault.cancel')}
        </button>
      </div>
    </div>
  );
};
