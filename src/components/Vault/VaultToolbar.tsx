// Import necessary types from vault.interface
/**
 * Vault interface for toolbar props (matches Home.tsx)
 */
interface Vault {
  id: string;
  volatile: {
    navigationPath?: string;
    entries: any[];
  };
}

/**
 * VaultToolbar component for displaying the toolbar header in the vault manager.
 *
 * @param {Object} props - Component props
 * @param {Vault} props.currentVault - Current vault object
 * @param {string[]} props.currentPath - Current navigation path
 * @param {Function} props.handleLockVault - Function to handle vault locking
 * @param {Function} props.t - Translation function
 * @param {boolean} props.isSearchActive - Whether search is currently active
 * @param {Function} props.setIsSearchActive - Function to set search active state
 * @param {Function} props.onSearchToggle - Function to toggle search modal
 */
import { useContext } from 'react';
import { VaultModalContext } from './VaultContext';

/**
 * VaultToolbar component for displaying the toolbar header in the vault manager.
 *
 * @param {Object} props - Component props
 * @param {Vault} props.currentVault - Current vault object
 * @param {string[]} props.currentPath - Current navigation path
 * @param {Function} props.handleLockVault - Function to handle vault locking
 * @param {Function} props.t - Translation function
 * @param {Function} props.onSearchToggle - Function to toggle search modal
 */
const VaultToolbar = ({
  currentVault: _currentVault,
  currentPath,
  handleLockVault,
  t,
  onSearchToggle,
  onOpenSettings,
}: {
  currentVault: Vault;
  currentPath: string[];
  handleLockVault: () => void;
  t: (key: string) => string;
  onSearchToggle: () => void;
  onOpenSettings: () => void;
}) => {
  const context = useContext(VaultModalContext);
  if (!context)
    throw new Error(
      'VaultModalContext must be used within a VaultModalProvider'
    );
  const { openAddEntryModal, openAddGroupModal, openImportCsvModal } = context;

	return (
		<div className="flex items-center justify-between px-6 py-3.5 bg-base-100">
			<div className="flex items-center gap-2.5 flex-wrap">
				<button
					className="btn btn-primary btn-sm shadow-sm hover:shadow active:scale-95 transition-all duration-150 font-semibold"
					onClick={() => openAddEntryModal(currentPath)}
					type="button"
					title={t("vault.manager.addEntry")}
					aria-label={t("vault.manager.addEntry")}
				>
					<svg
						className="w-4 h-4"
						fill="none"
						stroke="currentColor"
						viewBox="0 0 24 24"
					>
						<path
							strokeLinecap="round"
							strokeLinejoin="round"
							strokeWidth={2.5}
							d="M12 4v16m8-8H4"
						/>
					</svg>
				</button>

				<button
					className="btn btn-outline btn-sm border-base-300 hover:bg-base-200 text-base-content/85 hover:text-base-content active:scale-95 transition-all duration-150"
					onClick={() => openAddGroupModal(currentPath)}
					type="button"
					title={t("vault.manager.addGroup")}
					aria-label={t("vault.manager.addGroup")}
				>
					<svg
						className="w-4 h-4 text-base-content/60"
						fill="none"
						stroke="currentColor"
						viewBox="0 0 24 24"
					>
						<path
							strokeLinecap="round"
							strokeLinejoin="round"
							strokeWidth={2}
							d="M9 13h6m-3-3v6m-9 1V7a2 2 0 012-2h6l2 2h6a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z"
						/>
					</svg>
				</button>

				<button
					className="btn btn-outline btn-sm border-base-300 hover:bg-base-200 text-base-content/85 hover:text-base-content active:scale-95 transition-all duration-150"
					onClick={() => openImportCsvModal(currentPath)}
					type="button"
					title={t("vault.manager.importCsv")}
					aria-label={t("vault.manager.importCsv")}
				>
					<svg
						className="w-4 h-4 text-base-content/60"
						fill="none"
						stroke="currentColor"
						viewBox="0 0 24 24"
					>
						<path
							strokeLinecap="round"
							strokeLinejoin="round"
							strokeWidth={2}
							d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"
						/>
					</svg>
				</button>

				<button
					className="btn btn-ghost btn-sm btn-circle text-base-content/70 hover:text-base-content hover:bg-base-200/80 transition-all duration-150"
					onClick={onSearchToggle}
					aria-label={t("vault.manager.search")}
					type="button"
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
							strokeWidth={2.2}
							d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
						/>
					</svg>
				</button>
			</div>
			<div className="flex items-center gap-2">
				<button
					className="btn btn-ghost btn-sm btn-circle text-base-content/70 hover:text-base-content hover:bg-base-200/80 transition-all duration-150"
					onClick={onOpenSettings}
					type="button"
					title={t("vaultSettings.title")}
					aria-label={t("vaultSettings.title")}
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
							d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
						/>
						<path
							strokeLinecap="round"
							strokeLinejoin="round"
							strokeWidth={2}
							d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
						/>
					</svg>
				</button>
				<button
					className="btn btn-ghost btn-sm text-error/80 hover:text-error hover:bg-error/10 border border-error/15 hover:border-error/30 active:scale-95 transition-all duration-150"
					onClick={handleLockVault}
					type="button"
					title={t("vault.manager.lock")}
					aria-label={t("vault.manager.lock")}
				>
					<svg
						className="w-4 h-4"
						fill="none"
						stroke="currentColor"
						viewBox="0 0 24 24"
					>
						<path
							strokeLinecap="round"
							strokeLinejoin="round"
							strokeWidth={2}
							d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
						/>
					</svg>
				</button>
			</div>
		</div>
	);
};

export default VaultToolbar;
