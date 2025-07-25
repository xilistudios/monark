import { createSelector } from 'reselect'
import { VaultState } from '../actions/vault'
import { Vault } from '../actions/vault'
import { Entry } from '../../interfaces/vault.interface'

type RootState = { vault: VaultState }

// Current vaultId selector
export const selectCurrentVaultId = (state: RootState): string | null =>
	state.vault.currentVaultId

// Vaults selector
export const selectVaults = (state: RootState): Vault[] =>
	state.vault.vaults

// Current vault selector (memoized)
export const selectCurrentVault = createSelector(
	[selectVaults, selectCurrentVaultId],
	(vaults, currentVaultId) =>
		vaults.find((vault) => vault.id === currentVaultId) ?? null
)

// Memoized entries selector
export const selectVaultEntries = createSelector(
	[selectCurrentVault],
	(currentVault): Entry[] =>
		currentVault?.volatile?.entries ?? []
)

// Vault loading/error status
export const selectVaultStatus = createSelector(
	[(state: RootState) => state.vault],
	(vaultState) => ({
		loading: vaultState.loading,
		error: vaultState.error
	})
)

// Type-safe accessors for vault properties
export const selectVaultProperty = <K extends keyof Vault>(
	state: RootState,
	key: K
): Vault[K] | undefined => {
	const vault = selectCurrentVault(state)
	return vault ? vault[key] : undefined
}