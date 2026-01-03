import { Link } from "@tanstack/react-router";
import { useContext, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useDispatch, useSelector } from "react-redux";
import {
	isCloudVault,
	setCurrentVault,
	updateLastAccessed,
	type Vault,
} from "../../redux/actions/vault";
import type { RootState } from "../../redux/store";
import { VaultManager } from "../../services/vault";
import { isVaultLocked } from "../../services/vaultState";
import { CloudVaultIndicator } from "./CloudVaultIndicator";
import { VaultModalContext } from "./VaultContext";

const VaultSelector = ({
	onAddVault,
	onDeleteVault,
}: {
	onAddVault: () => void;
	onDeleteVault: (vault: Vault) => void;
}) => {
	const { t } = useTranslation("home");
	const dispatch = useDispatch();
	const vaults = useSelector((state: RootState) => state.vault.vaults);
	const currentVaultId = useSelector(
		(state: RootState) => state.vault.currentVaultId,
	);
	const loading = useSelector((state: RootState) => state.vault.loading);
	const error = useSelector((state: RootState) => state.vault.error);
	const providers = useSelector((state: RootState) => state.vault.providers);
	const context = useContext(VaultModalContext);

	const [cloudVaultsLoading, setCloudVaultsLoading] = useState(false);
	const [syncingVaults, setSyncingVaults] = useState<Set<string>>(new Set());
	const [refreshError, setRefreshError] = useState<string | null>(null);

	// Load providers and refresh cloud vaults on mount
	useEffect(() => {
		const initializeCloudVaults = async () => {
			try {
				setCloudVaultsLoading(true);
				setRefreshError(null);

				const vaultManager = VaultManager.getInstance();

				// Initialize VaultManager if not already done
				if (!vaultManager) {
					console.warn("VaultManager not available");
					return;
				}

				// Load providers first
				await vaultManager.loadProviders();

				// Then refresh cloud vaults
				await vaultManager.refreshCloudVaults();
			} catch (error) {
				console.error("Failed to load cloud vaults:", error);
				setRefreshError(
					t("vaultSelector.refreshError", "Failed to refresh cloud vaults"),
				);
			} finally {
				setCloudVaultsLoading(false);
			}
		};

		initializeCloudVaults();
	}, [t]);

	const handleVaultSelect = (vault: Vault) => {
		dispatch(setCurrentVault(vault.id));
		dispatch(updateLastAccessed(vault.id));
	};

	const handleEditVault = (vault: Vault) => {
		if (context) {
			// Set the current vault as the one being edited
			dispatch(setCurrentVault(vault.id));
			context.openEditVaultModal();
		}
	};

	const handleDeleteVault = (vault: Vault) => {
		onDeleteVault(vault);
	};

	const handleSyncVault = async (vault: Vault) => {
		if (!isCloudVault(vault)) return;

		try {
			setSyncingVaults((prev) => new Set(prev).add(vault.id));

			const vaultInstance = VaultManager.getInstance().getInstance(vault.id);
			if (vaultInstance) {
				await vaultInstance.syncWithCloud();
			}
		} catch (error) {
			console.error("Failed to sync vault:", error);
			// Could show a toast or error message here
		} finally {
			setSyncingVaults((prev) => {
				const newSet = new Set(prev);
				newSet.delete(vault.id);
				return newSet;
			});
		}
	};

	const handleRefreshCloudVaults = async () => {
		try {
			setCloudVaultsLoading(true);
			setRefreshError(null);

			const vaultManager = VaultManager.getInstance();
			await vaultManager.refreshCloudVaults();
		} catch (error) {
			console.error("Failed to refresh cloud vaults:", error);
			setRefreshError(
				t("vaultSelector.refreshError", "Failed to refresh cloud vaults"),
			);
		} finally {
			setCloudVaultsLoading(false);
		}
	};

	const handleMigrateToCloud = async (vault: Vault) => {
		// This would open a modal to select a provider and migrate
		// For now, we'll just log it
		console.log("Migrate to cloud:", vault.id);
		// Implementation would go here
	};

	const handleMigrateToLocal = async (vault: Vault) => {
		// This would open a modal to select a local path and migrate
		// For now, we'll just log it
		console.log("Migrate to local:", vault.id);
		// Implementation would go here
	};

	const formatLastAccessed = (dateStr?: string) => {
		if (!dateStr) return t("vaultSelector.never");
		const date = new Date(dateStr);
		return isNaN(date.getTime())
			? t("vaultSelector.never")
			: date.toLocaleDateString();
	};

	if (loading) {
		return (
			<div className="flex items-center justify-center h-full w-full">
				<span className="loading loading-spinner loading-md text-primary"></span>
			</div>
		);
	}

	return (
		<div className="h-full w-full flex flex-col">
			<div className="flex p-2 justify-between items-center flex-shrink-0">
				<div className="dropdown">
					<div
						tabIndex={0}
						role="button"
						className="btn btn-outline btn-sm touch-manipulation"
					>
						•••
					</div>
					<ul
						tabIndex={0}
						className="dropdown-content z-[1] menu p-2 shadow bg-base-100 rounded-box w-52 max-w-[calc(100vw-2rem)]"
					>
						<li>
							<a onClick={onAddVault}>{t("vaultSelector.addVault")}</a>
						</li>
						<li>
							<button
								onClick={handleRefreshCloudVaults}
								disabled={cloudVaultsLoading}
							>
								{cloudVaultsLoading ? (
									<>
										<span className="loading loading-spinner loading-xs"></span>
										{t("vaultSelector.syncing")}
									</>
								) : (
									t("vaultSelector.refreshVaults")
								)}
							</button>
						</li>
						<li>
							<Link to="/settings">{t("vaultSelector.settings")}</Link>
						</li>
					</ul>
				</div>

				{/* Cloud vaults loading indicator */}
				{cloudVaultsLoading && (
					<div className="flex items-center gap-2 text-xs text-base-content/60">
						<span className="loading loading-spinner loading-xs"></span>
						{t("vaultSelector.loadingCloudVaults")}
					</div>
				)}
			</div>

			{error && (
				<div className="alert alert-error mx-2 mb-2">
					<span>{error}</span>
				</div>
			)}

			{refreshError && (
				<div className="alert alert-warning mx-2 mb-2">
					<svg
						xmlns="http://www.w3.org/2000/svg"
						className="stroke-current shrink-0 h-6 w-6"
						fill="none"
						viewBox="0 0 24 24"
					>
						<path
							strokeLinecap="round"
							strokeLinejoin="round"
							strokeWidth="2"
							d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.732 16.5c-.77.833.192 2.5 1.732 2.5z"
						/>
					</svg>
					<span>{refreshError}</span>
				</div>
			)}
			{vaults.length === 0 && (
				<div className="text-center p-4">
					<div className="text-base-content opacity-60 mb-2">
						{t("vaultSelector.noVaults")}
					</div>
					<div className="text-sm text-base-content opacity-40">
						{t("vaultSelector.emptyState")}
					</div>
				</div>
			)}
			<ul className="menu rounded-box flex-1 w-full p-2 overflow-y-auto min-h-0">
				{vaults.map((vault) => (
					<li key={vault.id} className="w-full mb-1">
						<div className="flex items-center justify-between w-full gap-1">
							<a
								className={`flex-1 flex flex-col items-start p-3 min-w-0 gap-1.5 ${
									currentVaultId === vault.id ? "menu-active" : ""
								}`}
								onClick={() => handleVaultSelect(vault)}
							>
								{/* Vault name with status icons on same row */}
								<div className="flex items-center justify-between w-full gap-2">
									<span
										className="font-semibold truncate flex-1 min-w-0"
										title={vault.name}
									>
										{vault.name}
									</span>
									{/* Lock status icon only */}
									{isVaultLocked(vault) ? (
										<svg
											className="w-4 h-4 text-warning flex-shrink-0"
											fill="none"
											stroke="currentColor"
											viewBox="0 0 24 24"
											aria-label={t("vaultSelector.locked", "Locked")}
										>
											<path
												strokeLinecap="round"
												strokeLinejoin="round"
												strokeWidth={2}
												d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
											/>
										</svg>
									) : (
										<svg
											className="w-4 h-4 text-success flex-shrink-0"
											fill="none"
											stroke="currentColor"
											viewBox="0 0 24 24"
											aria-label={t("vaultSelector.unlocked", "Unlocked")}
										>
											<path
												strokeLinecap="round"
												strokeLinejoin="round"
												strokeWidth={2}
												d="M5 13l4 4L19 7"
											/>
										</svg>
									)}
								</div>

								{/* Info row: Cloud indicator */}
								<div className="w-full">
									<CloudVaultIndicator vault={vault} showTooltip={false} />
								</div>

								{/* Last accessed */}
								<div className="w-full text-[10px] opacity-70 truncate">
									{t("vaultSelector.lastAccessed")}:{" "}
									{formatLastAccessed(vault.lastAccessed)}
								</div>
							</a>

							<div className="dropdown dropdown-end">
								<div
									tabIndex={0}
									role="button"
									className="btn btn-ghost btn-sm min-h-[36px] h-[36px] px-2 touch-manipulation"
								>
									<svg
										xmlns="http://www.w3.org/2000/svg"
										className="h-4 w-4"
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
									className="dropdown-content z-[1] menu p-2 shadow bg-base-100 rounded-box w-52 max-w-[calc(100vw-2rem)] dropdown-end"
								>
									<li>
										<button
											onClick={(e) => {
												e.stopPropagation();
												handleEditVault(vault);
											}}
										>
											{t("edit", "Edit")}
										</button>
									</li>

									{/* Cloud vault specific actions */}
									{isCloudVault(vault) ? (
										<>
											<li>
												<button
													onClick={(e) => {
														e.stopPropagation();
														handleSyncVault(vault);
													}}
													disabled={syncingVaults.has(vault.id)}
												>
													{syncingVaults.has(vault.id) ? (
														<>
															<span className="loading loading-spinner loading-xs"></span>
															{t("vaultSelector.syncing")}
														</>
													) : (
														t("vaultSelector.syncNow")
													)}
												</button>
											</li>
											<li>
												<button
													onClick={(e) => {
														e.stopPropagation();
														handleMigrateToLocal(vault);
													}}
												>
													{t("vaultSelector.migrateToLocal")}
												</button>
											</li>
										</>
									) : (
										<>
											<li>
												<button
													onClick={(e) => {
														e.stopPropagation();
														handleMigrateToCloud(vault);
													}}
													disabled={providers.length === 0}
												>
													{t("vaultSelector.migrateToCloud")}
												</button>
											</li>
										</>
									)}

									<li>
										<button
											onClick={(e) => {
												e.stopPropagation();
												handleDeleteVault(vault);
											}}
										>
											{t("delete", "Delete")}
										</button>
									</li>
								</ul>
							</div>
						</div>
					</li>
				))}
			</ul>
		</div>
	);
};

export default VaultSelector;
