import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useDispatch, useSelector } from "react-redux";
import {
	getVaultProvider,
	isCloudVault,
	setVaultBiometricEnabled,
	updateVault,
	type Vault,
} from "../../redux/actions/vault";
import type { RootState } from "../../redux/store";
import { VaultManager } from "../../services/vault";
import { BiometricSettings } from "../Settings/BiometricSettings";

interface VaultSettingsPanelProps {
	vault: Vault;
	onClose: () => void;
	onDeleteVault: (vault: Vault) => void;
}

type TabType = "general" | "security" | "cloud" | "danger";

export function VaultSettingsPanel({
	vault,
	onClose,
	onDeleteVault,
}: VaultSettingsPanelProps) {
	const { t } = useTranslation("home");
	const dispatch = useDispatch();

	// Redux selectors
	const currentVaultFromRedux = useSelector((state: RootState) =>
		state.vault.vaults.find((v) => v.id === vault.id),
	);
	const providers = useSelector((state: RootState) => state.vault.providers);
	const providerStatus = useSelector(
		(state: RootState) => state.vault.providerStatus,
	);

	const biometricEnabled = currentVaultFromRedux?.biometricEnabled ?? false;
	const isCloud = isCloudVault(vault);
	const provider = getVaultProvider(vault, providers);

	// State
	const [activeTab, setActiveTab] = useState<TabType>("general");
	const [vaultName, setVaultName] = useState(vault.name);
	const [nameSaved, setNameSaved] = useState(false);
	const [newPassword, setNewPassword] = useState("");
	const [confirmPassword, setConfirmPassword] = useState("");
	const [passwordError, setPasswordError] = useState("");
	const [passwordChanged, setPasswordChanged] = useState(false);
	const [syncing, setSyncing] = useState(false);
	const [syncError, setSyncError] = useState<string | null>(null);

	// Handlers
	const handleSaveName = () => {
		if (!vaultName.trim() || vaultName.trim() === vault.name) return;
		const updatedVault: Vault = { ...vault, name: vaultName.trim() };
		dispatch(updateVault(updatedVault));
		setNameSaved(true);
		setTimeout(() => setNameSaved(false), 3000);
	};

	const handleChangePassword = async () => {
		if (!newPassword) return;
		if (newPassword !== confirmPassword) {
			setPasswordError(t("vaultSettings.security.passwordMismatch"));
			return;
		}
		setPasswordError("");
		try {
			await VaultManager.getInstance().changeVaultPassword(
				vault.id,
				newPassword,
			);
			setNewPassword("");
			setConfirmPassword("");
			setPasswordChanged(true);
			setTimeout(() => setPasswordChanged(false), 3000);
		} catch (err) {
			setPasswordError(String(err));
		}
	};

	const handleSync = async () => {
		setSyncing(true);
		setSyncError(null);
		try {
			const vaultInstance = VaultManager.getInstance().getInstance(vault.id);
			if (vaultInstance) {
				await vaultInstance.syncWithCloud();
			}
		} catch (err) {
			setSyncError(String(err));
		} finally {
			setSyncing(false);
		}
	};

	const formatLastSync = (dateStr?: string) => {
		if (!dateStr) return t("vaultSelector.never");
		const date = new Date(dateStr);
		const now = new Date();
		const diffMs = now.getTime() - date.getTime();
		const diffMins = Math.floor(diffMs / 60000);
		const diffHours = Math.floor(diffMins / 60);
		const diffDays = Math.floor(diffHours / 24);

		if (diffMins < 1) return t("vaultSelector.never");
		if (diffMins < 60)
			return `${diffMins} ${t("vaultSelector.minutesAgo", "minutes ago")}`;
		if (diffHours < 24)
			return `${diffHours} ${t("vaultSelector.hoursAgo", "hours ago")}`;
		return `${diffDays} ${t("vaultSelector.daysAgo", "days ago")}`;
	};

	return (
		<div className="flex flex-col h-full bg-base-100 text-base-content">
			{/* Header */}
			<div className="flex flex-col border-b border-base-200 bg-base-100/90 backdrop-blur-sm sticky top-0 z-10">
				<div className="flex items-center gap-4 px-8 py-6 pb-4">
					<button
						type="button"
						className="btn btn-ghost btn-sm btn-circle hover:bg-base-200 transition-colors"
						onClick={onClose}
						aria-label={t("vaultSettings.back")}
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
								d="M10 19l-7-7m0 0l7-7m-7 7h18"
							/>
						</svg>
					</button>
					<div>
						<h2 className="text-xl font-medium tracking-tight">{t("vaultSettings.title")}</h2>
					</div>
				</div>
				
				{/* Tabs */}
				<div className="px-8">
					<div className="tabs tabs-bordered flex-nowrap overflow-x-auto">
						<button
							type="button"
							className={`tab tab-lg px-6 ${activeTab === "general" ? "tab-active font-semibold" : "text-base-content/70"}`}
							onClick={() => setActiveTab("general")}
						>
							{t("vaultSettings.general.title")}
						</button>
						<button
							type="button"
							className={`tab tab-lg px-6 ${activeTab === "security" ? "tab-active font-semibold" : "text-base-content/70"}`}
							onClick={() => setActiveTab("security")}
						>
							{t("vaultSettings.security.title")}
						</button>
						{isCloud && (
							<button
								type="button"
								className={`tab tab-lg px-6 ${activeTab === "cloud" ? "tab-active font-semibold" : "text-base-content/70"}`}
								onClick={() => setActiveTab("cloud")}
							>
								{t("vaultSettings.cloudSync.title")}
							</button>
						)}
						<button
							type="button"
							className={`tab tab-lg px-6 transition-colors ${activeTab === "danger" ? "tab-active font-semibold text-error border-error" : "text-base-content/70 hover:text-error"}`}
							onClick={() => setActiveTab("danger")}
						>
							{t("vaultSettings.dangerZone.title")}
						</button>
					</div>
				</div>
			</div>

			{/* Scrollable Content */}
			<div className="flex-1 overflow-y-auto p-8 max-w-3xl w-full">
				<div className="animate-in fade-in slide-in-from-bottom-2 duration-300">
					{activeTab === "general" && (
						<section>
							<h3 className="text-sm font-semibold uppercase tracking-widest text-base-content/60 mb-6">
								{t("vaultSettings.general.title")}
							</h3>
							
							<div className="space-y-6">
								<div className="flex flex-col sm:flex-row gap-4 sm:items-end">
									<div className="form-control flex-1">
										<label htmlFor="vault-name" className="label px-0 pt-0 pb-2">
											<span className="label-text text-sm font-medium">{t("vaultSettings.general.vaultName")}</span>
										</label>
										<input
											id="vault-name"
											type="text"
											className="input input-bordered w-full bg-transparent focus:outline-none focus:border-primary transition-all rounded-lg"
											value={vaultName}
											onChange={(e) => setVaultName(e.target.value)}
										/>
									</div>
									<button
										type="button"
										className="btn btn-primary rounded-lg px-6 font-medium"
										disabled={!vaultName.trim() || vaultName.trim() === vault.name}
										onClick={handleSaveName}
									>
										{t("vaultSettings.general.save")}
									</button>
								</div>
								{nameSaved && (
									<p className="text-sm text-success font-medium mt-1 animate-fade-in">
										{t("vaultSettings.general.nameSaved")}
									</p>
								)}

								<div className="grid grid-cols-1 sm:grid-cols-2 gap-6 pt-4">
									<div className="space-y-1">
										<span className="text-xs font-medium uppercase tracking-wider text-base-content/50">
											{t("vaultSettings.general.storageType")}
										</span>
										<p className="text-sm font-medium">
											{isCloud ? "Cloud Synchronized" : "Local Only"}
										</p>
									</div>

									{isCloud && provider && (
										<div className="space-y-1">
											<span className="text-xs font-medium uppercase tracking-wider text-base-content/50">
												{t("vaultSettings.general.provider")}
											</span>
											<p className="text-sm font-medium">{provider.name}</p>
										</div>
									)}
								</div>

								<div className="space-y-2 pt-2">
									<div className="flex items-center justify-between">
										<span className="text-xs font-medium uppercase tracking-wider text-base-content/50">
											{t("vaultSettings.general.filePath")}
										</span>
										<button 
											type="button" 
											className="text-xs font-medium text-primary hover:underline"
											onClick={() => navigator.clipboard.writeText(vault.path)}
										>
											Copy
										</button>
									</div>
									<p className="text-sm font-mono text-base-content/70 break-all bg-base-200/50 p-3 rounded-lg">
										{vault.path}
									</p>
								</div>
							</div>
						</section>
					)}

					{activeTab === "security" && (
						<section>
							<h3 className="text-sm font-semibold uppercase tracking-widest text-base-content/60 mb-6">
								{t("vaultSettings.security.title")}
							</h3>
							
							<div className="space-y-8">
								<div className="space-y-4">
									<div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
										<div className="form-control">
											<label htmlFor="new-password" className="label px-0 pt-0 pb-2">
												<span className="label-text text-sm font-medium">{t("vaultSettings.security.newPassword")}</span>
											</label>
											<input
												id="new-password"
												type="password"
												className="input input-bordered w-full bg-transparent focus:outline-none focus:border-secondary transition-all rounded-lg"
												placeholder={t("vaultSettings.security.newPasswordPlaceholder")}
												value={newPassword}
												onChange={(e) => setNewPassword(e.target.value)}
											/>
										</div>
										<div className="form-control">
											<label htmlFor="confirm-password" className="label px-0 pt-0 pb-2">
												<span className="label-text text-sm font-medium">{t("vaultSettings.security.confirmPassword")}</span>
											</label>
											<input
												id="confirm-password"
												type="password"
												className="input input-bordered w-full bg-transparent focus:outline-none focus:border-secondary transition-all rounded-lg"
												placeholder={t("vaultSettings.security.confirmPasswordPlaceholder")}
												value={confirmPassword}
												onChange={(e) => setConfirmPassword(e.target.value)}
											/>
										</div>
									</div>
									
									<div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
										<p className="text-xs text-base-content/50">
											{t("vaultSettings.security.passwordHelp")}
										</p>
										<button
											type="button"
											className="btn btn-secondary rounded-lg px-6 font-medium"
											disabled={!newPassword || newPassword !== confirmPassword}
											onClick={handleChangePassword}
										>
											{t("vaultSettings.security.change")}
										</button>
									</div>

									{passwordError && (
										<p className="text-sm text-error font-medium mt-2">{passwordError}</p>
									)}
									{passwordChanged && (
										<p className="text-sm text-success font-medium mt-2">{t("vaultSettings.security.passwordChanged")}</p>
									)}
								</div>

								<div>
									<BiometricSettings
										vaultId={vault.id}
										vaultName={vault.name}
										vaultPassword={vault.volatile.credential}
										biometricEnabled={biometricEnabled}
										onToggle={(enabled) =>
											dispatch(
												setVaultBiometricEnabled({ vaultId: vault.id, enabled }),
											)
										}
									/>
								</div>
							</div>
						</section>
					)}

					{isCloud && activeTab === "cloud" && (
						<section>
							<h3 className="text-sm font-semibold uppercase tracking-widest text-base-content/60 mb-6">
								{t("vaultSettings.cloudSync.title")}
							</h3>
							
							<div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-base-200/30 p-5 rounded-xl border border-base-200/50">
								<div className="space-y-1">
									<div className="flex items-center gap-2">
										<span className="text-sm font-medium">
											{t("vaultSettings.cloudSync.providerStatus")}
										</span>
										<span className="badge badge-sm badge-outline border-base-content/20">
											{(vault.providerId && providerStatus[vault.providerId]) || "Unknown"}
										</span>
									</div>
									{vault.cloudMetadata?.lastSync && (
										<p className="text-xs text-base-content/50 mt-1">
											{t("vaultSettings.cloudSync.lastSync")}: {formatLastSync(vault.cloudMetadata.lastSync)}
										</p>
									)}
								</div>

								<button
									type="button"
									className="btn btn-outline btn-sm rounded-lg font-medium"
									disabled={syncing}
									onClick={handleSync}
								>
									{syncing ? (
										<span className="loading loading-spinner loading-xs mr-2" />
									) : null}
									{t("vaultSettings.cloudSync.syncNow")}
								</button>
							</div>
							
							{syncError && (
								<p className="text-sm text-error font-medium mt-3">{syncError}</p>
							)}
						</section>
					)}

					{activeTab === "danger" && (
						<section className="pb-12">
							<h3 className="text-sm font-semibold uppercase tracking-widest text-error/80 mb-6">
								{t("vaultSettings.dangerZone.title")}
							</h3>
							
							<div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-error/5 p-5 rounded-xl border border-error/20">
								<div className="space-y-1 max-w-md">
									<h4 className="text-sm font-medium text-error">{t("vaultSettings.dangerZone.deleteVault")}</h4>
									<p className="text-xs text-error/70">
										{t("vaultSettings.dangerZone.deleteVaultDescription")}
									</p>
								</div>
								<button
									type="button"
									className="btn btn-error btn-sm rounded-lg font-medium shrink-0"
									onClick={() => onDeleteVault(vault)}
								>
									{t("vaultSettings.dangerZone.deleteVault")}
								</button>
							</div>
						</section>
					)}
				</div>
			</div>
		</div>
	);
}

export default VaultSettingsPanel;
