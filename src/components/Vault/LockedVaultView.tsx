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
          <h2 className="card-title mb-2">{t('vault.unlock.title')}</h2>
          <p className="mb-4">
            {t('vault.unlock.description').replace('{name}', currentVault.name)}
          </p>
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
