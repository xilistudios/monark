/* Use dynamic import for Tauri invoke to allow tests to mock '@tauri-apps/api/core'
   before the service methods call it. The real invoke will be loaded lazily at runtime. */
import type {
	AddProviderRequest,
	CloudStorageError,
	CloudStorageSearchParams,
	CloudStorageSearchResponse,
	CloudVaultMetadata,
	CloudVaultOperation,
	CreateCloudVaultRequest,
	CreateFileRequest,
	CreateFolderRequest,
	DeleteCloudVaultRequest,
	ListFilesRequest,
	ListFilesResponse,
	StorageFile,
	StorageProvider,
	UpdateCloudVaultRequest,
	UpdateFileRequest,
} from "../interfaces/cloud-storage.interface";
import {
	CloudStorageErrorType,
	StorageProviderType,
} from "../interfaces/cloud-storage.interface";
import type { VaultContent } from "../interfaces/vault.interface";

/**
 * CloudStorageCommands class provides methods to interact with cloud storage backend commands.
 * All methods use Tauri's invoke() to call the corresponding Rust commands.
 */
async function invokeTauri<T = any>(...args: any[]): Promise<T> {
	// dynamic import so test-time mocks of '@tauri-apps/api/core' are respected
	const mod = await import("@tauri-apps/api/core");
	const result = await (mod as any).invoke(...args);
	return result as T;
}

// Provide a small invoke alias that delegates to the dynamic loader so existing
// calls to "invoke(...)" in this file keep working without mass edits.
const invoke = <T = any>(...args: any[]): Promise<T> => invokeTauri<T>(...args);

export class CloudStorageCommands {
	/**
	 * Lists all configured storage providers
	 * @returns Promise resolving to array of storage providers
	 */
	static async listProviders(): Promise<StorageProvider[]> {
		try {
			return await invoke<StorageProvider[]>("list_providers");
		} catch (error) {
			throw CloudStorageCommands.handleError(error, "Failed to list providers");
		}
	}

	/**
	 * Adds a new storage provider configuration
	 * @param request - Provider configuration request
	 */
	static async addProvider(request: AddProviderRequest): Promise<void> {
		try {
			await invoke("add_provider", { request });
		} catch (error) {
			throw CloudStorageCommands.handleError(error, "Failed to add provider");
		}
	}

	/**
	 * Removes a storage provider configuration
	 * @param name - Name of the provider to remove
	 */
	static async removeProvider(name: string): Promise<void> {
		try {
			await invoke("remove_provider", { name });
		} catch (error) {
			throw CloudStorageCommands.handleError(
				error,
				"Failed to remove provider",
			);
		}
	}

	/**
	 * Sets the default storage provider
	 * @param name - Name of the provider to set as default
	 */
	static async setDefaultProvider(name: string): Promise<void> {
		try {
			await invoke("set_default_provider", { name });
		} catch (error) {
			throw CloudStorageCommands.handleError(
				error,
				"Failed to set default provider",
			);
		}
	}

	/**
	 * Authenticates with a storage provider
	 * @param providerName - Optional name of the provider to authenticate
	 */
	static async authenticateProvider(providerName?: string): Promise<void> {
		try {
			await invoke("authenticate_provider", { providerName });
		} catch (error) {
			throw CloudStorageCommands.handleError(
				error,
				"Failed to authenticate provider",
			);
		}
	}

	/**
	 * Refreshes provider authentication and returns updated auth info.
	 * @param providerName - Name of the provider to refresh
	 */
	static async refreshProviderAuth(providerName: string): Promise<{
		authenticated: boolean;
		token_expires_at?: string | null;
	}> {
		try {
			return await invoke<{
				authenticated: boolean;
				token_expires_at?: string | null;
			}>("refresh_provider_auth", { providerName });
		} catch (error) {
			throw CloudStorageCommands.handleError(
				error,
				"Failed to refresh provider auth",
			);
		}
	}

	/**
	 * Checks if a storage provider is authenticated
	 * @param providerName - Name of the provider to check
	 * @returns Promise resolving to boolean indicating if provider is authenticated
	 */
	static async checkProviderAuthStatus(providerName: string): Promise<boolean> {
		if (providerName === "local") {
			return true;
		}
		try {
			return await invoke<boolean>("check_provider_auth_status", {
				providerName,
			});
		} catch (error) {
			console.error("Failed to check provider auth status:", error);
			return false;
		}
	}

