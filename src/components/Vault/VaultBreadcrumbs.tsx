import React from 'react';
import { Entry } from '../../interfaces/vault.interface';
import { isGroupEntry } from '../../interfaces/vault.interface';

interface Vault {
  id: string;
  volatile: {
    navigationPath: string;
    entries: Entry[];
  };
}

/**
 * Component for rendering breadcrumb navigation in the vault interface.
 *
 * @param {Object} props - Component props
 * @param {string} props.navigationPath - Current path string from Redux state
 * @param {Vault | null} props.currentVault - Current vault object
 * @param {(path: string[]) => void} props.onNavigate - Navigation handler
 */
const VaultBreadcrumbs: React.FC<{
  navigationPath: string;
  currentVault: Vault | null;
  onNavigate: (path: string[]) => void;
}> = ({ navigationPath, currentVault, onNavigate }) => {
  /**
   * Finds an entry by its path in the vault structure.
   *
   * @param {Entry[]} entries - Array of entries to search through
   * @param {string[]} pathParts - Array of path parts to navigate through
   * @returns {Entry | null} The found entry or null if not found
   */
  const findEntryByPath = (
    entries: Entry[],
    pathParts: string[]
  ): Entry | null => {
    if (pathParts.length === 0) return null;

    let currentEntries = entries;
    let foundEntry: Entry | null = null;

    for (const id of pathParts) {
      const entry = currentEntries.find((e: Entry) => e.id === id);
      if (!entry) return null;

      foundEntry = entry;

      if (isGroupEntry(entry)) {
        currentEntries = entry.children;
      } else {
        break;
      }
    }

    return foundEntry;
  };

  const renderBreadcrumbs = () => {
    const parts = navigationPath.split('/').filter(Boolean);

    return (
      <div className="breadcrumbs text-sm p-4 border-b border-base-300">
        <ul>
          <li>
            <a
              onClick={() => {
                if (currentVault) {
                  onNavigate([]);
                }
              }}
            >
              /
            </a>
          </li>
          {parts.map((id, index) => {
            const pathUpTo = parts.slice(0, index + 1);
            const entry = currentVault?.volatile?.entries
              ? findEntryByPath(currentVault.volatile.entries, pathUpTo)
              : null;

            if (!entry) return null;

            return (
              <li key={id}>
                <a
                  onClick={() => {
                    if (currentVault) {
                      onNavigate(pathUpTo);
                    }
                  }}
                >
                  {entry.name}
                </a>
              </li>
            );
          })}
        </ul>
      </div>
    );
  };

  return renderBreadcrumbs();
};

export default VaultBreadcrumbs;
