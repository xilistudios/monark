import type { Vault } from "../redux/actions/vault"
import type { Entry } from "../interfaces/vault.interface"
import VaultCommands from "./commands"
import type { AppDispatch } from "../redux/store"
import type { RootState } from "../redux/store"
import {
	setVaultCredential,
	setVaultEntries,
	lockVault,
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

	async unlock(password: string): Promise<void> {
		try {
			// Call the VaultCommands.read Tauri command to get the vault content
			const vaultContent = await VaultCommands.read(this.vault.path, password)
			
			// Dispatch setVaultCredential with the provided password
			this.dispatch(setVaultCredential({ vaultId: this.id, credential: password }))
			
			// Dispatch setVaultEntries with the entries from the vault content
			this.dispatch(setVaultEntries({ vaultId: this.id, entries: vaultContent.entries }))
			
			// Note: Setting isLocked = false requires a reducer action that works by vault ID
			// This would typically be added to the vault slice reducers
		} catch (error) {
			throw new Error(`Failed to unlock vault: ${error}`)
		}
	}

	lock(): void {
		// Dispatch an action to clear the vault's volatile data (entries, credential, etc.)
		this.dispatch(lockVault(this.id))
	}

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

	private async _saveVault(): Promise<void> {
		// Get the vault's path and credential from the Redux store
		const state = this.getState()
		const vault = state.vault.vaults.find(v => v.id === this.id)
		
		if (!vault?.volatile?.credential) {
			throw new Error("No credential available for vault")
		}
		
		const filePath = vault.path
		const password = vault.volatile.credential
		const entries = vault.volatile.entries ?? []
		
		// Create the Vault object that matches the backend Rust struct
		const vaultContent = {
			updated_at: new Date().toISOString(),
			hmac: "",
			entries: entries,
		}
		
		await VaultCommands.write(filePath, password, vaultContent)
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

	initialize(dispatch: AppDispatch, getState: () => RootState): void {
		this._dispatch = dispatch
		this._getState = getState
	}

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
		
		// Create new instance, store it, and return it
		const newInstance = new VaultInstance(vault, this._dispatch, this._getState)
		this._instances.set(vaultId, newInstance)
		return newInstance
	}

	removeInstance(vaultId: string): void {
		this._instances.delete(vaultId)
	}
}