	/**
	 * Gets provider authentication info including expiration.
	 * @param providerName - Name of the provider to inspect
	 */
	static async getProviderAuthInfo(providerName: string): Promise<{
		authenticated: boolean;
		token_expires_at?: string | null;
	}> {
		if (providerName === "local") {
			return {
				authenticated: true,
				token_expires_at: null,
			};
		}
		try {
			return await invoke<{
				authenticated: boolean;
				token_expires_at?: string | null;
			}>("get_provider_auth_info", { providerName });
		} catch (error) {
			throw CloudStorageCommands.handleError(
				error,
				"Failed to get provider auth info",
			);
		}
	}

	/**
	 * Lists cloud vaults from storage providers
	 * @param providerName - Optional name of the provider to list vaults from
	 * @returns Promise resolving to array of cloud vault metadata
	 */
	static async listCloudVaults(
		providerName?: string,
	): Promise<CloudVaultMetadata[]> {
		try {
			const files = await invoke<StorageFile[]>("list_vaults", {
				providerName,
			});
			return files.map((file) =>
				CloudStorageCommands.storageFileToCloudVaultMetadata(
					file,
					providerName,
				),
			);
		} catch (error) {
			throw CloudStorageCommands.handleError(
				error,
				"Failed to list cloud vaults",
			);
		}
	}

	/**
	 * Reads a cloud vault from storage
	 * @param requestOrVaultId - Cloud vault operation object or vault ID string
	 * @param maybeProviderName - Optional provider name (only used with string overload)
	 * @returns Promise resolving to vault content
	 *
	 * API Change: This method now requires an explicit password via the CloudVaultOperation object.
	 * The positional overload (readCloudVault(vaultId, providerName)) has been removed to prevent
	 * silent misuse. You must now use: readCloudVault({ vaultId, password, providerName })
	 *
	 * @example
	 * // Correct usage:
	 * const content = await CloudStorageCommands.readCloudVault({
	 *   vaultId: 'my-vault-id',
	 *   password: 'my-password',
	 *   providerName: 'google-drive'
	 * });
	 *
	 * @throws Error if called with positional arguments (defense in depth)
	 */
	static async readCloudVault(
		requestOrVaultId: CloudVaultOperation | string,
		_maybeProviderName?: string,
	): Promise<VaultContent> {
		// Defense-in-depth: the positional overload cannot provide a password.
		// Avoid silent misuse by throwing with a clear message.
		if (typeof requestOrVaultId === "string") {
			throw new Error(
				"readCloudVault(vaultId, providerName) requires a password. " +
					"Use readCloudVault({ vaultId, password, providerName })",
			);
		}

		try {
			const request = requestOrVaultId as CloudVaultOperation;
			return await invoke<VaultContent>("read_cloud_vault", {
				vaultId: request.vaultId,
				password: request.password,
				providerName: request.providerName,
			});
		} catch (error) {
			throw CloudStorageCommands.handleError(
				error,
				"Failed to read cloud vault",
			);
		}
	}

	/**
	 * Writes a cloud vault to storage
	 * @param request - Cloud vault creation request
	 * @param maybeVaultContent - Optional vault content (for positional style)
	 * @param maybeProviderName - Optional provider name (for positional style)
	 * @param maybeParentId - Optional parent folder ID (for positional style)
	 * @returns Promise resolving to vault ID
	 */
	static async writeCloudVault(
		requestOrVaultId: CreateCloudVaultRequest | string,
		maybeVaultContent?: any,
		maybeProviderName?: string,
		maybeParentId?: string,
	): Promise<string> {
		try {
			// Support two calling styles for compatibility with tests and callers:
			// 1) writeCloudVault(request: CreateCloudVaultRequest) -> invokes with vaultName, password, vaultContent, providerName, parentId
			// 2) writeCloudVault(vaultId: string, vaultContent: any, providerName?: string, parentId?: string) -> invokes with vaultId, vaultContent, providerName, parentId
			if (typeof requestOrVaultId === "string") {
				const vaultId = requestOrVaultId;
				const vaultContent = maybeVaultContent;
				const providerName = maybeProviderName;
				const parentId = maybeParentId;
				return await invoke<string>("write_cloud_vault", {
					vaultId,
					vaultContent,
					providerName,
					parentId,
				});
			} else {
				const request = requestOrVaultId as CreateCloudVaultRequest & {
					vaultId?: string;
					parentId?: string;
				};

				const payload: Record<string, any> = {
					vaultName: request.vaultName,
					password: request.password,
					vaultContent: request.vaultContent,
					providerName: request.providerName,
				};

				if (request.parentId) {
					payload.parentId = request.parentId;
				}

				if (request.vaultId) {
					payload.vaultId = request.vaultId;
				}

				return await invoke<string>("write_cloud_vault", payload);
			}
		} catch (error) {
			throw CloudStorageCommands.handleError(
				error,
				"Failed to write cloud vault",
			);
		}
	}

