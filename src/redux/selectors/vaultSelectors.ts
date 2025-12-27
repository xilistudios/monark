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

// Cloud storage selectors
export const selectProviders = (state: RootState) =>
	state.vault.providers

export const selectDefaultProvider = (state: RootState) =>
	state.vault.defaultProvider

export const selectProviderStatus = (state: RootState) =>
	state.vault.providerStatus

export const selectVaultLoading = (state: RootState) =>
	state.vault.loading

export const selectOAuthState = (state: RootState) =>
	state.vault.oauthState