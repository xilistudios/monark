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
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-3xl font-bold">{t('title')}</h1>
        <Link to="/" className="btn btn-outline btn-sm">
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
