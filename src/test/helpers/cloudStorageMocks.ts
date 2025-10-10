/**
 * Cloud Storage Mock Helpers
 *
 * This file provides comprehensive mock utilities for testing cloud storage functionality.
 * It includes mock data, mock Tauri invoke implementations, and helper functions
 * to set up common test scenarios for cloud vault operations.
 */

import { vi } from 'vitest'
import { invoke } from '@tauri-apps/api/core'
import type {
	StorageProvider,
	AddProviderRequest,
	StorageFile,
	CloudVaultMetadata,
	CloudVaultOperation,
	CreateCloudVaultRequest,
	UpdateCloudVaultRequest,
	DeleteCloudVaultRequest,
	ProviderConfig,
	GoogleDriveConfig,
	CloudStorageError,
	OAuthTokenResponse,
	OAuthState
} from '../../interfaces/cloud-storage.interface'
import { StorageProviderType, CloudStorageErrorType } from '../../interfaces/cloud-storage.interface'
import type { VaultContent, Entry } from '../../interfaces/vault.interface'
import type { Vault } from '../../redux/actions/vault'

// Mock the Tauri invoke function
vi.mock('@tauri-apps/api/core', () => ({
	invoke: vi.fn()
}))

export const mockInvoke = vi.mocked(invoke)

// Track invoke call history for verification
let invokeCallHistory: Array<{ command: string; args?: any }> = []

/**
 * Mock provider data for testing
 */
export const mockProviders: StorageProvider[] = [
	{
		name: 'google-drive-primary',
		providerType: StorageProviderType.GOOGLE_DRIVE,
		isDefault: true
	},
	{
		name: 'google-drive-secondary',
		providerType: StorageProviderType.GOOGLE_DRIVE,
		isDefault: false
	},
	{
		name: 'local-storage',
		providerType: StorageProviderType.LOCAL,
		isDefault: false
	}
]

/**
 * Mock Google Drive configuration
 */
export const mockGoogleDriveConfig: GoogleDriveConfig = {
	clientId: 'test-client-id-123',
	clientSecret: 'test-client-secret-456',
	redirectUri: 'http://localhost:1420/auth/callback',
	accessToken: 'mock-access-token-789',
	refreshToken: 'mock-refresh-token-012',
	tokenExpiresAt: '2024-12-31T23:59:59.000Z'
}

/**
 * Mock provider configuration requests
 */
export const mockProviderConfigs: Record<string, ProviderConfig> = {
	'google-drive-primary': {
		type: StorageProviderType.GOOGLE_DRIVE,
		config: mockGoogleDriveConfig
	},
	'google-drive-secondary': {
		type: StorageProviderType.GOOGLE_DRIVE,
		config: {
			...mockGoogleDriveConfig,
			clientId: 'test-client-id-secondary'
		}
	},
	'local-storage': {
		type: StorageProviderType.LOCAL,
		basePath: '/mock/local/path'
	}
}

/**
 * Mock storage files representing cloud vaults
 */
export const mockStorageFiles: StorageFile[] = [
	{
		id: 'vault-file-1',
		name: 'Personal Vault.monark',
		path: '/Personal Vault.monark',
		size: 2048,
		createdAt: '2023-01-15T10:30:00.000Z',
		modifiedAt: '2023-12-01T15:45:30.000Z',
		isFolder: false,
		mimeType: 'application/octet-stream',
		parentId: 'root-folder',
		metadata: {
			'vault-version': '1.0',
			'encrypted': 'true'
		}
	},
	{
		id: 'vault-file-2',
		name: 'Work Vault.monark',
		path: '/Work Vault.monark',
		size: 4096,
		createdAt: '2023-02-20T14:15:00.000Z',
		modifiedAt: '2023-11-30T09:20:15.000Z',
		isFolder: false,
		mimeType: 'application/octet-stream',
		parentId: 'work-folder',
		metadata: {
			'vault-version': '1.0',
			'encrypted': 'true',
			'tags': 'work,professional'
		}
	},
	{
		id: 'folder-1',
		name: 'Archive',
		path: '/Archive',
		isFolder: true,
		parentId: 'root-folder',
		metadata: {}
	}
]

/**
 * Mock cloud vault metadata
 */
