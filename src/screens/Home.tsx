import { useState, useEffect } from 'react'
import { useSelector, useDispatch } from 'react-redux'
import { useTranslation } from 'react-i18next'
import VaultSelector from "../components/Vault/VaultSelector"
import { AddEntryModal } from "../components/Vault/AddEntryModal"
import { RootState, AppDispatch } from '../redux/store'
import { unlockVault, saveVault, lockVault } from '../redux/actions/vault'
import { Entry, DataEntry, GroupEntry } from '../interfaces/vault.interface'

const HomeScreen = () => {
    const { t } = useTranslation('home')
    const dispatch = useDispatch<AppDispatch>()
    const { currentVault, vaultState, loading, error } = useSelector((state: RootState) => state.vault)
    
    const [password, setPassword] = useState('')
    const [unlockError, setUnlockError] = useState('')
    const [isAddEntryModalOpen, setIsAddEntryModalOpen] = useState(false)

    // Auto-save functionality
    useEffect(() => {
        if (currentVault && !vaultState.isLocked && vaultState.entries.length > 0) {
            const timeoutId = setTimeout(() => {
                dispatch(saveVault({
                    filePath: currentVault.path,
                    password: currentVault.data?.credential || ''
                }))
            }, 2000) // Auto-save after 2 seconds of no changes

            return () => clearTimeout(timeoutId)
        }
    }, [vaultState.entries, currentVault, vaultState.isLocked, dispatch])

    const handleUnlockVault = async () => {
        if (!currentVault || !password.trim()) {
            setUnlockError(t('errors.missingFields'))
            return
        }

        setUnlockError('')
        try {
            await dispatch(unlockVault({
                password: password.trim(),
                filePath: currentVault.path
            })).unwrap()
            
            // Store credential for auto-save
            if (currentVault.data) {
                currentVault.data.credential = password.trim()
            }
            
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

        // Filter entries by type from unified array
        const groupEntries = vaultState.entries.filter((entry): entry is GroupEntry => entry.entry_type === 'group')
        const dataEntries = vaultState.entries.filter((entry): entry is DataEntry => entry.entry_type === 'entry')

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
                                onClick={() => setIsAddEntryModalOpen(true)}
                            >
                                <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                                </svg>
                                {t('vault.manager.addEntry')}
                            </button>
                            <button className="btn btn-outline btn-sm">
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
                <div className="flex-1 p-4 overflow-auto">
                    {vaultState.entries.length === 0 ? (
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
                        <div className="space-y-6">
                            {/* Groups Section */}
                            {groupEntries.length > 0 && (
                                <div>
                                    <h3 className="text-lg font-semibold mb-3 flex items-center">
                                        <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                                                d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                                        </svg>
                                        {t('vault.manager.groups')} ({groupEntries.length})
                                    </h3>
                                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                                        {groupEntries.map((group) => (
                                            <div key={group.id} className="card bg-base-200 cursor-pointer hover:bg-base-300 transition-colors">
                                                <div className="card-body p-4">
                                                    <div className="flex items-center">
                                                        <svg className="w-5 h-5 mr-3 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                                                                d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                                                        </svg>
                                                        <span className="font-medium">{group.name}</span>
                                                    </div>
                                                    <div className="text-sm text-base-content/60 mt-1">
                                                        {group.children.length} {group.children.length === 1 ? 'item' : 'items'}
                                                    </div>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {/* Entries Section */}
                            {dataEntries.length > 0 && (
                                <div>
                                    <h3 className="text-lg font-semibold mb-3 flex items-center">
                                        <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                                                d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
                                        </svg>
                                        {t('vault.manager.entries')} ({dataEntries.length})
                                    </h3>
                                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                                        {dataEntries.map((entry) => (
                                            <div
                                                key={entry.id}
                                                className="card bg-base-100 border border-base-300 cursor-pointer hover:shadow-md transition-shadow"
                                                onClick={() => handleEntryClick(entry)}
                                            >
                                                <div className="card-body p-4">
                                                    <div className="flex items-center">
                                                        <svg className="w-5 h-5 mr-3 text-accent" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                                                                d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
                                                        </svg>
                                                        <span className="font-medium">{entry.name}</span>
                                                    </div>
                                                    <div className="text-sm text-base-content/60 mt-1">
                                                        {entry.data_type} • {entry.fields.length} fields
                                                    </div>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>
                    )}
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
            />
        </div>
    )
}

export default HomeScreen