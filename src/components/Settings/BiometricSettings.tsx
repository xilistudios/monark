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
		<div className="flex flex-col gap-2 bg-base-200/30 p-5 rounded-xl border border-base-200/50">
			<div className="flex items-center justify-between gap-4">
				<div>
					<h4 className="text-sm font-medium">{t("biometric.title")}</h4>
					<p className="text-xs text-base-content/60 mt-0.5">
						{biometricEnabled ? t("biometric.enabled") : "Use biometric authentication"}
					</p>
				</div>
				<div className="flex items-center gap-3">
					{loading && <span className="loading loading-spinner loading-xs text-base-content/50"></span>}
					<input
						type="checkbox"
						className="toggle toggle-sm"
						checked={biometricEnabled}
						disabled={loading}
						onChange={(e) => {
							if (e.target.checked) handleEnable();
							else handleDisable();
						}}
					/>
				</div>
			</div>
			
			{error && (
				<p className="text-xs text-error font-medium">{error}</p>
			)}
		</div>
	);
}

export default BiometricSettings;