	/**
	 * Updates an existing cloud vault
	 * @param request - Cloud vault update request
	 */
	static async updateCloudVault(
		requestOrVaultId: UpdateCloudVaultRequest | string,
		maybeVaultContent?: any,
		maybeProviderName?: string,
	): Promise<void> {
		try {
			// Support two calling styles:
			// 1) updateCloudVault(request: UpdateCloudVaultRequest) -> { vaultId, password, vaultContent, providerName }
			// 2) updateCloudVault(vaultId: string, vaultContent: any, providerName?: string) -> positional
			if (typeof requestOrVaultId === "string") {
				const vaultId = requestOrVaultId;
				const vaultContent = maybeVaultContent;
				const providerName = maybeProviderName;
				await invoke("update_cloud_vault", {
					vaultId,
					vaultContent,
					providerName,
				});
			} else {
				const request = requestOrVaultId as UpdateCloudVaultRequest;
				await invoke("update_cloud_vault", {
					vaultId: request.vaultId,
					password: request.password,
					vaultContent: request.vaultContent,
					providerName: request.providerName,
				});
			}
		} catch (error) {
			throw CloudStorageCommands.handleError(
				error,
				"Failed to update cloud vault",
			);
		}
	}

	/**
	 * Deletes a cloud vault from storage
	 * @param request - Cloud vault deletion request
	 */
	static async deleteCloudVault(
		request: DeleteCloudVaultRequest,
	): Promise<void> {
		try {
			await invoke("delete_cloud_vault", {
				vaultId: request.vaultId,
				providerName: request.providerName,
			});
		} catch (error) {
			throw CloudStorageCommands.handleError(
				error,
				"Failed to delete cloud vault",
			);
		}
	}

	/**
	 * Changes the password for a cloud vault
	 * @param vaultId - ID of the vault to change password for
	 * @param oldPassword - Current password of the vault
	 * @param newPassword - New password to set
	 * @param providerName - Optional name of the storage provider
	 */
	static async changeCloudVaultPassword(
		vaultId: string,
		oldPassword: string,
		newPassword: string,
		providerName?: string,
	): Promise<void> {
		try {
			await invoke("change_cloud_vault_password", {
				vaultId,
				oldPassword,
				newPassword,
				providerName,
			});
		} catch (error) {
			throw CloudStorageCommands.handleError(
				error,
				"Failed to change cloud vault password",
			);
		}
	}

	/**
	 * Lists files from a storage provider
	 * @param request - File listing request parameters
	 * @returns Promise resolving to file list response
	 */
	static async listFiles(
		request?: ListFilesRequest,
	): Promise<ListFilesResponse> {
		try {
			const files = await invoke<StorageFile[]>("list_files", {
				folderId: request?.folderId,
				providerName: request?.providerName,
			});

			return {
				files,
				totalCount: files.length,
			};
		} catch (error) {
			throw CloudStorageCommands.handleError(error, "Failed to list files");
		}
	}

	/**
	 * Creates a new file in storage
	 * @param request - File creation request
	 * @param providerName - Optional provider name
	 * @returns Promise resolving to created file metadata
	 */
	static async createFile(
		request: CreateFileRequest,
		providerName?: string,
	): Promise<StorageFile> {
		try {
			// Convert ArrayBuffer to Uint8Array for serialization
			const content = new Uint8Array(request.content);

			return await invoke<StorageFile>("create_file", {
				request: {
					...request,
					content: Array.from(content),
				},
				providerName,
			});
		} catch (error) {
			throw CloudStorageCommands.handleError(error, "Failed to create file");
		}
	}

