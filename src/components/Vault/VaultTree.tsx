import { useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { type Entry, isGroupEntry } from '../../interfaces/vault.interface';
import { VaultManager } from '../../services/vault';
import { useContext } from 'react';
import { VaultModalContext } from './VaultContext';

/**
 * Props for VaultTree component.
 * @property vaultId - The ID of the vault.
 * @property entries - The list of entries to display.
 * @property basePath - The base path for the tree.
 * @property onNavigate - Handler for navigating to a group.
 */
interface VaultTreeProps {
  vaultId: string;
  entries: Entry[];
  basePath: string[];
  onNavigate: (vaultId: string, path: string[]) => void;
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
}: TreeNodeProps) => {
  const { t } = useTranslation();
  const context = useContext(VaultModalContext);
  if (!context)
    throw new Error(
      'VaultModalContext must be used within a VaultModalProvider'
    );
  const { openEditEntry, openEditGroup, openEntryDetails } = context;

  const handleNavigate = useCallback(() => {
    if (isGroupEntry(entry)) {
      onNavigate(vaultId, currentPath);
    } else {
      openEntryDetails(entry);
    }
  }, [entry, vaultId, onNavigate, openEntryDetails, currentPath]);

  const getIndentStyle = useCallback(() => {
    const baseIndent = level * 24; // 24px per level
    return {
      paddingLeft: `${baseIndent + 12}px`,
      marginLeft: level > 0 ? '12px' : '0',
    };
  }, [level]);

  const renderTreeLines = useCallback(() => {
    if (level === 0) return null;

    return (
      <div
        className="absolute left-0 top-0 bottom-0 w-px bg-base-300"
        style={{ left: `${(level - 1) * 24 + 12}px` }}
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
    <div className="relative">
      {renderTreeLines()}
      <div className="relative">
        <div
          className="flex items-center justify-between bg-base-200 hover:bg-base-300 transition-colors rounded-lg border border-base-300"
          style={getIndentStyle()}
        >
          <div
            className="flex items-center cursor-pointer flex-1 py-2 px-3"
            onClick={handleNavigate}
          >
            <div className="flex items-center">
              {isGroupEntry(entry) ? (
                <svg
                  className="w-4 h-4 mr-2 text-primary"
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
                  className="w-4 h-4 mr-2 text-secondary"
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
              <span className="font-medium text-sm">{entry.name}</span>
            </div>
          </div>

          <div className="flex gap-1 px-2">
            <button
              className="btn btn-xs btn-accent"
              onClick={() =>
                isGroupEntry(entry)
                  ? openEditGroup(entry)
                  : openEditEntry(entry)
              }
              title={t('home.vault.tree.edit')}
            >
              <svg
                className="w-3 h-3"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
                />
              </svg>
            </button>
            <button
              className="btn btn-xs btn-error"
              onClick={() => onDelete(vaultId, currentPath)}
              disabled={deletingId === entry.id}
              title={t('home.vault.tree.delete')}
            >
              {deletingId === entry.id ? (
                <span className="loading loading-spinner loading-xs"></span>
              ) : (
                <svg
                  className="w-3 h-3"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                  />
                </svg>
              )}
            </button>
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
const VaultTree = ({
  vaultId,
  entries,
  basePath,
  onNavigate,
}: VaultTreeProps) => {
  const { t } = useTranslation();
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const handleDelete = useCallback(
    async (vaultId: string, path: string[]) => {
      if (confirm(t('home.vault.tree.deleteConfirm'))) {
        const entryId = path[path.length - 1];
        setDeletingId(entryId);
        try {
          if (vaultId) {
            // Get the VaultInstance from VaultManager
            const vaultInstance =
              VaultManager.getInstance().getInstance(vaultId);
            if (vaultInstance) {
              // Delete the entry using VaultManager
              await vaultInstance.deleteEntry(path);
            }
          }
        } catch (err) {
          console.error('Delete failed:', err);
        } finally {
          setDeletingId(null);
        }
      }
    },
    [t]
  );

  const renderEmptyState = useCallback(
    () => (
      <div className="text-center py-12">
        <div className="text-base-content/60 mb-4">
          <svg
            className="w-16 h-16 mx-auto"
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
        <p className="text-base-content/70">{t('home.vault.tree.noEntries')}</p>
        <div className="mt-4">
          <p className="text-sm text-base-content/60">
            {t('home.vault.tree.importOrCreateVault')}
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
    <div className="w-full">
      {processedEntries.length === 0 ? (
        renderEmptyState()
      ) : (
        <div className="space-y-1">
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
            />
          ))}
        </div>
      )}
    </div>
  );
};

export default VaultTree;
