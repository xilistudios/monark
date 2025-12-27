/**
 * Cloud Storage Interface Definitions
 *
 * This file contains TypeScript interfaces that match the Rust backend structures
 * for cloud storage integration. All types are designed to be serializable and
 * compatible with Tauri's invoke() calls.
 */

/**
 * Storage provider types supported by the system
 * Matches Rust StorageProviderType enum
 */
export enum StorageProviderType {
	LOCAL = 'local',
	GOOGLE_DRIVE = 'google_drive'
}

/**
 * Storage provider information matching Rust ProviderInfo struct
 */
export interface StorageProvider {
  name: string;
  provider_type: StorageProviderType;
  is_default: boolean;
}

/**
 * Google Drive configuration matching Rust GoogleDriveConfig struct
 */
export interface GoogleDriveConfig {
	client_id: string;
	client_secret: string;
	redirect_uri: string;
	access_token?: string;
	refresh_token?: string;
	token_expires_at?: string; // ISO 8601 datetime string
}

/**
 * Local storage configuration matching Rust Local config variant
 */
export interface LocalStorageConfig {
	basePath: string;
}

/**
 * Union type for provider configurations matching Rust ProviderConfig enum
 */
export type ProviderConfig =
  | { type: StorageProviderType.LOCAL; basePath: string }
  | { type: StorageProviderType.GOOGLE_DRIVE; config: GoogleDriveConfig };

/**
 * Request to add a new storage provider matching Rust AddProviderRequest
 */
export interface AddProviderRequest {
	name: string;
	config: ProviderConfig;
}

/**
 * Storage file information matching Rust StorageFile struct
 */
export interface StorageFile {
	id: string;
	name: string;
	path: string;
	size?: number;
	createdAt?: string; // ISO 8601 datetime string
	modifiedAt?: string; // ISO 8601 datetime string
	isFolder: boolean;
	mimeType?: string;
	parentId?: string;
	metadata: Record<string, string>;
}

/**
 * Request to create a file matching Rust CreateFileRequest
 */
export interface CreateFileRequest {
	name: string;
	path: string;
	content: ArrayBuffer;
	parentId?: string;
	mimeType?: string;
	metadata?: Record<string, string>;
}

/**
 * Request to update a file matching Rust UpdateFileRequest
 */
export interface UpdateFileRequest {
	id: string;
	content: ArrayBuffer;
	metadata?: Record<string, string>;
}

/**
 * Request to create a folder matching Rust CreateFolderRequest
 */
export interface CreateFolderRequest {
	name: string;
	path: string;
	parentId?: string;
	metadata?: Record<string, string>;
}

/**
 * Cloud vault metadata for vault operations
 */
export interface CloudVaultMetadata {
	id: string;
	name: string;
	providerName: string;
	providerType: StorageProviderType;
	size?: number;
	createdAt: string;
	modifiedAt: string;
	path: string;
	isFolder: boolean;
	mimeType?: string;
	parentId?: string;
	metadata?: Record<string, string>;
}

/**
 * Base cloud vault operation parameters
 */
export interface CloudVaultOperation {
	vaultId: string;
	password: string;
	providerName?: string;
}

/**
 * Request to create a new cloud vault
 */
export interface CreateCloudVaultRequest extends CloudVaultOperation {
  vaultName: string;
  vaultContent: {
    updatedAt: string;
    hmac: string;
    entries: any[];
  };
  parentId?: string;
}

/**
 * Request to update an existing cloud vault
 */
export interface UpdateCloudVaultRequest extends CloudVaultOperation {
	vaultContent: {
		updatedAt: string;
		hmac: string;
		entries: any[];
	};
}

/**
 * Request to delete a cloud vault
 */
export interface DeleteCloudVaultRequest {
	vaultId: string;
	providerName?: string;
}

/**
 * OAuth configuration for authentication flows
 */
export interface OAuthConfig {
	clientId: string;
	clientSecret: string;
	redirectUri: string;
	scopes: string[];
}

/**
 * OAuth token response from authentication
 */
export interface OAuthTokenResponse {
	accessToken: string;
	refreshToken?: string;
	expiresIn: number;
	tokenType: string;
	scope?: string;
}

/**
 * OAuth state for security during authentication flow
 */
export interface OAuthState {
	state: string;
	providerName: string;
	timestamp: number;
}

/**
 * Cloud storage operation result types
 */
export interface CloudStorageResult<T = void> {
	success: boolean;
	data?: T;
	error?: string;
}

/**
 * Provider authentication status
 */
export interface ProviderAuthStatus {
	providerName: string;
	isAuthenticated: boolean;
	lastAuthenticated?: string;
	error?: string;
}

/**
 * Cloud vault list response
 */
export interface CloudVaultListResponse {
	vaults: CloudVaultMetadata[];
	providerName?: string;
	totalCount: number;
}

/**
 * Storage provider list response
 */
export interface ProviderListResponse {
	providers: StorageProvider[];
	defaultProvider: string | null;
}

/**
 * File operation response
 */
export interface FileOperationResponse {
	file: StorageFile;
	operation: 'create' | 'update' | 'delete';
}

/**
 * Batch file operations
 */
export interface BatchFileOperation {
	operations: Array<{
		type: 'create' | 'update' | 'delete';
		request: CreateFileRequest | UpdateFileRequest | { id: string };
	}>;
	providerName?: string;
}

/**
 * Cloud storage statistics
 */
export interface CloudStorageStats {
	totalVaults: number;
	totalSize: number;
	providerStats: Array<{
		providerName: string;
		vaultCount: number;
		totalSize: number;
		lastSync?: string;
	}>;
}

/**
 * Sync status for cloud operations
 */
export interface CloudSyncStatus {
	vaultId: string;
	providerName: string;
	status: 'synced' | 'syncing' | 'error' | 'pending';
	lastSync?: string;
	error?: string;
}

/**
 * Cloud storage error types
 */
export enum CloudStorageErrorType {
	AUTHENTICATION_FAILED = 'AUTHENTICATION_FAILED',
	TOKEN_EXPIRED = 'TOKEN_EXPIRED',
	NETWORK_ERROR = 'NETWORK_ERROR',
	QUOTA_EXCEEDED = 'QUOTA_EXCEEDED',
	VAULT_NOT_FOUND = 'VAULT_NOT_FOUND',
	PERMISSION_DENIED = 'PERMISSION_DENIED',
	PROVIDER_NOT_CONFIGURED = 'PROVIDER_NOT_CONFIGURED',
	INVALID_CREDENTIALS = 'INVALID_CREDENTIALS',
	OPERATION_FAILED = 'OPERATION_FAILED'
}

/**
 * Cloud storage error details
 */
export interface CloudStorageError {
	type: CloudStorageErrorType;
	message: string;
	providerName?: string;
	originalError?: string;
	code?: string;
}

/**
 * Request parameters for listing files with filtering
 */
export interface ListFilesRequest {
	folderId?: string;
	providerName?: string;
	query?: string;
	pageSize?: number;
	pageToken?: string;
}

/**
 * Paginated response for file listings
 */
export interface ListFilesResponse {
	files: StorageFile[];
	nextPageToken?: string;
	totalCount?: number;
}

/**
 * Search parameters for cloud storage
 */
export interface CloudStorageSearchParams {
	query: string;
	providerName?: string;
	fileTypes?: string[];
	dateRange?: {
		start: string;
		end: string;
	};
	maxResults?: number;
}

/**
 * Cloud storage search response
 */
export interface CloudStorageSearchResponse {
	results: StorageFile[];
	totalCount: number;
	searchTime: number;
	providerName?: string;
}