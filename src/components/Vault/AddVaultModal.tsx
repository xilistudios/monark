import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal } from '../UI/Modal';
import { VaultTabs } from './VaultTabs';

interface AddVaultModalProps {
	isOpen: boolean;
	onClose: () => void;
}

export const AddVaultModal = ({ isOpen, onClose }: AddVaultModalProps) => {
	const { t } = useTranslation('home');

	return (
		<Modal isOpen={isOpen} onClose={onClose}>
			<VaultTabs
				onSuccess={onClose}
				onCancel={onClose}
			/>
		</Modal>
	);
};