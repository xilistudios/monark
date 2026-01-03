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
	const { providers, providerStatus } = useSelector((state: RootState) => ({
		providers: state.vault.providers,
		providerStatus: state.vault.providerStatus,
	}));

	// Filter to only show authenticated providers
	const authenticatedProviders = providers.filter(
		(provider) => providerStatus[provider.name] === "authenticated",
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
					await CloudStorageCommands.readCloudVault({
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
				await invoke("read_vault", { filePath, password });
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
				volatile: {
					credential: password,
					entries: [],
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
		<div className="space-y-4">
			<h3 className="font-bold text-lg">{t("importVault.title")}</h3>

			{/* Import Source Selector */}
			<div className="form-control">
				<label className="label">
					<span className="label-text">{t("vaultSelector.importSource")}</span>
				</label>
				<div className="flex gap-4">
					<label className="flex items-center gap-2 cursor-pointer">
						<input
							type="radio"
							name="importSource"
							className="radio radio-primary"
							checked={importSource === "local"}
							onChange={() => setImportSource("local")}
						/>
						<span>{t("vaultSelector.localFile")}</span>
					</label>
					<label className="flex items-center gap-2 cursor-pointer">
						<input
							type="radio"
							name="importSource"
							className="radio radio-primary"
							checked={importSource === "cloud"}
							onChange={() => setImportSource("cloud")}
						/>
						<span>{t("vaultSelector.cloudStorage")}</span>
					</label>
				</div>
			</div>

			{/* Cloud Provider Selector - Only show for cloud import */}
			{importSource === "cloud" && (
				<div className="form-control">
					<label className="label">
						<span className="label-text">
							{t("vaultSelector.selectProvider")}
						</span>
					</label>
					{authenticatedProviders.length > 0 ? (
						<select
							className="select select-bordered"
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
						<div className="alert alert-warning">
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
									d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
								/>
							</svg>
							<div>
								<p>{t("vaultSelector.noProvidersConfigured")}</p>
								<p className="text-sm opacity-80">
									{t("vaultSelector.goToSettings")}
								</p>
							</div>
						</div>
					)}
				</div>
			)}

			{/* Cloud Vault Selection - Only show for cloud import */}
			{importSource === "cloud" && providerId && (
				<div className="form-control">
					<label className="label">
						<span className="label-text">
							{t("vaultSelector.selectCloudVault")}
						</span>
					</label>
					{loadingCloudVaults ? (
						<div className="flex items-center gap-2">
							<span className="loading loading-spinner loading-sm"></span>
							<span>{t("vaultSelector.loadingVaults")}</span>
						</div>
					) : cloudVaults.length > 0 ? (
						<select
							className="select select-bordered"
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
						<div className="alert alert-info">
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
									d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
								/>
							</svg>
							<span>{t("vaultSelector.noCloudVaults")}</span>
						</div>
					)}
				</div>
			)}

			{/* Local File Selection - Only show for local import */}
			{importSource === "local" && (
				<div className="form-control">
					<label className="label">
						<span className="label-text">{t("importVault.vaultFile")}</span>
					</label>
					<div className="join">
						<input
							type="text"
							placeholder={t("importVault.vaultFilePlaceholder")}
							className="input input-bordered join-item flex-1"
							value={filePath}
							onChange={(e) => setFilePath(e.target.value)}
							readOnly
						/>
						<button
							className="btn join-item"
							onClick={handleSelectFile}
							type="button"
						>
							{t("importVault.browse")}
						</button>
					</div>
				</div>
			)}

			<div className="form-control">
				<label className="label">
					<span className="label-text">{t("importVault.name")}</span>
				</label>
				<input
					type="text"
					placeholder={t("importVault.namePlaceholder")}
					className="input input-bordered"
					value={vaultName}
					onChange={(e) => setVaultName(e.target.value)}
				/>
				<label className="label">
					<span className="label-text-alt">{t("importVault.fileHelp")}</span>
				</label>
			</div>

			<div className="form-control">
				<label className="label">
					<span className="label-text">{t("importVault.password")}</span>
				</label>
				<input
					type="password"
					placeholder={t("importVault.passwordPlaceholder")}
					className="input input-bordered"
					value={password}
					onChange={(e) => setPassword(e.target.value)}
				/>
			</div>

			{error && (
				<div className="alert alert-error">
					<span>{error}</span>
				</div>
			)}

			<div className="modal-action">
				<button
					className="btn btn-primary"
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
				<button className="btn" onClick={onCancel} disabled={loading}>
					{t("importVault.cancel")}
				</button>
			</div>
		</div>
	);
};
