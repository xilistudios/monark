import { useState } from 'react';
import { useDispatch } from 'react-redux';
import { useTranslation } from 'react-i18next';
import { open } from '@tauri-apps/plugin-dialog';
import { invoke } from '@tauri-apps/api/core';
import { addVault, Vault } from '../../redux/actions/vault';

interface AddVaultFormProps {
  onSuccess: () => void;
  onCancel: () => void;
}

export const AddVaultForm = ({ onSuccess, onCancel }: AddVaultFormProps) => {
  const dispatch = useDispatch();
  const { t } = useTranslation('home');
  const [filePath, setFilePath] = useState("");
  const [password, setPassword] = useState("");
  const [vaultName, setVaultName] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const generateVaultId = () => {
    return crypto.randomUUID();
  };

  const extractVaultNameFromPath = (path: string) => {
    const fileName = path.split('/').pop() || '';
    return fileName.replace('.monark', '');
  };

  const handleCreateVault = async () => {
    if (!filePath || !password || !vaultName) {
      setError(t('errors.missingFields'));
      return;
    }

    setError("");
    setLoading(true);
    
    try {
    const path = `${filePath}/${vaultName}.monark`;
      await invoke("create_vault", { filePath: path, password });
      
      const newVault: Vault = {
        id: generateVaultId(),
        name: vaultName,
        path,
        lastAccessed: new Date().toISOString(),
        isLocked: false,
      };

      dispatch(addVault(newVault));
      onSuccess();
    } catch (err) {
      console.error("Error creating vault:", err);
      setError(String(err));
    } finally {
      setLoading(false);
    }
  };

  const handleSelectFile = async () => {
    try {
      const result = await open({
        multiple: false,
        directory: true,
        filters: [{ name: "Monark Vault", extensions: ["monark"] }],
      });
      
      if (result) {
        setFilePath(result);
        // Auto-generate vault name from file path if not already set
        if (!vaultName) {
          setVaultName(extractVaultNameFromPath(result));
        }
      }
    } catch (err) {
      console.error("Error selecting file:", err);
      setError(t('addVault.errors.fileDialog'));
    }
  };

  return (
    <div className="space-y-4">
      <h3 className="font-bold text-lg">{t('addVault.title')}</h3>
      
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
          />
          <button 
            className="btn join-item"
            onClick={handleSelectFile}
            type="button"
          >
            {t('addVault.browse')}
          </button>
        </div>
      </div>

      <div className="form-control">
        <label className="label">
          <span className="label-text">{t('addVault.password')}</span>
        </label>
        <input
          type="password"
          placeholder={t('addVault.passwordPlaceholder')}
          className="input input-bordered"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
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
          onClick={handleCreateVault}
          disabled={loading}
        >
          {loading ? (
            <>
              <span className="loading loading-spinner loading-sm"></span>
              {t('addVault.creating')}
            </>
          ) : (
            t('addVault.createVault')
          )}
        </button>
        <button 
          className="btn"
          onClick={onCancel}
          disabled={loading}
        >
          {t('addVault.cancel')}
        </button>
      </div>
    </div>
  );
};
