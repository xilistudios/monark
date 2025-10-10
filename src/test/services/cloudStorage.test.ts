import { describe, it, expect, vi, beforeEach } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { CloudStorageCommands } from '../../services/cloudStorage';
import type {
	StorageProvider,
	AddProviderRequest,
	StorageFile,
	CreateFileRequest,
	UpdateFileRequest,
	CreateFolderRequest,
	CloudVaultOperation,
	CreateCloudVaultRequest,
	UpdateCloudVaultRequest,
	DeleteCloudVaultRequest
} from '../../interfaces/cloud-storage.interface';
import { CloudStorageErrorType, StorageProviderType } from '../../interfaces/cloud-storage.interface';
import type { VaultContent } from '../../interfaces/vault.interface';

// Mock the Tauri invoke function
vi.mock('@tauri-apps/api/core', () => ({
	invoke: vi.fn()
}));

const mockInvoke = vi.mocked(invoke);

describe('CloudStorageCommands', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	describe('Provider Management', () => {
		it('should list providers successfully', async () => {
			const mockProviders: StorageProvider[] = [
				{
					name: 'google-drive',
					providerType: StorageProviderType.GOOGLE_DRIVE,
					isDefault: true
				},
				{
					name: 'local',
					providerType: StorageProviderType.LOCAL,
					isDefault: false
				}
			];

			mockInvoke.mockResolvedValue(mockProviders);

			const result = await CloudStorageCommands.listProviders();

			expect(mockInvoke).toHaveBeenCalledWith('list_providers');
			expect(result).toEqual(mockProviders);
		});

		it('should handle list providers error', async () => {
			const error = new Error('Failed to list providers');
			mockInvoke.mockRejectedValue(error);

			await expect(CloudStorageCommands.listProviders()).rejects.toThrow();
		});

		it('should add provider successfully', async () => {
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

			mockInvoke.mockResolvedValue(undefined);

			await CloudStorageCommands.addProvider(request);

			expect(mockInvoke).toHaveBeenCalledWith('add_provider', { request });
		});

		it('should remove provider successfully', async () => {
			const providerName = 'test-provider';

			mockInvoke.mockResolvedValue(undefined);

			await CloudStorageCommands.removeProvider(providerName);

			expect(mockInvoke).toHaveBeenCalledWith('remove_provider', { name: providerName });
		});

		it('should set default provider successfully', async () => {
			const providerName = 'test-provider';

			mockInvoke.mockResolvedValue(undefined);

			await CloudStorageCommands.setDefaultProvider(providerName);

			expect(mockInvoke).toHaveBeenCalledWith('set_default_provider', { name: providerName });
		});

		it('should authenticate provider successfully', async () => {
			const providerName = 'test-provider';

			mockInvoke.mockResolvedValue(undefined);

			await CloudStorageCommands.authenticateProvider(providerName);

			expect(mockInvoke).toHaveBeenCalledWith('authenticate_provider', { providerName });
		});
	});

	describe('Cloud Vault Operations', () => {
		it('should list cloud vaults successfully', async () => {
			const mockFiles: StorageFile[] = [
        {
          id: 'vault-1',
          name: 'test-vault.monark',
          path: '/Monark/test-vault.monark',
          size: 1024,
          createdAt: '2023-01-01T00:00:00Z',
          modifiedAt: '2023-01-01T00:00:00Z',
          isFolder: false,
          mimeType: 'application/octet-stream',
          parentId: 'folder-1',
          metadata: {},
        },
      ];

			mockInvoke.mockResolvedValue(mockFiles);

			const result = await CloudStorageCommands.listCloudVaults('google-drive');

			expect(mockInvoke).toHaveBeenCalledWith('list_vaults', { providerName: 'google-drive' });
			expect(result).toHaveLength(1);
			expect(result[0].id).toBe('vault-1');
			expect(result[0].name).toBe('test-vault.monark');
		});

		it('should read cloud vault successfully', async () => {
			const request: CloudVaultOperation = {
				vaultId: 'vault-1',
				password: 'test-password',
				providerName: 'google-drive'
			};

			const mockVaultContent: VaultContent = {
				updated_at: '2023-01-01T00:00:00Z',
				hmac: 'test-hmac',
				entries: []
			};

			mockInvoke.mockResolvedValue(mockVaultContent);

			const result = await CloudStorageCommands.readCloudVault(request);

			expect(mockInvoke).toHaveBeenCalledWith('read_cloud_vault', {
				vaultId: request.vaultId,
				password: request.password,
				providerName: request.providerName
			});
			expect(result).toEqual(mockVaultContent);
		});

		it('should write cloud vault successfully', async () => {
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

			mockInvoke.mockResolvedValue('vault-1');

			const result = await CloudStorageCommands.writeCloudVault(request);

			expect(mockInvoke).toHaveBeenCalledWith('write_cloud_vault', {
				vaultName: request.vaultName,
				password: request.password,
				vaultContent: request.vaultContent,
				providerName: request.providerName
			});
			expect(result).toBe('vault-1');
		});

		it('should update cloud vault successfully', async () => {
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

			mockInvoke.mockResolvedValue(undefined);

			await CloudStorageCommands.updateCloudVault(request);

			expect(mockInvoke).toHaveBeenCalledWith('write_cloud_vault', {
				vaultName: '', // Empty for updates
				password: request.password,
				vaultContent: request.vaultContent,
				providerName: request.providerName
			});
		});

		it('should delete cloud vault successfully', async () => {
			const request: DeleteCloudVaultRequest = {
				vaultId: 'vault-1',
				providerName: 'google-drive'
			};

			mockInvoke.mockResolvedValue(undefined);

			await CloudStorageCommands.deleteCloudVault(request);

			expect(mockInvoke).toHaveBeenCalledWith('delete_cloud_vault', {
				vaultId: request.vaultId,
				providerName: request.providerName
			});
		});
	});

	describe('File Operations', () => {
		it('should list files successfully', async () => {
			const mockFiles: StorageFile[] = [
				{
					id: 'file-1',
					name: 'test.txt',
					path: '/test.txt',
					size: 1024,
					isFolder: false,
					metadata: {}
				}
			];

			mockInvoke.mockResolvedValue(mockFiles);

			const result = await CloudStorageCommands.listFiles({
				folderId: 'folder-1',
				providerName: 'google-drive'
			});

			expect(mockInvoke).toHaveBeenCalledWith('list_files', {
				folderId: 'folder-1',
				providerName: 'google-drive'
			});
			expect(result.files).toEqual(mockFiles);
			expect(result.totalCount).toBe(1);
		});

		it('should create file successfully', async () => {
			const request: CreateFileRequest = {
				name: 'test.txt',
				path: '/test.txt',
				content: new ArrayBuffer(8),
				parentId: 'folder-1',
				mimeType: 'text/plain',
				metadata: {}
			};

			const mockFile: StorageFile = {
				id: 'file-1',
				name: 'test.txt',
				path: '/test.txt',
				size: 8,
				isFolder: false,
				metadata: {}
			};

			mockInvoke.mockResolvedValue(mockFile);

			const result = await CloudStorageCommands.createFile(request, 'google-drive');

			expect(mockInvoke).toHaveBeenCalledWith('create_file', {
				request: {
					...request,
					content: expect.any(Array) // ArrayBuffer converted to array
				},
				providerName: 'google-drive'
			});
			expect(result).toEqual(mockFile);
		});

		it('should read file successfully', async () => {
			const fileId = 'file-1';
			const mockContent = [1, 2, 3, 4, 5, 6, 7, 8];

			mockInvoke.mockResolvedValue(mockContent);

			const result = await CloudStorageCommands.readFile(fileId, 'google-drive');

			expect(mockInvoke).toHaveBeenCalledWith('read_file', {
				fileId,
				providerName: 'google-drive'
			});
			expect(result).toBeInstanceOf(ArrayBuffer);
		});

		it('should update file successfully', async () => {
			const request: UpdateFileRequest = {
				id: 'file-1',
				content: new ArrayBuffer(8),
				metadata: {}
			};

			const mockFile: StorageFile = {
				id: 'file-1',
				name: 'test.txt',
				path: '/test.txt',
				size: 8,
				isFolder: false,
				metadata: {}
			};

			mockInvoke.mockResolvedValue(mockFile);

			const result = await CloudStorageCommands.updateFile(request, 'google-drive');

			expect(mockInvoke).toHaveBeenCalledWith('update_file', {
				request: {
					...request,
					content: expect.any(Array) // ArrayBuffer converted to array
				},
				providerName: 'google-drive'
			});
			expect(result).toEqual(mockFile);
		});

		it('should delete file successfully', async () => {
			const fileId = 'file-1';

			mockInvoke.mockResolvedValue(undefined);

			await CloudStorageCommands.deleteFile(fileId, 'google-drive');

			expect(mockInvoke).toHaveBeenCalledWith('delete_file', {
				fileId,
				providerName: 'google-drive'
			});
		});

		it('should create folder successfully', async () => {
			const request: CreateFolderRequest = {
				name: 'test-folder',
				path: '/test-folder',
				parentId: 'folder-1',
				metadata: {}
			};

			const mockFolder: StorageFile = {
				id: 'folder-2',
				name: 'test-folder',
				path: '/test-folder',
				isFolder: true,
				metadata: {}
			};

			mockInvoke.mockResolvedValue(mockFolder);

			const result = await CloudStorageCommands.createFolder(request, 'google-drive');

			expect(mockInvoke).toHaveBeenCalledWith('create_folder', {
				request,
				providerName: 'google-drive'
			});
			expect(result).toEqual(mockFolder);
		});

		it('should delete folder successfully', async () => {
			const folderId = 'folder-1';

			mockInvoke.mockResolvedValue(undefined);

			await CloudStorageCommands.deleteFolder(folderId, 'google-drive');

			expect(mockInvoke).toHaveBeenCalledWith('delete_folder', {
				folderId,
				providerName: 'google-drive'
			});
		});

		it('should get file info successfully', async () => {
			const fileId = 'file-1';
			const mockFile: StorageFile = {
				id: 'file-1',
				name: 'test.txt',
				path: '/test.txt',
				size: 1024,
				isFolder: false,
				metadata: {}
			};

			mockInvoke.mockResolvedValue(mockFile);

			const result = await CloudStorageCommands.getFileInfo(fileId, 'google-drive');

			expect(mockInvoke).toHaveBeenCalledWith('get_file_info', {
				fileId,
				providerName: 'google-drive'
			});
			expect(result).toEqual(mockFile);
		});

		it('should search files successfully', async () => {
			const searchParams = {
				query: 'test',
				providerName: 'google-drive'
			};

			const mockFiles: StorageFile[] = [
				{
					id: 'file-1',
					name: 'test.txt',
					path: '/test.txt',
					size: 1024,
					isFolder: false,
					metadata: {}
				}
			];

			mockInvoke.mockResolvedValue(mockFiles);

			const result = await CloudStorageCommands.searchFiles(searchParams);

			expect(mockInvoke).toHaveBeenCalledWith('search_files', {
				query: searchParams.query,
				providerName: searchParams.providerName
			});
			expect(result.results).toEqual(mockFiles);
			expect(result.totalCount).toBe(1);
			expect(result.providerName).toBe('google-drive');
			expect(typeof result.searchTime).toBe('number');
		});
	});

	describe('Error Handling', () => {
		it('should handle authentication errors', async () => {
			const error = new Error('authentication failed');
			mockInvoke.mockRejectedValue(error);

			try {
				await CloudStorageCommands.authenticateProvider();
			} catch (err) {
				expect(err.type).toBe(CloudStorageErrorType.AUTHENTICATION_FAILED);
				expect(err.message).toContain('authentication failed');
			}
		});

		it('should handle network errors', async () => {
			const error = new Error('network connection failed');
			mockInvoke.mockRejectedValue(error);

			try {
				await CloudStorageCommands.listFiles();
			} catch (err) {
				expect(err.type).toBe(CloudStorageErrorType.NETWORK_ERROR);
				expect(err.message).toContain('network connection failed');
			}
		});

		it('should handle vault not found errors', async () => {
			const error = new Error('vault not found');
			mockInvoke.mockRejectedValue(error);

			try {
				await CloudStorageCommands.readCloudVault({
					vaultId: 'non-existent',
					password: 'test'
				});
			} catch (err) {
				expect(err.type).toBe(CloudStorageErrorType.VAULT_NOT_FOUND);
				expect(err.message).toContain('vault not found');
			}
		});

		it('should handle quota exceeded errors', async () => {
			const error = new Error('storage quota exceeded');
			mockInvoke.mockRejectedValue(error);

			try {
				await CloudStorageCommands.createFile({
					name: 'large-file.txt',
					path: '/large-file.txt',
					content: new ArrayBuffer(1000000)
				});
			} catch (err) {
				expect(err.type).toBe(CloudStorageErrorType.QUOTA_EXCEEDED);
				expect(err.message).toContain('storage quota exceeded');
			}
		});
	});
});