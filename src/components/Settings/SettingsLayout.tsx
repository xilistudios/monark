/**
 * SettingsLayout component with sidebar tab navigation.
 * Provides a tabbed interface for different settings sections.
 * @module SettingsLayout
 */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import AppearanceSettings from './AppearanceSettings';
import GeneralSettings from './GeneralSettings';
import ResetSection from './ResetSection';

type SettingsTab = 'general' | 'appearance' | 'reset';

interface TabConfig {
  id: SettingsTab;
  label: string;
  icon: string;
  component: React.ComponentType;
}

function SettingsLayout() {
  const { t } = useTranslation('settings');
  const [activeTab, setActiveTab] = useState<SettingsTab>('general');

  const tabs: TabConfig[] = [
    {
      id: 'general',
      label: t('general', 'General'),
      icon: '⚙️',
      component: GeneralSettings,
    },
    {
      id: 'appearance',
      label: t('appearance', 'Appearance'),
      icon: '🎨',
      component: AppearanceSettings,
    },
    {
      id: 'reset',
      label: t('resetButton', 'Reset'),
      icon: '🔄',
      component: ResetSection,
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
    <div className="flex flex-col lg:flex-row gap-6 w-full">
      {/* Sidebar Navigation */}
      <aside className="lg:w-64 w-full">
        <nav
          className="menu bg-base-200 rounded-lg p-2 w-full"
          role="tablist"
          aria-label={t('navigation', 'Settings navigation')}
        >
          <ul className="menu menu-horizontal lg:menu-vertical bg-base-200 rounded-box w-full">
            {tabs.map((tab, index) => (
              <li key={tab.id} role="presentation">
                <button
                  className={`flex items-center gap-3 justify-start w-full ${
                    activeTab === tab.id
                      ? 'active bg-primary text-primary-content'
                      : ''
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
                  <span className="text-xl" aria-hidden="true">
                    {tab.icon}
                  </span>
                  <span>{tab.label}</span>
                </button>
              </li>
            ))}
          </ul>
        </nav>
      </aside>

      {/* Content Panel */}
      <main
        className="flex-1 bg-base-100 rounded-lg shadow-xl p-6"
        role="tabpanel"
        id={`${activeTab}-panel`}
        aria-labelledby={`${activeTab}-tab`}
      >
        {ActiveComponent && <ActiveComponent />}
      </main>
    </div>
  );
}

export default SettingsLayout;
