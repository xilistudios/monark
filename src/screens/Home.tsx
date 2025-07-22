import { useState } from 'react'
import { useSelector, useDispatch } from 'react-redux'
import { useTranslation } from 'react-i18next'
import VaultSelector from "../components/Vault/VaultSelector"
import { AddEntryModal } from "../components/Vault/AddEntryModal"
import { AddGroupModal } from "../components/Vault/AddGroupModal"
import VaultTree from "../components/Vault/VaultTree"
import { RootState, AppDispatch } from '../redux/store'
import { readVault, lockVault, setVaultCredential, setNavigationPath } from '../redux/actions/vault'
import { Entry, isGroupEntry } from '../interfaces/vault.interface'

const HomeScreen = () => {
    const { t } = useTranslation('home')
    const dispatch = useDispatch<AppDispatch>()
    const { currentVault, vaultState, loading, error } = useSelector((state: RootState) => state.vault)
    const navigationPath = useSelector((state: RootState) => state.vault.currentVault?.data?.navigationPath || '/')
    
    const [password, setPassword] = useState('')
    const [unlockError, setUnlockError] = useState('')
    const [isAddEntryModalOpen, setIsAddEntryModalOpen] = useState(false)
    const [addEntryParentId, setAddEntryParentId] = useState<string | null>(null)
    const [isAddGroupModalOpen, setIsAddGroupModalOpen] = useState(false)
    const [addGroupParentId, setAddGroupParentId] = useState<string | null>(null)

    const getCurrentParentId = () => {
        const pathParts = navigationPath.split('/').filter(Boolean)
        return pathParts.length > 0 ? pathParts[pathParts.length - 1] : null
    }

    const getCurrentEntries = (entries: Entry[], parentId: string | null) => {
        if (!parentId) {
            const allChildren = new Set<string>()
            entries.forEach(e => {
                if (isGroupEntry(e)) {
                    e.children.forEach(c => allChildren.add(c))
                }
            })
            return entries.filter(e => !allChildren.has(e.id))
        } else {
            const parent = entries.find(e => e.id === parentId)
            if (!parent || !isGroupEntry(parent)) return []
            return parent.children
                .map(childId => entries.find(e => e.id === childId))
                .filter(Boolean) as Entry[]
        }
    }

    const handleNavigate = (groupId: string) => {
        const newPath = `${navigationPath === '/' ? '' : navigationPath}/${groupId}`
        dispatch(setNavigationPath(newPath))
    }

    const renderBreadcrumbs = () => {
        const parts = navigationPath.split('/').filter(Boolean)
        return (
            <div className="breadcrumbs text-sm p-4 border-b border-base-300">
                <ul>
                    <li>
                        <a onClick={() => dispatch(setNavigationPath('/'))}>/</a>
                    </li>
                    {parts.map((id, index) => {
                        const entry = vaultState.entries.find(e => e.id === id)
                        if (!entry) return null
                        const pathUpTo = '/' + parts.slice(0, index + 1).join('/')
                        return (
                            <li key={id}>
                                <a onClick={() => dispatch(setNavigationPath(pathUpTo))}>{entry.name}</a>
                            </li>
                        )
                    })}
                </ul>
            </div>
        )
    }

    const handleUnlockVault = async () => {
        if (!currentVault || !password.trim()) {
            setUnlockError(t('errors.missingFields'))
            return
        }

        setUnlockError('')
        try {
            await dispatch(readVault({
                password: password.trim(),
                filePath: currentVault.path
            })).unwrap()
            
            dispatch(setVaultCredential(password.trim()))
            dispatch(setNavigationPath('/'))
            setPassword('')
        } catch (err) {
            setUnlockError(t('errors.unlockFailed'))
        }
    }

    const handleLockVault = () => {
        dispatch(lockVault())
        setPassword('')
        setUnlockError('')
    }

    const handleEntryClick = (entry: Entry) => {
        // Future: Navigate to entry details
        console.log('Entry clicked:', entry)
    }

    const renderVaultContent = () => {
        if (!currentVault) {
            return (
                <div className="flex items-center justify-center h-full">
                    <div className="text-center">
                        <h2 className="text-2xl font-bold mb-4">{t('vault.manager.noVaultSelected')}</h2>
                        <p className="text-base-content/60">{t('vault.manager.selectVaultToStart')}</p>
                    </div>
                </div>
            )
        }

        if (vaultState.isLocked) {
            return (
                <div className="flex items-center justify-center h-full">
                    <div className="card w-96 bg-base-100 shadow-xl">
                        <div className="card-body">
                            <h2 className="card-title justify-center mb-4">
                                <svg className="w-6 h-6 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                                        d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                                </svg>
                                {t('vault.unlock.title')}
                            </h2>
                            
                            <div className="form-control">
                                <label className="label">
                                    <span className="label-text">{t('vault.unlock.password')}</span>
                                </label>
                                <input
                                    type="password"
                                    placeholder={t('vault.unlock.passwordPlaceholder')}
                                    className="input input-bordered"
                                    value={password}
                                    onChange={(e) => setPassword(e.target.value)}
                                    onKeyPress={(e) => e.key === 'Enter' && handleUnlockVault()}
                                />
                            </div>

                            {(unlockError || error) && (
                                <div className="alert alert-error mt-4">
                                    <span>{unlockError || (typeof error === 'string' ? error : JSON.stringify(error))}</span>
                                </div>
                            )}

                            <div className="card-actions justify-end mt-4">
                                <button
                                    className="btn btn-primary"
                                    onClick={handleUnlockVault}
                                    disabled={loading || !password.trim()}
                                >
                                    {loading ? (
                                        <>
                                            <span className="loading loading-spinner loading-sm"></span>
                                            {t('vault.unlock.unlocking')}
                                        </>
                                    ) : (
                                        t('vault.unlock.unlockButton')
                                    )}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )
        }

        // Unlocked vault manager
        return (
            <div className="h-full flex flex-col">
                {/* Header with actions */}
                <div className="p-4 border-b border-base-300">
                    <div className="flex justify-between items-center">
                        <h2 className="text-2xl font-bold">{currentVault.name}</h2>
                        <div className="flex gap-2">
                            <button
                                className="btn btn-primary btn-sm"
                                onClick={() => {
                                    setAddEntryParentId(getCurrentParentId())
                                    setIsAddEntryModalOpen(true)
                                }}
                            >
                                <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                                </svg>
                                {t('vault.manager.addEntry')}
                            </button>
                            <button
                                className="btn btn-outline btn-sm"
                                onClick={() => {
                                    setAddGroupParentId(getCurrentParentId())
                                    setIsAddGroupModalOpen(true)
                                }}
                            >
                                <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                                </svg>
                                {t('vault.manager.addGroup')}
                            </button>
                            <button
                                className="btn btn-ghost btn-sm"
                                onClick={handleLockVault}
                            >
                                <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                                        d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                                </svg>
                                Lock
                            </button>
                        </div>
                    </div>
                </div>

                {/* Content area */}
                <div className="flex-1 overflow-auto">
                    {renderBreadcrumbs()}
                    <div className="p-4">
                        {getCurrentEntries(vaultState.entries, getCurrentParentId()).length === 0 ? (
                            <div className="text-center py-12">
                                <div className="text-base-content/60 mb-4">
                                    <svg className="w-16 h-16 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1}
                                            d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                                    </svg>
                                    <p className="text-lg">{t('vault.manager.emptyVault')}</p>
                                </div>
                            </div>
                        ) : (
                            <VaultTree 
                                entries={getCurrentEntries(vaultState.entries, getCurrentParentId())}
                                onAddEntry={(parentId) => {
                                    setAddEntryParentId(parentId);
                                    setIsAddEntryModalOpen(true);
                                }}
                                onAddGroup={(parentId) => {
                                    setAddGroupParentId(parentId);
                                    setIsAddGroupModalOpen(true);
                                }}
                                onEdit={(entry) => {
                                    // TODO: Implement edit modal
                                    console.log('Edit entry:', entry);
                                }}
                                onNavigate={handleNavigate}
                            />
                        )}
                    </div>
                </div>
            </div>
        )
    }

    return (
        <div className="flex h-screen w-screen">
            <div className="vault-selector w-1/5 h-full border-r border-base-300">
                <VaultSelector />
            </div>
            <div className="vault-content w-4/5 h-full">
                {renderVaultContent()}
            </div>

            {/* Add Entry Modal */}
            <AddEntryModal
                isOpen={isAddEntryModalOpen}
                onClose={() => setIsAddEntryModalOpen(false)}
                onSuccess={() => setIsAddEntryModalOpen(false)}
                parentId={addEntryParentId}
            />
            <AddGroupModal
                isOpen={isAddGroupModalOpen}
                onClose={() => setIsAddGroupModalOpen(false)}
                onSuccess={() => setIsAddGroupModalOpen(false)}
                parentId={addGroupParentId}
            />
        </div>
    )
}

export default HomeScreen