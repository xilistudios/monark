import { useTranslation } from 'react-i18next';
import { useSelector } from 'react-redux';
import type { Vault } from '../../redux/actions/vault';
import { getVaultProvider } from '../../redux/actions/vault';
import type { RootState } from '../../redux/store';
import { StorageProviderType } from '../../interfaces/cloud-storage.interface';
import { formatLastSync } from '../../utils/dateFormatter';

interface CloudVaultIndicatorProps {
  vault: Vault;
  showTooltip?: boolean;
  className?: string;
}

export const CloudVaultIndicator = ({
  vault,
  showTooltip = true,
  className = '',
}: CloudVaultIndicatorProps) => {
  const { t } = useTranslation('home');
  const providers = useSelector((state: RootState) => state.vault.providers);

  const isCloud = vault.storageType === 'cloud';
  const provider = getVaultProvider(vault, providers);

  const indicatorContent = (
    <div className={`flex items-center gap-1 ${className}`}>
      {isCloud ? (
        <>
          {/* Cloud icon */}
          <svg
            className="w-4 h-4 text-blue-500"
            fill="currentColor"
            viewBox="0 0 24 24"
          >
            <title>{t('vaultSelector.cloudVault')}</title>
            <path d="M19.35 10.04C18.67 6.59 15.64 4 12 4 9.11 4 6.6 5.64 5.35 8.04 2.34 8.36 0 10.91 0 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96z" />
          </svg>

          {/* Provider badge */}
          {provider && (
            <span
              className="badge badge-sm badge-info text-xs"
              title={t('vaultSelector.provider')}
            >
              {provider.provider_type === StorageProviderType.GOOGLE_DRIVE
                ? 'Google Drive'
                : provider.provider_type === StorageProviderType.LOCAL
                  ? 'Local'
                  : provider.name}
            </span>
          )}
        </>
      ) : (
        <>
          {/* Local storage icon */}
          <svg
            className="w-4 h-4 text-gray-500"
            fill="currentColor"
            viewBox="0 0 24 24"
          >
            <title>{t('vaultSelector.localVault')}</title>
            <path d="M10 4H4c-1.11 0-2 .89-2 2v12c0 1.11.89 2 2 2h16c1.11 0 2-.89 2-2V8c0-1.11-.89-2-2-2h-8l-2-2z" />
          </svg>

          {/* Local badge */}
          <span className="badge badge-sm badge-neutral text-xs">
            {t('vaultSelector.local')}
          </span>
        </>
      )}
    </div>
  );

  if (!showTooltip) {
    return indicatorContent;
  }

  const tooltipContent = isCloud ? (
    <div className="text-sm">
      <div className="font-semibold">{t('vaultSelector.cloudVault')}</div>
      {provider && (
        <div>
          {t('vaultSelector.provider')}: {provider.name}
        </div>
      )}
      {vault.cloudMetadata?.lastSync && (
        <div>
          <span>{`${t('vaultSelector.lastSync')}:`}</span>
          <span className="ml-1">
            {formatLastSync(vault.cloudMetadata.lastSync, t)}
          </span>
        </div>
      )}
      <div className="text-xs text-base-content/60 mt-1">
        {t('vaultSelector.path')}: {vault.path}
      </div>
    </div>
  ) : (
    <div className="text-sm">
      <div className="font-semibold">{t('vaultSelector.localVault')}</div>
      <div className="text-xs text-base-content/60 mt-1">
        {t('vaultSelector.path')}: {vault.path}
      </div>
    </div>
  );

  return (
    <div className="tooltip tooltip-right" data-tip={tooltipContent}>
      {indicatorContent}
    </div>
  );
};

export default CloudVaultIndicator;
