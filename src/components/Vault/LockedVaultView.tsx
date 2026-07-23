// src/components/Vault/LockedVaultView.tsx

import { useState, useEffect } from 'react';

/**
 * Vault type for LockedVaultView.
 * This matches the shape used for currentVault in the app.
 */
export type Vault = {
  id: string;
  name: string;
  content?: unknown;
  isCloudVault?: boolean;
  biometricEnabled?: boolean;
  [key: string]: unknown;
};

/**
 * Props for LockedVaultView component.
 */
export interface LockedVaultViewProps {
  currentVault: Vault | null;
  password: string;
  setPassword: (password: string) => void;
  handleUnlockVault: () => void;
  handleBiometricUnlock?: () => void;
  biometricLoading?: boolean;
  unlockError: string;
  loading: boolean;
  cloudUnlockMessage?: string;
  t: (key: string) => string;
}

export function LockedVaultView({
  currentVault,
  password,
  setPassword,
  handleUnlockVault,
  handleBiometricUnlock,
  biometricLoading = false,
  unlockError,
  loading,
  cloudUnlockMessage,
  t,
}: LockedVaultViewProps) {
  const [isVisible, setIsVisible] = useState(false);
  const [showPasswordForm, setShowPasswordForm] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setIsVisible(true), 10);
    return () => clearTimeout(timer);
  }, []);

  // Auto-trigger biometric unlock on mount if enabled
  useEffect(() => {
    if (currentVault?.biometricEnabled && handleBiometricUnlock && !showPasswordForm) {
      handleBiometricUnlock();
    }
  }, [currentVault?.id, currentVault?.biometricEnabled]);

  if (!currentVault) return null;

  const showBiometric = currentVault.biometricEnabled && handleBiometricUnlock && !showPasswordForm;

  return (
    <div data-testid="locked-vault-view" className={`h-full flex flex-col items-center justify-center transition-opacity duration-300 ${isVisible ? 'opacity-100' : 'opacity-0'}`}>
      <div className="card w-full max-w-md bg-base-100 shadow-xl">
        <div className="card-body">
          <div className="flex items-center gap-2 mb-2">
            <h2 className="card-title">{t('vault.unlock.title')}</h2>
            {currentVault.isCloudVault && (
              <div className="badge badge-info badge-sm">
                <svg
                  className="w-3 h-3 mr-1"
                  fill="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path d="M19.35 10.04C18.67 6.59 15.64 4 12 4 9.11 4 6.6 5.64 5.35 8.04 2.34 8.36 0 10.91 0 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96z" />
                </svg>
                Cloud
              </div>
            )}
          </div>

          {/* Biometric unlock section */}
          {showBiometric && (
            <>
              <div className="flex flex-col items-center py-6 gap-4">
                {biometricLoading ? (
                  <>
                    <span className="loading loading-spinner loading-lg" role="status"></span>
                    <p className="text-base-content/70">{t('biometric.unlocking')}</p>
                  </>
                ) : (
                  <>
                    <button
                      className="btn btn-circle btn-lg btn-primary"
                      onClick={handleBiometricUnlock}
                      aria-label={t('biometric.unlock')}
                    >
                      <svg
                        className="w-8 h-8"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M12 11c1.66 0 3-1.34 3-3s-1.34-3-3-3-3 1.34-3 3 1.34 3 3 3zm0 2c-2.76 0-5 2.24-5 5h2c0-1.66 1.34-3 3-3s3 1.34 3 3h2c0-2.76-2.24-5-5-5zm0-6c.55 0 1 .45 1 1s-.45 1-1 1-1-.45-1-1 .45-1 1-1z"
                        />
                      </svg>
                    </button>
                    <p className="text-base-content/70 text-sm">
                      {t('biometric.tapToUnlock')}
                    </p>
                  </>
                )}
              </div>

              <div className="divider text-xs">{t('biometric.or')}</div>

              <button
                className="btn btn-ghost btn-sm w-full"
                onClick={() => setShowPasswordForm(true)}
              >
                {t('biometric.usePasswordInstead')}
              </button>
            </>
          )}

          {/* Password form - always show if biometric is not shown */}
          {(!showBiometric || showPasswordForm) && (
            <>
              <p className="mb-4">
                {t('vault.unlock.description').replace('{name}', currentVault.name)}
              </p>

              {currentVault.isCloudVault && (
                <div className="alert alert-info mb-4">
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
                      d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                    />
                  </svg>
                  <span>{t('vault.unlock.cloudVaultNotice')}</span>
                </div>
              )}

              {cloudUnlockMessage && (
                <div className="alert alert-info mb-4">
                  <span className="loading loading-spinner loading-sm" role="status"></span>
                  <span>{cloudUnlockMessage}</span>
                </div>
              )}

              <input
                type="password"
                placeholder={t('vault.unlock.passwordPlaceholder')}
                className="input input-bordered"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onKeyPress={(e) => e.key === 'Enter' && handleUnlockVault()}
              />

              {unlockError && (
                <div className="alert alert-error mt-4">
                  <span>{unlockError}</span>
                </div>
              )}

              <div className="card-actions justify-end mt-4">
                <button
                  className="btn btn-primary"
                  onClick={handleUnlockVault}
                  disabled={loading || !password.trim()}
                >
                  {loading ? (
                    <>
                      <span className="loading loading-spinner loading-sm" role="status"></span>
                      {t('vault.unlock.unlocking')}
                    </>
                  ) : (
                    t('vault.unlock.unlockButton')
                  )}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
