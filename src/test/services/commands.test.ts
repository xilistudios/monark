import { describe, it, expect, vi, beforeEach } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import VaultCommands from '../../../services/commands';
import type {
	CloudVaultOperation,
	CreateCloudVaultRequest,
	UpdateCloudVaultRequest,
	DeleteCloudVaultRequest,
	CloudVaultMetadata
} from '../../../interfaces/cloud-storage.interface';
import { StorageProviderType } from '../../../interfaces/cloud-storage.interface';
import type { VaultContent } from '../../../interfaces/vault.interface';

// Mock the Tauri invoke function
vi.mock('@tauri-apps/api/core', () => ({
	invoke: vi.fn()
}));

const mockInvoke = vi.mocked(invoke);

describe('VaultCommands', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	describe('Local Vault Operations', () => {
		it('should read local vault successfully', async () => {
			const filePath = '/path/to/vault.monark';
			const password = 'test-password';
			const mockVaultContent: VaultContent = {
				updated_at: '2023-01-01T00:00:00Z',
				hmac: 'test-hmac',
				entries: []
			};

			mockInvoke.mockResolvedValue(mockVaultContent);

			const result = await VaultCommands.read(filePath, password);

			expect(mockInvoke).toHaveBeenCalledWith('read_vault', { filePath, password });
			expect(result).toEqual(mockVaultContent);
		});

		it('should write local vault successfully', async () => {
			const filePath = '/path/to/vault.monark';
			const password = 'test-password';
			const vaultContent: VaultContent = {
				updated_at: '2023-01-01T00:00:00Z',
				hmac: 'test-hmac',
				entries: []
			};

			mockInvoke.mockResolvedValue(undefined);

			await VaultCommands.write(filePath, password, vaultContent);

			expect(mockInvoke).toHaveBeenCalledWith('write_vault', {
				filePath,
				password,
				vaultContent
			});
		});

		it('should delete local vault successfully', async () => {
			const filePath = '/path/to/vault.monark';

			mockInvoke.mockResolvedValue(undefined);

			await VaultCommands.delete(filePath);

			expect(mockInvoke).toHaveBeenCalledWith('delete_vault', { filePath });
		});
	});

	describe('Cloud Vault Operations', () => {
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

			const result = await VaultCommands.readCloudVault(request);

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

			const result = await VaultCommands.writeCloudVault(request);

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

			await VaultCommands.updateCloudVault(request);

			expect(mockInvoke).toHaveBeenCalledWith('write_cloud_vault', {
				vaultName: '', // Empty name indicates update
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

			await VaultCommands.deleteCloudVault(request);

			expect(mockInvoke).toHaveBeenCalledWith('delete_cloud_vault', {
				vaultId: request.vaultId,
				providerName: request.providerName
			});
		});

		it('should list cloud vaults successfully', async () => {
			const mockVaults: CloudVaultMetadata[] = [
				{
					id: 'vault-1',
					name: 'test-vault.monark',
					providerName: 'google-drive',
					providerType: 'google_drive' as any,
					size: 1024,
					createdAt: '2023-01-01T00:00:00Z',
					modifiedAt: '2023-01-01T00:00:00Z',
					path: '/vaults/test-vault.monark',
					isFolder: false,
					mimeType: 'application/octet-stream',
					parentId: 'folder-1',
					metadata: {}
				}
			];

			mockInvoke.mockResolvedValue(mockVaults);

			const result = await VaultCommands.listCloudVaults('google-drive');

			expect(mockInvoke).toHaveBeenCalledWith('list_cloud_vaults', { providerName: 'google-drive' });
			expect(result).toEqual(mockVaults);
		});
	});

	describe('Unified Vault Operations', () => {
		it('should read vault from cloud when provider name is provided', async () => {
			const vaultPath = 'vault-1';
			const password = 'test-password';
			const providerName = 'google-drive';
			const mockVaultContent: VaultContent = {
				updated_at: '2023-01-01T00:00:00Z',
				hmac: 'test-hmac',
				entries: []
			};

			mockInvoke.mockResolvedValue(mockVaultContent);

			const result = await VaultCommands.readVault(vaultPath, password, providerName);

			expect(mockInvoke).toHaveBeenCalledWith('read_cloud_vault', {
				vaultId: vaultPath,
				password,
				providerName
			});
			expect(result).toEqual(mockVaultContent);
		});

		it('should read vault from local when provider name is not provided', async () => {
			const vaultPath = '/path/to/vault.monark';
			const password = 'test-password';
			const mockVaultContent: VaultContent = {
				updated_at: '2023-01-01T00:00:00Z',
				hmac: 'test-hmac',
				entries: []
			};

			mockInvoke.mockResolvedValue(mockVaultContent);

			const result = await VaultCommands.readVault(vaultPath, password);

			expect(mockInvoke).toHaveBeenCalledWith('read_vault', { filePath: vaultPath, password });
			expect(result).toEqual(mockVaultContent);
		});

		it('should write vault to cloud when provider name is provided', async () => {
			const vaultPath = 'vault-1';
			const password = 'test-password';
			const vaultContent: VaultContent = {
				updated_at: '2023-01-01T00:00:00Z',
				hmac: 'test-hmac',
				entries: []
			};
			const providerName = 'google-drive';
			const vaultName = 'test-vault';

			mockInvoke.mockResolvedValue('vault-1');

			const result = await VaultCommands.writeVault(
				vaultPath,
				password,
				vaultContent,
				providerName,
				vaultName
			);

			expect(mockInvoke).toHaveBeenCalledWith('write_cloud_vault', {
				vaultId: vaultPath,
				vaultName,
				password,
				vaultContent,
				providerName
			});
			expect(result).toBe('vault-1');
		});

		it('should write vault to local when provider name is not provided', async () => {
			const vaultPath = '/path/to/vault.monark';
			const password = 'test-password';
			const vaultContent: VaultContent = {
				updated_at: '2023-01-01T00:00:00Z',
				hmac: 'test-hmac',
				entries: []
			};

			mockInvoke.mockResolvedValue(undefined);

			const result = await VaultCommands.writeVault(vaultPath, password, vaultContent);

			expect(mockInvoke).toHaveBeenCalledWith('write_vault', {
				filePath: vaultPath,
				password,
				vaultContent
			});
			expect(result).toBe(vaultPath);
		});

		it('should delete vault from cloud when provider name is provided', async () => {
			const vaultPath = 'vault-1';
			const providerName = 'google-drive';

			mockInvoke.mockResolvedValue(undefined);

			await VaultCommands.deleteVault(vaultPath, providerName);

			expect(mockInvoke).toHaveBeenCalledWith('delete_cloud_vault', {
				vaultId: vaultPath,
				providerName
			});
		});

		it('should delete vault from local when provider name is not provided', async () => {
			const vaultPath = '/path/to/vault.monark';

			mockInvoke.mockResolvedValue(undefined);

			await VaultCommands.deleteVault(vaultPath);

			expect(mockInvoke).toHaveBeenCalledWith('delete_vault', { filePath: vaultPath });
		});
	});

	describe('Error Handling', () => {
		it('should handle read vault errors', async () => {
			const error = new Error('Failed to read vault');
			mockInvoke.mockRejectedValue(error);

			await expect(VaultCommands.read('/path/to/vault.monark', 'password')).rejects.toThrow();
		});

		it('should handle write vault errors', async () => {
			const error = new Error('Failed to write vault');
			mockInvoke.mockRejectedValue(error);

			await expect(
				VaultCommands.write('/path/to/vault.monark', 'password', {
					updated_at: '2023-01-01T00:00:00Z',
					hmac: 'test-hmac',
					entries: []
				})
			).rejects.toThrow();
		});

		it('should handle delete vault errors', async () => {
			const error = new Error('Failed to delete vault');
			mockInvoke.mockRejectedValue(error);

			await expect(VaultCommands.delete('/path/to/vault.monark')).rejects.toThrow();
		});

		it('should handle read cloud vault errors', async () => {
			const error = new Error('Failed to read cloud vault');
			mockInvoke.mockRejectedValue(error);

			await expect(
				VaultCommands.readCloudVault({
					vaultId: 'vault-1',
					password: 'password',
					providerName: 'google-drive'
				})
			).rejects.toThrow();
		});

		it('should handle write cloud vault errors', async () => {
			const error = new Error('Failed to write cloud vault');
			mockInvoke.mockRejectedValue(error);

			await expect(
				VaultCommands.writeCloudVault({
					vaultId: 'vault-1',
					vaultName: 'test-vault',
					password: 'password',
					vaultContent: {
						updatedAt: '2023-01-01T00:00:00Z',
						hmac: 'test-hmac',
						entries: []
					},
					providerName: 'google-drive'
				})
			).rejects.toThrow();
		});

		it('should handle delete cloud vault errors', async () => {
			const error = new Error('Failed to delete cloud vault');
			mockInvoke.mockRejectedValue(error);

			await expect(
				VaultCommands.deleteCloudVault({
					vaultId: 'vault-1',
					providerName: 'google-drive'
				})
			).rejects.toThrow();
		});
	});

	describe('Edge Cases', () => {
		it('should handle empty vault name in update cloud vault', async () => {
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

			await VaultCommands.updateCloudVault(request);

			expect(mockInvoke).toHaveBeenCalledWith('write_cloud_vault', {
				vaultName: '', // Should be empty for updates
				password: request.password,
				vaultContent: request.vaultContent,
				providerName: request.providerName
			});
		});

		it('should handle undefined provider name in unified operations', async () => {
			const vaultPath = 'vault-1';
			const password = 'test-password';
			const vaultContent: VaultContent = {
				updated_at: '2023-01-01T00:00:00Z',
				hmac: 'test-hmac',
				entries: []
			};

			mockInvoke.mockResolvedValue('vault-1');

			const result = await VaultCommands.writeVault(vaultPath, password, vaultContent);

			// Should call local write when providerName is undefined
			expect(mockInvoke).toHaveBeenCalledWith('write_vault', {
				filePath: vaultPath,
				password,
				vaultContent
			});
			expect(result).toBe(vaultPath);
		});

		it('should handle empty string provider name in unified operations', async () => {
			const vaultPath = 'vault-1';
			const password = 'test-password';
			const vaultContent: VaultContent = {
				updated_at: '2023-01-01T00:00:00Z',
				hmac: 'test-hmac',
				entries: []
			};

			mockInvoke.mockResolvedValue('vault-1');

			const result = await VaultCommands.writeVault(vaultPath, password, vaultContent, '');

			// Should call local write when providerName is empty string
			expect(mockInvoke).toHaveBeenCalledWith('write_vault', {
				filePath: vaultPath,
				password,
				vaultContent
			});
			expect(result).toBe(vaultPath);
		});
	});
});