export const mockCloudVaults: CloudVaultMetadata[] = [
	{
		id: 'vault-file-1',
		name: 'Personal Vault.monark',
		providerName: 'google-drive-primary',
		providerType: StorageProviderType.GOOGLE_DRIVE,
		size: 2048,
		createdAt: '2023-01-15T10:30:00.000Z',
		modifiedAt: '2023-12-01T15:45:30.000Z',
		path: '/Personal Vault.monark',
		isFolder: false,
		mimeType: 'application/octet-stream',
		parentId: 'root-folder',
		metadata: {
			'vault-version': '1.0',
			'encrypted': 'true'
		}
	},
	{
		id: 'vault-file-2',
		name: 'Work Vault.monark',
		providerName: 'google-drive-primary',
		providerType: StorageProviderType.GOOGLE_DRIVE,
		size: 4096,
		createdAt: '2023-02-20T14:15:00.000Z',
		modifiedAt: '2023-11-30T09:20:15.000Z',
		path: '/Work Vault.monark',
		isFolder: false,
		mimeType: 'application/octet-stream',
		parentId: 'work-folder',
		metadata: {
			'vault-version': '1.0',
			'encrypted': 'true',
			'tags': 'work,professional'
		}
	}
]

/**
 * Mock vault content for testing
 */
export const mockVaultContent: VaultContent = {
	updated_at: '2023-12-01T15:45:30.000Z',
	hmac: 'mock-hmac-signature-12345',
	entries: [
		{
			id: 'entry-1',
			name: 'Test Entry 1',
			type: 'entry',
			created_at: '2023-01-15T10:30:00.000Z',
			updated_at: '2023-12-01T15:45:30.000Z',
			fields: [
				{
					name: 'username',
					value: 'testuser',
					type: 'text'
				},
				{
					name: 'password',
					value: 'testpass',
					type: 'password'
				}
			],
			tags: ['test', 'sample']
		},
		{
			id: 'entry-2',
			name: 'Test Entry 2',
			type: 'entry',
			created_at: '2023-02-20T14:15:00.000Z',
			updated_at: '2023-11-30T09:20:15.000Z',
			fields: [
				{
					name: 'username',
					value: 'user2',
					type: 'text'
				},
				{
					name: 'password',
					value: 'pass2',
					type: 'password'
				}
			],
			tags: ['test']
		}
	] as Entry[]
}

/**
 * Mock OAuth token response
 */
export const mockOAuthTokenResponse: OAuthTokenResponse = {
	accessToken: 'new-access-token-123',
	refreshToken: 'new-refresh-token-456',
	expiresIn: 3600,
	tokenType: 'Bearer',
	scope: 'https://www.googleapis.com/auth/drive.file'
}

/**
 * Mock OAuth state
 */
export const mockOAuthState: OAuthState = {
	state: 'oauth-state-123',
	providerName: 'google-drive-primary',
	timestamp: Date.now()
}

/**
 * Mock cloud vault objects (Redux state format)
 */
export const mockCloudVaultObjects: Vault[] = [
	{
		id: 'vault-1',
		name: 'Personal Vault',
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
	},
	{
		id: 'vault-2',
		name: 'Work Vault',
		path: 'vault-file-2',
		storageType: 'cloud',
		providerId: 'google-drive-primary',
		cloudMetadata: {
			fileId: 'vault-file-2',
			provider: 'google-drive-primary',
			lastSync: '2023-11-30T09:20:15.000Z'
		},
		isLocked: false,
		volatile: {
			entries: mockVaultContent.entries,
			credential: 'test-password',
			navigationPath: '/',
			encryptedData: undefined
		}
	}
]

/**
 * Mock error responses for testing error scenarios
 */
