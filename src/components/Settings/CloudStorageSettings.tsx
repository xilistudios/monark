/**
 * CloudStorageSettings component for managing cloud storage providers
 * Displays provider list, status, and provides management actions
 * @module CloudStorageSettings
 */

import { useContext, useState } from "react";
import { useTranslation } from "react-i18next";
import { useDispatch, useSelector } from "react-redux";
import type { StorageProvider } from "../../interfaces/cloud-storage.interface";
import { StorageProviderType } from "../../interfaces/cloud-storage.interface";
import {
	removeStorageProvider,
	setDefaultStorageProvider,
	setProviderStatus,
} from "../../redux/actions/vault";
import {
	selectDefaultProvider,
	selectProviderStatus,
	selectProviders,
	selectVaultLoading,
} from "../../redux/selectors/vaultSelectors";
import { CloudStorageCommands } from "../../services/cloudStorage";
import { VaultManager } from "../../services/vault";
import { Modal } from "../UI/Modal";
import { ProviderStatusBadge } from "../Vault/ProviderStatusBadge";
import { VaultModalContext } from "../Vault/VaultContext";

type ProviderStatus =
	| "idle"
	| "authenticating"
	| "authenticated"
	| "expired"
	| "error";

export const CloudStorageSettings = () => {
	const { t } = useTranslation("settings");
	const dispatch = useDispatch();
	const context = useContext(VaultModalContext);

	const providers = useSelector(selectProviders);
	const defaultProvider = useSelector(selectDefaultProvider);
	const providerStatus = useSelector(selectProviderStatus);
	const loading = useSelector(selectVaultLoading);

	const [authenticatingProvider, setAuthenticatingProvider] = useState<
		string | null
	>(null);

	const [confirmRemove, setConfirmRemove] = useState<{
		isOpen: boolean;
		providerName: string | null;
	}>({ isOpen: false, providerName: null });
	const [isRemoving, setIsRemoving] = useState(false);

	const handleAuthenticate = async (provider: StorageProvider) => {
		console.log(
			"[CloudStorageSettings] Starting authentication for provider:",
			provider.name,
		);
		setAuthenticatingProvider(provider.name);
		dispatch(
			setProviderStatus({
				providerId: provider.name,
				status: "authenticating",
			}),
		);

		try {
			// Check if this is a Google Drive provider
			if (provider.provider_type === StorageProviderType.GOOGLE_DRIVE) {
				console.log(
					"[CloudStorageSettings] Starting Google Drive re-auth flow",
				);
				await VaultManager.getInstance().startProviderReauth(provider.name);
			} else {
				// For other providers, use the old flow
				console.log("[CloudStorageSettings] Using legacy authentication flow");
				await CloudStorageCommands.authenticateProvider(provider.name);
				dispatch(
					setProviderStatus({
						providerId: provider.name,
						status: "authenticated",
					}),
				);
			}
		} catch (error) {
			console.error("[CloudStorageSettings] Authentication failed:", error);
			console.error(
				"[CloudStorageSettings] Error details:",
				JSON.stringify(error, null, 2),
			);
			console.error(
				"[CloudStorageSettings] Error message:",
				error instanceof Error ? error.message : String(error),
			);
			console.error(
				"[CloudStorageSettings] Error keys:",
				error ? Object.keys(error as any) : "null",
			);
			console.error("[CloudStorageSettings] Error type:", typeof error);
			dispatch(
				setProviderStatus({ providerId: provider.name, status: "error" }),
			);
		} finally {
			setAuthenticatingProvider(null);
		}
	};

	const handleSetAsDefault = async (providerName: string) => {
		try {
			const vaultManager = VaultManager.getInstance();
			await vaultManager.setDefaultProvider(providerName);
			dispatch(setDefaultStorageProvider(providerName));
		} catch (error) {
			console.error("Failed to set default provider:", error);
		}
	};

	const handleRemoveProvider = (providerName: string) => {
		setConfirmRemove({ isOpen: true, providerName });
	};

	const handleConfirmRemove = async () => {
		if (!confirmRemove.providerName) return;

		setIsRemoving(true);
		try {
			const vaultManager = VaultManager.getInstance();
			await vaultManager.removeProvider(confirmRemove.providerName);
			dispatch(removeStorageProvider(confirmRemove.providerName));
		} catch (error) {
			console.error("Failed to remove provider:", error);
		} finally {
			setIsRemoving(false);
			setConfirmRemove({ isOpen: false, providerName: null });
		}
	};

	const getProviderTypeLabel = (type: string) => {
		switch (type) {
			case "google_drive":
				return t("cloudStorage.googleDrive", "Google Drive");
			default:
				return type;
		}
	};

	return (
		<section>
			<div className="flex items-center justify-between mb-6">
				<div>
					<h2 className="text-xl font-semibold text-base-content mb-2">
						{t("cloudStorage.title", "Cloud Storage")}
					</h2>
					<p className="text-sm text-base-content/60">
						{t(
							"cloudStorage.description",
							"Manage your cloud storage providers",
						)}
					</p>
				</div>
				<button
					className="px-4 py-2 bg-primary text-primary-content rounded-lg font-medium hover:bg-primary/90 focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
					onClick={() => context?.openAddProviderModal()}
					disabled={!context || loading}
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
							d="M12 4v16m8-8H4"
						/>
					</svg>
					{t("cloudStorage.addProvider", "Add Provider")}
				</button>
			</div>

			{providers.length === 0 ? (
				<div className="flex items-start gap-4 p-6 bg-base-50 border border-base-200 rounded-xl">
					<div className="p-3 bg-primary/10 rounded-lg shrink-0">
						<svg
							className="w-6 h-6 text-primary"
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
					</div>
					<div>
						<h3 className="font-semibold text-base-content mb-1">
							{t(
								"cloudStorage.noProviders",
								"No cloud storage providers configured",
							)}
						</h3>
						<p className="text-sm text-base-content/60">
							{t(
								"cloudStorage.addProviderHint",
								"Add a provider to start using cloud storage for your vaults",
							)}
						</p>
					</div>
				</div>
			) : (
				<div className="space-y-4">
					{providers.map((provider) => {
						const status = (providerStatus[provider.name] ||
							"idle") as ProviderStatus;
						const isExpired = status === "expired";
						const isDefault = provider.name === defaultProvider;
						const isAuthenticating = authenticatingProvider === provider.name;

						return (
							<div
								key={provider.name}
								className="bg-base-50 border border-base-200 rounded-xl p-6 hover:border-base-300 transition-colors duration-200"
							>
								<div className="flex items-start justify-between gap-4">
									<div className="flex-1 min-w-0">
										<div className="flex items-center gap-3 mb-3">
											<h3 className="text-lg font-semibold text-base-content truncate">
												{provider.name}
											</h3>
											{isDefault && (
												<span className="px-2.5 py-1 bg-primary/10 text-primary text-xs font-medium rounded-full">
													{t("cloudStorage.defaultProvider", "Default")}
												</span>
											)}
										</div>

										<div className="flex items-center gap-4">
											<span className="text-sm text-base-content/60">
												{getProviderTypeLabel(provider.provider_type)}
											</span>
											<ProviderStatusBadge status={status} />
										</div>
										{isExpired && (
											<div className="mt-3 alert alert-warning py-2 px-3 text-sm">
												<span>
													{t(
														"cloudStorage.tokenExpired",
														"The token for this provider expired. Re-authenticate to continue.",
													)}
												</span>
											</div>
										)}
									</div>

									<div className="flex flex-wrap gap-2 shrink-0">
										{(status === "idle" || isExpired) && (
											<button
												className="px-3 py-2 bg-base-100 border border-base-300 text-base-content rounded-lg text-sm font-medium hover:bg-base-200 hover:border-base-400 focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
												onClick={() => handleAuthenticate(provider)}
												disabled={isAuthenticating || loading}
											>
												{isAuthenticating ? (
													<>
														<span className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin"></span>
														{t(
															"cloudStorage.authenticating",
															"Authenticating...",
														)}
													</>
												) : isExpired ? (
													t("cloudStorage.reAuthenticate", "Re-authenticate")
												) : (
													t("cloudStorage.authenticate", "Authenticate")
												)}
											</button>
										)}

										{status === "authenticated" &&
											provider.provider_type ===
												StorageProviderType.GOOGLE_DRIVE && (
												<button
													className="px-3 py-2 bg-base-100 border border-base-300 text-base-content rounded-lg text-sm font-medium hover:bg-base-200 hover:border-base-400 focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
													onClick={() => handleAuthenticate(provider)}
													disabled={isAuthenticating || loading}
												>
													{isAuthenticating ? (
														<>
															<span className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin"></span>
															{t(
																"cloudStorage.authenticating",
																"Authenticating...",
															)}
														</>
													) : (
														t("cloudStorage.reAuthenticate", "Re-authenticate")
													)}
												</button>
											)}

										{status === "authenticated" && !isDefault && (
											<button
												className="px-3 py-2 bg-base-100 border border-base-300 text-base-content rounded-lg text-sm font-medium hover:bg-base-200 hover:border-base-400 focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
												onClick={() => handleSetAsDefault(provider.name)}
												disabled={loading}
											>
												{t("cloudStorage.setAsDefault", "Set as Default")}
											</button>
										)}

										<button
											className="px-3 py-2 bg-error/10 border border-error/20 text-error rounded-lg text-sm font-medium hover:bg-error/20 hover:border-error/30 focus:outline-none focus:ring-2 focus:ring-error/20 transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
											onClick={() => handleRemoveProvider(provider.name)}
											disabled={loading || isDefault}
										>
											{t("cloudStorage.remove", "Remove")}
										</button>
									</div>
								</div>
							</div>
						);
					})}
				</div>
			)}

			{/* Help Section */}
			<details className="group mt-6">
				<summary className="flex items-center justify-between p-4 bg-base-50 border border-base-200 rounded-xl cursor-pointer hover:bg-base-100 transition-colors duration-200 list-none">
					<span className="font-medium text-base-content">
						{t("cloudStorage.help.title", "Help & Documentation")}
					</span>
					<svg
						className="w-5 h-5 text-base-content/60 group-open:rotate-180 transition-transform duration-200"
						fill="none"
						stroke="currentColor"
						viewBox="0 0 24 24"
					>
						<path
							strokeLinecap="round"
							strokeLinejoin="round"
							strokeWidth={2}
							d="M19 9l-7 7-7-7"
						/>
					</svg>
				</summary>
				<div className="mt-4 p-6 bg-base-50 border border-base-200 rounded-xl space-y-6">
					<div>
						<h4 className="text-sm font-semibold text-base-content mb-2">
							{t("cloudStorage.help.gettingStarted", "Getting Started")}
						</h4>
						<p className="text-sm text-base-content/70">
							{t(
								"cloudStorage.help.gettingStartedText",
								"To use cloud storage, you need to configure OAuth credentials for your cloud provider.",
							)}
						</p>
					</div>

					<div>
						<h4 className="text-sm font-semibold text-base-content mb-3">
							{t("cloudStorage.help.googleDrive", "Google Drive Setup")}
						</h4>
						<ol className="space-y-2 text-sm text-base-content/70">
							<li className="flex gap-3">
								<span className="w-5 h-5 flex items-center justify-center bg-primary/10 text-primary text-xs font-medium rounded-full shrink-0">
									1
								</span>
								{t(
									"cloudStorage.help.googleStep1",
									"Go to Google Cloud Console",
								)}
							</li>
							<li className="flex gap-3">
								<span className="w-5 h-5 flex items-center justify-center bg-primary/10 text-primary text-xs font-medium rounded-full shrink-0">
									2
								</span>
								{t(
									"cloudStorage.help.googleStep2",
									"Create a new project or select an existing one",
								)}
							</li>
							<li className="flex gap-3">
								<span className="w-5 h-5 flex items-center justify-center bg-primary/10 text-primary text-xs font-medium rounded-full shrink-0">
									3
								</span>
								{t(
									"cloudStorage.help.googleStep3",
									"Enable the Google Drive API",
								)}
							</li>
							<li className="flex gap-3">
								<span className="w-5 h-5 flex items-center justify-center bg-primary/10 text-primary text-xs font-medium rounded-full shrink-0">
									4
								</span>
								{t(
									"cloudStorage.help.googleStep4",
									"Create OAuth 2.0 credentials",
								)}
							</li>
							<li className="flex gap-3">
								<span className="w-5 h-5 flex items-center justify-center bg-primary/10 text-primary text-xs font-medium rounded-full shrink-0">
									5
								</span>
								{t(
									"cloudStorage.help.googleStep5",
									"Add the redirect URI to your OAuth consent screen",
								)}
							</li>
						</ol>
					</div>

					<div className="flex items-start gap-3 p-4 bg-warning/10 border border-warning/20 rounded-lg">
						<svg
							className="w-5 h-5 text-warning shrink-0 mt-0.5"
							fill="none"
							stroke="currentColor"
							viewBox="0 0 24 24"
						>
							<path
								strokeLinecap="round"
								strokeLinejoin="round"
								strokeWidth={2}
								d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
							/>
						</svg>
						<div>
							<h4 className="text-sm font-semibold text-base-content mb-1">
								{t("cloudStorage.help.security", "Security Notes")}
							</h4>
							<p className="text-sm text-base-content/70">
								{t(
									"cloudStorage.help.securityText",
									"Your credentials are stored locally and encrypted. Never share your client secrets with others.",
								)}
							</p>
						</div>
					</div>
				</div>
			</details>

			{/* Confirm Remove Modal */}
			{confirmRemove.isOpen && (
				<Modal
					isOpen={confirmRemove.isOpen}
					onClose={() =>
						setConfirmRemove({ isOpen: false, providerName: null })
					}
				>
					<div className="p-6">
						<div className="flex items-start gap-4 mb-4">
							<div className="p-3 bg-error/10 rounded-lg shrink-0">
								<svg
									className="w-6 h-6 text-error"
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
							</div>
							<div>
								<h3 className="text-lg font-semibold text-base-content mb-2">
									{t("cloudStorage.confirmRemoveTitle", "Confirm Removal")}
								</h3>
								<p className="text-sm text-base-content/70">
									{t(
										"cloudStorage.confirmRemove",
										"Are you sure you want to remove this provider?",
									)}
								</p>
							</div>
						</div>
						<div className="flex justify-end gap-3 mt-6">
							<button
								className="px-4 py-2 bg-base-100 border border-base-300 text-base-content rounded-lg font-medium hover:bg-base-200 focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
								onClick={() =>
									setConfirmRemove({ isOpen: false, providerName: null })
								}
								disabled={isRemoving}
							>
								{t("common.cancel", "Cancel")}
							</button>
							<button
								className="px-4 py-2 bg-error text-error-content rounded-lg font-medium hover:bg-error/90 focus:outline-none focus:ring-2 focus:ring-error/20 transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
								onClick={handleConfirmRemove}
								disabled={isRemoving}
							>
								{isRemoving ? (
									<>
										<span className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin"></span>
										{t("common.removing", "Removing...")}
									</>
								) : (
									t("common.remove", "Remove")
								)}
							</button>
						</div>
					</div>
				</Modal>
			)}
		</section>
	);
};
