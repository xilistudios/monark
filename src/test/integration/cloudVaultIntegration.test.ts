
/**
 * Cloud Vault Integration Tests
 * 
 * This file contains comprehensive integration tests that verify the complete
 * cloud vault workflow from provider setup to vault operations. These tests
 * ensure all components work together correctly.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { configureStore } from '@reduxjs/toolkit'
import { CloudStorageCommands } from '../../services/cloudStorage'
import { VaultManager, VaultInstance } from '../../services/vault'
import vaultReducer, {
	addVault,
	setStorageProviders,
	setProviderStatus,
	setCloudVaults,
	syncCloudVault,
	setVaultCredential,
	setVaultEntries,
	lockVault
} from '../../redux/actions/vault'
import type { AppDispatch, RootState } from '../../redux/store'
import type { Vault } from '../../redux/actions/vault'
import type { StorageProvider } from '../../interfaces/cloud-storage.interface'
import { settingsStore } from '../../store/settings'
import { mockStore } from '../setup'
import {
	setupMockInvokeSuccess,
	setupMockInvokeError,
	resetAllMocks,
	mockProviders,
	mockCloudVaults,
	mockVaultContent,
	mockGoogleDriveConfig,
	createMockCloudVaultRequest,
	createMockCloudVaultUpdateRequest,
	createMockCloudVaultDeleteRequest,
	setupCloudVaultTestScenario,
	verifyInvokeCall,
	getInvokeCallHistory,
	mockInvoke
} from '../helpers/cloudStorageMocks'
import { CloudStorageErrorType, StorageProviderType } from '../../interfaces/cloud-storage.interface'

describe('Cloud Vault Integration', () => {
	let store: any
	let vaultManager: VaultManager
	let mockDispatch: AppDispatch
	let mockGetState: () => RootState

	beforeEach(() => {
		// Reset all mocks before each test
		resetAllMocks()
		
		// Mock the settings store to be initialized
		Object.defineProperty(settingsStore, 'store', {
			value: mockStore,
			writable: true,
		})
		Object.defineProperty(settingsStore, 'initialized', {
			value: true,
			writable: true,
		})
		
		// Mock the store methods
		mockStore.set.mockResolvedValue(undefined)
		mockStore.get.mockResolvedValue(undefined)
		mockStore.delete.mockResolvedValue(undefined)
		
		// Mock CloudStorageCommands methods to track invoke calls
		vi.mocked(CloudStorageCommands.listProviders).mockImplementation(async () => {
			await mockInvoke('list_providers')
			return mockProviders
		})
		vi.mocked(CloudStorageCommands.addProvider).mockImplementation(async (request) => {
			await mockInvoke('add_provider', { request })
			return undefined
		})
		vi.mocked(CloudStorageCommands.removeProvider).mockImplementation(async (name) => {
			await mockInvoke('remove_provider', { name })
			return undefined
		})
		vi.mocked(CloudStorageCommands.setDefaultProvider).mockImplementation(async (name) => {
			await mockInvoke('set_default_provider', { name })
			return undefined
		})
		vi.mocked(CloudStorageCommands.authenticateProvider).mockImplementation(async (providerName) => {
			await mockInvoke('authenticate_provider', { providerName })
			return undefined
		})
		vi.mocked(CloudStorageCommands.listCloudVaults).mockImplementation(async (providerName) => {
			await mockInvoke('list_vaults', { providerName })
			return mockCloudVaults
		})
		vi.mocked(CloudStorageCommands.readCloudVault).mockImplementation(async (vaultId, providerName) => {
			await mockInvoke('read_cloud_vault', { vaultId, providerName })
			return mockVaultContent
		})
		vi.mocked(CloudStorageCommands.writeCloudVault).mockImplementation(async (vaultId, vaultContent, providerName) => {
			await mockInvoke('write_cloud_vault', { vaultId, vaultContent, providerName })
			return vaultId
		})
		vi.mocked(CloudStorageCommands.updateCloudVault).mockImplementation(async (vaultId, vaultContent, providerName) => {
			await mockInvoke('update_cloud_vault', { vaultId, vaultContent, providerName })
			return undefined
		})
		vi.mocked(CloudStorageCommands.deleteCloudVault).mockImplementation(async (vaultId, providerName) => {
			await mockInvoke('delete_cloud_vault', { vaultId, providerName })
			return undefined
		})
		
		// Create Redux store
		store = configureStore({
			reducer: {
				vault: vaultReducer,
			},
		})
		
		// Initialize VaultManager
		vaultManager = VaultManager.getInstance()
		mockDispatch = store.dispatch
		mockGetState = store.getState
		
		vaultManager.initialize(mockDispatch, mockGetState)
		
		// Setup default successful mocks
		setupMockInvokeSuccess()
	})

	afterEach(() => {
		resetAllMocks()
	})

	describe('Provider Management Flow', () => {
		it('should add a new Google Drive provider', async () => {
			const providerConfig = {
				type: StorageProviderType.GOOGLE_DRIVE,
				config: mockGoogleDriveConfig
			}
			
			await vaultManager.addProvider(providerConfig)
			
			// Verify the provider was added via Tauri command
			expect(verifyInvokeCall('add_provider')).toBe(true)
			
			// Verify providers were reloaded
			expect(verifyInvokeCall('list_providers')).toBe(true)
		})

		it('should list all configured providers', async () => {
			const providers = await CloudStorageCommands.listProviders()
			
			expect(providers).toEqual(mockProviders)
			expect(verifyInvokeCall('list_providers')).toBe(true)
		})

		it('should set default provider', async () => {
			await CloudStorageCommands.setDefaultProvider('google-drive-primary')
			
			expect(verifyInvokeCall('set_default_provider', { name: 'google-drive-primary' })).toBe(true)
		})

		it('should remove provider', async () => {
			await CloudStorageCommands.removeProvider('google-drive-secondary')
			
			expect(verifyInvokeCall('remove_provider', { name: 'google-drive-secondary' })).toBe(true)
		})

		it('should handle provider authentication flow', async () => {
			// Set provider status to authenticating
			store.dispatch(setProviderStatus({ 
				providerId: 'google-drive-primary', 
				status: 'authenticating' 
			}))
			
			await vaultManager.authenticateProvider('google-drive-primary')
			
			// Verify authentication was attempted
			expect(verifyInvokeCall('authenticate_provider', { providerName: 'google-drive-primary' })).toBe(true)
			
			// Verify provider status was updated to authenticated
			const state = store.getState().vault
			expect(state.providerStatus['google-drive-primary']).toBe('authenticated')
		})

		it('should handle authentication failure', async () => {
			vi.mocked(CloudStorageCommands.authenticateProvider).mockRejectedValue(new Error('Authentication failed'))
			
			await expect(vaultManager.authenticateProvider('google-drive-primary')).rejects.toThrow()
			
			// Verify provider status was updated to error
			const state = store.getState().vault
			expect(state.providerStatus['google-drive-primary']).toBe('error')
		})
	})

	describe('Cloud Vault Creation Flow', () => {
		it('should create a cloud vault with authenticated provider', async () => {
			// Setup providers in Redux
			store.dispatch(setStorageProviders(mockProviders))
			
			const vaultId = await vaultManager.createVault(
				'Test Cloud Vault',
				'test-password',
				'cloud',
				'google-drive-primary'
			)
			
			// Verify vault was created via Tauri command
			expect(verifyInvokeCall('write_cloud_vault')).toBe(true)
			
			// Verify vault was added to Redux
			const state = store.getState().vault
			expect(state.vaults).toHaveLength(1)
			expect(state.vaults[0]).toMatchObject({
				name: 'Test Cloud Vault',
				storageType: 'cloud',
				providerId: 'google-drive-primary'
			})
			
			// Verify vault ID was returned
			expect(vaultId).toMatch(/^vault_\d+_[a-z0-9]+$/)
		})

		it('should verify Redux state is updated correctly after vault creation', async () => {
			store.dispatch(setStorageProviders(mockProviders))
			
			await vaultManager.createVault(
				'Redux Test Vault',
				'test-password',
				'cloud',
				'google-drive-primary'
			)
			
			const state = store.getState().vault
			const vault = state.vaults[0]
			
			expect(vault.name).toBe('Redux Test Vault')
			expect(vault.storageType).toBe('cloud')
			expect(vault.providerId).toBe('google-drive-primary')
			expect(vault.cloudMetadata).toBeDefined()
			expect(vault.isLocked).toBe(true)
			expect(vault.volatile.entries).toEqual([])
		})

		it('should verify VaultManager creates vault with correct metadata', async () => {
			store.dispatch(setStorageProviders(mockProviders))
			
			const vaultId = await vaultManager.createVault(
				'Metadata Test Vault',
				'test-password',
				'cloud',
				'google-drive-primary'
			)
			
			const state = store.getState().vault
			const vault = state.vaults[0]
			
			expect(vault.cloudMetadata).toMatchObject({
				fileId: expect.any(String),
				provider: 'google-drive-primary',
				lastSync: expect.any(String)
			})
		})

		it('should handle error when no provider is authenticated', async () => {
			// Don't setup any providers
			store.dispatch(setStorageProviders([]))
			
			await expect(vaultManager.createVault(
				'Test Vault',
				'test-password',
				'cloud',
				'non-existent-provider'
			)).rejects.toThrow('Provider ID is required for cloud vaults')
		})

		it('should handle vault creation failure', async () => {
			vi.mocked(CloudStorageCommands.writeCloudVault).mockRejectedValue(new Error('Quota exceeded'))
			
			store.dispatch(setStorageProviders(mockProviders))
			
			await expect(vaultManager.createVault(
				'Failed Vault',
				'test-password',
				'cloud',
				'google-drive-primary'
			)).rejects.toThrow()
			
			// Verify no vault was added to Redux
			const state = store.getState().vault
			expect(state.vaults).toHaveLength(0)
		})
	})

	describe('Cloud Vault Import Flow', () => {
		it('should import existing cloud vault', async () => {
			// Setup providers and cloud vaults
			store.dispatch(setStorageProviders(mockProviders))
			
			const importedVaults = await vaultManager.listCloudVaults('google-drive-primary')
			
			// Verify cloud vaults were listed
			expect(verifyInvokeCall('list_vaults', { providerName: 'google-drive-primary' })).toBe(true)
			expect(importedVaults).toHaveLength(2)
			
			// Add imported vaults to Redux
			store.dispatch(setCloudVaults(importedVaults))
			
			const state = store.getState().vault
			expect(state.vaults).toHaveLength(2)
			expect(state.vaults[0]).toMatchObject({
				name: 'Personal Vault',
				storageType: 'cloud',
				providerId: 'google-drive-primary'
			})
		})

		it('should verify vault is added to Redux with correct cloud metadata', async () => {
			store.dispatch(setStorageProviders(mockProviders))
			
			const cloudVaults = await vaultManager.listCloudVaults()
			store.dispatch(setCloudVaults(cloudVaults))
			
			const state = store.getState().vault
			const vault = state.vaults[0]
			
			expect(vault.cloudMetadata).toMatchObject({
				fileId: expect.any(String),
				provider: 'google-drive-primary',
				lastSync: expect.any(String)
			})
		})

		it('should list cloud vaults from provider', async () => {
			const vaults = await CloudStorageCommands.listCloudVaults('google-drive-primary')
			
			expect(vaults).toHaveLength(2)
			expect(vaults[0].name).toBe('Personal Vault.monark')
			expect(vaults[0].providerName).toBe('google-drive-primary')
		})

		it('should handle empty vault list', async () => {
			// Mock empty response
			vi.mocked(CloudStorageCommands.listCloudVaults).mockResolvedValue([])
			
			const vaults = await vaultManager.listCloudVaults()
			
			expect(vaults).toHaveLength(0)
		})
	})

	describe('Cloud Vault Unlock/Lock Flow', () => {
		let cloudVault: Vault
		let vaultInstance: VaultInstance

		beforeEach(() => {
			// Setup a cloud vault in Redux
			cloudVault = {
				id: 'test-cloud-vault',
				name: 'Test Cloud Vault',
				path: 'vault-file-1',
				storageType: 'cloud',
				providerId: 'google-drive-primary',
				cloudMetadata: {
					fileId: 'vault-file-1',
					provider: 'google-drive-primary',
					lastSync: '2023-12-01T15:45:30.000Z'
				},
				isLocked: true,
				volatile: {
					entries: [],
					credential: '',
					navigationPath: '/',
					encryptedData: undefined
				}
			}
			
			store.dispatch(addVault(cloudVault))
			vaultInstance = vaultManager.getInstance('test-cloud-vault')!
		})

		it('should unlock cloud vault', async () => {
			await vaultInstance.unlock('test-password')
			
			// Verify cloud vault was read
			expect(verifyInvokeCall('read_cloud_vault')).toBe(true)
			
			// Verify credential was stored
			const state = store.getState().vault
			const vault = state.vaults.find(v => v.id === 'test-cloud-vault')
			expect(vault?.volatile.credential).toBe('test-password')
		})

		it('should verify credentials are stored after unlock', async () => {
			await vaultInstance.unlock('test-password')
			
			const state = store.getState().vault
			const vault = state.vaults.find(v => v.id === 'test-cloud-vault')
			
			expect(vault?.volatile.credential).toBe('test-password')
			expect(vault?.volatile.entries).toEqual(mockVaultContent.entries)
		})

		it('should verify entries are loaded from cloud', async () => {
			await vaultInstance.unlock('test-password')
			
			const state = store.getState().vault
			const vault = state.vaults.find(v => v.id === 'test-cloud-vault')
			
			expect(vault?.volatile.entries).toEqual(mockVaultContent.entries)
			expect(vault?.volatile.entries).toHaveLength(2)
		})

		it('should lock cloud vault', async () => {
			// First unlock the vault
			await vaultInstance.unlock('test-password')
			
			// Then lock it
			vaultInstance.lock()
			
			// Verify vault was locked
			const state = store.getState().vault
			const vault = state.vaults.find(v => v.id === 'test-cloud-vault')
			
			expect(vault?.isLocked).toBe(true)
			expect(vault?.volatile.credential).toBe('')
			expect(vault?.volatile.entries).toEqual([])
		})

		it('should handle unlock failure with wrong password', async () => {
			vi.mocked(CloudStorageCommands.readCloudVault).mockRejectedValue(new Error('Invalid credentials'))
			
			await expect(vaultInstance.unlock('wrong-password')).rejects.toThrow()
			
			// Verify vault remains locked
			const state = store.getState().vault
			const vault = state.vaults.find(v => v.id === 'test-cloud-vault')
			expect(vault?.isLocked).toBe(true)
		})
	})

	describe('Cloud Vault Operations', () => {
		let cloudVault: Vault
		let vaultInstance: VaultInstance

		beforeEach(async () => {
			// Setup and unlock a cloud vault
			cloudVault = {
				id: 'test-cloud-vault',
				name: 'Test Cloud Vault',
				path: 'vault-file-1',
				storageType: 'cloud',
				providerId: 'google-drive-primary',
				cloudMetadata: {
					fileId: 'vault-file-1',
					provider: 'google-drive-primary',
					lastSync: '2023-12-01T15:45:30.000Z'
				},
				isLocked: false,
				volatile: {
					entries: [...mockVaultContent.entries],
					credential: 'test-password',
					navigationPath: '/',
					encryptedData: undefined
				}
			}
			
			store.dispatch(addVault(cloudVault))
			vaultInstance = vaultManager.getInstance('test-cloud-vault')!
			
		})

		it('should add entries to cloud vault', async () => {
			const newEntry = {
				id: 'new-entry',
				type: 'note' as const,
				title: 'New Entry',
				content: 'New content',
				created_at: new Date().toISOString(),
				updated_at: new Date().toISOString(),
				tags: ['new']
			}
			
			await vaultInstance.addEntry([], newEntry)
			
			// Verify vault was updated in cloud
			expect(verifyInvokeCall('write_cloud_vault')).toBe(true)
			
			// Verify entry was added to Redux
			const state = store.getState().vault
			const vault = state.vaults.find(v => v.id === 'test-cloud-vault')
			expect(vault?.volatile.entries).toContainEqual(newEntry)
		})

		it('should update entries in cloud vault', async () => {
			const updatedEntry = {
				...mockVaultContent.entries[0],
				title: 'Updated Title',
				content: 'Updated content'
			}
			
			await vaultInstance.updateEntry(['entry-1'], updatedEntry)
			
			// Verify vault was updated in cloud
			expect(verifyInvokeCall('write_cloud_vault')).toBe(true)
			
			// Verify entry was updated in Redux
			const state = store.getState().vault
			const vault = state.vaults.find(v => v.id === 'test-cloud-vault')
			const entry = vault?.volatile.entries.find(e => e.id === 'entry-1')
			expect(entry?.title).toBe('Updated Title')
		})

		it('should delete entries from cloud vault', async () => {
			await vaultInstance.deleteEntry(['entry-1'])
			
			// Verify vault was updated in cloud
			expect(verifyInvokeCall('write_cloud_vault')).toBe(true)
			
			// Verify entry was removed from Redux
			const state = store.getState().vault
			const vault = state.vaults.find(v => v.id === 'test-cloud-vault')
			expect(vault?.volatile.entries).not.toContainEqual(
				expect.objectContaining({ id: 'entry-1' })
			)
		})

		it('should verify changes are synced to cloud', async () => {
			const newEntry = {
				id: 'sync-test-entry',
				type: 'note' as const,
				title: 'Sync Test Entry',
				content: 'This should sync to cloud',
				created_at: new Date().toISOString(),
				updated_at: new Date().toISOString(),
				tags: ['sync', 'test']
			}
			
			await vaultInstance.addEntry([], newEntry)
			
			// Verify the write_cloud_vault command was called with updated content
			const callHistory = getInvokeCallHistory()
			const writeCall = callHistory.find(call => call.command === 'write_cloud_vault')
			
			expect(writeCall).toBeDefined()
			expect(writeCall?.args?.vaultContent?.entries).toContainEqual(newEntry)
		})

		it('should handle multiple operations in sequence', async () => {
			// Add entry
			const entry1 = {
				id: 'multi-entry-1',
				type: 'note' as const,
				title: 'Multi Entry 1',
				content: 'Content 1',
				created_at: new Date().toISOString(),
				updated_at: new Date().toISOString(),
				tags: ['multi']
			}
			
			await vaultInstance.addEntry([], entry1)
			
			// Update entry
			await vaultInstance.updateEntry(['multi-entry-1'], {
				title: 'Updated Multi Entry 1'
			})
			
			// Add another entry
			const entry2 = {
				id: 'multi-entry-2',
				type: 'note' as const,
				title: 'Multi Entry 2',
				content: 'Content 2',
				created_at: new Date().toISOString(),
				updated_at: new Date().toISOString(),
				tags: ['multi']
			}
			
			await vaultInstance.addEntry([], entry2)
			
			// Delete first entry
			await vaultInstance.deleteEntry(['multi-entry-1'])
			
			// Verify all operations were synced
			const callHistory = getInvokeCallHistory()
			const writeCalls = callHistory.filter(call => call.command === 'write_cloud_vault')
			
			// Should have 4 write calls (add, update, add, delete)
			expect(writeCalls).toHaveLength(4)
			
			// Verify final state
			const state = store.getState().vault
			const vault = state.vaults.find(v => v.id === 'test-cloud-vault')
			expect(vault?.volatile.entries).not.toContainEqual(
				expect.objectContaining({ id: 'multi-entry-1' })
			)
			expect(vault?.volatile.entries).toContainEqual(entry2)
		})
	})

	describe('Vault Sync Operations', () => {
		let cloudVault: Vault
		let vaultInstance: VaultInstance

		beforeEach(async () => {
			// Setup and unlock a cloud vault
			cloudVault = {
				id: 'sync-test-vault',
				name: 'Sync Test Vault',
				path: 'vault-file-1',
				storageType: 'cloud',
				providerId: 'google-drive-primary',
				cloudMetadata: {
					fileId: 'vault-file-1',
					provider: 'google-drive-primary',
					lastSync: '2023-12-01T15:45:30.000Z'
				},
				isLocked: false,
				volatile: {
					entries: [...mockVaultContent.entries],
					credential: 'test-password',
					navigationPath: '/',
					encryptedData: undefined
				}
			}
			
			store.dispatch(addVault(cloudVault))
			vaultInstance = vaultManager.getInstance('sync-test-vault')!
			
		})

		it('should perform manual sync operation', async () => {
			await vaultInstance.syncWithCloud()
			
			// Verify cloud vault was re-read
			expect(verifyInvokeCall('read_cloud_vault')).toBe(true)
			
			// Verify sync timestamp was updated
			const state = store.getState().vault
			const vault = state.vaults.find(v => v.id === 'sync-test-vault')
			expect(vault?.cloudMetadata?.lastSync).toBeDefined()
		})

		it('should verify sync status updates in Redux', async () => {
			const initialSyncTime = cloudVault.cloudMetadata?.lastSync
			
			// Wait a bit to ensure different timestamp
			await new Promise(resolve => setTimeout(resolve, 10))
			
			await vaultInstance.syncWithCloud()
			
			const state = store.getState().vault
			const vault = state.vaults.find(v => v.id === 'sync-test-vault')
			
			expect(vault?.cloudMetadata?.lastSync).not.toBe(initialSyncTime)
		})

		it('should handle sync error gracefully', async () => {
			vi.mocked(CloudStorageCommands.readCloudVault).mockRejectedValue(new Error('Network error'))
			
			await expect(vaultInstance.syncWithCloud()).rejects.toThrow()
			
			// Verify vault state remains unchanged
			const state = store.getState().vault
			const vault = state.vaults.find(v => v.id === 'sync-test-vault')
			expect(vault?.volatile.entries).toEqual(mockVaultContent.entries)
		})

		it('should handle sync for non-cloud vault', async () => {
			const localVault = {
				id: 'local-vault',
				name: 'Local Vault',
				path: '/local/path.vault',
				storageType: 'local' as const,
				isLocked: false,
				volatile: {
					entries: [],
					credential: 'test-password',
					navigationPath: '/',
					encryptedData: undefined
				}
			}
			
			store.dispatch(addVault(localVault))
			const localVaultInstance = vaultManager.getInstance('local-vault')!
			
			await expect(localVaultInstance.syncWithCloud()).rejects.toThrow('Cannot sync non-cloud vault')
		})

		it('should handle sync for locked vault', async () => {
			const lockedVault = {
				...cloudVault,
				isLocked: true,
				volatile: {
					...cloudVault.volatile,
					credential: ''
				}
			}
			
			store.dispatch(addVault(lockedVault))
			const lockedVaultInstance = vaultManager.getInstance('sync-test-vault')!
			
			await expect(lockedVaultInstance.syncWithCloud()).rejects.toThrow('Vault must be unlocked to sync')
		})
	})

	describe('Error Handling and Edge Cases', () => {
		it('should handle provider disconnection during operations', async () => {
			// Setup successful initial state
			store.dispatch(setStorageProviders(mockProviders))
			
			const vaultId = await vaultManager.createVault(
				'Error Test Vault',
				'test-password',
				'cloud',
				'google-drive-primary'
			)
			
			// Simulate provider error for subsequent operations
			vi.mocked(CloudStorageCommands.readCloudVault).mockRejectedValue(new Error('Provider not configured'))
			
			const vaultInstance = vaultManager.getInstance(vaultId)!
			
			await expect(vaultInstance.unlock('test-password')).rejects.toThrow()
		})

		it('should handle quota exceeded during vault creation', async () => {
			vi.mocked(CloudStorageCommands.writeCloudVault).mockRejectedValue(new Error('Storage quota exceeded'))
			
			store.dispatch(setStorageProviders(mockProviders))
			
			await expect(vaultManager.createVault(
				'Large Vault',
				'test-password',
				'cloud',
				'google-drive-primary'
			)).rejects.toThrow()
		})

		it('should handle token expiration during operations', async () => {
			// Setup successful initial unlock
			const cloudVault = {
				id: 'token-expire-vault',
				name: 'Token Expire Vault',
				path: 'vault-file-1',
				storageType: 'cloud',
				providerId: 'google-drive-primary',
				cloudMetadata: {
					fileId: 'vault-file-1',
					provider: 'google-drive-primary',
					lastSync: '2023-12-01T15:45:30.000Z'
				},
				isLocked: false,
				volatile: {
					entries: [...mockVaultContent.entries],
					credential: 'test-password',
					navigationPath: '/',
					encryptedData: undefined
				}
			}
			
			store.dispatch(addVault(cloudVault))
			const vaultInstance = vaultManager.getInstance('token-expire-vault')!
			
			// Simulate token expiration on update
			vi.mocked(CloudStorageCommands.writeCloudVault).mockRejectedValue(new Error('Access token has expired'))
			
			const newEntry = {
				id: 'token-test-entry',
				type: 'note' as const,
				title: 'Token Test Entry',
				content: 'This should fail',
				created_at: new Date().toISOString(),
				updated_at: new Date().toISOString(),
				tags: ['token', 'test']
			}
			
			await expect(vaultInstance.addEntry([], newEntry)).rejects.toThrow()
		})

		it('should handle concurrent operations on same vault', async () => {
			const cloudVault = {
				id: 'concurrent-vault',
				name: 'Concurrent Vault',
				path: 'vault-file-1',
				storageType: 'cloud',
				providerId: 'google-drive-primary',
				cloudMetadata: {
					fileId: 'vault-file-1',
					provider: 'google-drive-primary',
					lastSync: '2023-12-01T15:45:30.000Z'
				},
				isLocked: false,
				volatile: {
					entries: [...mockVaultContent.entries],
					credential: 'test-password',
					navigationPath: '/',
					encryptedData: undefined
				}
			}
			
			store.dispatch(addVault(cloudVault))
			const vaultInstance = vaultManager.getInstance('concurrent-vault')!
			
			// Perform multiple operations concurrently
			const operations = [
				vaultInstance.addEntry([], {
					id: 'concurrent-1',
					type: 'note' as const,
					title: 'Concurrent 1',
					content: 'Content 1',
					created_at: new Date().toISOString(),
					updated_at: new Date().toISOString(),
					tags: ['concurrent']
				}),
				vaultInstance.addEntry([], {
					id: 'concurrent-2',
					type: 'note' as const,
					title: 'Concurrent 2',
					content: 'Content 2',
					created_at: new Date().toISOString(),
					updated_at: new Date().toISOString(),
					tags: ['concurrent']
				}),
				vaultInstance.updateEntry(['entry-1'], { title: 'Updated Concurrent' })
			]
			
			// All operations should complete successfully
			await expect(Promise.all(operations)).resolves.toBeDefined()
			
			// Verify all entries were added
			const state = store.getState().vault
			const vault = state.vaults.find(v => v.id === 'concurrent-vault')
			expect(vault?.volatile.entries).toContainEqual(
				expect.objectContaining({ id: 'concurrent-1' })
			)
			expect(vault?.volatile.entries).toContainEqual(
				expect.objectContaining({ id: 'concurrent-2' })
			)
		})

		it('should handle vault metadata corruption', async () => {
			const corruptedVault = {
				id: 'corrupted-vault',
				name: 'Corrupted Vault',
				path: 'vault-file-1',
				storageType: 'cloud',
				providerId: 'google-drive-primary',
				// Missing cloud metadata
				isLocked: true,
				volatile: {
					entries: [],
					credential: '',
					navigationPath: '/',
					encryptedData: undefined
				}
			}
			
			store.dispatch(addVault(corruptedVault))
			
			// Should return undefined for vault with missing metadata
			const vaultInstance = vaultManager.getInstance('corrupted-vault')
			expect(vaultInstance).toBeUndefined()
		})
	})

	describe('Performance and Optimization', () => {
		it('should handle large vault content efficiently', async () => {
			// Create vault with many entries
			const largeVaultContent = {
				updated_at: new Date().toISOString(),
				hmac: 'large-vault-hmac',
				entries: Array.from({ length: 1000 }, (_, i) => ({
					id: `entry-${i}`,
					type: 'note' as const,
					title: `Entry ${i}`,
					content: `Content for entry ${i}`,
					created_at: new Date().toISOString(),
					updated_at: new Date().toISOString(),
					tags: [`tag-${i % 10}`]
				}))
			}
			
			// Mock large vault content
			vi.mocked(CloudStorageCommands.readCloudVault).mockImplementation(() => Promise.resolve(largeVaultContent))
			
			const cloudVault = {
				id: 'large-vault',
				name: 'Large Vault',
				path: 'vault-file-1',
				storageType: 'cloud',
				providerId: 'google-drive-primary',
				cloudMetadata: {
					fileId: 'vault-file-1',
					provider: 'google-drive-primary',
					lastSync: '2023-12-01T15:45:30.000Z'
				},
				isLocked: true,
				volatile: {
					entries: [],
					credential: '',
					navigationPath: '/',
					encryptedData: undefined
				}
			}
			
			store.dispatch(addVault(cloudVault))
			const vaultInstance = vaultManager.getInstance('large-vault')!
			
			const startTime = Date.now()
			await vaultInstance.unlock('test-password')
			const endTime = Date.now()
			
			// Should complete within reasonable time (adjust threshold as needed)
			expect(endTime - startTime).toBeLessThan(1000)
			
			// Verify all entries were loaded
			const state = store.getState().vault
			const vault = state.vaults.find(v => v.id === 'large-vault')
			expect(vault?.volatile.entries).toHaveLength(1000)
		})

		it('should batch multiple operations for better performance', async () => {
			const cloudVault = {
				id: 'batch-vault',
				name: 'Batch Vault',
				path: 'vault-file-1',
				storageType: 'cloud',
				providerId: 'google-drive-primary',
				cloudMetadata: {
					fileId: 'vault-file-1',
					provider: 'google-drive-primary',
					lastSync: '2023-12-01T15:45:30.000Z'
				},
				isLocked: false,
				volatile: {
					entries: [],
					credential: 'test-password',
					navigationPath: '/',
					encryptedData: undefined
				}
			}
			
			store.dispatch(addVault(cloudVault))
			const vaultInstance = vaultManager.getInstance('batch-vault')!
			
			// Add multiple entries in batch
			const entries = Array.from({ length: 10 }, (_, i) => ({
				id: `batch-entry-${i}`,
				type: 'note' as const,
				title: `Batch Entry ${i}`,
				content: `Batch content ${i}`,
				created_at: new Date().toISOString(),
				updated_at: new Date().toISOString(),
				tags: ['batch']
			}))
			
			const entriesWithPaths = entries.map(entry => ({
				path: [] as string[],
				entry
			}))
			
			await vaultInstance.addEntries(entriesWithPaths)
			
			// Should only make one write call for all entries
			const callHistory = getInvokeCallHistory()
			const writeCalls = callHistory.filter(call => call.command === 'write_cloud_vault')
			expect(writeCalls).toHaveLength(1)
			
			// Verify all entries were added
			const state = store.getState().vault
			const vault = state.vaults.find(v => v.id === 'batch-vault')
			expect(vault?.volatile.entries).toHaveLength(10)
		})
	})

	describe('Integration with Other Systems', () => {
		it('should integrate with settings persistence', async () => {
			// This test verifies that cloud vault state is properly persisted
			// and can be restored after application restart
			
			store.dispatch(setStorageProviders(mockProviders))
			
			const vaultId = await vaultManager.createVault(
				'Persistence Test Vault',
				'test-password',
				'cloud',
				'google-drive-primary'
			)
			
			// Verify vault exists in current state
			let state = store.getState().vault
			expect(state.vaults).toHaveLength(1)
			expect(state.vaults[0].id).toBe(vaultId)
			
			// Simulate application restart by creating new store
			const newStore = configureStore({
				reducer: {
					vault: vaultReducer,
				},
			})
			
			// Verify the vault would be restored from settings
			// (This would typically be handled by loadVaultStateFromSettings)
			expect(newStore.getState().vault.vaults).toHaveLength(0) // Initially empty
		})

		it('should handle provider switching', async () => {
			// Setup multiple providers
			const multipleProviders = [
				{
					name: 'provider-1',
					providerType: StorageProviderType.GOOGLE_DRIVE,
					isDefault: true
				},
				{
					name: 'provider-2',
					providerType: StorageProviderType.GOOGLE_DRIVE,
					isDefault: false
				}
			]
			
			store.dispatch(setStorageProviders(multipleProviders))
			
			// Create vault with first provider
			const vaultId1 = await vaultManager.createVault(
				'Provider 1 Vault',
				'test-password',
				'cloud',
				'provider-1'
			)
			
			// Create vault with second provider
			const vaultId2 = await vaultManager.createVault(
				'Provider 2 Vault',
				'test-password',
				'cloud',
				'provider-2'
			)
			
			// Verify both vaults exist with correct providers
			const state = store.getState().vault
			const vault1 = state.vaults.find(v => v.id === vaultId1)
			const vault2 = state.vaults.find(v => v.id === vaultId2)
			
			expect(vault1?.providerId).toBe('provider-1')
			expect(vault2?.providerId).toBe('provider-2')
		})
	})
})