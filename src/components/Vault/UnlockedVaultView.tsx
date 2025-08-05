// src/components/Vault/UnlockedVaultView.tsx

import { Entry } from '../../interfaces/vault.interface';
import { AddEntryModal } from './AddEntryModal';
import { AddGroupModal } from './AddGroupModal';
import { EditEntryModal } from './EditEntryModal';
import { EditGroupModal } from './EditGroupModal';
import { EntryDetailsModal } from './EntryDetailsModal';
import { ImportCsvModal } from './ImportCsvModal';
/**
 * Vault interface for unlocked vault view props.
 */
interface Vault {
  id: string;
  volatile: {
    navigationPath?: string;
    entries: Entry[];
  };
}
import VaultToolbar from './VaultToolbar';
import VaultBreadcrumbs from './VaultBreadcrumbs';
import VaultTree from './VaultTree';

/**
 * Props for UnlockedVaultView component.
 * @property {Vault} currentVault - The currently unlocked vault.
 * @property {string[]} currentPath - The current navigation path in the vault.
 * @property {Entry[]} entries - The entries at the current path.
 * @property {(path: string[]) => void} handleNavigate - Callback for navigation.
 * @property {(entry: DataEntry | GroupEntry) => void} openEntryDetails - Callback to open entry details.
 * @property {(entry: DataEntry) => void} openEditEntry - Callback to open edit entry modal.
 * @property {(entry: GroupEntry) => void} openEditGroup - Callback to open edit group modal.
 * @property {(key: string) => string} t - Translation function.
 */
/**
 * Props for UnlockedVaultView component.
 * @property {Vault} currentVault - The currently unlocked vault.
 * @property {string[]} currentPath - The current navigation path in the vault.
 * @property {Entry[]} entries - The entries at the current path.
 * @property {(path: string[]) => void} handleNavigate - Callback for navigation.
 * @property {() => void} handleLockVault - Callback to lock the vault.
 * @property {(key: string) => string} t - Translation function.
 */
export interface UnlockedVaultViewProps {
  currentVault: Vault;
  currentPath: string[];
  entries: Entry[];
  handleNavigate: (path: string[]) => void;
  handleLockVault: () => void;
  t: (key: string) => string;
}

/**
 * Renders the unlocked vault UI, including toolbar, breadcrumbs, and entry tree.
 * Handles empty vault state and delegates entry actions via props.
 */
/**
 * Renders the unlocked vault UI, including toolbar, breadcrumbs, and entry tree.
 * Handles empty vault state and delegates entry actions via VaultModalContext.
 */
function UnlockedVaultView({
  currentVault,
  currentPath,
  entries,
  handleNavigate,
  handleLockVault,
  t,
}: UnlockedVaultViewProps) {
  return (
    <div className="flex flex-col h-full">
      {/* Modal components (context-driven, no props) */}
      <AddEntryModal />
      <AddGroupModal />
      <EditEntryModal />
      <EditGroupModal />
      <EntryDetailsModal />
      <ImportCsvModal />

      <div className="border-b border-base-300">
        <VaultToolbar
          currentVault={currentVault}
          currentPath={currentPath}
          handleLockVault={handleLockVault}
          t={t}
        />
      </div>
      <div className="flex-1 overflow-auto">
        <VaultBreadcrumbs
          navigationPath={currentPath.join('/')}
          currentVault={{
            ...currentVault,
            volatile: {
              ...currentVault.volatile,
              navigationPath: currentVault.volatile.navigationPath ?? '',
            },
          }}
          onNavigate={handleNavigate}
        />
        <div className="p-4">
          {entries.length === 0 ? (
            <div className="text-center py-12">
              <div className="text-base-content/60 mb-4">
                <p className="text-lg">{t('vault.manager.emptyVault')}</p>
              </div>
            </div>
          ) : (
            <VaultTree
              vaultId={currentVault.id}
              entries={entries}
              basePath={currentPath}
              onNavigate={(_vaultId, path) => handleNavigate(path)}
            />
          )}
        </div>
      </div>
    </div>
  );
}

export default UnlockedVaultView;
