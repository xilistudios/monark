import { useState, useCallback, useContext } from 'react';
import { useTranslation } from 'react-i18next';
import { type Entry, isGroupEntry } from '../../interfaces/vault.interface';
import { VaultManager } from '../../services/vault';
import { VaultModalContext } from './VaultContext';
import { Modal } from '../UI/Modal';

/**
 * Props for VaultTree component.
 * @property vaultId - The ID of the vault.
 * @property entries - The list of entries to display.
 * @property basePath - The base path for the tree.
 * @property onNavigate - Handler for navigating to a group.
 * @property onEntrySelect - Optional callback for entry selection (bypasses modal if provided).
 */
interface VaultTreeProps {
  vaultId: string;
  entries: Entry[];
  basePath: string[];
  onNavigate: (vaultId: string, path: string[]) => void;
  onEntrySelect?: (entry: Entry) => void;
}

/**
 * Props for TreeNode component.
 * @property entry - The entry to render.
 * @property vaultId - The ID of the vault.
 * @property onNavigate - Handler for navigating to a group.
 * @property onDelete - Handler for deleting an entry/group.
 * @property deletingId - The ID of the entry currently being deleted.
 * @property level - The tree depth level.
 * @property isLastChild - Whether this node is the last child.
 * @property currentPath - The path to this node.
 */
interface TreeNodeProps {
  entry: Entry;
  vaultId: string;
  onNavigate: (vaultId: string, path: string[]) => void;
  onDelete: (vaultId: string, path: string[]) => void;
  deletingId: string | null;
  level: number;
  isLastChild: boolean;
  currentPath: string[];
  /**
   * Optional callback for entry selection (bypasses modal if provided).
   */
  onEntrySelect?: (entry: Entry) => void;
}

// TreeNode component for recursive rendering
/**
 * TreeNode component for rendering a single entry or group in the tree.
 */
const TreeNode = ({
  entry,
  vaultId,
  onNavigate,
  onDelete,
  deletingId,
  level,
  isLastChild,
  currentPath,
  onEntrySelect,
}: TreeNodeProps) => {
  const { t } = useTranslation('home');
  const context = useContext(VaultModalContext);
  if (!context)
    throw new Error(
      'VaultModalContext must be used within a VaultModalProvider'
    );
  const { openEditEntry, openEditGroup, openEntryDetails } = context;

  const handleNavigate = useCallback(() => {
    if (isGroupEntry(entry)) {
      onNavigate(vaultId, currentPath);
    } else if (onEntrySelect) {
      onEntrySelect(entry);
    } else {
      openEntryDetails(entry);
    }
  }, [
    entry,
    vaultId,
    onNavigate,
    openEntryDetails,
    currentPath,
    onEntrySelect,
  ]);

  const getIndentStyle = useCallback(() => {
    const baseIndent = level * 16; // Reduced indent for mobile
    return {
      paddingLeft: `${baseIndent + 8}px`,
      marginLeft: level > 0 ? '8px' : '0',
    };
  }, [level]);

  const renderTreeLines = useCallback(() => {
    if (level === 0) return null;

    return (
      <div
        className="absolute left-0 top-0 bottom-0 w-px bg-base-300 hidden sm:block"
        style={{ left: `${(level - 1) * 16 + 8}px` }}
      >
        {!isLastChild && (
          <div
            className="absolute top-0 bottom-0 w-px bg-base-300"
            style={{ left: '0px' }}
          />
        )}
        <div className="absolute top-6 left-0 w-3 h-px bg-base-300" />
      </div>
    );
  }, [level, isLastChild]);

  return (
    <div className="relative mb-1">
      {renderTreeLines()}
      <div className="relative">
        <div
          className="flex items-center justify-between bg-base-200 hover:bg-base-300 active:bg-base-300 transition-colors rounded-lg border border-base-300 touch-manipulation"
          style={getIndentStyle()}
        >
          <div
            className="flex items-center cursor-pointer flex-1 py-3 px-3 sm:py-2 min-h-[44px] sm:min-h-[36px]"
            onClick={handleNavigate}
          >
            <div className="flex items-center">
              {isGroupEntry(entry) ? (
                <svg
                  className="w-5 h-5 sm:w-4 sm:h-4 mr-3 sm:mr-2 text-primary flex-shrink-0"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"
                  />
                </svg>
              ) : (
                <svg
                  className="w-5 h-5 sm:w-4 sm:h-4 mr-3 sm:mr-2 text-secondary flex-shrink-0"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z"
                  />
                </svg>
              )}
              <div className="min-w-0 flex-1">
                <span className="font-medium text-sm sm:text-sm block truncate">
                  {entry.name}
                </span>
                {isGroupEntry(entry) && (
                  <span className="text-xs text-base-content/60 block sm:hidden">
                    Group
                  </span>
                )}
              </div>
            </div>
          </div>

          <div className="flex gap-1 px-2 flex-shrink-0">
            <div className="dropdown dropdown-end">
              <div
                tabIndex={0}
                role="button"
                className="btn btn-sm sm:btn-xs btn-ghost min-h-[40px] sm:min-h-[24px] px-2"
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
                    d="M5 12h.01M12 12h.01M19 12h.01"
                  />
                </svg>
              </div>
              <ul
                tabIndex={0}
                className="dropdown-content z-[1] menu p-2 shadow bg-base-100 rounded-box w-60"
              >
                <li>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      isGroupEntry(entry)
                        ? openEditGroup(entry)
                        : openEditEntry(entry);
                    }}
                  >
                    {t('vault.tree.edit')}
                  </button>
                </li>
                <li>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onDelete(vaultId, currentPath);
                    }}
                    disabled={deletingId === entry.id}
                  >
                    {deletingId === entry.id ? (
                      <span className="loading loading-spinner loading-sm"></span>
                    ) : (
                      t('vault.tree.delete')
                    )}
                  </button>
                </li>
              </ul>
            </div>
          </div>
        </div>

        {/* Children are not rendered when displaying only parent entries */}
      </div>
    </div>
  );
};

