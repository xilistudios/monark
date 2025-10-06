/**
 * CloudStorageSettings component for managing cloud storage providers
 * Displays provider list, status, and provides management actions
 * @module CloudStorageSettings
 */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useDispatch, useSelector } from 'react-redux';
import { useContext } from 'react';
import { VaultModalContext } from '../Vault/VaultContext';
import { ProviderStatusBadge } from '../Vault/ProviderStatusBadge';
import { VaultManager } from '../../services/vault';
import { 
	setDefaultStorageProvider, 
	removeStorageProvider, 
	setProviderStatus 
} from '../../redux/actions/vault';
import { 
	selectProviders, 
	selectDefaultProvider, 
	selectProviderStatus, 
	selectVaultLoading 
} from '../../redux/selectors/vaultSelectors';
import type { StorageProvider } from '../../interfaces/cloud-storage.interface';

export const CloudStorageSettings = () => {
	const { t } = useTranslation('settings');
	const dispatch = useDispatch();
	const context = useContext(VaultModalContext);
	
	const providers = useSelector(selectProviders);
	const defaultProvider = useSelector(selectDefaultProvider);
	const providerStatus = useSelector(selectProviderStatus);
	const loading = useSelector(selectVaultLoading);

	const [authenticatingProvider, setAuthenticatingProvider] = useState<string | null>(null);

	const handleAuthenticate = async (provider: StorageProvider) => {
		setAuthenticatingProvider(provider.name);
		dispatch(setProviderStatus({ providerId: provider.name, status: 'authenticating' }));

		try {
			// Start OAuth flow - this would typically open a browser or webview
			// For now, we'll simulate the authentication process
			
			// In a real implementation, this would open the OAuth flow
			// For now, we'll simulate successful authentication
			await new Promise(resolve => setTimeout(resolve, 2000));
			
			dispatch(setProviderStatus({ providerId: provider.name, status: 'authenticated' }));
		} catch (error) {
			console.error('Authentication failed:', error);
			dispatch(setProviderStatus({ providerId: provider.name, status: 'error' }));
		} finally {
			setAuthenticatingProvider(null);
		}
	};

	const handleSetAsDefault = async (providerName: string) => {
		try {
			const vaultManager = VaultManager.getInstance();
			await vaultManager.setDefaultProvider(providerName);
			dispatch(setDefaultStorageProvider(providerName));
		} catch (error) {
			console.error('Failed to set default provider:', error);
		}
	};

	const handleRemoveProvider = async (providerName: string) => {
		if (!confirm(t('cloudStorage.confirmRemove', 'Are you sure you want to remove this provider?'))) {
			return;
		}

		try {
			const vaultManager = VaultManager.getInstance();
			await vaultManager.removeProvider(providerName);
			dispatch(removeStorageProvider(providerName));
		} catch (error) {
			console.error('Failed to remove provider:', error);
		}
	};

	const getProviderTypeLabel = (type: string) => {
		switch (type) {
			case 'google_drive':
				return t('cloudStorage.googleDrive', 'Google Drive');
			default:
				return type;
		}
	};

	return (
		<section className="mb-8">
			<div className="flex items-center justify-between mb-6">
				<div>
					<h2 className="text-2xl font-bold">
						{t('cloudStorage.title', 'Cloud Storage')}
					</h2>
					<p className="text-base-content/70 mt-1">
						{t('cloudStorage.description', 'Manage your cloud storage providers')}
					</p>
				</div>
				<button
					className="btn btn-primary"
					onClick={() => context?.openAddProviderModal()}
					disabled={!context || loading}
				>
					➕
					{t('cloudStorage.addProvider', 'Add Provider')}
				</button>
			</div>

			{providers.length === 0 ? (
				<div className="alert alert-info">
					<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" className="stroke-current shrink-0 w-6 h-6">
						<path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path>
					</svg>
					<div>
						<h3 className="font-bold">
							{t('cloudStorage.noProviders', 'No cloud storage providers configured')}
						</h3>
						<div className="text-xs">
							{t('cloudStorage.addProviderHint', 'Add a provider to start using cloud storage for your vaults')}
						</div>
					</div>
				</div>
			) : (
				<div className="space-y-4">
					{providers.map((provider) => {
						const status = providerStatus[provider.name] || 'idle';
						const isDefault = provider.name === defaultProvider;
						const isAuthenticating = authenticatingProvider === provider.name;

						return (
							<div
								key={provider.name}
								className="card bg-base-100 shadow-lg border border-base-300"
							>
								<div className="card-body p-6">
									<div className="flex items-start justify-between">
										<div className="flex-1">
											<div className="flex items-center gap-3 mb-2">
												<h3 className="card-title text-lg">
													{provider.name}
												</h3>
												{isDefault && (
													<div className="badge badge-primary badge-sm">
														{t('cloudStorage.defaultProvider', 'Default Provider')}
													</div>
												)}
											</div>
											
											<div className="flex items-center gap-4 mb-4">
												<span className="text-sm text-base-content/70">
													{getProviderTypeLabel(provider.providerType)}
												</span>
												<ProviderStatusBadge status={status} />
											</div>
										</div>

										<div className="flex gap-2">
											{status !== 'authenticated' && (
												<button
													className="btn btn-outline btn-sm"
													onClick={() => handleAuthenticate(provider)}
													disabled={isAuthenticating || loading}
												>
													{isAuthenticating ? (
														<>
															<span className="loading loading-spinner loading-xs"></span>
															{t('cloudStorage.authenticating', 'Authenticating...')}
														</>
													) : (
														t('cloudStorage.authenticate', 'Authenticate')
													)}
												</button>
											)}
											
											{status === 'authenticated' && !isDefault && (
												<button
													className="btn btn-outline btn-sm"
													onClick={() => handleSetAsDefault(provider.name)}
													disabled={loading}
												>
													{t('cloudStorage.setAsDefault', 'Set as Default')}
												</button>
											)}
											
											<button
												className="btn btn-error btn-outline btn-sm"
												onClick={() => handleRemoveProvider(provider.name)}
												disabled={loading || isDefault}
											>
												{t('cloudStorage.remove', 'Remove')}
											</button>
										</div>
									</div>
								</div>
							</div>
						);
					})}
				</div>
			)}

			{/* Help Section */}
			<div className="collapse collapse-arrow bg-base-200 mt-6">
				<input type="checkbox" />
				<div className="collapse-title text-lg font-medium">
					{t('cloudStorage.help.title', 'Help & Documentation')}
				</div>
				<div className="collapse-content">
					<div className="prose prose-sm max-w-none">
						<h4>{t('cloudStorage.help.gettingStarted', 'Getting Started')}</h4>
						<p>
							{t('cloudStorage.help.gettingStartedText', 'To use cloud storage, you need to configure OAuth credentials for your cloud provider.')}
						</p>
						
						<h4>{t('cloudStorage.help.googleDrive', 'Google Drive Setup')}</h4>
						<ol>
							<li>{t('cloudStorage.help.googleStep1', 'Go to Google Cloud Console')}</li>
							<li>{t('cloudStorage.help.googleStep2', 'Create a new project or select an existing one')}</li>
							<li>{t('cloudStorage.help.googleStep3', 'Enable the Google Drive API')}</li>
							<li>{t('cloudStorage.help.googleStep4', 'Create OAuth 2.0 credentials')}</li>
							<li>{t('cloudStorage.help.googleStep5', 'Add the redirect URI to your OAuth consent screen')}</li>
						</ol>
						
						<h4>{t('cloudStorage.help.security', 'Security Notes')}</h4>
						<p>
							{t('cloudStorage.help.securityText', 'Your credentials are stored locally and encrypted. Never share your client secrets with others.')}
						</p>
					</div>
				</div>
			</div>
		</section>
	);
};