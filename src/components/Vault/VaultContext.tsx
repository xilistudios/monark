import React, { createContext, useState, ReactNode, useMemo } from 'react';
import { DataEntry, GroupEntry } from '../../interfaces/vault.interface';

/**
 * Interface for vault modal state
 */
interface VaultModalState {
  /** Whether the add entry modal is open */
  isAddEntryModalOpen: boolean;
  /** Path for adding a new entry */
  addEntryPath: string[];
  /** Success callback for add entry modal */
  addEntryOnSuccess?: () => void;
  /** Whether the add group modal is open */
  isAddGroupModalOpen: boolean;
  /** Path for adding a new group */
  addGroupPath: string[];
  /** Success callback for add group modal */
  addGroupOnSuccess?: () => void;
  /** Whether the import CSV modal is open */
  isImportCsvModalOpen: boolean;
  /** Path for CSV import */
  importCsvPath: string[];
  /** Success callback for import CSV modal */
  importCsvOnSuccess?: () => void;
  /** Currently selected entry for details/editing */
  selectedEntry: DataEntry | GroupEntry | null;
  /** Whether the entry details modal is open */
  isDetailsModalOpen: boolean;
  /** Whether the edit entry modal is open */
  isEditEntryModalOpen: boolean;
  /** Whether the edit group modal is open */
  isEditGroupModalOpen: boolean;
  /** Whether the search modal is open */
  isSearchModalOpen: boolean;
}

/**
 * Interface for vault modal actions
 */
interface VaultModalActions {
  /** Opens the add entry modal with the specified path */
  openAddEntryModal: (path: string[], onSuccess?: () => void) => void;
  /** Opens the add group modal with the specified path */
  openAddGroupModal: (path: string[], onSuccess?: () => void) => void;
  /** Opens the import CSV modal with the specified path */
  openImportCsvModal: (path: string[], onSuccess?: () => void) => void;
  /** Opens the entry details modal with the specified entry */
  openEntryDetails: (entry: DataEntry | GroupEntry) => void;
  /** Opens the edit entry modal with the specified entry */
  openEditEntry: (entry: DataEntry) => void;
  /** Opens the edit group modal with the specified entry */
  openEditGroup: (entry: GroupEntry) => void;
  /** Closes the add entry modal and resets its path */
  closeAddEntryModal: () => void;
  /** Closes the add group modal and resets its path */
  closeAddGroupModal: () => void;
  /** Closes the import CSV modal and resets its path */
  closeImportCsvModal: () => void;
  /** Closes all modals and resets their states */
  closeAllModals: () => void;
  /** Sets the search modal open state */
  setIsSearchModalOpen: (open: boolean) => void;
}

/**
 * Combined context type for vault modals
 */
type VaultModalContextType = VaultModalState & VaultModalActions;

/**
 * Context for managing vault modal state and actions
 */
const VaultModalContext = createContext<VaultModalContextType | undefined>(
  undefined
);

/**
 * Props for the VaultModalProvider component
 */
interface VaultModalProviderProps {
  /** Child components to be wrapped by the provider */
  children: ReactNode;
}

/**
 * Provider component for vault modal state management
 * Manages all modal states and provides functions to control them
 */
