import { useContext, useEffect, useMemo, useRef } from 'react';
import { VaultModalContext } from './VaultContext';
import { useTranslation } from 'react-i18next';
import { flattenEntries } from '../../utils/vaultSearch';

const VaultSearchBar = ({
  currentVault,
  handleSearchResultSelect,
}: {
  currentVault: {
    id: string;
    volatile: {
      entries: any[];
    };
  };
  handleSearchResultSelect: (item: { entry: any; path: string[] }) => void;
}) => {
  const searchInputRef = useRef<HTMLInputElement>(null);
  const { t } = useTranslation();
  const { setIsSearchModalOpen, isSearchModalOpen, searchQuery, setSearchQuery } =
    useContext(VaultModalContext)!;
  /**
   * Flattens all entries in the vault for search functionality.
   * This includes entries from all groups and subgroups.
   */
  const allEntries = useMemo(() => {
    return flattenEntries(currentVault.volatile.entries || []);
  }, [currentVault.volatile.entries]);

  /**
   * Filters entries based on the search query.
   * Only returns results when searchQuery is not empty and search is active.
   */
  const filteredEntries = useMemo(() => {
    if (!searchQuery.trim() || !isSearchModalOpen) return [];
    return allEntries
      .filter((item) =>
        item.entry.name.toLowerCase().includes(searchQuery.toLowerCase())
      )
      .slice(0, 10);
  }, [allEntries, searchQuery, isSearchModalOpen]);
  /**
   * Handles global keyboard shortcuts for focusing the search input.
   * Platform-aware shortcut detection (Ctrl+F or Cmd+F)
   */
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      // Open search modal with Ctrl+F/Cmd+F
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f') {
        event.preventDefault();
        setIsSearchModalOpen(true);
        setTimeout(() => searchInputRef.current?.focus(), 0);
      }
      // Close modal with Escape
      if (event.key === 'Escape' && isSearchModalOpen) {
        event.preventDefault();
        setIsSearchModalOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isSearchModalOpen]);
  return (
    <div
      className={`fixed inset-0 flex items-center justify-center ${
        isSearchModalOpen ? 'block z-50 ' : 'hidden'
      }`}
      role="dialog"
      aria-modal="true"
      aria-labelledby="search-modal-title"
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black opacity-50"
        onClick={() => setIsSearchModalOpen(false)}
      />

      {/* Modal content */}
      <div
        className="relative bg-base-100 w-full max-w-md h-[80vh] md:h-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Search input header */}
        <div className="p-4 border-b border-base-300">
          <h2 id="search-modal-title" className="sr-only">
            {t('vault.manager.search')}
          </h2>
          <input
            ref={searchInputRef}
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full input input-bordered"
            placeholder={t('vault.manager.search')}
            aria-label={t('vault.manager.search')}
          />
        </div>

        {/* Results list */}
        <div className="flex-1 overflow-auto p-4">
          {filteredEntries.length > 0 ? (
            filteredEntries.map((item) => (
              <div
                key={item.entry.id}
                onClick={() => handleSearchResultSelect(item)}
                className="p-2 hover:bg-base-200 cursor-pointer border-b border-base-300 last:border-b-0"
              >
                <div className="font-medium">{item.entry.name}</div>
                <div className="text-sm text-base-content/60">
                  {item.entry.fields[0]?.value ||
                    t('vault.manager.noDescription')}
                </div>
              </div>
            ))
          ) : (
            <div className="text-center py-4">
              {t('vault.manager.noSearchResults')}
            </div>
          )}
        </div>

        {/* Close button for mobile */}
        <button
          onClick={() => setIsSearchModalOpen(false)}
          className="btn btn-ghost absolute top-4 right-4 md:hidden"
          aria-label={t('close')}
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
    </div>
  );
};

export default VaultSearchBar;
