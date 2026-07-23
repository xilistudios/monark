import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useDispatch, useSelector } from "react-redux";
import { addVault, type Vault } from "../../../redux/actions/vault";
import type { RootState } from "../../../redux/store";
import { CloudStorageCommands } from "../../../services/cloudStorage";
import { VaultManager } from "../../../services/vault";

interface ImportVaultFormProps {
	onSuccess: () => void;
	onCancel: () => void;
	vault?: Vault;
}

export const ImportVaultForm = ({
	onSuccess,
	onCancel,
}: ImportVaultFormProps) => {
	const dispatch = useDispatch();
	const { t } = useTranslation("home");
	const [filePath, setFilePath] = useState("");
	const [password, setPassword] = useState("");
	const [vaultName, setVaultName] = useState("");
	const [error, setError] = useState("");
	const [loading, setLoading] = useState(false);
	const [importSource, setImportSource] = useState<"local" | "cloud">("local");
	const [providerId, setProviderId] = useState<string>("");
	const [cloudVaults, setCloudVaults] = useState<Vault[]>([]);
	const [selectedCloudVault, setSelectedCloudVault] = useState<Vault | null>(
		null,
	);
	const [loadingCloudVaults, setLoadingCloudVaults] = useState(false);

	// Get providers and their status from Redux
	const providers = useSelector((state: RootState) => state.vault.providers);
	const providerStatus = useSelector(
		(state: RootState) => state.vault.providerStatus,
	);

	// Filter to only show authenticated providers
	const authenticatedProviders = providers.filter(
		(provider) =>
			provider.provider_type !== "local" &&
			providerStatus[provider.name] === "authenticated",
	);

	// Load cloud vaults when provider is selected
	useEffect(() => {
		if (importSource === "cloud" && providerId) {
			loadCloudVaults();
		} else {
			setCloudVaults([]);
			setSelectedCloudVault(null);
		}
	}, [importSource, providerId]);

	const loadCloudVaults = async () => {
		if (!providerId) return;

		setLoadingCloudVaults(true);
		setError("");

		try {
			const vaults =
				await VaultManager.getInstance().listCloudVaults(providerId);
			setCloudVaults(vaults);
		} catch (err) {
			console.error("Error loading cloud vaults:", err);
			setError(String(err));
		} finally {
			setLoadingCloudVaults(false);
		}
	};

	const handleCloudVaultSelect = (vaultId: string) => {
		const vault = cloudVaults.find((v) => v.id === vaultId);
		if (vault) {
			setSelectedCloudVault(vault);
			setVaultName(vault.name);
		}
	};

	const generateVaultId = () => {
		return crypto.randomUUID();
	};

	const extractVaultNameFromPath = (path: string) => {
		const fileName = path.split("/").pop() || "";
		return fileName.replace(".monark", "");
	};

	const handleImportVault = async () => {
		if (importSource === "local") {
			if (!filePath || !password) {
				setError(t("errors.missingFields"));
				return;
			}
		} else {
			// Cloud import validation
			if (!selectedCloudVault || !password) {
				setError(t("errors.missingFields"));
				return;
			}
		}

		setError("");
		setLoading(true);

		try {
			let vaultPath: string;
			let finalVaultName: string;
			let cloudVault: Vault | null = null;
			let vaultContent: any = null;

			if (importSource === "cloud") {
				// Import cloud vault
				cloudVault = selectedCloudVault;
				if (!cloudVault) {
					throw new Error("No cloud vault selected");
				}
				vaultPath = cloudVault.path; // Use cloud file ID as path
				finalVaultName = vaultName || cloudVault.name;

				// Verify the vault can be accessed with the password
				try {
					vaultContent = await CloudStorageCommands.readCloudVault({
						vaultId: cloudVault.id,
						password,
						providerName: providerId,
					});
				} catch (unlockError) {
					console.error("Error unlocking cloud vault:", unlockError);
					setError(
						t("importVault.errors.invalidPassword") ||
							"Invalid password or failed to access cloud vault",
					);
					return;
				}
			} else {
				// Import local vault
				vaultPath = filePath;
				finalVaultName = vaultName || extractVaultNameFromPath(filePath);

				// Try to open the vault to verify the password is correct
				vaultContent = await invoke("read_vault", { filePath, password });
			}

			const newVault: Vault = {
				id: generateVaultId(),
				name: finalVaultName,
				path: vaultPath,
				lastAccessed: new Date().toISOString(),
				isLocked: false,
				storageType: importSource,
				providerId: importSource === "cloud" ? providerId : undefined,
				cloudMetadata:
					importSource === "cloud" ? cloudVault?.cloudMetadata : undefined,
				biometricEnabled: false,
				volatile: {
					credential: password,
					entries: vaultContent?.entries || [],
					navigationPath: "/",
					encryptedData: undefined,
				},
			};

			dispatch(addVault(newVault));
			onSuccess();
		} catch (err) {
			console.error("Error importing vault:", err);
			setError(t("importVault.errors.importVault"));
		} finally {
			setLoading(false);
		}
	};

	const handleSelectFile = async () => {
		try {
			const result = await open({
				multiple: false,
				directory: false,
				filters: [{ name: "Monark Vault", extensions: ["monark"] }],
			});

			if (result) {
				setFilePath(result);
				// Auto-generate vault name from file path if not already set
				if (!vaultName) {
					setVaultName(extractVaultNameFromPath(result));
				}
			}
		} catch (err) {
			console.error("Error selecting file:", err);
			setError(t("importVault.errors.fileDialog"));
		}
	};

	return (
		<div className="flex flex-col gap-6 pt-2 animate-fade-in w-full">
			{/* Import Source Selector */}
			<div className="flex flex-col gap-3 w-full">
				<label className="text-sm font-medium text-base-content/80 pl-1">
					{t("vaultSelector.importSource")}
				</label>
				<div className="grid grid-cols-2 gap-3">
					<button
						type="button"
						className={`btn h-auto py-3 flex flex-col gap-2 transition-all duration-300 ${importSource === "local" ? "btn-primary shadow-lg shadow-primary/20 scale-[1.02]" : "btn-outline border-base-300 hover:border-base-content/30 text-base-content/70"}`}
						onClick={() => setImportSource("local")}
					>
						<svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
							<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4" />
						</svg>
						<span className="font-medium text-sm">{t("vaultSelector.localFile")}</span>
					</button>
					<button
						type="button"
						className={`btn h-auto py-3 flex flex-col gap-2 transition-all duration-300 ${importSource === "cloud" ? "btn-primary shadow-lg shadow-primary/20 scale-[1.02]" : "btn-outline border-base-300 hover:border-base-content/30 text-base-content/70"}`}
						onClick={() => setImportSource("cloud")}
					>
						<svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
							<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 15a4 4 0 004 4h9a5 5 0 10-.1-9.999 5.002 5.002 0 10-9.78 2.096A4.001 4.001 0 003 15z" />
						</svg>
						<span className="font-medium text-sm">{t("vaultSelector.cloudStorage")}</span>
					</button>
				</div>
			</div>

			{/* Cloud Provider Selector - Only show for cloud import */}
			{importSource === "cloud" && (
				<div className="flex flex-col gap-2 w-full">
					<label className="text-sm font-medium text-base-content/80 pl-1">
						{t("vaultSelector.selectProvider")}
					</label>
					{authenticatedProviders.length > 0 ? (
						<select
							className="select select-bordered select-sm w-full max-w-xs bg-base-100 hover:border-base-content/30 focus:border-primary focus:ring-1 focus:ring-primary transition-all duration-300"
							value={providerId}
							onChange={(e) => setProviderId(e.target.value)}
						>
							<option value="">{t("vaultSelector.selectProvider")}</option>
							{authenticatedProviders.map((provider) => (
								<option key={provider.name} value={provider.name}>
									{provider.name} ({provider.provider_type})
								</option>
							))}
						</select>
					) : (
						<div className="alert alert-warning py-2">
							<svg
								xmlns="http://www.w3.org/2000/svg"
								className="stroke-current shrink-0 h-5 w-5"
								fill="none"
								viewBox="0 0 24 24"
							>
								<path
									strokeLinecap="round"
									strokeLinejoin="round"
									strokeWidth="2"
									d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
								/>
							</svg>
							<div>
								<p className="text-sm">{t("vaultSelector.noProvidersConfigured")}</p>
								<p className="text-xs opacity-80 mt-1">
									{t("vaultSelector.goToSettings")}
								</p>
							</div>
						</div>
					)}
				</div>
			)}

			{/* Cloud Vault Selection - Only show for cloud import */}
			{importSource === "cloud" && providerId && (
				<div className="flex flex-col gap-2 w-full">
					<label className="text-sm font-medium text-base-content/80 pl-1">
						{t("vaultSelector.selectCloudVault")}
					</label>
					{loadingCloudVaults ? (
						<div className="flex items-center gap-2 pl-1">
							<span className="loading loading-spinner loading-sm"></span>
							<span className="text-sm">{t("vaultSelector.loadingVaults")}</span>
						</div>
					) : cloudVaults.length > 0 ? (
						<select
							className="select select-bordered select-sm w-full max-w-xs bg-base-100 hover:border-base-content/30 focus:border-primary focus:ring-1 focus:ring-primary transition-all duration-300"
							value={selectedCloudVault?.id || ""}
							onChange={(e) => handleCloudVaultSelect(e.target.value)}
						>
							<option value="">{t("vaultSelector.selectCloudVault")}</option>
							{cloudVaults.map((vault) => (
								<option key={vault.id} value={vault.id}>
									{vault.name}
									{vault.cloudMetadata?.lastSync &&
										` (Last modified: ${new Date(vault.cloudMetadata.lastSync).toLocaleDateString()})`}
								</option>
							))}
						</select>
					) : (
						<div className="alert alert-info py-2">
							<svg
								xmlns="http://www.w3.org/2000/svg"
								className="stroke-current shrink-0 h-5 w-5"
								fill="none"
								viewBox="0 0 24 24"
							>
								<path
									strokeLinecap="round"
									strokeLinejoin="round"
									strokeWidth="2"
									d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
								/>
							</svg>
							<span className="text-sm">{t("vaultSelector.noCloudVaults")}</span>
						</div>
					)}
				</div>
			)}

			{/* Local File Selection - Only show for local import */}
			{importSource === "local" && (
				<div className="flex flex-col gap-2 w-full">
					<label className="text-sm font-medium text-base-content/80 pl-1">
						{t("importVault.vaultFile")}
					</label>
					<div className="join w-full">
						<input
							type="text"
							placeholder={t("importVault.vaultFilePlaceholder")}
							className="input input-bordered w-full bg-base-100 hover:border-base-content/30 focus:border-primary focus:ring-1 focus:ring-primary transition-all duration-300 join-item"
							value={filePath}
							onChange={(e) => setFilePath(e.target.value)}
							readOnly
						/>
						<button
							className="btn btn-outline border-base-content/20 hover:border-base-content/40 hover:bg-base-200 text-base-content join-item"
							onClick={handleSelectFile}
							type="button"
						>
							{t("importVault.browse")}
						</button>
					</div>
				</div>
			)}

			<div className="flex flex-col gap-2 w-full">
				<label className="text-sm font-medium text-base-content/80 pl-1 flex items-center justify-between w-full">
					<span>{t("importVault.name")}</span>
					<span className="text-xs font-normal opacity-70">{t("importVault.fileHelp")}</span>
				</label>
				<input
					type="text"
					placeholder={t("importVault.namePlaceholder")}
					className="input input-bordered w-full bg-base-100 hover:border-base-content/30 focus:border-primary focus:ring-1 focus:ring-primary transition-all duration-300"
					value={vaultName}
					onChange={(e) => setVaultName(e.target.value)}
				/>
			</div>

			<div className="flex flex-col gap-2 w-full">
				<label className="text-sm font-medium text-base-content/80 pl-1">
					{t("importVault.password")}
				</label>
				<input
					type="password"
					placeholder={t("importVault.passwordPlaceholder")}
					className="input input-bordered w-full bg-base-100 hover:border-base-content/30 focus:border-primary focus:ring-1 focus:ring-primary transition-all duration-300"
					value={password}
					onChange={(e) => setPassword(e.target.value)}
				/>
			</div>

			{error && (
				<div className="alert alert-error py-2">
					<span className="text-sm">{error}</span>
				</div>
			)}

			<div className="modal-action pt-4 flex justify-end gap-3 mt-2">
				<button className="btn btn-ghost" onClick={onCancel} disabled={loading}>
					{t("importVault.cancel")}
				</button>
				<button
					className="btn btn-primary min-w-[120px]"
					onClick={handleImportVault}
					disabled={
						loading ||
						(importSource === "local" && !filePath) ||
						(importSource === "cloud" && !selectedCloudVault)
					}
				>
					{loading ? (
						<>
							<span className="loading loading-spinner loading-sm"></span>
							{t("importVault.importing")}
						</>
					) : (
						t("importVault.importVault")
					)}
				</button>
			</div>
		</div>
	);
};
