import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useDispatch, useSelector } from "react-redux";
import type { GroupEntry } from "../../interfaces/vault.interface";
import type { AppDispatch, RootState } from "../../redux/store";
import { VaultManager } from "../../services/vault";
import { Modal } from "../UI/Modal";

/**
 * Props for the EditGroupModal component.
 */
interface EditGroupModalProps {
	isOpen: boolean;
	onClose: () => void;
	onSuccess?: () => void;
	entry: GroupEntry;
	path: string[];
}

/**
 * Modal component for editing a group entry's name.
 * Implements validation and error handling.
 */
export const EditGroupModal: React.FC<EditGroupModalProps> = ({
	isOpen,
	onClose,
	onSuccess,
	entry,
	path,
}) => {
	const dispatch = useDispatch<AppDispatch>();
	const { t } = useTranslation("home");
	const currentVaultId = useSelector((state: RootState) => state.vault.currentVaultId);
	const [groupName, setGroupName] = useState(entry.name);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);

	// Prefill name
	useEffect(() => {
		setGroupName(entry.name);
	}, [entry]);

	// Submit update
	const handleSubmit = async (): Promise<void> => {
		const trimmed = groupName.trim();
		if (!trimmed) {
			setError(t("editGroup.errors.nameRequired"));
			return;
		}

		setError(null);
		setLoading(true);

		try {
			if (currentVaultId) {
				// Get the VaultInstance from VaultManager
				const vaultInstance = VaultManager.getInstance().getInstance(currentVaultId);
				if (vaultInstance) {
					// Update the entry using VaultManager
					await vaultInstance.updateEntry(path, { name: trimmed, updated_at: new Date().toISOString() });
				}
			}

			onSuccess?.();
			onClose();
		} catch (err) {
			console.error("Error updating group:", err);
			setError(t("editGroup.errors.updateFailed"));
		} finally {
			setLoading(false);
		}
	};

	// Cancel
	const handleCancel = (): void => {
		setError(null);
		onClose();
	};

	return (
		<Modal isOpen={isOpen} onClose={handleCancel}>
			<div className="space-y-4">
				<h3 className="font-bold text-lg">{t("editGroup.title")}</h3>

				<div className="form-control">
					<label className="label">
						<span className="label-text">{t("editGroup.groupName")} *</span>
					</label>
					<input
						type="text"
						placeholder={t("editGroup.groupNamePlaceholder")}
						className="input input-bordered"
						value={groupName}
						onChange={(e) => setGroupName(e.target.value)}
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
						onClick={handleSubmit}
						disabled={loading}
					>
						{loading ? (
							<>
								<span className="loading loading-spinner loading-sm"></span>
								{t("editGroup.saving")}
							</>
						) : (
							t("editGroup.save")
						)}
					</button>
					<button className="btn" onClick={handleCancel} disabled={loading}>
						{t("editGroup.cancel")}
					</button>
				</div>
			</div>
		</Modal>
	);
};
