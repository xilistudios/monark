/**
 * AddProviderModal component for adding new cloud storage providers
 * Prov			// Create provider configuration
			const providerConfig: { type: StorageProviderType.GOOGLE_DRIVE; config: GoogleDriveConfig } = {
				type: StorageProviderType.GOOGLE_DRIVE,
				config: {
					client_id: formData.clientId.trim(),
					client_secret: formData.clientSecret.trim(),
					redirect_uri: formData.redirectUri.trim(),
				},
			};

			// Add provider through VaultManager
			await vaultManager.addProvider(providerConfig);r Google Drive provider configuration
 * @module AddProviderModal
 */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useDispatch, useSelector } from 'react-redux';
import { Modal } from '../../UI/Modal';
import { VaultManager } from '../../../services/vault';
import { addStorageProvider } from '../../../redux/actions/vault';
import { StorageProviderType } from '../../../interfaces/cloud-storage.interface';
import type { RootState } from '../../../redux/store';

interface AddProviderModalProps {
	isOpen: boolean;
	onClose: () => void;
}

interface ProviderFormData {
	providerName: string;
	providerType: StorageProviderType;
	clientId: string;
	clientSecret: string;
	redirectUri: string;
}

export const AddProviderModal = ({ isOpen, onClose }: AddProviderModalProps) => {
	const { t } = useTranslation('settings');
	const dispatch = useDispatch();
	const loading = useSelector((state: RootState) => state.vault.loading);

	const [formData, setFormData] = useState<ProviderFormData>({
		providerName: '',
		providerType: StorageProviderType.GOOGLE_DRIVE,
		clientId: '',
		clientSecret: '',
		redirectUri: 'http://localhost:1420/auth/callback',
	});

	const [errors, setErrors] = useState<Partial<ProviderFormData>>({});
	const [isSubmitting, setIsSubmitting] = useState(false);

	const validateForm = (): boolean => {
		const newErrors: Partial<ProviderFormData> = {};

		if (!formData.providerName.trim()) {
			newErrors.providerName = t('addProvider.errors.providerNameRequired', 'Provider name is required');
		}

		if (!formData.clientId.trim()) {
			newErrors.clientId = t('addProvider.errors.clientIdRequired', 'Client ID is required');
		}

		if (!formData.clientSecret.trim()) {
			newErrors.clientSecret = t('addProvider.errors.clientSecretRequired', 'Client Secret is required');
		}

		if (!formData.redirectUri.trim()) {
			newErrors.redirectUri = t('addProvider.errors.redirectUriRequired', 'Redirect URI is required');
		}

		setErrors(newErrors);
		return Object.keys(newErrors).length === 0;
	};

	const handleSubmit = async (e: React.FormEvent) => {
		e.preventDefault();
		
		if (!validateForm()) {
			return;
		}

		setIsSubmitting(true);
		setErrors({});

		try {
			const vaultManager = VaultManager.getInstance();
			
			// Create provider configuration
			const providerConfig = {
				type: formData.providerType,
				config: {
					client_id: formData.clientId.trim(),
					client_secret: formData.clientSecret.trim(),
					redirect_uri: formData.redirectUri.trim(),
				},
			};

			// Add provider through VaultManager
			await vaultManager.addProvider(providerConfig);

			// Update Redux state
			dispatch(addStorageProvider({
				name: formData.providerName.trim(),
				providerType: formData.providerType,
				isDefault: false,
			}));

			// Reset form and close modal
			setFormData({
				providerName: '',
				providerType: StorageProviderType.GOOGLE_DRIVE,
				clientId: '',
				clientSecret: '',
				redirectUri: 'http://localhost:1420/auth/callback',
			});
			onClose();
		} catch (error) {
			console.error('Failed to add provider:', error);
			setErrors({
				providerName: t('addProvider.errors.addFailed', 'Failed to add provider. Please check your credentials.'),
			});
		} finally {
			setIsSubmitting(false);
		}
	};

	const handleInputChange = (field: keyof ProviderFormData) => (
		e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>
	) => {
		setFormData(prev => ({
			...prev,
			[field]: e.target.value,
		}));
		
		// Clear error for this field when user starts typing
		if (errors[field]) {
			setErrors(prev => ({
				...prev,
				[field]: undefined,
			}));
		}
	};

	const handleClose = () => {
		if (!isSubmitting) {
			setErrors({});
			onClose();
		}
	};

	return (
		<Modal isOpen={isOpen} onClose={handleClose}>
			<div className="card-body p-6">
				<h2 className="card-title text-xl mb-4">
					{t('addProvider.title', 'Add Storage Provider')}
				</h2>

				<form onSubmit={handleSubmit} className="space-y-4">
					{/* Provider Name */}
					<div className="form-control">
						<label className="label">
							<span className="label-text">
								{t('addProvider.providerName', 'Provider Name')}
							</span>
						</label>
						<input
							type="text"
							className={`input input-bordered w-full ${
								errors.providerName ? 'input-error' : ''
							}`}
							value={formData.providerName}
							onChange={handleInputChange('providerName')}
							placeholder={t('addProvider.providerNamePlaceholder', 'My Google Drive')}
							disabled={isSubmitting}
						/>
						{errors.providerName && (
							<label className="label">
								<span className="label-text-alt text-error">
									{errors.providerName}
								</span>
							</label>
						)}
					</div>

					{/* Provider Type */}
					<div className="form-control">
						<label className="label">
							<span className="label-text">
								{t('addProvider.providerType', 'Provider Type')}
							</span>
						</label>
						<select
							className="select select-bordered w-full"
							value={formData.providerType}
							onChange={handleInputChange('providerType')}
							disabled={isSubmitting}
						>
							<option value={StorageProviderType.GOOGLE_DRIVE}>
								{t('cloudStorage.googleDrive', 'Google Drive')}
							</option>
						</select>
					</div>

					{/* Client ID */}
					<div className="form-control">
						<label className="label">
							<span className="label-text">
								{t('addProvider.clientId', 'Client ID')}
							</span>
						</label>
						<input
							type="text"
							className={`input input-bordered w-full ${
								errors.clientId ? 'input-error' : ''
							}`}
							value={formData.clientId}
							onChange={handleInputChange('clientId')}
							placeholder={t('addProvider.clientIdPlaceholder', 'Your Google OAuth Client ID')}
							disabled={isSubmitting}
						/>
						{errors.clientId && (
							<label className="label">
								<span className="label-text-alt text-error">
									{errors.clientId}
								</span>
							</label>
						)}
					</div>

					{/* Client Secret */}
					<div className="form-control">
						<label className="label">
							<span className="label-text">
								{t('addProvider.clientSecret', 'Client Secret')}
							</span>
						</label>
						<input
							type="password"
							className={`input input-bordered w-full ${
								errors.clientSecret ? 'input-error' : ''
							}`}
							value={formData.clientSecret}
							onChange={handleInputChange('clientSecret')}
							placeholder={t('addProvider.clientSecretPlaceholder', 'Your Google OAuth Client Secret')}
							disabled={isSubmitting}
						/>
						{errors.clientSecret && (
							<label className="label">
								<span className="label-text-alt text-error">
									{errors.clientSecret}
								</span>
							</label>
						)}
					</div>

					{/* Redirect URI */}
					<div className="form-control">
						<label className="label">
							<span className="label-text">
								{t('addProvider.redirectUri', 'Redirect URI')}
							</span>
						</label>
						<input
							type="text"
							className={`input input-bordered w-full ${
								errors.redirectUri ? 'input-error' : ''
							}`}
							value={formData.redirectUri}
							onChange={handleInputChange('redirectUri')}
							disabled={isSubmitting}
						/>
						{errors.redirectUri && (
							<label className="label">
								<span className="label-text-alt text-error">
									{errors.redirectUri}
								</span>
							</label>
						)}
						<label className="label">
							<span className="label-text-alt">
								{t('addProvider.redirectUriHelp', 'This URI must be configured in your Google Cloud Console')}
							</span>
						</label>
					</div>

					{/* Form Actions */}
					<div className="card-actions justify-end mt-6">
						<button
							type="button"
							className="btn btn-ghost"
							onClick={handleClose}
							disabled={isSubmitting}
						>
							{t('addProvider.cancel', 'Cancel')}
						</button>
						<button
							type="submit"
							className="btn btn-primary"
							disabled={isSubmitting || loading}
						>
							{isSubmitting ? (
								<>
									<span className="loading loading-spinner loading-sm"></span>
									{t('addProvider.adding', 'Adding...')}
								</>
							) : (
								t('addProvider.add', 'Add Provider')
							)}
						</button>
					</div>
				</form>
			</div>
		</Modal>
	);
};