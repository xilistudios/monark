import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useDispatch, useSelector } from 'react-redux';
import VaultSelector from '../components/Vault/VaultSelector';
import { AddEntryModal } from '../components/Vault/AddEntryModal';
import { AddGroupModal } from '../components/Vault/AddGroupModal';
import { EditEntryModal } from '../components/Vault/EditEntryModal';
import { EditGroupModal } from '../components/Vault/EditGroupModal';
import { EntryDetailsModal } from '../components/Vault/EntryDetailsModal';
import { ImportCsvModal } from '../components/Vault/ImportCsvModal';
import { isDataEntry, isGroupEntry } from '../interfaces/vault.interface';
import {
  lockVault,
  setNavigationPath,
  setVaultLocked,
} from '../redux/actions/vault';
import { VaultManager } from '../services/vault';
import type { AppDispatch, RootState } from '../redux/store';
import { useContext } from 'react';
import { VaultModalContext } from '../components/Vault/VaultContext';
import {
  parseNavigationPath,
  getCurrentEntries,
} from '../utils/vaultNavigation';
import UnlockedVaultView from '../components/Vault/UnlockedVaultView';
import { LockedVaultView } from '../components/Vault/LockedVaultView';

function HomeScreen() {
  const { t } = useTranslation('home');
  const dispatch = useDispatch<AppDispatch>();
  const vaults = useSelector((state: RootState) => state.vault.vaults);
  const currentVaultId = useSelector(
    (state: RootState) => state.vault.currentVaultId
  );
  const error = useSelector((state: RootState) => state.vault.error);
  const currentVault = vaults.find((v) => v.id === currentVaultId) ?? null;
  const navigationPath = currentVault?.volatile?.navigationPath || '/';

  const [password, setPassword] = useState('');
  const [unlockError, setUnlockError] = useState('');
  const [loading, setLoading] = useState(false);

  const context = useContext(VaultModalContext);
  if (!context)
    throw new Error(
      'VaultModalContext must be used within a VaultModalProvider'
    );
  const { selectedEntry } = context;

  const currentPath = parseNavigationPath(navigationPath);

  const handleNavigate = (path: string[]) => {
    const newPath = path.length > 0 ? `/${path.join('/')}` : '/';
    if (currentVault) {
      dispatch(
        setNavigationPath({ vaultId: currentVault.id, navigationPath: newPath })
      );
    }
  };

  const handleUnlockVault = async () => {
    if (!currentVault || !password.trim()) {
      setUnlockError(t('errors.missingFields'));
      return;
    }
    setLoading(true);
    setUnlockError('');
    try {
      const vaultInstance = VaultManager.getInstance().getInstance(
        currentVault.id
      );
      if (vaultInstance) {
        await vaultInstance.unlock(password.trim());
        dispatch(setVaultLocked({ vaultId: currentVault.id, isLocked: false }));
        dispatch(
          setNavigationPath({ vaultId: currentVault.id, navigationPath: '/' })
        );
      }
      setPassword('');
    } catch (err) {
      setUnlockError(t('errors.unlockFailed'));
    } finally {
      setLoading(false);
    }
  };

  /**
   * Handles vault locking by dispatching the lockVault action.
   * Clears password and unlock error states after locking.
   *
   * @returns {void}
   * @throws {Error} When vault locking fails
   */
  const handleLockVault = () => {
    if (!currentVault) {
      console.error('Cannot lock vault: no current vault selected');
      return;
    }

    try {
      dispatch(lockVault(currentVault.id));
      setPassword('');
      setUnlockError('');
    } catch (error) {
      console.error('Failed to lock vault:', error);
      setUnlockError(t('errors.lockFailed'));
    }
  };

  const entries = getCurrentEntries(
    currentVault?.volatile?.entries ?? [],
    currentPath
  );

  let vaultContent;
  if (!currentVault) {
    vaultContent = (
      <div className="flex items-center justify-center h-full">
        <div className="text-center">
          <h2 className="text-2xl font-bold mb-4">
            {t('vault.manager.noVaultSelected')}
          </h2>
          <p className="text-base-content/60">
            {t('vault.manager.selectVaultToStart')}
          </p>
        </div>
      </div>
    );
  } else if (currentVault.isLocked) {
    vaultContent = (
      <LockedVaultView
        currentVault={{
          id: currentVault.id,
          name: currentVault.name,
        }}
        password={password}
        setPassword={setPassword}
        handleUnlockVault={handleUnlockVault}
        unlockError={unlockError || (typeof error === 'string' ? error : '')}
        loading={loading}
        t={t}
      />
    );
  } else {
    vaultContent = (
      <UnlockedVaultView
        currentVault={currentVault}
        currentPath={currentPath}
        entries={entries}
        handleNavigate={handleNavigate}
        handleLockVault={handleLockVault}
        t={t}
      />
    );
  }

  return (
    <div className="flex h-screen w-screen">
      <div className="vault-selector w-1/5 h-full border-r border-base-300">
        <VaultSelector />
      </div>
      <div className="vault-content w-4/5 h-full">{vaultContent}</div>
      <AddEntryModal />
      <AddGroupModal />
      <ImportCsvModal />
      {selectedEntry && isDataEntry(selectedEntry) && <EntryDetailsModal />}
      {selectedEntry && isDataEntry(selectedEntry) && <EditEntryModal />}
      {selectedEntry && isGroupEntry(selectedEntry) && <EditGroupModal />}
    </div>
  );
}

export default HomeScreen;