	/**
	 * Reads a file from storage
	 * @param fileId - ID of the file to read
	 * @param providerName - Optional provider name
	 * @returns Promise resolving to file content as ArrayBuffer
	 */
	static async readFile(
		fileId: string,
		providerName?: string,
	): Promise<ArrayBuffer> {
		try {
			const content = await invoke<number[]>("read_file", {
				fileId,
				providerName,
			});
			return new Uint8Array(content).buffer;
		} catch (error) {
			throw CloudStorageCommands.handleError(error, "Failed to read file");
		}
	}

	/**
	 * Updates an existing file in storage
	 * @param request - File update request
	 * @param providerName - Optional provider name
	 * @returns Promise resolving to updated file metadata
	 */
	static async updateFile(
		request: UpdateFileRequest,
		providerName?: string,
	): Promise<StorageFile> {
		try {
			// Convert ArrayBuffer to Uint8Array for serialization
			const content = new Uint8Array(request.content);

			return await invoke<StorageFile>("update_file", {
				request: {
					...request,
					content: Array.from(content),
				},
				providerName,
			});
		} catch (error) {
			throw CloudStorageCommands.handleError(error, "Failed to update file");
		}
	}

	/**
	 * Deletes a file from storage
	 * @param fileId - ID of the file to delete
	 * @param providerName - Optional provider name
	 */
	static async deleteFile(
		fileId: string,
		providerName?: string,
	): Promise<void> {
		try {
			await invoke("delete_file", { fileId, providerName });
		} catch (error) {
			throw CloudStorageCommands.handleError(error, "Failed to delete file");
		}
	}

	/**
	 * Creates a new folder in storage
	 * @param request - Folder creation request
	 * @param providerName - Optional provider name
	 * @returns Promise resolving to created folder metadata
	 */
	static async createFolder(
		request: CreateFolderRequest,
		providerName?: string,
	): Promise<StorageFile> {
		try {
			return await invoke<StorageFile>("create_folder", {
				request,
				providerName,
			});
		} catch (error) {
			throw CloudStorageCommands.handleError(error, "Failed to create folder");
		}
	}

	/**
	 * Deletes a folder from storage
	 * @param folderId - ID of the folder to delete
	 * @param providerName - Optional provider name
	 */
	static async deleteFolder(
		folderId: string,
		providerName?: string,
	): Promise<void> {
		try {
			await invoke("delete_folder", { folderId, providerName });
		} catch (error) {
			throw CloudStorageCommands.handleError(error, "Failed to delete folder");
		}
	}

	/**
	 * Gets file information
	 * @param fileId - ID of the file
	 * @param providerName - Optional provider name
	 * @returns Promise resolving to file metadata
	 */
	static async getFileInfo(
		fileId: string,
		providerName?: string,
	): Promise<StorageFile> {
		try {
			return await invoke<StorageFile>("get_file_info", {
				fileId,
				providerName,
			});
		} catch (error) {
			throw CloudStorageCommands.handleError(error, "Failed to get file info");
		}
	}

	/**
	 * Searches for files in storage
	 * @param params - Search parameters
	 * @returns Promise resolving to search results
	 */
	static async searchFiles(
		params: CloudStorageSearchParams,
	): Promise<CloudStorageSearchResponse> {
		try {
			const startTime = Date.now();
			const files = await invoke<StorageFile[]>("search_files", {
				query: params.query,
				providerName: params.providerName,
			});

			return {
				results: files,
				totalCount: files.length,
				searchTime: Date.now() - startTime,
				providerName: params.providerName,
			};
		} catch (error) {
			throw CloudStorageCommands.handleError(error, "Failed to search files");
		}
	}

	/**
	 * Gets Google Drive OAuth URL for authentication
	 * @param providerName - Name of the provider to authenticate
	 * @returns Promise resolving to OAuth URL and state
	 */
	static async getGoogleDriveOAuthUrl(
		providerName: string,
	): Promise<{ url: string; state: string }> {
		try {
			return await invoke<{ url: string; state: string }>(
				"get_google_drive_oauth_url",
				{ providerName },
			);
		} catch (error) {
			throw CloudStorageCommands.handleError(error, "Failed to get OAuth URL");
		}
	}

