/**
 * SettingsScreen main layout component.
 * Uses SettingsLayout with sidebar tab navigation.
 * Handles i18n, accessibility, and navigation.
 * @module SettingsScreen
 */
import { Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { useContext } from 'react';
import SettingsLayout from '../components/Settings/SettingsLayout';
import { VaultModalContext } from '../components/Vault/VaultContext';
import { AddProviderModal } from '../components/Vault/Modals/AddProviderModal';

function SettingsScreen() {
  const { t } = useTranslation('settings');
  const { isAddProviderModalOpen, closeAddProviderModal } = useContext(VaultModalContext)!;

  return (
    <main className="p-4 w-full">
      <div className="max-w-6xl mx-auto pt-4 px-4 md:px-8">
        <Link 
          to="/" 
          className="inline-flex items-center gap-2 text-sm font-medium text-base-content/50 hover:text-base-content transition-colors duration-200 group w-fit"
          aria-label={t('backButton')}
        >
          <svg className="w-4 h-4 transition-transform duration-200 group-hover:-translate-x-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
          </svg>
          {t('backButton')}
        </Link>
      </div>
      <div className="max-w-7xl mx-auto">
        <SettingsLayout />
      </div>
      <AddProviderModal
        isOpen={isAddProviderModalOpen}
        onClose={() => closeAddProviderModal()}
      />
    </main>
  );
}

export default SettingsScreen;
