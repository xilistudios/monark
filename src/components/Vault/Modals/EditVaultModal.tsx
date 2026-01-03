import { useContext } from "react";
import { useTranslation } from "react-i18next";
import { useSelector } from "react-redux";
import type { RootState } from "../../../redux/store";
import { Modal } from "../../UI/Modal";
import { AddVaultForm } from "../Forms/AddVaultForm";
import { VaultModalContext } from "../VaultContext";

/**
 * Modal component for editing an existing vault.
 * Reuses AddVaultForm with edit mode props.
 */
export const EditVaultModal: React.FC = () => {
	const { t } = useTranslation("home");
	const context = useContext(VaultModalContext);
	if (!context)
		throw new Error(
			"VaultModalContext must be used within a VaultModalProvider",
		);

	const { isEditVaultModalOpen, closeEditVaultModal } = context;
	const vaults = useSelector((state: RootState) => state.vault.vaults);
	const currentVaultId = useSelector(
		(state: RootState) => state.vault.currentVaultId,
	);

	// Find the vault being edited
	const vaultToEdit =
		vaults.find((vault) => vault.id === currentVaultId) || null;

	const handleClose = (): void => {
		closeEditVaultModal();
	};

	const handleSuccess = (): void => {
		closeEditVaultModal();
	};

	return (
		<Modal isOpen={isEditVaultModalOpen} onClose={handleClose}>
			{vaultToEdit ? (
				<AddVaultForm
					onSuccess={handleSuccess}
					onCancel={handleClose}
					vault={vaultToEdit}
				/>
			) : (
				<div className="space-y-4 p-4">
					<h3 className="font-bold text-lg">{t("editVault.title")}</h3>
					<div className="alert alert-error">
						<span>{t("editVault.errors.vaultNotFound")}</span>
					</div>
					<div className="modal-action">
						<button className="btn" onClick={handleClose}>
							{t("close")}
						</button>
					</div>
				</div>
			)}
		</Modal>
	);
};
