import { useContext, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSelector } from "react-redux";
import { selectCurrentNavigationPath } from "../../../redux/selectors/vaultSelectors";
import type { RootState } from "../../../redux/store";
import { VaultManager } from "../../../services/vault";
import { Modal } from "../../UI/Modal";
import { VaultModalContext } from "../VaultContext";

/**
 * Modal component for editing a group entry's name.
 * Implements validation and error handling.
 */
export const EditGroupModal: React.FC = () => {
	const { t } = useTranslation("home");
	const currentVaultId = useSelector(
		(state: RootState) => state.vault.currentVaultId,
	);
	const context = useContext(VaultModalContext);
	if (!context)
		throw new Error(
			"VaultModalContext must be used within a VaultModalProvider",
		);
	const { isEditGroupModalOpen, selectedEntry, closeAllModals } = context;
	const [groupName, setGroupName] = useState("");
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);

	// Extract current path from Redux state using selector
	const currentPath = useSelector(selectCurrentNavigationPath);

	// Prefill name when modal opens or entry changes
	useEffect(() => {
		if (isEditGroupModalOpen && selectedEntry && "name" in selectedEntry) {
			setGroupName(selectedEntry.name);
		}
	}, [isEditGroupModalOpen, selectedEntry]);

	// Close modal
	const handleClose = (): void => {
		setError(null);
		closeAllModals();
	};

	// Submit update
	const handleSubmit = async (): Promise<void> => {
		// Verify selectedEntry is a GroupEntry
		if (!selectedEntry || !("children" in selectedEntry)) {
			setError(t("editGroup.errors.invalidEntry"));
			return;
		}

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
				const vaultInstance =
					VaultManager.getInstance().getInstance(currentVaultId);
				if (vaultInstance) {
					// Debug: log the path being used
					console.log("Updating group with path:", [
						...currentPath,
						selectedEntry.id,
					]);

					// Update the entry using VaultManager
					await vaultInstance.updateEntry([...currentPath, selectedEntry.id], {
						name: trimmed,
						updated_at: new Date().toISOString(),
					});
				}
			}

			closeAllModals();
		} catch (err) {
			console.error("Error updating group:", err);
			setError(
				err instanceof Error ? err.message : t("editGroup.errors.updateFailed"),
			);
		} finally {
			setLoading(false);
		}
	};

	return (
		<Modal isOpen={isEditGroupModalOpen} onClose={handleClose}>
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
					<button className="btn" onClick={handleClose} disabled={loading}>
						{t("editGroup.cancel")}
					</button>
				</div>
			</div>
		</Modal>
	);
};
