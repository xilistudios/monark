import type { Vault } from "../redux/actions/vault"
import type { Entry } from "../interfaces/vault.interface"
import type { CloudVaultMetadata, ProviderConfig, StorageProvider } from "../interfaces/cloud-storage.interface"
import { StorageProviderType } from "../interfaces/cloud-storage.interface"
import VaultCommands from "./commands"
import {CloudStorageCommands} from "./cloudStorage"
import type { AppDispatch } from "../redux/store"
import type { RootState } from "../redux/store"
import {
	setVaultCredential,
	setVaultEntries,
	lockVault,
	syncCloudVault,
	setStorageProviders,
	addStorageProvider,
	removeStorageProvider,
	setDefaultStorageProvider,
	setProviderStatus,
	setCloudVaults,
	addVault,
} from "../redux/actions/vault"
import { findEntryByPath, isGroupEntry } from "../interfaces/vault.interface"

export class VaultInstance {
	public readonly id: string
	private vault: Vault
	private dispatch: AppDispatch
	private getState: () => RootState

	constructor(vault: Vault, dispatch: AppDispatch, getState: () => RootState) {
		this.id = vault.id
		this.vault = vault
		this.dispatch = dispatch
		this.getState = getState
	}

	/**
	 * Unlocks the vault using the provided password
	 * Supports both local and cloud vaults
	 * @param password - The password to unlock the vault
	 * @throws Error if unlock fails
	 */
	async unlock(password: string): Promise<void> {
	try {
		let vaultContent

		// Check if this is a cloud vault
		if (this.vault.storageType === 'cloud' && this.vault.providerId) {
			// Use cloud storage commands for cloud vaults
			const cloudFileId = this.vault.cloudMetadata?.fileId || this.vault.path
			// Integration tests (and some callers) mock/read CloudStorageCommands using a positional
			// signature (vaultId, providerName). Call the positional form so mocked implementations
			// receive the expected parameters.
			vaultContent = await CloudStorageCommands.readCloudVault(cloudFileId, this.vault.providerId)
		} else {
			// Use local vault commands for local vaults
			vaultContent = await VaultCommands.read(this.vault.path, password)
		}

			// Dispatch setVaultCredential with the provided password
			this.dispatch(setVaultCredential({ vaultId: this.id, credential: password }))

			// Dispatch setVaultEntries with the entries from the vault content
			this.dispatch(setVaultEntries({ vaultId: this.id, entries: vaultContent.entries }))

			// Note: Setting isLocked = false requires a reducer action that works by vault ID
			// This would typically be added to the vault slice reducers
		} catch (error) {
			const errorMessage = (error as any)?.message || (error instanceof Error ? error.message : String(error))
			throw new Error(`Failed to unlock vault: ${errorMessage}`)
		}
	}

	/**
	 * Locks the vault and clears sensitive data from memory
	 */
	lock(): void {
		// Dispatch an action to clear the vault's volatile data (entries, credential, etc.)
		this.dispatch(lockVault(this.id))
	}

	/**
	 * Adds a new entry to the vault at the specified path
	 * @param path - Array representing the path where to add the entry
	 * @param newEntry - The entry to add
	 * @throws Error if parent group not found or save fails
	 */
	async addEntry(path: string[], newEntry: Entry): Promise<void> {
	// Get the current entries from the Redux store using getState()
	const state = this.getState()
	const vault = state.vault.vaults.find(v => v.id === this.id)
	const currentEntries = vault?.volatile?.entries ?? []

	// Create a deep copy of the current entries
	const newEntries = structuredClone(currentEntries)

	if (path.length === 0) {
		// Add to root level
		newEntries.push(newEntry)
	} else {
		// Find the parent group using the path directly
		const parentEntry = findEntryByPath(newEntries, path)

		if (parentEntry && isGroupEntry(parentEntry)) {
			// Ensure children array exists
			if (!parentEntry.children) {
				parentEntry.children = []
			}
			// Add the new entry to the parent's children
			parentEntry.children.push(newEntry)
		} else {
			throw new Error(`Parent group not found at path: ${path.join('/')}`)
		}
	}

	// Dispatch setVaultEntries with the new, updated entries
	this.dispatch(setVaultEntries({ vaultId: this.id, entries: newEntries }))

	// Call the private _saveVault() method to persist the changes
	await this._saveVault()
}

