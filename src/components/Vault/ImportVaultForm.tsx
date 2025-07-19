import { useState } from 'react';
import { useDispatch } from 'react-redux';
import { open } from '@tauri-apps/plugin-dialog';
import { invoke } from '@tauri-apps/api/core';
import { addVault, Vault } from '../../redux/actions/vault';

interface ImportVaultFormProps {
  onSuccess: () => void;
  onCancel: () => void;
}

export const ImportVaultForm = ({ onSuccess, onCancel }: ImportVaultFormProps) => {
  const dispatch = useDispatch();
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

  const handleImportVault = async () => {
    if (!filePath || !password) {
      setError("Please select a vault file and enter the password");
      return;
    }

    setError("");
    setLoading(true);
    
    try {
      // Try to open the vault to verify the password is correct
      await invoke("open_vault", { filePath, password });
      
      const finalVaultName = vaultName || extractVaultNameFromPath(filePath);
      
      const newVault: Vault = {
        id: generateVaultId(),
        name: finalVaultName,
        path: filePath,
        lastAccessed: new Date(),
        isLocked: false,
      };

      dispatch(addVault(newVault));
      onSuccess();
    } catch (err) {
      console.error("Error importing vault:", err);
      setError("Failed to import vault. Please check the file path and password.");
    } finally {
      setLoading(false);
    }
  };

  const handleSelectFile = async () => {
    try {
      const result = await open({
        multiple: false,
        directory: false,
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
      setError("Failed to open file dialog");
    }
  };

  return (
    <div className="space-y-4">
      <h3 className="font-bold text-lg">Import Existing Vault</h3>
      
      <div className="form-control">
        <label className="label">
          <span className="label-text">Vault Name (Optional)</span>
        </label>
        <input
          type="text"
          placeholder="Enter custom vault name..."
          className="input input-bordered"
          value={vaultName}
          onChange={(e) => setVaultName(e.target.value)}
        />
        <label className="label">
          <span className="label-text-alt">Leave empty to use filename</span>
        </label>
      </div>

      <div className="form-control">
        <label className="label">
          <span className="label-text">Vault File</span>
        </label>
        <div className="join">
          <input
            type="text"
            placeholder="Select vault file..."
            className="input input-bordered join-item flex-1"
            value={filePath}
            onChange={(e) => setFilePath(e.target.value)}
            readOnly
          />
          <button 
            className="btn join-item"
            onClick={handleSelectFile}
            type="button"
          >
            Browse
          </button>
        </div>
      </div>

      <div className="form-control">
        <label className="label">
          <span className="label-text">Password</span>
        </label>
        <input
          type="password"
          placeholder="Enter vault password..."
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
          onClick={handleImportVault}
          disabled={loading || !filePath}
        >
          {loading ? (
            <>
              <span className="loading loading-spinner loading-sm"></span>
              Importing...
            </>
          ) : (
            'Import Vault'
          )}
        </button>
        <button 
          className="btn"
          onClick={onCancel}
          disabled={loading}
        >
          Cancel
        </button>
      </div>
    </div>
  );
};
