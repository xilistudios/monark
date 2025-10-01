import { useContext, useEffect, useMemo, useRef, useState } from 'react';
import { VaultModalContext } from './VaultContext';
import { useTranslation } from 'react-i18next';
import { flattenEntries } from '../../utils/vaultSearch';

// Constants for height calculations
const MIN_RESULT_ITEM_HEIGHT = 80;
const MAX_RESULTS_HEIGHT = 400;
const NO_RESULTS_HEIGHT = 80;

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
  const resultsContainerRef = useRef<HTMLDivElement>(null);
  const [resultsHeight, setResultsHeight] = useState<number>(0);
  const { t } = useTranslation('home');
  const {
    setIsSearchModalOpen,
    isSearchModalOpen,
    searchQuery,
    setSearchQuery,
  } = useContext(VaultModalContext)!;
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
   * Calculate the actual height of search results
   */
  const calculateResultsHeight = useMemo(() => {
    if (filteredEntries.length === 0) {
      return searchQuery.trim() && isSearchModalOpen ? NO_RESULTS_HEIGHT : 0;
    }

    // If we have a mounted container, try to measure actual content
    if (resultsContainerRef.current) {
      // Create a temporary measurement approach
      // Since we can't easily measure each item individually in React without DOM refs,
      // we'll estimate based on content length
      let totalHeight = 0;
      filteredEntries.forEach((item) => {
        const nameLength = item.entry.name?.length || 0;
        const descriptionLength = item.entry.fields[0]?.value?.length || 0;

        // Estimate height based on content
        // Base height + potential extra height for long descriptions
        let itemHeight = MIN_RESULT_ITEM_HEIGHT;

        // Add extra height for longer descriptions (rough estimate)
        if (descriptionLength > 50) {
          itemHeight += Math.ceil(descriptionLength / 50) * 20;
        }

        // Add extra height for very long names
        if (nameLength > 30) {
          itemHeight += 20;
        }

        totalHeight += itemHeight;
      });

      return Math.min(totalHeight, MAX_RESULTS_HEIGHT);
    }

    // Fallback to simple calculation
    return Math.min(
      filteredEntries.length * MIN_RESULT_ITEM_HEIGHT,
      MAX_RESULTS_HEIGHT
    );
  }, [filteredEntries, searchQuery, isSearchModalOpen]);

  /**
   * Update height when calculated height changes
   */
  useEffect(() => {
    setResultsHeight(calculateResultsHeight);
  }, [calculateResultsHeight]);

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
        className="relative bg-base-100 w-full max-w-md md:h-auto"
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

        {/* Results list with animated height */}
        <div
          className="overflow-hidden transition-all duration-300 ease-in-out"
          style={{ height: `${resultsHeight}px` }}
          aria-live="polite"
        >
          <div ref={resultsContainerRef} className="overflow-auto p-4">
            {filteredEntries.length > 0 ? (
              filteredEntries.map((item) => (
                <div
                  key={item.entry.id}
                  onClick={() => handleSearchResultSelect(item)}
                  className="p-2 hover:bg-base-200 cursor-pointer border-b border-base-300 last:border-b-0"
                >
                  <div className="font-medium truncate">{item.entry.name}</div>
                  <div className="text-sm text-base-content/60 break-words">
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