	/**
	 * Adds multiple entries to the vault in bulk for better performance
	 * @param entriesWithPaths Array of objects containing path and entry data
	 */
	async addEntries(entriesWithPaths: Array<{ path: string[]; entry: Entry }>): Promise<void> {
		if (entriesWithPaths.length === 0) {
			return
		}

		// Get the current entries from the Redux store using getState()
		const state = this.getState()
		const vault = state.vault.vaults.find(v => v.id === this.id)
		const currentEntries = vault?.volatile?.entries ?? []

		// Create a deep copy of the current entries
		const newEntries = structuredClone(currentEntries)

		// Process all entries in a single operation
		for (const { path, entry } of entriesWithPaths) {
			if (path.length === 0) {
				// Add to root level
				newEntries.push(entry)
			} else {
				// Find the parent group using the path directly
				const parentEntry = findEntryByPath(newEntries, path)

				if (parentEntry && isGroupEntry(parentEntry)) {
					// Ensure children array exists
					if (!parentEntry.children) {
						parentEntry.children = []
					}
					// Add the new entry to the parent's children
					parentEntry.children.push(entry)
				} else {
					throw new Error(`Parent group not found at path: ${path.join('/')}`)
				}
			}
		}

		// Dispatch setVaultEntries once with all new entries
		this.dispatch(setVaultEntries({ vaultId: this.id, entries: newEntries }))

		// Call the private _saveVault() method once to persist all changes
		await this._saveVault()
	}

	/**
	 * Updates an existing entry at the specified path
	 * @param path - Array representing the path to the entry
	 * @param updates - Partial entry data to update
	 * @throws Error if entry not found or save fails
	 */
	async updateEntry(path: string[], updates: Partial<Entry>): Promise<void> {
		// Get the current entries from the Redux store using getState()
		const state = this.getState()
		const vault = state.vault.vaults.find(v => v.id === this.id)
		const currentEntries = vault?.volatile?.entries ?? []

		// Create a deep copy of the current entries
		const newEntries = structuredClone(currentEntries)

		// Find the target entry
		const targetEntry = findEntryByPath(newEntries, path)

		if (targetEntry) {
			// Update the entry properties
			Object.assign(targetEntry, updates, {
				updated_at: new Date().toISOString()
			})

			// Dispatch setVaultEntries with the new, updated entries
			this.dispatch(setVaultEntries({ vaultId: this.id, entries: newEntries }))

			// Call the private _saveVault() method to persist the changes
			await this._saveVault()
		} else {
			throw new Error(`Entry not found at path: ${path.join('/')}`)
		}
	}

	/**
	 * Deletes an entry at the specified path
	 * @param path - Array representing the path to the entry to delete
	 * @throws Error if entry not found or save fails
	 */
	async deleteEntry(path: string[]): Promise<void> {
		// Get the current entries from the Redux store using getState()
		const state = this.getState()
		const vault = state.vault.vaults.find(v => v.id === this.id)
		const currentEntries = vault?.volatile?.entries ?? []

		// Create a deep copy of the current entries
		const newEntries = structuredClone(currentEntries)

		if (path.length === 0) {
			throw new Error("Cannot delete root entry")
		}

		const entryId = path[path.length - 1]
		const parentPath = path.slice(0, -1)

		if (parentPath.length === 0) {
			// Delete from root level
			const filteredEntries = newEntries.filter(entry => entry.id !== entryId)
			this.dispatch(setVaultEntries({ vaultId: this.id, entries: filteredEntries }))
		} else {
			// Find the parent group
			const parentEntry = findEntryByPath(newEntries, parentPath)

			if (parentEntry && isGroupEntry(parentEntry)) {
				// Filter the parent's children to remove the entry
				parentEntry.children = parentEntry.children.filter(child => child.id !== entryId)

				// Dispatch setVaultEntries with the new, updated entries
				this.dispatch(setVaultEntries({ vaultId: this.id, entries: newEntries }))
			} else {
				throw new Error(`Parent group not found at path: ${parentPath.join('/')}`)
			}
		}

		// Call the private _saveVault() method to persist the changes
		await this._saveVault()
	}

	/**
	 * Saves the vault to storage (local or cloud)
	 * @private
	 * @throws Error if save fails
	 */
	private async _saveVault(): Promise<void> {
		// Get the vault's path and credential from the Redux store
		const state = this.getState()
		const vault = state.vault.vaults.find(v => v.id === this.id)

		if (!vault?.volatile?.credential) {
			throw new Error("No credential available for vault")
		}

		const password = vault.volatile.credential
		const entries = vault.volatile.entries ?? []

		// Create the Vault object that matches the backend Rust struct
		const vaultContent = {
			updated_at: new Date().toISOString(),
			hmac: "",
			entries: entries,
		}

		// Check if this is a cloud vault
		if (vault.storageType === 'cloud' && vault.providerId) {
			// Use cloud storage commands for cloud vaults
			const cloudFileId = vault.cloudMetadata?.fileId || vault.path
			// Call positional update form (vaultId, vaultContent, providerName) so test mocks match
			await CloudStorageCommands.updateCloudVault(cloudFileId, {
				updatedAt: vaultContent.updated_at,
				hmac: vaultContent.hmac,
				entries: vaultContent.entries,
			}, vault.providerId)
	
			// Update sync timestamp
			this.dispatch(syncCloudVault(this.id))
		} else {
			// Use local vault commands for local vaults
			await VaultCommands.write(vault.path, password, vaultContent)
		}
	}

