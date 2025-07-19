import { useState } from 'react';
import { AddVaultForm } from './AddVaultForm';
import { ImportVaultForm } from './ImportVaultForm';

interface VaultTabsProps {
  onSuccess: () => void;
  onCancel: () => void;
}

export const VaultTabs = ({ onSuccess, onCancel }: VaultTabsProps) => {
  const [activeTab, setActiveTab] = useState<'create' | 'import'>('create');

  return (
    <div className="w-full">
      {/* Tab Navigation */}
      <div role="tablist" className="tabs tabs-boxed mb-6">
        <button 
          role="tab" 
          className={`tab ${activeTab === 'create' ? 'tab-active' : ''}`}
          onClick={() => setActiveTab('create')}
        >
          Create New Vault
        </button>
        <button 
          role="tab" 
          className={`tab ${activeTab === 'import' ? 'tab-active' : ''}`}
          onClick={() => setActiveTab('import')}
        >
          Import Existing Vault
        </button>
      </div>

      {/* Tab Content */}
      <div className="mt-6">
        {activeTab === 'create' && (
          <AddVaultForm onSuccess={onSuccess} onCancel={onCancel} />
        )}
        {activeTab === 'import' && (
          <ImportVaultForm onSuccess={onSuccess} onCancel={onCancel} />
        )}
      </div>
    </div>
  );
};