// Main VaultTree component
/**
 * VaultTree component for rendering the vault's entry/group tree.
 * Uses VaultModalContext for modal actions.
 */
/**
 * VaultTree component for rendering the vault's entry/group tree.
 * Uses VaultModalContext for modal actions.
 *
 * @param onEntrySelect Optional callback for entry selection (bypasses modal if provided).
 */
const VaultTree = ({
  vaultId,
  entries,
  basePath,
  onNavigate,
  onEntrySelect,
}: VaultTreeProps) => {
  const { t } = useTranslation();
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<{
    isOpen: boolean;
    vaultId: string;
    path: string[];
  } | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const handleDelete = useCallback(
    (vaultId: string, path: string[]) => {
      setConfirmDelete({ isOpen: true, vaultId, path });
    },
    []
  );

  const handleConfirmDelete = async () => {
    if (!confirmDelete) return;

    const { vaultId, path } = confirmDelete;
    const entryId = path[path.length - 1];
    setDeletingId(entryId);
    setIsDeleting(true);
    try {
      if (vaultId) {
        const vaultInstance =
          VaultManager.getInstance().getInstance(vaultId);
        if (vaultInstance) {
          await vaultInstance.deleteEntry(path);
        }
      }
    } catch (err) {
      console.error('Delete failed:', err);
    } finally {
      setDeletingId(null);
      setIsDeleting(false);
      setConfirmDelete(null);
    }
  };

  const renderEmptyState = useCallback(
    () => (
      <div className="text-center py-8 sm:py-12 px-4">
        <div className="text-base-content/60 mb-4">
          <svg
            className="w-12 h-12 sm:w-16 sm:h-16 mx-auto"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1}
              d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
            />
          </svg>
        </div>
        <p className="text-base-content/70 text-base sm:text-lg font-medium mb-2">
          {t('vault.tree.noEntries')}
        </p>
        <div className="mt-4">
          <p className="text-sm text-base-content/60">
            {t('vault.tree.importOrCreateVault')}
          </p>
        </div>
      </div>
    ),
    [vaultId, t]
  );

  // Sort entries: groups first, then by name
  const processedEntries = [...entries].sort((a, b) => {
    // Sort groups first, then by name
    const aIsGroup = isGroupEntry(a);
    const bIsGroup = isGroupEntry(b);

    if (aIsGroup && !bIsGroup) return -1;
    if (!aIsGroup && bIsGroup) return 1;

    // Both are groups or both are entries, sort by name
    return a.name.localeCompare(b.name);
  });

  return (
    <div className="w-full h-screen max-h-screen overflow-y-auto pb-40">
      {processedEntries.length === 0 ? (
        renderEmptyState()
      ) : (
        <div className="space-y-2 sm:space-y-1">
          {processedEntries.map((entry, index) => (
            <TreeNode
              key={entry.id}
              entry={entry}
              vaultId={vaultId}
              onNavigate={onNavigate}
              onDelete={handleDelete}
              deletingId={deletingId}
              level={0}
              isLastChild={index === processedEntries.length - 1}
              currentPath={[...basePath, entry.id]}
              onEntrySelect={onEntrySelect}
            />
          ))}
        </div>
      )}

      {/* Confirm Delete Modal */}
      {confirmDelete && (
        <Modal
          isOpen={confirmDelete.isOpen}
          onClose={() => setConfirmDelete(null)}
        >
          <div className="p-6">
            <h3 className="text-lg font-bold">
              {t('home.vault.tree.deleteConfirmTitle', 'Confirm Delete')}
            </h3>
            <p className="py-4">
              {t('home.vault.tree.deleteConfirm', 'Are you sure you want to delete this item?')}
            </p>
            <div className="flex justify-end gap-2">
              <button
                className="btn btn-ghost"
                onClick={() => setConfirmDelete(null)}
                disabled={isDeleting}
              >
                {t('common.cancel', 'Cancel')}
              </button>
              <button
                className="btn btn-error"
                onClick={handleConfirmDelete}
                disabled={isDeleting}
              >
                {isDeleting ? (
                  <>
                    <span className="loading loading-spinner loading-xs"></span>
                    {t('common.deleting', 'Deleting...')}
                  </>
                ) : (
                  t('common.delete', 'Delete')
                )}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
};

export default VaultTree;