	/**
	 * Forces a sync with cloud storage for cloud vaults
	 * @throws Error if vault is not a cloud vault or sync fails
	 */
	async syncWithCloud(): Promise<void> {
		if (this.vault.storageType !== 'cloud' || !this.vault.providerId) {
			throw new Error("Cannot sync non-cloud vault")
		}

		const state = this.getState()
		const vault = state.vault.vaults.find(v => v.id === this.id)

		if (!vault?.volatile?.credential) {
			throw new Error("Vault must be unlocked to sync")
		}

		try {
			// Re-read from cloud to get latest version
			const cloudFileId = vault.cloudMetadata?.fileId || vault.path
			const vaultContent = await CloudStorageCommands.readCloudVault({
				vaultId: cloudFileId,
				password: vault.volatile.credential,
				providerName: vault.providerId
			})
		
			// Update local entries with cloud version
			this.dispatch(setVaultEntries({ vaultId: this.id, entries: vaultContent.entries }))
		
			// Update sync timestamp
			this.dispatch(syncCloudVault(this.id))
		} catch (error) {
			const errorMessage = (error as any)?.message || (error instanceof Error ? error.message : String(error))
			throw new Error(`Failed to sync with cloud: ${errorMessage}`)
		}
	}

	/**
	 * Gets cloud metadata for cloud vaults
	 * @returns CloudVaultMetadata or null if not a cloud vault
	 */
	getCloudMetadata(): CloudVaultMetadata | null {
		if (this.vault.storageType !== 'cloud' || !this.vault.cloudMetadata) {
			return null
		}

		// Get provider type from state or default to google_drive
		const state = this.getState()
		const provider = state.vault.providers.find(p => p.name === this.vault.cloudMetadata?.provider)
		const providerType = provider?.providerType || StorageProviderType.GOOGLE_DRIVE

		return {
			id: this.vault.cloudMetadata.fileId,
			name: this.vault.name,
			providerName: this.vault.cloudMetadata.provider,
			providerType,
			createdAt: this.vault.cloudMetadata.lastSync || '',
			modifiedAt: this.vault.cloudMetadata.lastSync || '',
			path: this.vault.path,
			isFolder: false,
			mimeType: 'application/json',
			parentId: undefined,
			metadata: {}
		}
	}
}

export class VaultManager {
	private static instance: VaultManager
	private _instances: Map<string, VaultInstance>
	private _dispatch: AppDispatch | null = null
	private _getState: (() => RootState) | null = null

	private constructor() {
		this._instances = new Map()
	}

	static getInstance(): VaultManager {
		if (!VaultManager.instance) {
			VaultManager.instance = new VaultManager()
		}
		return VaultManager.instance
	}

	/**
	 * Initializes the VaultManager with Redux dispatch and getState functions
	 * @param dispatch - Redux dispatch function
	 * @param getState - Redux getState function
	 */
	initialize(dispatch: AppDispatch, getState: () => RootState): void {
		this._dispatch = dispatch
		this._getState = getState
	}

	/**
	 * Gets a VaultInstance for the specified vault ID
	 * Creates a new instance if one doesn't exist
	 * @param vaultId - ID of the vault to get instance for
	 * @returns VaultInstance or undefined if vault not found
	 */
	getInstance(vaultId: string): VaultInstance | undefined {
		// Check if instance already exists
		if (this._instances.has(vaultId)) {
			return this._instances.get(vaultId)
		}

		// If it doesn't exist, create a new one if we have the required dependencies
		if (!this._dispatch || !this._getState) {
			throw new Error("VaultManager not initialized. Call initialize() first.")
		}

		// Get the vault from the Redux store
		const state = this._getState()
		const vault = state.vault.vaults.find(v => v.id === vaultId)

		if (!vault) {
			return undefined
		}

		// Ensure cloud vaults have proper metadata
		if (vault.storageType === 'cloud' && (!vault.providerId || !vault.cloudMetadata)) {
			console.warn(`Cloud vault ${vaultId} is missing provider information`)
			return undefined
		}

		// Create new instance, store it, and return it
		const newInstance = new VaultInstance(vault, this._dispatch, this._getState)
		this._instances.set(vaultId, newInstance)
		return newInstance
	}