export const mockErrors: Record<CloudStorageErrorType, CloudStorageError> = {
	[CloudStorageErrorType.AUTHENTICATION_FAILED]: {
		type: CloudStorageErrorType.AUTHENTICATION_FAILED,
		message: 'Authentication failed: Invalid credentials',
		providerName: 'google-drive-primary',
		originalError: '401 Unauthorized'
	},
	[CloudStorageErrorType.TOKEN_EXPIRED]: {
		type: CloudStorageErrorType.TOKEN_EXPIRED,
		message: 'Access token has expired',
		providerName: 'google-drive-primary',
		originalError: 'Token expired'
	},
	[CloudStorageErrorType.NETWORK_ERROR]: {
		type: CloudStorageErrorType.NETWORK_ERROR,
		message: 'Network connection failed',
		originalError: 'ECONNREFUSED'
	},
	[CloudStorageErrorType.QUOTA_EXCEEDED]: {
		type: CloudStorageErrorType.QUOTA_EXCEEDED,
		message: 'Storage quota exceeded',
		providerName: 'google-drive-primary',
		originalError: 'Insufficient storage'
	},
	[CloudStorageErrorType.VAULT_NOT_FOUND]: {
		type: CloudStorageErrorType.VAULT_NOT_FOUND,
		message: 'Vault not found',
		providerName: 'google-drive-primary',
		originalError: 'File not found'
	},
	[CloudStorageErrorType.PERMISSION_DENIED]: {
		type: CloudStorageErrorType.PERMISSION_DENIED,
		message: 'Permission denied',
		providerName: 'google-drive-primary',
		originalError: 'Access denied'
	},
	[CloudStorageErrorType.PROVIDER_NOT_CONFIGURED]: {
		type: CloudStorageErrorType.PROVIDER_NOT_CONFIGURED,
		message: 'Provider not configured',
		originalError: 'No provider found'
	},
	[CloudStorageErrorType.INVALID_CREDENTIALS]: {
		type: CloudStorageErrorType.INVALID_CREDENTIALS,
		message: 'Invalid credentials provided',
		providerName: 'google-drive-primary',
		originalError: 'Bad credentials'
	},
	[CloudStorageErrorType.OPERATION_FAILED]: {
		type: CloudStorageErrorType.OPERATION_FAILED,
		message: 'Operation failed',
		originalError: 'Unknown error'
	}
}

/**
 * Helper function to setup mock Tauri invoke responses for successful operations
 */
export function setupMockInvokeSuccess(): void {
	// Clear call history
	invokeCallHistory = []
	
	// Provider management
	mockInvoke.mockImplementation((command: string, args?: any) => {
		// Track the call
		invokeCallHistory.push({ command, args })
		
		switch (command) {
			case 'list_providers':
				return Promise.resolve(mockProviders)
			
			case 'add_provider':
				return Promise.resolve(undefined)
			
			case 'remove_provider':
				return Promise.resolve(undefined)
			
			case 'set_default_provider':
				return Promise.resolve(undefined)
			
			case 'authenticate_provider':
				return Promise.resolve(undefined)
			
			// Cloud vault operations
			case 'list_vaults':
				return Promise.resolve(mockStorageFiles)
			
			case 'read_cloud_vault':
				return Promise.resolve(mockVaultContent)
			
			case 'write_cloud_vault':
				return Promise.resolve(args?.vaultId || 'new-vault-id')
			
			case 'update_cloud_vault':
				// Support both 'update_cloud_vault' and 'write_cloud_vault' command names
				// used by different test mocks — treat update as a successful no-op.
				return Promise.resolve(undefined)
			
			case 'delete_cloud_vault':
				return Promise.resolve(undefined)
			
			// File operations
			case 'list_files':
				return Promise.resolve(mockStorageFiles)
			
			case 'create_file':
				return Promise.resolve({
					id: 'new-file-id',
					name: args?.request?.name || 'new-file',
					path: args?.request?.path || '/new-file',
					size: args?.request?.content?.length || 0,
					isFolder: false,
					metadata: {}
				})
			
			case 'read_file':
				return Promise.resolve([1, 2, 3, 4, 5]) // Mock file content
			
			case 'update_file':
				return Promise.resolve({
					id: args?.request?.id,
					name: 'updated-file',
					path: '/updated-file',
					size: args?.request?.content?.length || 0,
					isFolder: false,
					metadata: {}
				})
			
			case 'delete_file':
				return Promise.resolve(undefined)
			
			case 'create_folder':
				return Promise.resolve({
					id: 'new-folder-id',
					name: args?.request?.name || 'new-folder',
					path: args?.request?.path || '/new-folder',
					isFolder: true,
					metadata: {}
				})
			
			case 'delete_folder':
				return Promise.resolve(undefined)
			
			case 'get_file_info':
				return Promise.resolve(mockStorageFiles[0])
			
			case 'search_files':
				return Promise.resolve(mockStorageFiles.filter(file =>
					file.name.toLowerCase().includes(args?.query?.toLowerCase() || '')
				))
			
			default:
				return Promise.reject(new Error(`Unknown command: ${command}`))
		}
	})
}

