import { describe, it, expect } from 'vitest';
import {
	StorageProviderType,
	StorageProvider,
	GoogleDriveConfig,
	LocalStorageConfig,
	ProviderConfig,
	AddProviderRequest,
	StorageFile,
	CreateFileRequest,
	UpdateFileRequest,
	CreateFolderRequest,
	CloudVaultMetadata,
	CloudVaultOperation,
	CreateCloudVaultRequest,
	UpdateCloudVaultRequest,
	DeleteCloudVaultRequest,
	OAuthConfig,
	OAuthTokenResponse,
	OAuthState,
	CloudStorageError,
	ListFilesRequest,
	ListFilesResponse,
	CloudStorageSearchParams,
	CloudStorageSearchResponse
} from '../../interfaces/cloud-storage.interface';
import { CloudStorageErrorType } from '../../interfaces/cloud-storage.interface';

describe('Cloud Storage Interfaces', () => {
	describe('StorageProviderType', () => {
		it('should have correct enum values', () => {
			expect(StorageProviderType.LOCAL).toBe('local');
			expect(StorageProviderType.GOOGLE_DRIVE).toBe('google_drive');
		});
	});

	describe('StorageProvider', () => {
		it('should create valid storage provider', () => {
			const provider: StorageProvider = {
				name: 'test-provider',
				providerType: StorageProviderType.GOOGLE_DRIVE,
				isDefault: true
			};

			expect(provider.name).toBe('test-provider');
			expect(provider.providerType).toBe(StorageProviderType.GOOGLE_DRIVE);
			expect(provider.isDefault).toBe(true);
		});
	});

	describe('GoogleDriveConfig', () => {
		it('should create valid Google Drive config', () => {
			const config: GoogleDriveConfig = {
				client_id: 'test-client-id',
				client_secret: 'test-client-secret',
				redirect_uri: 'http://localhost:8080/callback',
				access_token: 'test-access-token',
				refresh_token: 'test-refresh-token',
				token_expires_at: '2023-12-31T23:59:59Z'
			};

			expect(config.client_id).toBe('test-client-id');
			expect(config.client_secret).toBe('test-client-secret');
			expect(config.redirect_uri).toBe('http://localhost:8080/callback');
			expect(config.access_token).toBe('test-access-token');
			expect(config.refresh_token).toBe('test-refresh-token');
			expect(config.token_expires_at).toBe('2023-12-31T23:59:59Z');
		});

		it('should create minimal Google Drive config', () => {
			const config: GoogleDriveConfig = {
				client_id: 'test-client-id',
				client_secret: 'test-client-secret',
				redirect_uri: 'http://localhost:8080/callback'
			};

			expect(config.access_token).toBeUndefined();
			expect(config.refresh_token).toBeUndefined();
			expect(config.token_expires_at).toBeUndefined();
		});
	});

	describe('LocalStorageConfig', () => {
		it('should create valid local storage config', () => {
			const config: LocalStorageConfig = {
				basePath: '/path/to/storage'
			};

			expect(config.basePath).toBe('/path/to/storage');
		});
	});

	describe('ProviderConfig', () => {
		it('should create Google Drive provider config', () => {
			const config: ProviderConfig = {
				type: StorageProviderType.GOOGLE_DRIVE,
				config: {
					client_id: 'test-client-id',
					client_secret: 'test-client-secret',
					redirect_uri: 'http://localhost:8080/callback'
				}
			};

			expect(config.type).toBe(StorageProviderType.GOOGLE_DRIVE);
			expect('config' in config).toBe(true);
			if ('config' in config) {
				expect(config.config.client_id).toBe('test-client-id');
			}
		});

		it('should create local provider config', () => {
			const config: ProviderConfig = {
				type: StorageProviderType.LOCAL,
				basePath: '/path/to/storage'
			};

			expect(config.type).toBe(StorageProviderType.LOCAL);
			expect('basePath' in config).toBe(true);
			if ('basePath' in config) {
				expect(config.basePath).toBe('/path/to/storage');
			}
		});
	});

	describe('AddProviderRequest', () => {
		it('should create valid add provider request', () => {
			const request: AddProviderRequest = {
				name: 'test-provider',
				config: {
					type: StorageProviderType.GOOGLE_DRIVE,
					config: {
						client_id: 'test-client-id',
						client_secret: 'test-client-secret',
						redirect_uri: 'http://localhost:8080/callback'
					}
				}
			};

			expect(request.name).toBe('test-provider');
			expect(request.config.type).toBe(StorageProviderType.GOOGLE_DRIVE);
		});
	});

	describe('StorageFile', () => {
		it('should create valid storage file', () => {
			const file: StorageFile = {
				id: 'file-1',
				name: 'test.txt',
				path: '/test.txt',
				size: 1024,
				createdAt: '2023-01-01T00:00:00Z',
				modifiedAt: '2023-01-01T00:00:00Z',
				isFolder: false,
				mimeType: 'text/plain',
				parentId: 'folder-1',
				metadata: { key: 'value' }
			};

			expect(file.id).toBe('file-1');
			expect(file.name).toBe('test.txt');
			expect(file.path).toBe('/test.txt');
			expect(file.size).toBe(1024);
			expect(file.isFolder).toBe(false);
			expect(file.metadata).toEqual({ key: 'value' });
		});

		it('should create minimal storage file', () => {
			const file: StorageFile = {
				id: 'file-1',
				name: 'test.txt',
				path: '/test.txt',
				isFolder: false,
				metadata: {}
			};

			expect(file.size).toBeUndefined();
			expect(file.createdAt).toBeUndefined();
			expect(file.modifiedAt).toBeUndefined();
			expect(file.mimeType).toBeUndefined();
			expect(file.parentId).toBeUndefined();
		});
	});

	describe('CreateFileRequest', () => {
		it('should create valid create file request', () => {
			const content = new ArrayBuffer(8);
			const request: CreateFileRequest = {
				name: 'test.txt',
				path: '/test.txt',
				content,
				parentId: 'folder-1',
				mimeType: 'text/plain',
				metadata: { key: 'value' }
			};

			expect(request.name).toBe('test.txt');
			expect(request.path).toBe('/test.txt');
			expect(request.content).toBe(content);
			expect(request.parentId).toBe('folder-1');
			expect(request.mimeType).toBe('text/plain');
			expect(request.metadata).toEqual({ key: 'value' });
		});
	});

	describe('UpdateFileRequest', () => {
		it('should create valid update file request', () => {
			const content = new ArrayBuffer(8);
			const request: UpdateFileRequest = {
				id: 'file-1',
				content,
				metadata: { key: 'value' }
			};

			expect(request.id).toBe('file-1');
			expect(request.content).toBe(content);
			expect(request.metadata).toEqual({ key: 'value' });
		});
	});

	describe('CreateFolderRequest', () => {
		it('should create valid create folder request', () => {
			const request: CreateFolderRequest = {
				name: 'test-folder',
				path: '/test-folder',
				parentId: 'folder-1',
				metadata: { key: 'value' }
			};

			expect(request.name).toBe('test-folder');
			expect(request.path).toBe('/test-folder');
			expect(request.parentId).toBe('folder-1');
			expect(request.metadata).toEqual({ key: 'value' });
		});
	});

	describe('CloudVaultMetadata', () => {
		it('should create valid cloud vault metadata', () => {
			const metadata: CloudVaultMetadata = {
				id: 'vault-1',
				name: 'test-vault.monark',
				providerName: 'google-drive',
				providerType: StorageProviderType.GOOGLE_DRIVE,
				size: 1024,
				createdAt: '2023-01-01T00:00:00Z',
				modifiedAt: '2023-01-01T00:00:00Z',
				path: '/vaults/test-vault.monark',
				isFolder: false,
				mimeType: 'application/octet-stream',
				parentId: 'folder-1',
				metadata: { key: 'value' }
			};

			expect(metadata.id).toBe('vault-1');
			expect(metadata.name).toBe('test-vault.monark');
			expect(metadata.providerName).toBe('google-drive');
			expect(metadata.providerType).toBe(StorageProviderType.GOOGLE_DRIVE);
		});
	});

	describe('CloudVaultOperation', () => {
		it('should create valid cloud vault operation', () => {
			const operation: CloudVaultOperation = {
				vaultId: 'vault-1',
				password: 'test-password',
				providerName: 'google-drive'
			};

			expect(operation.vaultId).toBe('vault-1');
			expect(operation.password).toBe('test-password');
			expect(operation.providerName).toBe('google-drive');
		});

		it('should create minimal cloud vault operation', () => {
			const operation: CloudVaultOperation = {
				vaultId: 'vault-1',
				password: 'test-password'
			};

			expect(operation.providerName).toBeUndefined();
		});
	});

	describe('CreateCloudVaultRequest', () => {
		it('should create valid create cloud vault request', () => {
			const request: CreateCloudVaultRequest = {
				vaultId: 'vault-1',
				vaultName: 'test-vault',
				password: 'test-password',
				vaultContent: {
					updatedAt: '2023-01-01T00:00:00Z',
					hmac: 'test-hmac',
					entries: []
				},
				providerName: 'google-drive'
			};

			expect(request.vaultId).toBe('vault-1');
			expect(request.vaultName).toBe('test-vault');
			expect(request.password).toBe('test-password');
			expect(request.providerName).toBe('google-drive');
			expect(request.vaultContent.entries).toEqual([]);
		});
	});

	describe('UpdateCloudVaultRequest', () => {
		it('should create valid update cloud vault request', () => {
			const request: UpdateCloudVaultRequest = {
				vaultId: 'vault-1',
				password: 'test-password',
				vaultContent: {
					updatedAt: '2023-01-01T00:00:00Z',
					hmac: 'test-hmac',
					entries: []
				},
				providerName: 'google-drive'
			};

			expect(request.vaultId).toBe('vault-1');
			expect(request.password).toBe('test-password');
			expect(request.providerName).toBe('google-drive');
		});
	});

	describe('DeleteCloudVaultRequest', () => {
		it('should create valid delete cloud vault request', () => {
			const request: DeleteCloudVaultRequest = {
				vaultId: 'vault-1',
				providerName: 'google-drive'
			};

			expect(request.vaultId).toBe('vault-1');
			expect(request.providerName).toBe('google-drive');
		});

		it('should create minimal delete cloud vault request', () => {
			const request: DeleteCloudVaultRequest = {
				vaultId: 'vault-1'
			};

			expect(request.providerName).toBeUndefined();
		});
	});

	describe('OAuth Types', () => {
		it('should create valid OAuth config', () => {
			const config: OAuthConfig = {
				clientId: 'test-client-id',
				clientSecret: 'test-client-secret',
				redirectUri: 'http://localhost:8080/callback',
				scopes: ['https://www.googleapis.com/auth/drive']
			};

			expect(config.clientId).toBe('test-client-id');
			expect(config.scopes).toContain('https://www.googleapis.com/auth/drive');
		});

		it('should create valid OAuth token response', () => {
			const response: OAuthTokenResponse = {
				accessToken: 'test-access-token',
				refreshToken: 'test-refresh-token',
				expiresIn: 3600,
				tokenType: 'Bearer',
				scope: 'https://www.googleapis.com/auth/drive'
			};

			expect(response.accessToken).toBe('test-access-token');
			expect(response.expiresIn).toBe(3600);
			expect(response.tokenType).toBe('Bearer');
		});

		it('should create valid OAuth state', () => {
			const state: OAuthState = {
				state: 'random-state-string',
				providerName: 'google-drive',
				timestamp: Date.now()
			};

			expect(state.providerName).toBe('google-drive');
			expect(typeof state.timestamp).toBe('number');
		});
	});

	describe('CloudStorageError', () => {
		it('should create valid cloud storage error', () => {
			const error: CloudStorageError = {
				type: CloudStorageErrorType.AUTHENTICATION_FAILED,
				message: 'Authentication failed',
				providerName: 'google-drive',
				originalError: 'Invalid credentials',
				code: 'AUTH_001'
			};

			expect(error.type).toBe(CloudStorageErrorType.AUTHENTICATION_FAILED);
			expect(error.message).toBe('Authentication failed');
			expect(error.providerName).toBe('google-drive');
			expect(error.originalError).toBe('Invalid credentials');
			expect(error.code).toBe('AUTH_001');
		});
	});

	describe('CloudStorageErrorType', () => {
		it('should have all required error types', () => {
			expect(CloudStorageErrorType.AUTHENTICATION_FAILED).toBe('AUTHENTICATION_FAILED');
			expect(CloudStorageErrorType.TOKEN_EXPIRED).toBe('TOKEN_EXPIRED');
			expect(CloudStorageErrorType.NETWORK_ERROR).toBe('NETWORK_ERROR');
			expect(CloudStorageErrorType.QUOTA_EXCEEDED).toBe('QUOTA_EXCEEDED');
			expect(CloudStorageErrorType.VAULT_NOT_FOUND).toBe('VAULT_NOT_FOUND');
			expect(CloudStorageErrorType.PERMISSION_DENIED).toBe('PERMISSION_DENIED');
			expect(CloudStorageErrorType.PROVIDER_NOT_CONFIGURED).toBe('PROVIDER_NOT_CONFIGURED');
			expect(CloudStorageErrorType.INVALID_CREDENTIALS).toBe('INVALID_CREDENTIALS');
			expect(CloudStorageErrorType.OPERATION_FAILED).toBe('OPERATION_FAILED');
		});
	});

	describe('ListFilesRequest', () => {
		it('should create valid list files request', () => {
			const request: ListFilesRequest = {
				folderId: 'folder-1',
				providerName: 'google-drive',
				query: 'test',
				pageSize: 50,
				pageToken: 'page-token-1'
			};

			expect(request.folderId).toBe('folder-1');
			expect(request.providerName).toBe('google-drive');
			expect(request.query).toBe('test');
			expect(request.pageSize).toBe(50);
			expect(request.pageToken).toBe('page-token-1');
		});
	});

	describe('ListFilesResponse', () => {
		it('should create valid list files response', () => {
			const files: StorageFile[] = [
				{
					id: 'file-1',
					name: 'test.txt',
					path: '/test.txt',
					isFolder: false,
					metadata: {}
				}
			];

			const response: ListFilesResponse = {
				files,
				nextPageToken: 'next-page-token',
				totalCount: 1
			};

			expect(response.files).toEqual(files);
			expect(response.nextPageToken).toBe('next-page-token');
			expect(response.totalCount).toBe(1);
		});
	});

	describe('CloudStorageSearchParams', () => {
		it('should create valid search params', () => {
			const params: CloudStorageSearchParams = {
				query: 'test',
				providerName: 'google-drive',
				fileTypes: ['txt', 'pdf'],
				dateRange: {
					start: '2023-01-01T00:00:00Z',
					end: '2023-12-31T23:59:59Z'
				},
				maxResults: 100
			};

			expect(params.query).toBe('test');
			expect(params.providerName).toBe('google-drive');
			expect(params.fileTypes).toEqual(['txt', 'pdf']);
			expect(params.dateRange?.start).toBe('2023-01-01T00:00:00Z');
			expect(params.maxResults).toBe(100);
		});
	});

	describe('CloudStorageSearchResponse', () => {
		it('should create valid search response', () => {
			const files: StorageFile[] = [
				{
					id: 'file-1',
					name: 'test.txt',
					path: '/test.txt',
					isFolder: false,
					metadata: {}
				}
			];

			const response: CloudStorageSearchResponse = {
				results: files,
				totalCount: 1,
				searchTime: 150,
				providerName: 'google-drive'
			};

			expect(response.results).toEqual(files);
			expect(response.totalCount).toBe(1);
			expect(response.searchTime).toBe(150);
			expect(response.providerName).toBe('google-drive');
		});
	});
});