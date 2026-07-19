import { useEffect, useState } from "react";
import {
	authenticate,
	checkBiometricAvailability,
	deleteVaultPassword,
	storeVaultPassword,
} from "../../services/biometric";

interface BiometricSettingsProps {
	vaultId: string;
	vaultName: string;
	vaultPassword: string;
	biometricEnabled: boolean;
	onToggle: (enabled: boolean) => void;
	t: (key: string, options?: Record<string, unknown>) => string;
}

export function BiometricSettings({
	vaultId,
	vaultName,
	vaultPassword,
	biometricEnabled,
	onToggle,
	t,
}: BiometricSettingsProps) {
	const [available, setAvailable] = useState<boolean | null>(null);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		checkBiometricAvailability()
			.then((status) => setAvailable(status.isAvailable))
			.catch(() => setAvailable(false));
	}, []);

	const handleEnable = async () => {
		setLoading(true);
		setError(null);
		try {
			const success = await authenticate(
				t("biometric.promptEnable", { vaultName }),
				{ allowDeviceCredential: true },
			);
			if (!success) {
				setError(t("biometric.enableFailed"));
				return;
			}
			await storeVaultPassword(vaultId, vaultPassword);
			onToggle(true);
		} catch (_err) {
			setError(t("biometric.enableFailed"));
		} finally {
			setLoading(false);
		}
	};

	const handleDisable = async () => {
		setLoading(true);
		setError(null);
		try {
			await deleteVaultPassword(vaultId);
			onToggle(false);
		} catch (_err) {
			setError(t("biometric.disableFailed"));
		} finally {
			setLoading(false);
		}
	};

	if (available === null) return null;
	if (!available) return null;

	return (
		<div className="flex flex-col gap-2">
			<div className="flex items-center justify-between">
				<div className="flex items-center gap-2">
					<svg
						className="w-5 h-5 text-base-content/70"
						fill="none"
						stroke="currentColor"
						viewBox="0 0 24 24"
						role="img"
						aria-label={t("biometric.title")}
					>
						<path
							strokeLinecap="round"
							strokeLinejoin="round"
							strokeWidth={2}
							d="M12 11c1.66 0 3-1.34 3-3s-1.34-3-3-3-3 1.34-3 3 1.34 3 3 3zm0 1c-2.67 0-8 1.34-8 4v3h16v-3c0-2.66-5.33-4-8-4z"
						/>
					</svg>
					<span className="text-sm font-medium">{t("biometric.title")}</span>
				</div>
				<label className="swap">
					<input
						type="checkbox"
						checked={biometricEnabled}
						disabled={loading}
						onChange={(e) => {
							if (e.target.checked) handleEnable();
							else handleDisable();
						}}
					/>
					<div className="swap-on btn btn-sm btn-primary">ON</div>
					<div className="swap-off btn btn-sm btn-ghost">OFF</div>
				</label>
			</div>
			{loading && <span className="loading loading-spinner loading-sm"></span>}
			{error && (
				<div className="alert alert-error py-1 px-2 text-xs">
					<span>{error}</span>
				</div>
			)}
			{biometricEnabled && !error && (
				<p className="text-xs text-base-content/60">{t("biometric.enabled")}</p>
			)}
		</div>
	);
}

export default BiometricSettings;
