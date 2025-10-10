import { open } from "@tauri-apps/plugin-dialog";
import * as path from '@tauri-apps/api/path';
import { useMemo, useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useDispatch, useSelector } from 'react-redux';
import { addVault, updateVault, type Vault } from '../../../redux/actions/vault';
import VaultCommands from '../../../services/commands';
import { VaultManager } from '../../../services/vault';
import { CloudStorageCommands } from '../../../services/cloudStorage';
import { isMobile } from '../../../utils/platform';
import type { RootState } from '../../../redux/store';
import type { StorageFile } from '../../../interfaces/cloud-storage.interface';

interface AddVaultFormProps {
  onSuccess: () => void;
  onCancel: () => void;
  vault?: Vault;
}

export const AddVaultForm = ({
  onSuccess,
  onCancel,
  vault,
}: AddVaultFormProps) => {
  const dispatch = useDispatch();
  const { t } = useTranslation('home');
  const [filePath, setFilePath] = useState('');
  const [password, setPassword] = useState('');
  const [vaultName, setVaultName] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [storageType, setStorageType] = useState<'local' | 'cloud'>('local');
  const [providerId, setProviderId] = useState<string>('');
  const [cloudFolderId, setCloudFolderId] = useState<string>(''); // Selected folder ID for cloud storage
  const [cloudFolders, setCloudFolders] = useState<StorageFile[]>([]); // Available folders
  const [loadingFolders, setLoadingFolders] = useState(false);
  const [currentFolderId, setCurrentFolderId] = useState<string | undefined>(
    undefined
  ); // For folder navigation
  const [folderBreadcrumbs, setFolderBreadcrumbs] = useState<
    Array<{ id: string; name: string }>
  >([{ id: '', name: 'Root' }]);
  const [showFolderSelector, setShowFolderSelector] = useState(false);
  const mobile = useMemo(() => isMobile(), []);
  const isEditMode = !!vault;

  // Get providers and their status from Redux
  const { providers, providerStatus } = useSelector((state: RootState) => ({
    providers: state.vault.providers,
    providerStatus: state.vault.providerStatus,
  }));

  // Filter to only show authenticated providers
  const authenticatedProviders = providers.filter(
    (provider) => providerStatus[provider.name] === 'authenticated'
  );

  // Prefill form when editing
  useEffect(() => {
    if (vault) {
      setVaultName(vault.name);
      setFilePath(vault.path);
      setStorageType(vault.storageType || 'local');
      setProviderId(vault.providerId || '');
    }
  }, [vault]);

  // Reset provider when switching storage type
  useEffect(() => {
    if (storageType === 'local') {
      setProviderId('');
      setCloudFolderId('');
      setCloudFolders([]);
      setCurrentFolderId(undefined);
      setFolderBreadcrumbs([{ id: '', name: 'Root' }]);
      setShowFolderSelector(false);
    }
  }, [storageType]);

  // Load folders when provider changes
  useEffect(() => {
    if (storageType === 'cloud' && providerId) {
      loadCloudFolders(undefined);
    }
  }, [providerId, storageType]);

  const loadCloudFolders = async (folderId: string | undefined) => {
    if (!providerId) return;

    setLoadingFolders(true);
    try {
      const response = await CloudStorageCommands.listFiles({
        folderId: folderId || undefined,
        providerName: providerId,
      });

      // Filter to only show folders
      const folders = response.files.filter((file) => file.isFolder);
      setCloudFolders(folders);
      setCurrentFolderId(folderId);
    } catch (error) {
      console.error('Failed to load cloud folders:', error);
      setError(
        t('vaultSelector.failedToLoadFolders', 'Failed to load folders')
      );
    } finally {
      setLoadingFolders(false);
    }
  };

  const navigateToFolder = async (folderId: string, folderName: string) => {
    await loadCloudFolders(folderId);

    // Update breadcrumbs
    const breadcrumbIndex = folderBreadcrumbs.findIndex(
      (b) => b.id === folderId
    );
    if (breadcrumbIndex >= 0) {
      // Navigate back to a parent folder
      setFolderBreadcrumbs(folderBreadcrumbs.slice(0, breadcrumbIndex + 1));
    } else {
      // Navigate to a child folder
      setFolderBreadcrumbs([
        ...folderBreadcrumbs,
        { id: folderId, name: folderName },
      ]);
    }
  };

  const selectFolder = (folderId: string) => {
    setCloudFolderId(folderId);
    setShowFolderSelector(false);
  };

  const getCurrentFolderName = (): string => {
    if (!cloudFolderId) return t('vaultSelector.rootFolder', 'Root Folder');
    const folder = cloudFolders.find((f) => f.id === cloudFolderId);
    return (
      folder?.name ||
      folderBreadcrumbs[folderBreadcrumbs.length - 1]?.name ||
      t('vaultSelector.selectedFolder', 'Selected Folder')
    );
  };

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

    // Additional validation for cloud storage
    if (storageType === 'cloud' && !providerId) {
      setError(t('vaultSelector.missingProvider'));
      return;
    }

    setError('');
    setLoading(true);

    try {
      let vaultId: string;

      if (storageType === 'cloud') {
        // Create cloud vault using VaultManager
        vaultId = await VaultManager.getInstance().createVault(
          vaultName,
          password,
          'cloud',
          providerId,
          undefined,
          cloudFolderId || undefined
        );
      } else {
        // Create local vault using VaultManager
        const filepath = await path.join(
          filePath || (await path.appDataDir()),
          `${vaultName}.monark`
        );
        vaultId = await VaultManager.getInstance().createVault(
          vaultName,
          password,
          'local',
          undefined,
          filepath
        );
      }

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
          setError(
            t('errors.unlockFailed') || 'Failed to access vault credentials'
          );
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
      <h3 className="font-bold text-lg">
        {isEditMode ? t('editVault.title') : t('addVault.title')}
      </h3>

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

      {/* Storage Location Selector - Only show in create mode */}
      {!isEditMode && (
        <div className="form-control">
          <label className="label">
            <span className="label-text">
              {t('vaultSelector.storageLocation')}
            </span>
          </label>
          <div className="flex gap-4">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="radio"
                name="storageType"
                className="radio radio-primary"
                checked={storageType === 'local'}
                onChange={() => setStorageType('local')}
              />
              <span>{t('vaultSelector.local')}</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="radio"
                name="storageType"
                className="radio radio-primary"
                checked={storageType === 'cloud'}
                onChange={() => setStorageType('cloud')}
              />
              <span>{t('vaultSelector.cloud')}</span>
            </label>
          </div>
        </div>
      )}

      {/* Cloud Provider Selector - Only show for cloud storage */}
      {!isEditMode && storageType === 'cloud' && (
        <>
          <div className="form-control">
            <label className="label">
              <span className="label-text">
                {t('vaultSelector.selectProvider')}
              </span>
            </label>
            {authenticatedProviders.length > 0 ? (
              <>
                <select
                  className="select select-bordered"
                  value={providerId}
                  onChange={(e) => setProviderId(e.target.value)}
                >
                  <option value="">{t('vaultSelector.selectProvider')}</option>
                  {authenticatedProviders.map((provider) => (
                    <option key={provider.name} value={provider.name}>
                      {provider.name} ({provider.provider_type})
                    </option>
                  ))}
                </select>

                {/* Cloud Folder Selector */}
                {providerId && (
                  <div className="mt-4">
                    <label className="label">
                      <span className="label-text">
                        {t(
                          'vaultSelector.destinationFolder',
                          'Destination Folder'
                        )}
                      </span>
                    </label>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        className="input input-bordered flex-1"
                        value={getCurrentFolderName()}
                        readOnly
                        placeholder={t(
                          'vaultSelector.selectFolder',
                          'Select a folder'
                        )}
                      />
                      <button
                        type="button"
                        className="btn btn-outline"
                        onClick={() =>
                          setShowFolderSelector(!showFolderSelector)
                        }
                        disabled={loadingFolders}
                      >
                        {loadingFolders ? (
                          <span className="loading loading-spinner loading-xs"></span>
                        ) : (
                          <svg
                            xmlns="http://www.w3.org/2000/svg"
                            fill="none"
                            viewBox="0 0 24 24"
                            strokeWidth={1.5}
                            stroke="currentColor"
                            className="w-5 h-5"
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              d="M2.25 12.75V12A2.25 2.25 0 014.5 9.75h15A2.25 2.25 0 0121.75 12v.75m-8.69-6.44l-2.12-2.12a1.5 1.5 0 00-1.061-.44H4.5A2.25 2.25 0 002.25 6v12a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9a2.25 2.25 0 00-2.25-2.25h-5.379a1.5 1.5 0 01-1.06-.44z"
                            />
                          </svg>
                        )}
                      </button>
                    </div>

                    {/* Folder Browser */}
                    {showFolderSelector && (
                      <div className="mt-2 border border-base-300 rounded-lg p-4 bg-base-100">
                        {/* Breadcrumbs */}
                        <div className="breadcrumbs text-sm mb-3">
                          <ul>
                            {folderBreadcrumbs.map((crumb, index) => (
                              <li key={crumb.id}>
                                <button
                                  type="button"
                                  onClick={() =>
                                    navigateToFolder(crumb.id, crumb.name)
                                  }
                                  className="hover:text-primary"
                                  disabled={
                                    index === folderBreadcrumbs.length - 1
                                  }
                                >
                                  {crumb.name}
                                </button>
                              </li>
                            ))}
                          </ul>
                        </div>

                        {/* Folder List */}
                        <div className="max-h-60 overflow-y-auto space-y-1">
                          {loadingFolders ? (
                            <div className="flex justify-center py-8">
                              <span className="loading loading-spinner loading-md"></span>
                            </div>
                          ) : cloudFolders.length > 0 ? (
                            cloudFolders.map((folder) => (
                              <div
                                key={folder.id}
                                className="flex items-center justify-between p-2 hover:bg-base-200 rounded cursor-pointer"
                              >
                                <button
                                  type="button"
                                  onClick={() =>
                                    navigateToFolder(folder.id, folder.name)
                                  }
                                  className="flex items-center gap-2 flex-1 text-left"
                                >
                                  <svg
                                    xmlns="http://www.w3.org/2000/svg"
                                    fill="none"
                                    viewBox="0 0 24 24"
                                    strokeWidth={1.5}
                                    stroke="currentColor"
                                    className="w-5 h-5 text-warning"
                                  >
                                    <path
                                      strokeLinecap="round"
                                      strokeLinejoin="round"
                                      d="M2.25 12.75V12A2.25 2.25 0 014.5 9.75h15A2.25 2.25 0 0121.75 12v.75m-8.69-6.44l-2.12-2.12a1.5 1.5 0 00-1.061-.44H4.5A2.25 2.25 0 002.25 6v12a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9a2.25 2.25 0 00-2.25-2.25h-5.379a1.5 1.5 0 01-1.06-.44z"
                                    />
                                  </svg>
                                  <span>{folder.name}</span>
                                </button>
                                <button
                                  type="button"
                                  onClick={() => selectFolder(folder.id)}
                                  className="btn btn-xs btn-primary"
                                >
                                  {t('vaultSelector.selectButton', 'Select')}
                                </button>
                              </div>
                            ))
                          ) : (
                            <div className="text-center py-8 text-base-content/60">
                              {t('vaultSelector.noFolders', 'No folders found')}
                            </div>
                          )}
                        </div>

                        {/* Select Current Folder Button */}
                        <div className="mt-3 pt-3 border-t border-base-300">
                          <button
                            type="button"
                            onClick={() => selectFolder(currentFolderId || '')}
                            className="btn btn-sm btn-block btn-outline"
                          >
                            {t(
                              'vaultSelector.selectCurrentFolder',
                              'Use This Folder'
                            )}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </>
            ) : (
              <div className="alert alert-warning">
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  className="stroke-current shrink-0 h-6 w-6"
                  fill="none"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="2"
                    d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                  />
                </svg>
                <div>
                  <p>{t('vaultSelector.noProvidersConfigured')}</p>
                  <p className="text-sm opacity-80">
                    {t('vaultSelector.goToSettings')}
                  </p>
                </div>
              </div>
            )}
          </div>
        </>
      )}

      {/* File Path - Only show for local storage and not on mobile */}
      {!isEditMode && !mobile && storageType === 'local' && (
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
      )}

      {/* Edit mode file path display */}
      {isEditMode && (
        <div className="form-control">
          <label className="label">
            <span className="label-text">{t('addVault.filePath')}</span>
          </label>
          <input
            type="text"
            className="input input-bordered"
            value={vault?.path || ''}
            disabled
          />
          <div className="text-xs text-base-content opacity-60 mt-1">
            {t('editVault.filePathHelp')}
          </div>
        </div>
      )}

      {isEditMode && vault?.isLocked && (
        <div className="alert alert-warning mb-4">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            className="stroke-current shrink-0 h-6 w-6"
            fill="none"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="2"
              d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
            />
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
          placeholder={
            isEditMode
              ? t('editVault.newPasswordPlaceholder')
              : t('addVault.passwordPlaceholder')
          }
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
          ) : isEditMode ? (
            t('editVault.save')
          ) : (
            t('addVault.createVault')
          )}
        </button>
        <button className="btn" onClick={onCancel} disabled={loading}>
          {t('addVault.cancel')}
        </button>
      </div>
    </div>
  );
};
