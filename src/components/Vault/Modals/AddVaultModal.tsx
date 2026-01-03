import { Modal } from "../../UI/Modal";
import { VaultTabs } from "../VaultTabs";

interface AddVaultModalProps {
	isOpen: boolean;
	onClose: () => void;
}

export const AddVaultModal = ({ isOpen, onClose }: AddVaultModalProps) => {
	return (
		<Modal isOpen={isOpen} onClose={onClose}>
			<VaultTabs onSuccess={onClose} onCancel={onClose} />
		</Modal>
	);
};