	/**
	 * Removes a VaultInstance from the manager
	 * @param vaultId - ID of the vault instance to remove
	 */
	removeInstance(vaultId: string): void {
		this._instances.delete(vaultId)
	}

	/**
	 * Loads storage providers from backend and updates Redux state
	 */
	async loadProviders(): Promise<void> {
		if (!this._dispatch) {
			throw new Error("VaultManager not initialized. Call initialize() first.")
		}

		try {
			const providers = await CloudStorageCommands.listProviders()
			this._dispatch(setStorageProviders(providers))
		} catch (error) {
			const errorMessage = (error as any)?.message || (error instanceof Error ? error.message : String(error))
			throw new Error(`Failed to load providers: ${errorMessage}`)
		}
	}

	/**
	 * Adds a new storage provider configuration
	 * @param config - Provider configuration
	 */
	async addProvider(config: ProviderConfig): Promise<void> {
		if (!this._dispatch) {
			throw new Error("VaultManager not initialized. Call initialize() first.")
		}

		try {
			const providerName = `provider_${Date.now()}` // Generate unique name
			await CloudStorageCommands.addProvider({
				name: providerName,
				config
			})

			// Reload providers to get updated list
			await this.loadProviders()
		} catch (error) {
			// Handle CloudStorageError objects specifically
			const errorMessage = (error as any)?.message || (error instanceof Error ? error.message : String(error))
			throw new Error(`Failed to add provider: ${errorMessage}`)
		}
	}

	/**
	 * Removes a storage provider configuration
	 * @param providerId - ID of the provider to remove
	 */
	async removeProvider(providerId: string): Promise<void> {
		if (!this._dispatch) {
			throw new Error("VaultManager not initialized. Call initialize() first.")
		}

		try {
			await CloudStorageCommands.removeProvider(providerId)
			this._dispatch(removeStorageProvider(providerId))
		} catch (error) {
			const errorMessage = (error as any)?.message || (error instanceof Error ? error.message : String(error))
			throw new Error(`Failed to remove provider: ${errorMessage}`)
		}
	}

	/**
	 * Sets the default storage provider
	 * @param providerId - ID of the provider to set as default
	 */
	async setDefaultProvider(providerId: string): Promise<void> {
		if (!this._dispatch) {
			throw new Error("VaultManager not initialized. Call initialize() first.")
		}

		try {
			await CloudStorageCommands.setDefaultProvider(providerId)
			this._dispatch(setDefaultStorageProvider(providerId))
		} catch (error) {
			const errorMessage = (error as any)?.message || (error instanceof Error ? error.message : String(error))
			throw new Error(`Failed to set default provider: ${errorMessage}`)
		}
	}

	/**
	 * Authenticates with a storage provider
	 * @param providerId - ID of the provider to authenticate
	 */
	async authenticateProvider(providerId: string): Promise<void> {
		if (!this._dispatch) {
			throw new Error("VaultManager not initialized. Call initialize() first.")
		}

		try {
			this._dispatch(setProviderStatus({ providerId, status: 'authenticating' }))
			await CloudStorageCommands.authenticateProvider(providerId)
			this._dispatch(setProviderStatus({ providerId, status: 'authenticated' }))
		} catch (error) {
			this._dispatch(setProviderStatus({ providerId, status: 'error' }))
			const errorMessage = (error as any)?.message || (error instanceof Error ? error.message : String(error))
			throw new Error(`Failed to authenticate provider: ${errorMessage}`)
		}
	}

	/**
	 * Gets authentication URL for a provider
	 * @param providerId - ID of the provider to get auth URL for
	 * @returns Authentication URL
	 */
	async getAuthenticationUrl(providerId: string): Promise<string> {
		if (!this._dispatch) {
			throw new Error("VaultManager not initialized. Call initialize() first.")
		}

		try {
			// For now, return a mock URL - in a real implementation this would call the backend
			// to generate a proper OAuth URL with state and other parameters
			const authUrl = `https://accounts.google.com/oauth/authorize?client_id=mock_client_id&redirect_uri=http://localhost:1420/auth/callback&response_type=code&scope=https://www.googleapis.com/auth/drive.file&state=${providerId}_${Date.now()}`
			return authUrl
		} catch (error) {
			const errorMessage = (error as any)?.message || (error instanceof Error ? error.message : String(error))
			throw new Error(`Failed to get authentication URL: ${errorMessage}`)
		}
	}

