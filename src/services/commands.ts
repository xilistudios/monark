import { invoke } from "@tauri-apps/api/core";
import type {
	CloudVaultMetadata,
	CloudVaultOperation,
	CreateCloudVaultRequest,
	DeleteCloudVaultRequest,
	UpdateCloudVaultRequest,
} from "../interfaces/cloud-storage.interface";
import type { VaultContent } from "../interfaces/vault.interface";

/**
 * VaultCommands class provides methods to interact with Tauri's backend commands.
 * Includes both local and cloud vault operations.
 */
export default class VaultCommands {
	// Local vault operations

	/**
	 * Reads a local vault from file system
	 * @param filePath - Path to the vault file
	 * @param password - Vault password for decryption
	 * @returns Promise resolving to vault content
	 */
	static async read(filePath: string, password: string): Promise<VaultContent> {
		return await invoke<VaultContent>("read_vault", { filePath, password });
	}

	/**
	 * Writes a local vault to file system
	 * @param filePath - Path to save the vault file
	 * @param password - Vault password for encryption
	 * @param vaultContent - Vault content to save
	 */
	static async write(
		filePath: string,
		password: string,
		vaultContent: {
			updated_at: string;
			hmac: string;
			entries: any[];
		},
	) {
		console.log("Writing vault content:", vaultContent, filePath, password);
		return await invoke("write_vault", { filePath, password, vaultContent });
	}

	/**
	 * Deletes a local vault file
	 * @param filePath - Path to the vault file to delete
	 */
	static async delete(filePath: string) {
		return await invoke("delete_vault", { filePath });
	}

	// Cloud vault operations

	/**
	 * Reads a cloud vault from storage provider
	 * @param request - Cloud vault operation parameters
	 * @returns Promise resolving to vault content
	 */
	static async readCloudVault(
		request: CloudVaultOperation,
	): Promise<VaultContent> {
		return await invoke<VaultContent>("read_cloud_vault", {
			vaultId: request.vaultId,
			password: request.password,
			providerName: request.providerName,
		});
	}

	/**
	 * Creates or updates a cloud vault
	 * @param request - Cloud vault creation/update request
	 * @returns Promise resolving to vault ID
	 */
	static async writeCloudVault(
		request: CreateCloudVaultRequest,
	): Promise<string> {
		return await invoke<string>("write_cloud_vault", {
			vaultName: request.vaultName,
			password: request.password,
			vaultContent: request.vaultContent,
			providerName: request.providerName,
			parentId: request.parentId,
			vaultId: request.vaultId || undefined,
		});
	}

	/**
	 * Updates an existing cloud vault
	 * @param request - Cloud vault update request
	 */
	static async updateCloudVault(
		request: UpdateCloudVaultRequest,
	): Promise<void> {
		return await invoke("write_cloud_vault", {
			vaultName: "", // Empty name when updating by ID
			password: request.password,
			vaultContent: request.vaultContent,
			providerName: request.providerName,
			vaultId: request.vaultId,
		});
	}

	/**
	 * Deletes a cloud vault from storage provider
	 * @param request - Cloud vault deletion request
	 */
	static async deleteCloudVault(
		request: DeleteCloudVaultRequest,
	): Promise<void> {
		return await invoke("delete_cloud_vault", {
			vaultId: request.vaultId,
			providerName: request.providerName,
		});
	}

	/**
	 * Lists all cloud vaults from storage providers
	 * @param providerName - Optional name of the provider to list vaults from
	 * @returns Promise resolving to array of cloud vault metadata
	 */
	static async listCloudVaults(
		providerName?: string,
	): Promise<CloudVaultMetadata[]> {
		const files = await invoke<any[]>("list_cloud_vaults", { providerName });

		// Convert StorageFile to CloudVaultMetadata
		return files.map((file) => ({
			id: file.id,
			name: file.name,
			providerName: providerName || "unknown",
			providerType: "google_drive" as any, // Default to Google Drive for now
			size: file.size,
			createdAt: file.createdAt || "",
			modifiedAt: file.modifiedAt || "",
			path: file.path,
			isFolder: file.isFolder,
			mimeType: file.mimeType,
			parentId: file.parentId,
			metadata: file.metadata || {},
		}));
	}

	// Unified vault operations

	/**
	 * Reads a vault from either local or cloud storage
	 * @param vaultPath - Path to local vault or cloud vault ID
	 * @param password - Vault password for decryption
	 * @param providerName - Optional provider name for cloud vaults
	 * @returns Promise resolving to vault content
	 */
	static async readVault(
		vaultPath: string,
		password: string,
		providerName?: string,
	): Promise<VaultContent> {
		// If provider name is provided, assume it's a cloud vault
		if (providerName) {
			return VaultCommands.readCloudVault({
				vaultId: vaultPath,
				password,
				providerName,
			});
		}

		// Otherwise, treat as local vault
		return VaultCommands.read(vaultPath, password);
	}

	/**
	 * Writes a vault to either local or cloud storage
	 * @param vaultPath - Path for local vault or cloud vault ID
	 * @param password - Vault password for encryption
	 * @param vaultContent - Vault content to save
	 * @param providerName - Optional provider name for cloud vaults
	 * @param vaultName - Optional vault name for cloud vault creation
	 * @returns Promise resolving to vault path/ID
	 */
	static async writeVault(
		vaultPath: string,
		password: string,
		vaultContent: {
			updated_at: string;
			hmac: string;
			entries: any[];
		},
		providerName?: string,
		vaultName?: string,
	): Promise<string> {
		// Validate required parameters
		if (!vaultPath || !password) {
			throw new Error("vaultPath and password are required");
		}

		// If provider name is provided, assume it's a cloud vault
		if (providerName) {
			// Convert snake_case to camelCase for the interface
			return VaultCommands.writeCloudVault({
				vaultId: vaultPath,
				vaultName: vaultName || vaultPath,
				password,
				vaultContent: {
					updatedAt: vaultContent.updated_at,
					hmac: vaultContent.hmac,
					entries: vaultContent.entries,
				},
				providerName,
			});
		}

		// Otherwise, treat as local vault
		await VaultCommands.write(vaultPath, password, vaultContent);
		return vaultPath;
	}

	/**
	 * Deletes a vault from either local or cloud storage
	 * @param vaultPath - Path to local vault or cloud vault ID
	 * @param providerName - Optional provider name for cloud vaults
	 */
	static async deleteVault(
		vaultPath: string,
		providerName?: string,
	): Promise<void> {
		// If provider name is provided, assume it's a cloud vault
		if (providerName) {
			await VaultCommands.deleteCloudVault({
				vaultId: vaultPath,
				providerName,
			});
		} else {
			// Otherwise, treat as local vault
			await VaultCommands.delete(vaultPath);
		}
	}
}
