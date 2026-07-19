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
			<div role="tablist" className="flex p-1 bg-base-200/50 rounded-lg w-full mb-2">
				<button
					role="tab"
					className={`flex-1 py-2 px-4 rounded-md text-sm transition-all duration-300 ${(activeTabs[currentVaultId!] || 'create') === 'create' ? 'bg-base-100 shadow-sm font-semibold text-base-content' : 'text-base-content/60 hover:text-base-content'}`}
					onClick={() => handleTabChange(currentVaultId!, 'create')}
				>
					{t('vaultSelector.createNew')}
				</button>
				<button
					role="tab"
					className={`flex-1 py-2 px-4 rounded-md text-sm transition-all duration-300 ${(activeTabs[currentVaultId!] || 'create') === 'import' ? 'bg-base-100 shadow-sm font-semibold text-base-content' : 'text-base-content/60 hover:text-base-content'}`}
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
