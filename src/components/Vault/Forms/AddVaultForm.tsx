import { open } from '@tauri-apps/plugin-dialog';
import * as path from '@tauri-apps/api/path';
import { useMemo, useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useDispatch, useSelector } from 'react-redux';
import { updateVault, type Vault } from '../../../redux/actions/vault';
import { VaultManager } from '../../../services/vault';
import { CloudStorageCommands } from '../../../services/cloudStorage';
import { isMobile } from '../../../utils/platform';
import type { RootState } from '../../../redux/store';

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
  const [confirmPassword, setConfirmPassword] = useState('');
  const [vaultName, setVaultName] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(false);
  const [storageType, setStorageType] = useState<'local' | 'cloud'>('local');
  const [providerId, setProviderId] = useState<string>('');
  const mobile = useMemo(() => isMobile(), []);
  const isEditMode = !!vault;

  // Clear success message when user starts typing
  const clearMessages = () => {
    setError('');
    setSuccess('');
  };

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
    }
  }, [storageType]);

  const extractVaultNameFromPath = (path: string) => {
    const fileName = path.split('/').pop() || '';
    return fileName.replace('.monark', '');
  };

  const handleCreateVault = async () => {
    if (!password || !vaultName) {
      setError(t('errors.missingFields'));
      return;
    }

    // Password confirmation validation
    if (password !== confirmPassword) {
      setError(t('errors.passwordMismatch') || 'Passwords do not match');
      return;
    }

    // Additional validation for cloud storage
    if (storageType === 'cloud' && !providerId) {
      setError(t('vaultSelector.missingProvider'));
      return;
    }

    setError('');
    setSuccess('');
    setLoading(true);

    try {
      if (storageType === 'cloud') {
        // Check authentication status before creating vault
        try {
          const isAuthenticated =
            await CloudStorageCommands.checkProviderAuthStatus(providerId);
          if (!isAuthenticated) {
            setError(
              t(
                'vaultSelector.providerNotAuthenticated',
                'Provider is not authenticated. Please authenticate in Settings.'
              )
            );
            setLoading(false);
            return;
          }
        } catch (authCheckError) {
          console.error('Error checking auth status:', authCheckError);
          setError(
            t(
              'vaultSelector.authCheckFailed',
              'Failed to verify authentication status.'
            )
          );
          setLoading(false);
          return;
        }

        // Create cloud vault using VaultManager
        // parentFolderId is undefined - the backend will automatically use the "Monark" folder
        await VaultManager.getInstance().createVault(
          vaultName,
          password,
          'cloud',
          providerId,
          undefined,
          undefined
        );
      } else {
        // Create local vault using VaultManager
        const filepath = await path.join(
          filePath || (await path.appDataDir()),
          `${vaultName}.monark`
        );
        await VaultManager.getInstance().createVault(
          vaultName,
          password,
          'local',
          undefined,
          filepath
        );
      }

      setSuccess(t('addVault.success') || 'Vault created successfully');
      setTimeout(() => {
        onSuccess();
      }, 1500); // Show success message for 1.5 seconds
    } catch (err) {
      console.error('Error creating vault:', err);

      // Parse error message for better user feedback
      const errorMessage = String(err);
      if (
        errorMessage.includes('401') ||
        errorMessage.includes('Invalid Credentials') ||
        errorMessage.includes('UNAUTHENTICATED')
      ) {
        setError(
          t(
            'vaultSelector.authenticationExpired',
            'Authentication has expired. Please re-authenticate in Settings.'
          )
        );
      } else if (
        errorMessage.includes('403') ||
        errorMessage.includes('insufficient permission')
      ) {
        setError(
          t(
            'vaultSelector.insufficientPermissions',
            'Insufficient permissions. Please check your cloud storage permissions.'
          )
        );
      } else if (
        errorMessage.includes('quota') ||
        errorMessage.includes('storage full')
      ) {
        setError(
          t(
            'vaultSelector.storageQuotaExceeded',
            'Storage quota exceeded. Please free up space.'
          )
        );
      } else {
        setError(errorMessage);
      }
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

    // Password confirmation validation when changing password
    if (password && password !== confirmPassword) {
      setError(t('errors.passwordMismatch') || 'Passwords do not match');
      return;
    }

    setError('');
    setSuccess('');
    setLoading(true);

    try {
      // Only update password if new value is provided
      if (password) {
        try {
          // Use the new changePassword method from VaultManager
          await VaultManager.getInstance().changeVaultPassword(vault.id, password);
        } catch (err) {
          console.error('Error changing vault password:', err);
          setError(
            t('errors.passwordChangeFailed') || 'Failed to change vault password'
          );
          setLoading(false);
          return;
        }
      }

      const updatedVault: Vault = {
        ...vault,
        name: vaultName,
        path: filePath || vault.path, // Preserve existing path if not changed
        // Don't update credential here - it's handled by the changePassword method
      };

      dispatch(updateVault(updatedVault));
      
      // Show success message for password change
      if (password) {
        setSuccess(t('editVault.passwordChanged') || 'Password changed successfully');
        setTimeout(() => {
          onSuccess();
        }, 1500); // Show success message for 1.5 seconds
      } else {
        onSuccess();
      }
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
          onChange={(e) => {
            setVaultName(e.target.value);
            clearMessages();
          }}
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

                {/* Storage location info */}
                {providerId && (
                  <div className="mt-4">
                    <div className="alert alert-info">
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        fill="none"
                        viewBox="0 0 24 24"
                        className="stroke-current shrink-0 w-6 h-6"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth="2"
                          d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                        ></path>
                      </svg>
                      <span>
                        {t(
                          'vaultSelector.autoStorageNote',
                          'Vaults will be automatically stored in the "Monark" folder in your cloud storage.'
                        )}
                      </span>
                    </div>
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
          onChange={(e) => {
            setPassword(e.target.value);
            clearMessages();
          }}
          disabled={isEditMode && vault?.isLocked}
        />
        {isEditMode && (
          <div className="text-xs text-base-content opacity-60 mt-1">
            {t('editVault.passwordHelp')}
          </div>
        )}
      </div>

      {/* Password confirmation field */}
      {(password || !isEditMode) && (
        <div className="form-control">
          <label className="label">
            <span className="label-text">
              {isEditMode
                ? t('editVault.confirmNewPassword')
                : t('addVault.confirmPassword')
              }
              {!isEditMode && ' *'}
            </span>
          </label>
          <input
            type="password"
            placeholder={
              isEditMode
                ? t('editVault.confirmNewPasswordPlaceholder')
                : t('addVault.confirmPasswordPlaceholder')
            }
            className="input input-bordered"
            value={confirmPassword}
            onChange={(e) => {
              setConfirmPassword(e.target.value);
              clearMessages();
            }}
            disabled={isEditMode && vault?.isLocked}
          />
        </div>
      )}

      {error && (
        <div className="alert alert-error">
          <span>{JSON.stringify(error.toString())}</span>
        </div>
      )}

      {success && (
        <div className="alert alert-success">
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
              d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
          <span>{success}</span>
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
