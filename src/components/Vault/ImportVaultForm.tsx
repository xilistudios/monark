import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useDispatch } from "react-redux";
import { addVault, type Vault } from "../../redux/actions/vault";

interface ImportVaultFormProps {
	onSuccess: () => void
	onCancel: () => void
	vault?: Vault
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

	const generateVaultId = () => {
		return crypto.randomUUID();
	};

	const extractVaultNameFromPath = (path: string) => {
		const fileName = path.split("/").pop() || "";
		return fileName.replace(".monark", "");
	};

	const handleImportVault = async () => {
		if (!filePath || !password) {
			setError(t("errors.missingFields"));
			return;
		}

		setError("");
		setLoading(true);

		try {
			// Try to open the vault to verify the password is correct
			await invoke("read_vault", { filePath, password });

			const finalVaultName = vaultName || extractVaultNameFromPath(filePath);

			const newVault: Vault = {
				id: generateVaultId(),
				name: finalVaultName,
				path: filePath,
				lastAccessed: new Date().toISOString(),
				isLocked: false,
				volatile: {
					credential: password,
					entries: [],
					navigationPath: '/',
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
					disabled={loading || !filePath}
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