const VaultModalProvider: React.FC<VaultModalProviderProps> = ({
  children,
}) => {
  // Modal states
  const [isAddEntryModalOpen, setIsAddEntryModalOpen] = useState(false);
  const [addEntryPath, setAddEntryPath] = useState<string[]>([]);
  const [isAddGroupModalOpen, setIsAddGroupModalOpen] = useState(false);
  const [addGroupPath, setAddGroupPath] = useState<string[]>([]);
  const [isImportCsvModalOpen, setIsImportCsvModalOpen] = useState(false);
  const [importCsvPath, setImportCsvPath] = useState<string[]>([]);
  const [selectedEntry, setSelectedEntry] = useState<
    DataEntry | GroupEntry | null
  >(null);
  const [isDetailsModalOpen, setIsDetailsModalOpen] = useState(false);
  const [isEditEntryModalOpen, setIsEditEntryModalOpen] = useState(false);
  const [isEditGroupModalOpen, setIsEditGroupModalOpen] = useState(false);
  const [isSearchModalOpen, setIsSearchModalOpen] = useState(false);

  /**
   * Opens the add entry modal with the specified path
   * @param path - Array of strings representing the path to the entry
   */
  const openAddEntryModal = (path: string[]) => {
    setAddEntryPath(path);
    setIsAddEntryModalOpen(true);
  };

  /**
   * Opens the add group modal with the specified path
   * @param path - Array of strings representing the path to the group
   */
  const openAddGroupModal = (path: string[]) => {
    setAddGroupPath(path);
    setIsAddGroupModalOpen(true);
  };

  /**
   * Opens the import CSV modal with the specified path
   * @param path - Array of strings representing the path for CSV import
   */
  const openImportCsvModal = (path: string[]) => {
    setImportCsvPath(path);
    setIsImportCsvModalOpen(true);
  };

  /**
   * Opens the entry details modal with the specified entry
   * @param entry - The entry or group entry to display details for
   */
  const openEntryDetails = (entry: DataEntry | GroupEntry) => {
    setSelectedEntry(entry);
    setIsDetailsModalOpen(true);
  };

  /**
   * Opens the edit entry modal with the specified entry
   * @param entry - The data entry to edit
   */
  const openEditEntry = (entry: DataEntry) => {
    setSelectedEntry(entry);
    setIsEditEntryModalOpen(true);
  };

  /**
   * Opens the edit group modal with the specified entry
   * @param entry - The group entry to edit
   */
  const openEditGroup = (entry: GroupEntry) => {
    setSelectedEntry(entry);
    setIsEditGroupModalOpen(true);
  };

  /**
   * Closes the add entry modal and resets its path
   */
  const closeAddEntryModal = () => {
    setIsAddEntryModalOpen(false);
    setAddEntryPath([]);
  };

  /**
   * Closes the add group modal and resets its path
   */
  const closeAddGroupModal = () => {
    setIsAddGroupModalOpen(false);
    setAddGroupPath([]);
  };

  /**
   * Closes the import CSV modal and resets its path
   */
  const closeImportCsvModal = () => {
    setIsImportCsvModalOpen(false);
    setImportCsvPath([]);
  };

  /**
   * Closes all modals and resets their states
   */
  const closeAllModals = () => {
    setIsAddEntryModalOpen(false);
    setAddEntryPath([]);
    setIsAddGroupModalOpen(false);
    setAddGroupPath([]);
    setIsImportCsvModalOpen(false);
    setImportCsvPath([]);
    setSelectedEntry(null);
    setIsDetailsModalOpen(false);
    setIsEditEntryModalOpen(false);
    setIsEditGroupModalOpen(false);
  };

  const contextValue: VaultModalContextType = useMemo(
    () => ({
      // State
      isAddEntryModalOpen,
      addEntryPath,
      isAddGroupModalOpen,
      addGroupPath,
      isImportCsvModalOpen,
      importCsvPath,
      selectedEntry,
      isDetailsModalOpen,
      isEditEntryModalOpen,
      isEditGroupModalOpen,
      isSearchModalOpen,
      // Actions
      openAddEntryModal: (path: string[]) => {
        setAddEntryPath(path);
        setIsAddEntryModalOpen(true);
      },
      openAddGroupModal: (path: string[]) => {
        setAddGroupPath(path);
        setIsAddGroupModalOpen(true);
      },
      openImportCsvModal: (path: string[]) => {
        setImportCsvPath(path);
        setIsImportCsvModalOpen(true);
      },
      openEntryDetails,
      openEditEntry,
      openEditGroup,
      closeAddEntryModal,
      closeAddGroupModal,
      closeImportCsvModal,
      setIsSearchModalOpen,
      closeAllModals,
    }),
    [
      isAddEntryModalOpen,
      addEntryPath,
      isAddGroupModalOpen,
      addGroupPath,
      isImportCsvModalOpen,
      importCsvPath,
      selectedEntry,
      isDetailsModalOpen,
      isEditEntryModalOpen,
      isEditGroupModalOpen,
      openAddEntryModal,
      openAddGroupModal,
      openImportCsvModal,
      openEntryDetails,
      openEditEntry,
      openEditGroup,
      closeAddEntryModal,
      closeAddGroupModal,
      closeImportCsvModal,
      closeAllModals,
    ]
  );

  return (
    <VaultModalContext.Provider value={contextValue}>
      {children}
    </VaultModalContext.Provider>
  );
};

/**
 * Custom hook to access the vault modal context
 * @throws {Error} When used outside of VaultModalProvider
 * @returns {VaultModalContextType} The vault modal context value
 */
export { VaultModalProvider, VaultModalContext };
export type { VaultModalState, VaultModalActions, VaultModalProviderProps };