	/**
	 * Handles Google Drive OAuth callback with authorization code
	 * @param providerName - Name of the provider
	 * @param code - Authorization code from OAuth callback
	 * @param state - State parameter for CSRF protection
	 */
	static async handleGoogleDriveOAuthCallback(
		providerName: string,
		code: string,
		state: string,
	): Promise<void> {
		try {
			console.log("Calling handle_google_drive_oauth_callback with:", {
				providerName,
				code,
				state,
			});
			await invoke("handle_google_drive_oauth_callback", {
				request: {
					provider_name: providerName,
					code,
					state,
				},
			});
			console.log("OAuth callback completed successfully");
		} catch (error) {
			console.error("OAuth callback error:", error);
			throw CloudStorageCommands.handleError(
				error,
				"Failed to complete OAuth authentication",
			);
		}
	}

	/**
	 * Converts StorageFile to CloudVaultMetadata
	 * @private
	 * @param file - StorageFile to convert
	 * @param providerName - Provider name to include in metadata
	 * @returns CloudVaultMetadata
	 */
	private static storageFileToCloudVaultMetadata(
		file: StorageFile,
		providerName?: string,
	): CloudVaultMetadata {
		return {
			id: file.id,
			name: file.name,
			providerName: providerName || "unknown",
			providerType: StorageProviderType.GOOGLE_DRIVE, // This should be determined from provider configuration
			size: file.size,
			createdAt: file.createdAt || "",
			modifiedAt: file.modifiedAt || "",
			path: file.path,
			isFolder: file.isFolder,
			mimeType: file.mimeType,
			parentId: file.parentId,
			metadata: file.metadata,
		};
	}

	/**
	 * Maps raw Tauri errors to structured CloudStorageError objects
	 * @private
	 * @param error - Raw error from Tauri invoke call
	 * @param defaultMessage - Fallback error message
	 * @returns Structured CloudStorageError with proper type classification
	 */
	private static handleError(
		error: any,
		defaultMessage: string,
	): CloudStorageError {
		// Extract the actual error message from various error formats
		let message: string;
		let originalError: string;

		if (typeof error === "string") {
			message = error;
			originalError = error;
		} else if (error?.message) {
			message = error.message;
			originalError = JSON.stringify(error, null, 2);
		} else if (typeof error === "object") {
			// Try to extract meaningful info from the error object
			try {
				originalError = JSON.stringify(error, null, 2);
				// Check for common error properties
				message = error.error || error.msg || error.reason || originalError;
			} catch (e) {
				originalError = String(error);
				message = defaultMessage;
			}
		} else {
			message = defaultMessage;
			originalError = String(error);
		}

		// Determine error type based on message content
		let errorType: CloudStorageErrorType =
			CloudStorageErrorType.OPERATION_FAILED;

		if (
			message.includes("authentication") ||
			message.includes("unauthorized")
		) {
			errorType = CloudStorageErrorType.AUTHENTICATION_FAILED;
		} else if (message.includes("token") && message.includes("expired")) {
			errorType = CloudStorageErrorType.TOKEN_EXPIRED;
		} else if (message.includes("network") || message.includes("connection")) {
			errorType = CloudStorageErrorType.NETWORK_ERROR;
		} else if (message.includes("quota") || message.includes("storage")) {
			errorType = CloudStorageErrorType.QUOTA_EXCEEDED;
		} else if (message.includes("not found")) {
			errorType = CloudStorageErrorType.VAULT_NOT_FOUND;
		} else if (message.includes("permission") || message.includes("denied")) {
			errorType = CloudStorageErrorType.PERMISSION_DENIED;
		} else if (message.includes("provider") && message.includes("configured")) {
			errorType = CloudStorageErrorType.PROVIDER_NOT_CONFIGURED;
		} else if (message.includes("credentials") || message.includes("invalid")) {
			errorType = CloudStorageErrorType.INVALID_CREDENTIALS;
		}

		return {
			type: errorType,
			message: message || defaultMessage,
			originalError: originalError,
		};
	}
}