/**
 * Helper function to setup mock Tauri invoke responses for error scenarios
 */
export function setupMockInvokeError(errorType: CloudStorageErrorType): void {
	const error = mockErrors[errorType]
	invokeCallHistory = []
	mockInvoke.mockImplementation((command: string, args?: any) => {
		// Track the call even for errors
		invokeCallHistory.push({ command, args })
		return Promise.reject(new Error(error.message))
	})
}

/**
 * Helper function to setup mock Tauri invoke responses with custom error
 */
export function setupMockInvokeCustomError(errorMessage: string): void {
	mockInvoke.mockRejectedValue(new Error(errorMessage))
}

/**
 * Helper function to setup mocks for a specific provider
 */
export function setupMockProvider(providerName: string, config?: ProviderConfig): void {
	const provider = mockProviders.find(p => p.name === providerName)
	if (!provider) {
		throw new Error(`Provider ${providerName} not found in mock data`)
	}
	
	mockInvoke.mockImplementation((command: string, args?: any) => {
		if (command === 'add_provider' && args?.request?.name === providerName) {
			return Promise.resolve(undefined)
		}
		
		if (command === 'authenticate_provider' && (args?.providerName === providerName || !args?.providerName)) {
			return Promise.resolve(undefined)
		}
		
		if (command === 'list_vaults' && (!args?.providerName || args?.providerName === providerName)) {
			return Promise.resolve(mockStorageFiles)
		}
		
		return Promise.reject(new Error(`Provider ${providerName} not configured for command: ${command}`))
	})
}

/**
 * Helper function to create a mock cloud vault request
 */
export function createMockCloudVaultRequest(
	vaultId: string = 'test-vault',
	vaultName: string = 'Test Vault',
	password: string = 'test-password',
	providerName: string = 'google-drive-primary'
): CreateCloudVaultRequest {
	return {
		vaultId,
		vaultName,
		password,
		vaultContent: {
			updatedAt: new Date().toISOString(),
			hmac: 'mock-hmac',
			entries: mockVaultContent.entries
		},
		providerName
	}
}

/**
 * Helper function to create a mock cloud vault update request
 */
export function createMockCloudVaultUpdateRequest(
	vaultId: string = 'test-vault',
	password: string = 'test-password',
	providerName: string = 'google-drive-primary'
): UpdateCloudVaultRequest {
	return {
		vaultId,
		password,
		vaultContent: {
			updatedAt: new Date().toISOString(),
			hmac: 'updated-hmac',
			entries: [...mockVaultContent.entries, {
				id: 'entry-3',
				type: 'note',
				title: 'New Entry',
				content: 'New content',
				created_at: new Date().toISOString(),
				updated_at: new Date().toISOString(),
				tags: ['new']
			} as Entry]
		},
		providerName
	}
}

/**
 * Helper function to create a mock cloud vault delete request
 */
export function createMockCloudVaultDeleteRequest(
	vaultId: string = 'test-vault',
	providerName: string = 'google-drive-primary'
): DeleteCloudVaultRequest {
	return {
		vaultId,
		providerName
	}
}

/**
 * Helper function to setup complete test scenario for cloud vault operations
 */
export function setupCloudVaultTestScenario(): {
	providers: StorageProvider[]
	vaults: CloudVaultMetadata[]
	content: VaultContent
} {
	setupMockInvokeSuccess()
	
	return {
		providers: mockProviders,
		vaults: mockCloudVaults,
		content: mockVaultContent
	}
}

/**
 * Helper function to reset all mocks
 */
export function resetAllMocks(): void {
	vi.clearAllMocks()
	invokeCallHistory = []
}

/**
 * Helper function to verify specific invoke calls were made
 */
export function verifyInvokeCall(command: string, expectedArgs?: any): boolean {
	return invokeCallHistory.some(call =>
		call.command === command &&
		(!expectedArgs || JSON.stringify(call.args) === JSON.stringify(expectedArgs))
	)
}

/**
 * Helper function to get invoke call history
 */
export function getInvokeCallHistory(): Array<{ command: string; args?: any }> {
	return [...invokeCallHistory]
}