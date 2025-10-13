// src/components/Vault/LockedVaultView.tsx

/**
 * LockedVaultView component displays the UI for unlocking a locked vault.
 *
 * @param {LockedVaultViewProps} props - Component props
 * @returns {JSX.Element | null}
 */

/**
 * Vault type for LockedVaultView.
 * This matches the shape used for currentVault in the app.
 */
export type Vault = {
  id: string;
  name: string;
  content?: unknown;
  isCloudVault?: boolean;
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
  unlockError,
  loading,
  t,
}: LockedVaultViewProps) {
  if (!currentVault) return null;

  return (
    <div className="h-full flex flex-col items-center justify-center">
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
                  <span className="loading loading-spinner loading-sm"></span>
                  {t('vault.unlock.unlocking')}
                </>
              ) : (
                t('vault.unlock.unlockButton')
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
