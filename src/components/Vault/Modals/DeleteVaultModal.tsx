import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal } from '../../UI/Modal';
import type { Vault } from '../../../redux/actions/vault';

interface DeleteVaultModalProps {
	isOpen: boolean;
	onClose: () => void;
	vault: Vault | null;
	onConfirm: (deleteFile: boolean) => void;
	deleting?: boolean;
}

export const DeleteVaultModal = ({
	isOpen,
	onClose,
	vault,
	onConfirm,
	deleting = false,
}: DeleteVaultModalProps) => {
	const { t } = useTranslation('home');
	const [deleteFile, setDeleteFile] = useState(true);

	if (!vault) return null;

	const handleConfirm = () => {
		onConfirm(deleteFile);
	};

	return (
		<Modal isOpen={isOpen} onClose={onClose}>
			<div className="p-6">
				<h3 className="text-lg font-bold mb-2">
					{t('vault.delete.confirmTitle', 'Delete Vault')}
				</h3>
				<p className="mb-4 text-base-content">
					{t(
						'vault.delete.confirmMessage',
						'Are you sure you want to delete the vault "{{name}}"?',
						{ name: vault.name }
					)}
				</p>
				
				{vault.isLocked && (
					<div className="alert alert-warning mb-4">
						<span>
							{t(
								'vault.delete.lockedWarning',
								'This vault is currently locked. You must unlock it before deleting the file.'
							)}
						</span>
					</div>
				)}
				
				<div className="form-control mb-6">
					<label className="label cursor-pointer">
						<span className="label-text">
							{t(
								'vault.delete.deleteFileOption',
								'Also delete the vault file from disk'
							)}
						</span>
						<input
							type="checkbox"
							className="toggle toggle-primary"
							checked={deleteFile}
							onChange={(e) => setDeleteFile(e.target.checked)}
							disabled={vault.isLocked}
						/>
					</label>
					<div className="text-xs text-warning mt-1">
						{t(
							'vault.delete.warning',
							'Warning: This action cannot be undone. If you choose to delete the file, all data will be permanently lost.'
						)}
					</div>
				</div>

				<div className="flex justify-end gap-2">
					<button
						className="btn btn-ghost"
						onClick={onClose}
						disabled={deleting}
					>
						{t('cancel', 'Cancel')}
					</button>
					<button
						className="btn btn-error"
						onClick={handleConfirm}
						disabled={deleting}
					>
						{deleting ? (
							<>
								<span className="loading loading-spinner loading-sm mr-2"></span>
								{t('vault.delete.deleting', 'Deleting...')}
							</>
						) : (
							t('delete', 'Delete')
						)}
					</button>
				</div>
			</div>
		</Modal>
	);
};