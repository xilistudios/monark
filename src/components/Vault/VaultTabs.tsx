import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useSelector } from 'react-redux'
import { AddVaultForm } from './Forms/AddVaultForm'
import { ImportVaultForm } from './Forms/ImportVaultForm'
import { selectCurrentVaultId } from '../../redux/selectors/vaultSelectors'

interface VaultTabsProps {
	onSuccess: () => void
	onCancel: () => void
}

type TabType = 'create' | 'import'

export const VaultTabs = ({ onSuccess, onCancel }: VaultTabsProps) => {
	const { t } = useTranslation('home')
	const currentVaultId = useSelector(selectCurrentVaultId)
	const [activeTabs, setActiveTabs] = useState<Record<string, TabType>>({})

	const handleTabChange = (vaultId: string, tab: TabType) => {
		setActiveTabs(prev => ({ ...prev, [vaultId]: tab }))
	}

	return (
		<div className="w-full">
			{/* Tab Navigation for current vault */}
			<div role="tablist" className="tabs tabs-boxed mb-6">
				<button
					role="tab"
					className={`tab ${(activeTabs[currentVaultId!] || 'create') === 'create' ? 'tab-active' : ''}`}
					onClick={() => handleTabChange(currentVaultId!, 'create')}
				>
					{t('vaultSelector.createNew')}
				</button>
				<button
					role="tab"
					className={`tab ${(activeTabs[currentVaultId!] || 'create') === 'import' ? 'tab-active' : ''}`}
					onClick={() => handleTabChange(currentVaultId!, 'import')}
				>
					{t('vaultSelector.importExisting')}
				</button>
			</div>
			{/* Tab Content */}
			<div className="mt-6">
				{(activeTabs[currentVaultId!] || 'create') === 'create' && (
					<AddVaultForm onSuccess={onSuccess} onCancel={onCancel} />
				)}
				{(activeTabs[currentVaultId!] || 'create') === 'import' && (
					<ImportVaultForm onSuccess={onSuccess} onCancel={onCancel} />
				)}
			</div>
		</div>
	)
}
