import { Link } from "@tanstack/react-router";
import { useContext, useState } from "react";
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
	const cloudVaultsRefreshing = useSelector(
		(state: RootState) => state.vault.cloudVaultsRefreshing,
	);
	const error = useSelector((state: RootState) => state.vault.error);
	const providers = useSelector((state: RootState) => state.vault.providers);
	const providerStatus = useSelector(
		(state: RootState) => state.vault.providerStatus,
	);
	const context = useContext(VaultModalContext);

	const [syncingVaults, setSyncingVaults] = useState<Set<string>>(new Set());
	const [refreshError, setRefreshError] = useState<string | null>(null);

	// Note: Cloud vaults are initialized in Home.tsx — no duplicate init here

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
			setRefreshError(null);

			const vaultManager = VaultManager.getInstance();
			await vaultManager.refreshCloudVaults();
		} catch (error) {
			console.error("Failed to refresh cloud vaults:", error);
			setRefreshError(
				t("vaultSelector.refreshError", "Failed to refresh cloud vaults"),
			);
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
				<div className="flex gap-2">
					<button
						className="btn btn-ghost btn-sm btn-square"
						onClick={onAddVault}
						title={t("vaultSelector.addVault")}
					>
						<svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
							<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
						</svg>
					</button>
					<button
						className="btn btn-ghost btn-sm btn-square"
						onClick={handleRefreshCloudVaults}
						disabled={cloudVaultsRefreshing}
						title={t("vaultSelector.refreshVaults")}
					>
						{cloudVaultsRefreshing ? (
							<span className="loading loading-spinner loading-xs"></span>
						) : (
							<svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
								<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
							</svg>
						)}
					</button>
				</div>

				{/* Cloud vaults loading indicator */}
				{cloudVaultsRefreshing && (
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

			{Object.entries(providerStatus).some(
				([, status]) => status === "expired",
			) && (
				<div className="alert alert-warning mx-2 mb-2 flex-col items-start gap-2">
					<span>
						{t(
							"vaultSelector.authExpired",
							"Google Drive access expired. Re-authenticate to keep cloud vaults working.",
						)}
					</span>
					{(() => {
						const expiredProvider = Object.entries(providerStatus).find(
							([, status]) => status === "expired",
						)?.[0];
						return expiredProvider ? (
							<button
								className="btn btn-sm btn-warning"
								onClick={() => {
									void VaultManager.getInstance().startProviderReauth(
										expiredProvider,
									);
								}}
							>
								{t("vaultSelector.reAuthenticate", "Re-authenticate")}
							</button>
						) : null;
					})()}
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
			<div className="p-2 flex-shrink-0 border-t border-base-300">
				<Link to="/settings" className="btn btn-ghost btn-sm btn-square" title={t("vaultSelector.settings")}>
					<svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
						<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
						<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
					</svg>
				</Link>
			</div>
		</div>
	);
};

export default VaultSelector;
