/**
 * ProviderStatusBadge component for displaying storage provider authentication status
 * Shows visual indicators for different authentication states
 * @module ProviderStatusBadge
 */

import { useTranslation } from 'react-i18next';

interface ProviderStatusBadgeProps {
	status: 'idle' | 'authenticating' | 'authenticated' | 'error';
	className?: string;
}

export const ProviderStatusBadge = ({ status, className = '' }: ProviderStatusBadgeProps) => {
	const { t } = useTranslation('settings');

	const getStatusConfig = () => {
		switch (status) {
			case 'authenticated':
				return {
					badgeClass: 'badge-success',
					icon: '✓',
					text: t('cloudStorage.authenticated', 'Authenticated'),
				};
			case 'authenticating':
				return {
					badgeClass: 'badge-info',
					icon: (
						<span className="loading loading-spinner loading-xs"></span>
					),
					text: t('cloudStorage.authenticating', 'Authenticating...'),
				};
			case 'error':
				return {
					badgeClass: 'badge-error',
					icon: '✕',
					text: t('cloudStorage.error', 'Error'),
				};
			case 'idle':
			default:
				return {
					badgeClass: 'badge-warning',
					icon: '⚠',
					text: t('cloudStorage.notAuthenticated', 'Not Authenticated'),
				};
		}
	};

	const config = getStatusConfig();

	return (
		<div className={`badge ${config.badgeClass} gap-2 ${className}`}>
			{config.icon}
			{config.text}
		</div>
	);
};