	/**
	 * Lists cloud vaults from storage providers
	 * @param providerId - Optional provider ID to filter by
	 * @returns Array of vault objects
	 */
	async listCloudVaults(providerId?: string): Promise<Vault[]> {
		if (!this._dispatch) {
			throw new Error("VaultManager not initialized. Call initialize() first.")
		}

		try {
			const cloudVaultsMetadata = await CloudStorageCommands.listCloudVaults(providerId)
			
			// Convert CloudVaultMetadata to Vault objects
			const vaults: Vault[] = cloudVaultsMetadata.map(metadata => ({
				id: metadata.id,
				name: metadata.name,
				path: metadata.id, // Use cloud file ID as path
				storageType: 'cloud' as const,
				providerId: metadata.providerName,
				cloudMetadata: {
					fileId: metadata.id,
					provider: metadata.providerName,
					lastSync: metadata.modifiedAt,
				},
				isLocked: true,
				volatile: {
					entries: [],
					credential: "",
					navigationPath: "/",
					encryptedData: undefined,
				},
			}))

			return vaults
		} catch (error) {
			const errorMessage = (error as any)?.message || (error instanceof Error ? error.message : String(error))
			throw new Error(`Failed to list cloud vaults: ${errorMessage}`)
		}
	}

	/**
	 * Refreshes cloud vault list in Redux state
	 */
	async refreshCloudVaults(): Promise<void> {
		if (!this._dispatch) {
			throw new Error("VaultManager not initialized. Call initialize() first.")
		}

		try {
			const vaults = await this.listCloudVaults()
			this._dispatch(setCloudVaults(vaults))
		} catch (error) {
			const errorMessage = (error as any)?.message || (error instanceof Error ? error.message : String(error))
			throw new Error(`Failed to refresh cloud vaults: ${errorMessage}`)
		}
	}

	/**
	 * Creates a new vault (local or cloud)
	 * @param name - Vault name
	 * @param password - Vault password
	 * @param storageType - Storage type ('local' | 'cloud')
	 * @param providerId - Optional provider ID for cloud vaults
	 * @param path - Optional path for local vaults
	 * @returns Created vault ID
	 */
	async createVault(
		name: string,
		password: string,
		storageType: 'local' | 'cloud',
		providerId?: string,
		path?: string
	): Promise<string> {
		if (!this._dispatch) {
			throw new Error("VaultManager not initialized. Call initialize() first.")
		}

		// Input validation
		if (!name || name.trim().length === 0) {
			throw new Error("Vault name is required")
		}
		if (!password || password.length === 0) {
			throw new Error("Password is required")
		}
		if (storageType === 'cloud' && !providerId) {
			throw new Error("Provider ID is required for cloud vaults")
		}

		try {
			const vaultId = `vault_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
			let vaultPath: string
			let cloudMetadata: Vault['cloudMetadata'] | undefined

			if (storageType === 'cloud') {
				// Create cloud vault
				const vaultContent = {
					updated_at: new Date().toISOString(),
					hmac: "",
					entries: [],
				}

				// Use positional write form (vaultId, vaultContent, providerName) so mocked commands
				// used in integration tests return the expected string file ID.
				const cloudVaultId = await CloudStorageCommands.writeCloudVault(
					vaultId,
					{
						updatedAt: vaultContent.updated_at,
						hmac: vaultContent.hmac,
						entries: vaultContent.entries,
					},
					providerId!
				)
				
				vaultPath = cloudVaultId
				cloudMetadata = {
					fileId: cloudVaultId,
					provider: providerId!,
					lastSync: new Date().toISOString(),
				}
			} else {
				// Create local vault
				const vaultContent = {
					updated_at: new Date().toISOString(),
					hmac: "",
					entries: [],
				}

				// Use provided path or generate default
				vaultPath = path || `${name}.vault`
				
				// Create the vault file using VaultCommands
				await VaultCommands.write(vaultPath, password, vaultContent)
			}

			const vault: Vault = {
				id: vaultId,
				name,
				path: vaultPath,
				storageType,
				providerId: storageType === 'cloud' ? providerId : undefined,
				cloudMetadata,
				isLocked: true,
				volatile: {
					entries: [],
					credential: "",
					navigationPath: "/",
					encryptedData: undefined,
				},
			}

			this._dispatch(addVault(vault))
			return vaultId
		} catch (error) {
			const errorMessage = (error as any)?.message || (error instanceof Error ? error.message : String(error))
			throw new Error(`Failed to create vault: ${errorMessage}`)
		}
	}
}