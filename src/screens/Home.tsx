import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useDispatch, useSelector } from 'react-redux';
import VaultSelector from '../components/Vault/VaultSelector';
import { Toast } from '../components/UI/Toast';
import { AddEntryModal } from '../components/Vault/Modals/AddEntryModal';
import { AddGroupModal } from '../components/Vault/Modals/AddGroupModal';
import { EditEntryModal } from '../components/Vault/Modals/EditEntryModal';
import { EditGroupModal } from '../components/Vault/Modals/EditGroupModal';
import { EntryDetailsModal } from '../components/Vault/Modals/EntryDetailsModal';
import { ImportCsvModal } from '../components/Vault/Modals/ImportCsvModal';
import { AddVaultModal } from '../components/Vault/Modals/AddVaultModal';
import { EditVaultModal } from '../components/Vault/Modals/EditVaultModal';
import { DeleteVaultModal } from '../components/Vault/Modals/DeleteVaultModal';
import { AddProviderModal } from '../components/Vault/Modals/AddProviderModal';
import { deleteVault, type Vault, isCloudVault } from '../redux/actions/vault';
import { isVaultLocked } from '../services/vaultState';
import { isDataEntry, isGroupEntry } from '../interfaces/vault.interface';
import {
  lockVault,
  setNavigationPath,
  setVaultLocked,
} from '../redux/actions/vault';
import { VaultManager } from '../services/vault';
import { store } from '../redux/store';
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
  const effectiveLocked = currentVault ? isVaultLocked(currentVault) : true;

  const [password, setPassword] = useState('');
  const [unlockError, setUnlockError] = useState('');
  const [loading, setLoading] = useState(false);
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [vaultToDelete, setVaultToDelete] = useState<Vault | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [cloudUnlockMessage, setCloudUnlockMessage] = useState('');
  const [showToast, setShowToast] = useState(false);
  const [toastMessage, setToastMessage] = useState('');
  const [toastType, setToastType] = useState<'success' | 'error' | 'warning' | 'info'>('success');

  const context = useContext(VaultModalContext);
  if (!context)
    throw new Error(
      'VaultModalContext must be used within a VaultModalProvider'
    );
  const {
    selectedEntry,
    isAddVaultModalOpen,
    openAddVaultModal,
    closeAddVaultModal,
    isAddProviderModalOpen,
    closeAddProviderModal,
  } = context;

  // Initialize VaultManager and load providers on app start
  useEffect(() => {
    const initializeApp = async () => {
      try {
        const vaultManager = VaultManager.getInstance();
        
        // Initialize VaultManager with Redux dispatch and getState
        vaultManager.initialize(dispatch, () => store.getState());
        
        // Load storage providers
        await vaultManager.loadProviders();
        
        // Refresh cloud vaults
        await vaultManager.refreshCloudVaults();
      } catch (error) {
        console.error('Failed to initialize app:', error);
      }
    };

    initializeApp();
  }, [dispatch]);

  // Set up periodic cloud vault refresh (every 5 minutes)
  useEffect(() => {
    const interval = setInterval(async () => {
      try {
        const vaultManager = VaultManager.getInstance();
        await vaultManager.refreshCloudVaults();
      } catch (error) {
        console.error('Failed to refresh cloud vaults:', error);
      }
    }, 5 * 60 * 1000); // 5 minutes

    return () => clearInterval(interval);
  }, []);

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
    
    // Show cloud-specific message if it's a cloud vault
    if (isCloudVault(currentVault)) {
      setCloudUnlockMessage(t('vaultSelector.downloadingFromCloud'));
    }
    
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
      setCloudUnlockMessage('');
    } catch (err) {
      setUnlockError(t('errors.unlockFailed'));
      setCloudUnlockMessage('');
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

  const handleDeleteVault = (vault: Vault) => {
    setVaultToDelete(vault);
    setDeleteModalOpen(true);
  };

  const handleConfirmDelete = async (deleteFile: boolean) => {
  	if (!vaultToDelete) return;
 
  	setDeleting(true);
  	try {
  		await dispatch(deleteVault(vaultToDelete.id, deleteFile) as any);
  		setDeleteModalOpen(false);
  	} catch (error) {
  		console.error('Failed to delete vault:', error);
  		setToastMessage(t('vault.delete.error', 'Failed to delete vault'));
  		setToastType('error');
  		setShowToast(true);
  	} finally {
  		setDeleting(false);
  		setVaultToDelete(null);
  	}
  };

  const handleCloseDeleteModal = () => {
    setDeleteModalOpen(false);
    setVaultToDelete(null);
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
  } else if (effectiveLocked) {
    vaultContent = (
      <LockedVaultView
        currentVault={{
          id: currentVault.id,
          name: currentVault.name,
          isCloudVault: isCloudVault(currentVault),
        }}
        password={password}
        setPassword={setPassword}
        handleUnlockVault={handleUnlockVault}
        unlockError={unlockError || (typeof error === 'string' ? error : '')}
        loading={loading}
        cloudUnlockMessage={cloudUnlockMessage}
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
    <div className="flex h-[100vh] w-screen overflow-hidden">
      <div className="drawer lg:drawer-open">
        <input id="vault-drawer" type="checkbox" className="drawer-toggle" />
        <div className="drawer-content flex flex-col">
          <div className="w-full px-4 py-2 bg-base-200 border-b border-base-300">
            <label
              htmlFor="vault-drawer"
              className="btn btn-ghost btn-sm lg:hidden"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                className="h-5 w-5"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2"
                  d="M4 6h16M4 12h16M4 18h16"
                />
              </svg>
            </label>
          </div>
          <div className="vault-content flex-1 overflow-hidden">
            {vaultContent}
          </div>
        </div>
        <div className="drawer-side h-full">
          <label
            htmlFor="vault-drawer"
            aria-label="close sidebar"
            className="drawer-overlay"
          ></label>
          <div className="menu p-4 w-80 h-full bg-base-100 text-base-content border-r border-base-300 lg:w-80 md:w-64 sm:w-56 max-w-[80vw] overflow-hidden flex flex-col">
            <VaultSelector
              onAddVault={() => openAddVaultModal()}
              onDeleteVault={handleDeleteVault}
            />
          </div>
        </div>
      </div>
      <AddEntryModal />
      <AddGroupModal />
      <ImportCsvModal />
      {selectedEntry && isDataEntry(selectedEntry) && <EntryDetailsModal />}
      {selectedEntry && isDataEntry(selectedEntry) && <EditEntryModal />}
      {selectedEntry && isGroupEntry(selectedEntry) && <EditGroupModal />}
      <AddVaultModal
        isOpen={isAddVaultModalOpen}
        onClose={() => closeAddVaultModal()}
      />
      <EditVaultModal />
      <DeleteVaultModal
        isOpen={deleteModalOpen}
        onClose={handleCloseDeleteModal}
        vault={vaultToDelete}
        onConfirm={handleConfirmDelete}
        deleting={deleting}
      />
      <AddProviderModal
        isOpen={isAddProviderModalOpen}
        onClose={() => closeAddProviderModal()}
      />
      <Toast
        message={toastMessage}
        isVisible={showToast}
        onHide={() => setShowToast(false)}
        type={toastType}
      />
    </div>
  );
}

export default HomeScreen;
