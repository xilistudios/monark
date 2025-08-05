// src/components/Vault/UnlockedVaultView.tsx

import React, { useState, useEffect } from 'react';
import { Entry, DataEntry, GroupEntry } from '../../interfaces/vault.interface';
import { AddEntryModal } from './AddEntryModal';
import { AddGroupModal } from './AddGroupModal';
import { ImportCsvModal } from './ImportCsvModal';
import { EntryDetailsSidebar } from './EntryDetailsSidebar';
import { VaultManager } from '../../services/vault';
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
  const [selectedEntry, setSelectedEntry] = useState<Entry | null>(null);
  const [sidebarMode, setSidebarMode] = useState<'view' | 'edit'>('view');
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);

  useEffect(() => {
    setSelectedEntry(null);
    setSidebarMode('view');
    setIsMobileSidebarOpen(false);
  }, [currentPath]);

  const handleEntrySelect = (entry: Entry) => {
    setSelectedEntry(entry);
    setSidebarMode('view');
    // Open sidebar on mobile when an entry is selected
    setIsMobileSidebarOpen(true);
  };

  const handleCloseMobileSidebar = () => {
    setIsMobileSidebarOpen(false);
    setSelectedEntry(null);
  };

  const handleSaveEntry = async (updatedEntry: DataEntry | GroupEntry) => {
    if (!selectedEntry) return;
    const path = [...currentPath, selectedEntry.id];
    const vaultInstance = VaultManager.getInstance().getInstance(
      currentVault.id
    );
    if (vaultInstance) {
      await vaultInstance.updateEntry(path, updatedEntry);
      setSidebarMode('view');
    }
  };

  const handleCancelEntry = () => {
    if (sidebarMode === 'edit') {
      setSidebarMode('view');
    } else {
      setSelectedEntry(null);
      setIsMobileSidebarOpen(false);
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* Modal components (context-driven, no props) */}
      <AddEntryModal />
      <AddGroupModal />
      <ImportCsvModal />

      <div className="border-b border-base-300">
        <VaultToolbar
          currentVault={currentVault}
          currentPath={currentPath}
          handleLockVault={handleLockVault}
          t={t}
        />
      </div>
      <div className="flex-1 flex flex-col md:flex-row overflow-hidden relative">
        {/* Left column: Breadcrumbs + VaultTree */}
        <div
          className={`w-full md:w-[40%] flex flex-col h-full overflow-auto border-r border-base-300 ${
            isMobileSidebarOpen ? 'hidden md:flex' : 'flex'
          }`}
        >
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
          <div className="p-4 flex-1 overflow-auto">
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
                onEntrySelect={handleEntrySelect}
              />
            )}
          </div>
        </div>

        {/* Desktop Sidebar */}
        <div className="hidden md:block w-full md:w-[60%] h-full">
          <EntryDetailsSidebar
            entry={selectedEntry}
            mode={sidebarMode}
            onEdit={() => setSidebarMode('edit')}
            onSave={handleSaveEntry}
            onCancel={handleCancelEntry}
          />
        </div>

        {/* Mobile Sidebar Overlay */}
        {isMobileSidebarOpen && selectedEntry && (
          <>
            {/* Backdrop */}
            <div
              className="md:hidden fixed inset-0 bg-black bg-opacity-50 z-40"
              onClick={handleCloseMobileSidebar}
            />

            {/* Mobile Sidebar */}
            <div className="md:hidden fixed inset-0 w-full bg-base-100 z-50 shadow-xl">
              {/* Mobile Header */}
              <div className="w-full flex items-center justify-between p-4 border-b bg-base-200">
                <h3 className="font-semibold text-lg">Entry Details</h3>
                <button
                  className="btn btn-sm btn-ghost"
                  onClick={handleCloseMobileSidebar}
                >
                  <svg
                    className="w-5 h-5"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M6 18L18 6M6 6l12 12"
                    />
                  </svg>
                </button>
              </div>

              {/* Sidebar Content */}
              <div className="h-full overflow-hidden">
                <EntryDetailsSidebar
                  entry={selectedEntry}
                  mode={sidebarMode}
                  onEdit={() => setSidebarMode('edit')}
                  onSave={handleSaveEntry}
                  onCancel={handleCancelEntry}
                  className="border-none"
                />
              </div>
            </div>
          </>
        )}

        {/* Mobile Entry Selected Indicator */}
        {selectedEntry && !isMobileSidebarOpen && (
          <div className="md:hidden fixed bottom-4 right-4 z-30">
            <button
              className="btn btn-primary btn-circle shadow-lg"
              onClick={() => setIsMobileSidebarOpen(true)}
            >
              <svg
                className="w-5 h-5"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export default UnlockedVaultView;
