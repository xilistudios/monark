/**
 * SettingsLayout component with sidebar tab navigation.
 * Provides a minimalist tabbed interface for different settings sections.
 * @module SettingsLayout
 */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import AppearanceSettings from './AppearanceSettings';
import GeneralSettings from './GeneralSettings';
import ResetSection from './ResetSection';
import UpdateSection from './UpdateSection';
import { CloudStorageSettings } from './CloudStorageSettings';

type SettingsTab = 'general' | 'appearance' | 'cloudStorage' | 'reset' | 'updates';

interface TabConfig {
  id: SettingsTab;
  label: string;
  icon: React.ReactNode;
  component: React.ComponentType;
}

const getIcon = (id: SettingsTab) => {
  switch (id) {
    case 'general':
      return (
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
        </svg>
      );
    case 'appearance':
      return (
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zm0 0h12a2 2 0 002-2v-4a2 2 0 00-2-2h-2.343M11 7.343l1.657-1.657a2 2 0 012.828 0l2.829 2.829a2 2 0 010 2.828l-8.486 8.485M7 17h.01" />
        </svg>
      );
    case 'cloudStorage':
      return (
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 15a4 4 0 004 4h9a5 5 0 10-.1-9.999 5.002 5.002 0 10-9.78 2.096A4.001 4.001 0 003 15z" />
        </svg>
      );
    case 'reset':
      return (
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12.066 11.2a1 1 0 000 1.6l5.334 4A1 1 0 0019 16V8a1 1 0 00-1.6-.8l-5.333 4zM4.066 11.2a1 1 0 000 1.6l5.334 4A1 1 0 0011 16V8a1 1 0 00-1.6-.8l-5.334 4z" />
        </svg>
      );
    case 'updates':
      return (
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
        </svg>
      );
  }
};

function SettingsLayout() {
  const { t } = useTranslation('settings');
  const [activeTab, setActiveTab] = useState<SettingsTab>('general');

  const tabs: TabConfig[] = [
    {
      id: 'general',
      label: t('general', 'General'),
      icon: getIcon('general'),
      component: GeneralSettings,
    },
    {
      id: 'appearance',
      label: t('appearance', 'Appearance'),
      icon: getIcon('appearance'),
      component: AppearanceSettings,
    },
    {
      id: 'cloudStorage',
      label: t('cloudStorage.title', 'Cloud Storage'),
      icon: getIcon('cloudStorage'),
      component: CloudStorageSettings,
    },
    {
      id: 'reset',
      label: t('resetButton', 'Reset'),
      icon: getIcon('reset'),
      component: ResetSection,
    },
    {
      id: 'updates',
      label: t('updates.title', 'Updates'),
      icon: getIcon('updates'),
      component: UpdateSection,
    },
  ];

  const ActiveComponent = tabs.find((tab) => tab.id === activeTab)?.component;

  const handleTabChange = (tabId: SettingsTab) => {
    setActiveTab(tabId);
  };

  const handleKeyDown = (
    e: React.KeyboardEvent,
    tabId: SettingsTab,
    index: number
  ) => {
    if (e.key === 'ArrowRight') {
      e.preventDefault();
      const nextIndex = (index + 1) % tabs.length;
      setActiveTab(tabs[nextIndex].id);
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      const prevIndex = (index - 1 + tabs.length) % tabs.length;
      setActiveTab(tabs[prevIndex].id);
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      setActiveTab(tabId);
    }
  };

  return (
    <div className="flex flex-col lg:flex-row gap-12 w-full max-w-6xl mx-auto min-h-[650px] font-sans px-4 md:px-8 py-8">
      {/* Sidebar Navigation */}
      <aside className="lg:w-64 w-full shrink-0">
        <nav
          role="tablist"
          aria-label={t('navigation', 'Settings navigation')}
        >
          <div className="mb-8">
            <h1 className="text-2xl font-semibold text-base-content tracking-tight">
              {t('settings', 'Settings')}
            </h1>
          </div>
          <ul className="space-y-1">
            {tabs.map((tab, index) => (
              <li key={tab.id} role="presentation">
                <button
                  className={`group flex items-center gap-3 px-4 py-2.5 w-full rounded-lg transition-colors duration-200 text-left overflow-hidden relative ${
                    activeTab === tab.id
                      ? 'text-base-content bg-base-content/5'
                      : 'text-base-content/50 hover:text-base-content hover:bg-base-content/5'
                  }`}
                  onClick={() => handleTabChange(tab.id)}
                  onKeyDown={(e) => handleKeyDown(e, tab.id, index)}
                  role="tab"
                  aria-selected={activeTab === tab.id}
                  aria-controls={`${tab.id}-panel`}
                  id={`${tab.id}-tab`}
                  tabIndex={activeTab === tab.id ? 0 : -1}
                  type="button"
                >
                  <span className={`transition-colors duration-200 ${
                    activeTab === tab.id ? 'text-primary' : 'text-base-content/40 group-hover:text-base-content/70'
                  }`}>
                    {tab.icon}
                  </span>
                  <span className={`text-[14px] font-medium tracking-wide ${
                    activeTab === tab.id ? 'font-semibold' : ''
                  }`}>
                    {tab.label}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </nav>
      </aside>

      {/* Content Panel */}
      <main
        className="flex-1 max-w-3xl pt-2 lg:pl-8 lg:border-l border-base-content/10"
        role="tabpanel"
        id={`${activeTab}-panel`}
        aria-labelledby={`${activeTab}-tab`}
      >
        <div className="animate-in fade-in duration-300">
          {ActiveComponent && <ActiveComponent />}
        </div>
      </main>
    </div>
  );
}

export default SettingsLayout;
