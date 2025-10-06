
# Technical Architecture Plan: Google Drive Vault Integration

## Executive Summary

This plan outlines the comprehensive integration of Google Drive cloud storage into the Monark password manager frontend. The architecture maintains backward compatibility with existing local vaults while adding robust cloud storage capabilities through a modular, extensible design.

## 1. Backend Architecture Analysis ✅

### Existing Backend Components
- **Storage Manager**: Modular system with [`StorageProvider`](src-tauri/src/storage/providers/mod.rs:56) trait
- **Google Drive Provider**: Full OAuth2 implementation with token management
- **Cloud Vault Commands**: [`write_cloud_vault`](src-tauri/src/vault/cloud_lifecycle.rs:19), [`read_cloud_vault`](src-tauri/src/vault/cloud_lifecycle.rs:62), [`delete_cloud_vault`](src-tauri/src/vault/cloud_lifecycle.rs:91), [`list_cloud_vaults`](src-tauri/src/vault/cloud_lifecycle.rs:102)
- **Storage Commands**: Provider management operations in [`storage.rs`](src-tauri/src/commands/storage.rs:1)

### Key Backend Features
- Automatic token refresh and expiration handling
- Encrypted vault storage with same crypto as local vaults
- Provider abstraction supporting multiple storage backends
- Comprehensive error handling and validation

## 2. TypeScript Type Definitions

### 2.1 Storage Provider Types

```typescript
// src/interfaces/storage.interface.ts
export enum StorageProviderType {
  LOCAL = 'local',
  GOOGLE_DRIVE = 'google_drive'
}

export interface StorageProvider {
  name: string;
  type: StorageProviderType;
  isDefault: boolean;
  isAuthenticated: boolean;
  lastAuthenticated?: string;
  config?: ProviderConfig;
}

export interface GoogleDriveConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  accessToken?: string;
  refreshToken?: string;
  tokenExpiresAt?: string;
}

export interface LocalStorageConfig {
  basePath: string;
}

export type ProviderConfig = GoogleDriveConfig | LocalStorageConfig;

export interface AddProviderRequest {
  name: string;
  config: ProviderConfig;
}
```

### 2.2 Cloud Vault Types

```typescript
// src/interfaces/cloud-vault.interface.ts
export interface CloudVault {
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

export interface CloudVaultOperation {
  vaultId: string;
  providerName?: string;
  password: string;
}

export interface CreateCloudVaultRequest extends CloudVaultOperation {
  vaultName: string;
  vaultContent: VaultContent;
}

export interface UpdateCloudVaultRequest extends CloudVaultOperation {
  vaultContent: VaultContent;
}
```

### 2.3 OAuth Types

```typescript
// src/interfaces/oauth.interface.ts
export interface OAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  scopes: string[];
}

export interface OAuthTokenResponse {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  tokenType: string;
  scope?: string;
}

export interface OAuthState {
  state: string;
  providerName: string;
  timestamp: number;
}
```

## 3. Redux State Structure

### 3.1 Enhanced Vault State

```typescript
// src/redux/actions/vault.ts (extended)
export interface Vault {
  id: string;
  name: string;
  path: string;
  lastAccessed?: string;
  isLocked: boolean;
  // New: Cloud storage support
  storageType: StorageProviderType;
  providerName?: string;
  cloudVaultId?: string;
  // Existing volatile state
  volatile: {
    credential: string;
    entries: Entry[];
    navigationPath?: string;
    encryptedData?: string;
  };
}

export interface VaultState {
  vaults: Vault[];
  currentVaultId: string | null;
  loading: boolean;
  error: string | null;
  // New: Storage provider state
  providers: StorageProvider[];
  defaultProvider: string | null;
  cloudVaults: CloudVault[];
  providersLoading: boolean;
  providersError: string | null;
}
```

### 3.2 Storage Provider Slice

```typescript
// src/redux/actions/storage.ts
export interface StorageState {
  providers: StorageProvider[];
  defaultProvider: string | null;
  cloudVaults: Record<string, CloudVault[]>; // providerName -> vaults
  loading: {
    providers: boolean;
    vaults: Record<string, boolean>;
    authentication: Record<string, boolean>;
  };
  errors: {
    providers: string | null;
    vaults: Record<string, string | null>;
    authentication: Record<string, string | null>;
  };
  oauth: {
    pendingAuth: string | null;
    authWindow: Window | null;
  };
}
```

## 4. Service Layer Architecture

### 4.1 Cloud Storage Commands

```typescript
// src/services/cloud-storage.ts
export class CloudStorageCommands {
  // Provider Management
  static async listProviders(): Promise<StorageProvider[]>;
  static async addProvider(request: AddProviderRequest): Promise<void>;
  static async removeProvider(name: string): Promise<void>;
  static async setDefaultProvider(name: string): Promise<void>;
  static async authenticateProvider(providerName?: string): Promise<void>;
  
  // Cloud Vault Operations
  static async listCloudVaults(providerName?: string): Promise<CloudVault[]>;
  static async createCloudVault(request: CreateCloudVaultRequest): Promise<string>;
  static async readCloudVault(request: CloudVaultOperation): Promise<VaultContent>;
  static async updateCloudVault(request: UpdateCloudVaultRequest): Promise<void>;
  static async deleteCloudVault(request: Omit<CloudVaultOperation, 'password'>): Promise<void>;
  
  // File Operations
  static async listFiles(folderId?: string, providerName?: string): Promise<StorageFile[]>;
  static async createFile(request: CreateFileRequest, providerName?: string): Promise<StorageFile>;
  static async readFile(fileId: string, providerName?: string): Promise<Uint8Array>;
  static async updateFile(request: UpdateFileRequest, providerName?: string): Promise<StorageFile>;
  static async deleteFile(fileId: string, providerName?: string): Promise<void>;
}
```

### 4.2 Enhanced Vault Manager

```typescript
// src/services/vault.ts (extended)
export class VaultInstance {
  // Existing methods...
  
  // New cloud-specific methods
  async unlockCloud(password: string, providerName?: string): Promise<void>;
  async saveToCloud(providerName?: string): Promise<void>;
  async moveToCloud(targetProvider: string): Promise<void>;
  async moveToLocal(localPath: string): Promise<void>;
  
  // Unified save method
  private async _saveVault(): Promise<void> {
    if (this.vault.storageType === StorageProviderType.LOCAL) {
      await this._saveLocalVault();
    } else {
      await this._saveCloudVault();
    }
  }
  
  private async _saveCloudVault(): Promise<void> {
    // Implementation for cloud vault saving
  }
}

export class VaultManager {
  // Existing methods...
  
  // New cloud-specific methods
  async createCloudVault(
    name: string, 
    password: string, 
    providerName: string
  ): Promise<VaultInstance>;
  
  async importCloudVault(
    cloudVault: CloudVault, 
    password: string
  ): Promise<VaultInstance>;
  
  async syncVault(vaultId: string): Promise<void>;
}
```

### 4.3 OAuth Service

```typescript
// src/services/oauth.ts
export class OAuthService {
  static async initiateGoogleDriveAuth(providerName: string): Promise<void>;
  static async handleOAuthCallback(code: string, state: string): Promise<OAuthTokenResponse>;
  static async refreshToken(providerName: string): Promise<OAuthTokenResponse>;
  static async revokeToken(providerName: string): Promise<void>;
  
  private static generateOAuthState(providerName: string): string;
  private static validateOAuthState(state: string): OAuthState | null;
  private static openAuthWindow(url: string): Promise<Window>;
}
```

## 5. UI Component Hierarchy

### 5.1 Storage Management Components

```
src/components/Storage/
├── StorageProviderList.tsx          # List all configured providers
├── StorageProviderCard.tsx          # Individual provider card
├── AddProviderModal.tsx             # Add new storage provider
├── GoogleDriveSetup.tsx             # Google Drive specific setup
├── OAuthWebView.tsx                 # In-app OAuth browser
├── CloudVaultList.tsx               # List cloud vaults
├── CloudVaultCard.tsx               # Individual cloud vault card
└── StorageSettings.tsx              # Storage settings page
```

### 5.2 Enhanced Vault Components

```
src/components/Vault/Forms/
├── AddVaultForm.tsx (enhanced)      # Support storage location selection
├── StorageLocationSelector.tsx      # Choose local vs cloud storage
├── CloudVaultForm.tsx               # Cloud vault specific fields
└── ProviderSelector.tsx             # Select storage provider

src/components/Vault/Modals/
├── AddVaultModal.tsx (enhanced)     # Support cloud vault creation
├── CloudVaultModal.tsx              # Cloud vault operations
├── OAuthModal.tsx                   # OAuth flow modal
└── StorageProviderModal.tsx         # Provider management modal
```

### 5.3 Enhanced Vault Context

```typescript
// src/components/Vault/VaultContext.tsx (extended)
interface VaultModalState {
  // Existing modal states...
  
  // New cloud storage modals
  isAddProviderModalOpen: boolean;
  isOAuthModalOpen: boolean;
  isCloudVaultModalOpen: boolean;
  selectedProvider: StorageProvider | null;
  oauthProvider: string | null;
}

interface VaultModalActions {
  // Existing actions...
  
  // New cloud storage actions
  openAddProviderModal: () => void;
  closeAddProviderModal: () => void;
  openOAuthModal: (providerName: string) => void;
  closeOAuthModal: () => void;
  openCloudVaultModal: (provider?: string) => void;
  closeCloudVaultModal: () => void;
  setSelectedProvider: (provider: StorageProvider | null) => void;
}
```

## 6. OAuth WebView Integration Strategy

### 6.1 In-App Browser Implementation

```typescript
// src/components/Storage/OAuthWebView.tsx
export const OAuthWebView: React.FC<{
  authUrl: string;
  onSuccess: (tokens: OAuthTokenResponse) => void;
  onError:
(error: string) => void;
  onClose: () => void;
}> = ({ authUrl, onSuccess, onError, onClose }) => {
  const [webview, setWebview] = useState<WebviewWindow | null>(null);
  
  useEffect(() => {
    const createWebView = async () => {
      const webView = new WebviewWindow('oauth-auth', {
        url: authUrl,
        width: 500,
        height: 600,
        resizable: true,
        decorations: true,
      });
      
      // Listen for navigation events
      await webView.listen('tauri://url-change', (event) => {
        const url = event.payload as string;
        handleUrlChange(url);
      });
      
      setWebview(webView);
    };
    
    createWebView();
    
    return () => {
      webview?.close();
    };
  }, [authUrl]);
  
  const handleUrlChange = (url: string) => {
    // Handle OAuth callback
    if (url.includes('/oauth/callback')) {
      const urlParams = new URLSearchParams(url.split('?')[1]);
      const code = urlParams.get('code');
      const state = urlParams.get('state');
      const error = urlParams.get('error');
      
      if (error) {
        onError(error);
      } else if (code && state) {
        handleOAuthCallback(code, state);
      }
    }
  };
  
  const handleOAuthCallback = async (code: string, state: string) => {
    try {
      const tokens = await OAuthService.handleOAuthCallback(code, state);
      onSuccess(tokens);
      webview?.close();
    } catch (error) {
      onError(String(error));
    }
  };
  
  return null; // WebView is managed by Tauri
};
```

### 6.2 OAuth Flow Management

```typescript
// src/services/oauth-flow-manager.ts
export class OAuthFlowManager {
  private static activeFlows = new Map<string, OAuthState>();
  
  static async initiateFlow(providerName: string): Promise<void> {
    const state = this.generateOAuthState(providerName);
    this.activeFlows.set(state.state, state);
    
    const authUrl = this.buildAuthUrl(providerName, state);
    
    // Open OAuth modal with WebView
    const context = getVaultModalContext();
    context.openOAuthModal(providerName);
    
    // Store auth URL for WebView
    context.setOAuthUrl(authUrl);
  }
  
  static async completeFlow(code: string, state: string): Promise<OAuthTokenResponse> {
    const oauthState = this.activeFlows.get(state);
    if (!oauthState) {
      throw new Error('Invalid OAuth state');
    }
    
    try {
      const tokens = await OAuthService.handleOAuthCallback(code, state);
      
      // Update provider configuration
      await this.updateProviderTokens(oauthState.providerName, tokens);
      
      return tokens;
    } finally {
      this.activeFlows.delete(state);
    }
  }
  
  private static generateOAuthState(providerName: string): OAuthState {
    return {
      state: crypto.randomUUID(),
      providerName,
      timestamp: Date.now(),
    };
  }
}
```

## 7. Vault Creation Flow with Storage Location Selection

### 7.1 Enhanced Add Vault Form

```typescript
// src/components/Vault/Forms/AddVaultForm.tsx (enhanced)
export const AddVaultForm = ({ onSuccess, onCancel, vault }: AddVaultFormProps) => {
  const [storageType, setStorageType] = useState<StorageProviderType>(StorageProviderType.LOCAL);
  const [selectedProvider, setSelectedProvider] = useState<string>('');
  const [vaultName, setVaultName] = useState('');
  const [password, setPassword] = useState('');
  const [filePath, setFilePath] = useState('');
  
  const providers = useSelector((state: RootState) => state.storage.providers);
  const dispatch = useDispatch();
  
  const handleSubmit = async () => {
    if (storageType === StorageProviderType.LOCAL) {
      await handleCreateLocalVault();
    } else {
      await handleCreateCloudVault();
    }
  };
  
  const handleCreateCloudVault = async () => {
    try {
      const vaultContent = {
        updated_at: new Date().toISOString(),
        hmac: '',
        entries: [],
      };
      
      const cloudVaultId = await CloudStorageCommands.createCloudVault({
        vaultName,
        password,
        vaultContent,
        providerName: selectedProvider,
      });
      
      const newVault: Vault = {
        id: generateVaultId(),
        name: vaultName,
        path: cloudVaultId, // Use cloud vault ID as path
        storageType: StorageProviderType.GOOGLE_DRIVE,
        providerName: selectedProvider,
        cloudVaultId,
        isLocked: false,
        volatile: {
          credential: password,
          entries: [],
          navigationPath: '/',
        },
      };
      
      dispatch(addVault(newVault));
      onSuccess();
    } catch (error) {
      setError(String(error));
    }
  };
  
  return (
    <div className="space-y-4 p-4">
      <h3 className="font-bold text-lg">
        {isEditMode ? t('editVault.title') : t('addVault.title')}
      </h3>
      
      {/* Storage Type Selection */}
      <div className="form-control">
        <label className="label">
          <span className="label-text">{t('addVault.storageType')}</span>
        </label>
        <select
          className="select select-bordered"
          value={storageType}
          onChange={(e) => setStorageType(e.target.value as StorageProviderType)}
          disabled={isEditMode}
        >
          <option value={StorageProviderType.LOCAL}>{t('addVault.localStorage')}</option>
          <option value={StorageProviderType.GOOGLE_DRIVE}>{t('addVault.googleDrive')}</option>
        </select>
      </div>
      
      {/* Provider Selection for Cloud Storage */}
      {storageType === StorageProviderType.GOOGLE_DRIVE && (
        <div className="form-control">
          <label className="label">
            <span className="label-text">{t('addVault.storageProvider')}</span>
          </label>
          <select
            className="select select-bordered"
            value={selectedProvider}
            onChange={(e) => setSelectedProvider(e.target.value)}
          >
            <option value="">{t('addVault.selectProvider')}</option>
            {providers
              .filter(p => p.type === StorageProviderType.GOOGLE_DRIVE && p.isAuthenticated)
              .map(provider => (
                <option key={provider.name} value={provider.name}>
                  {provider.name}
                </option>
              ))}
          </select>
          {!selectedProvider && (
            <div className="text-xs text-base-content opacity-60 mt-1">
              {t('addVault.setupProviderFirst')}
            </div>
          )}
        </div>
      )}
      
      {/* Rest of the form remains similar... */}
    </div>
  );
};
```

### 7.2 Storage Location Selector Component

```typescript
// src/components/Vault/Forms/StorageLocationSelector.tsx
export const StorageLocationSelector: React.FC<{
  storageType: StorageProviderType;
  onStorageTypeChange: (type: StorageProviderType) => void;
  selectedProvider: string;
  onProviderChange: (provider: string) => void;
  disabled?: boolean;
}> = ({ storageType, onStorageTypeChange, selectedProvider, onProviderChange, disabled }) => {
  const providers = useSelector((state: RootState) => state.storage.providers);
  const { t } = useTranslation('home');
  
  const availableProviders = providers.filter(
    p => p.type === storageType && p.isAuthenticated
  );
  
  return (
    <div className="space-y-4">
      <div className="form-control">
        <label className="label">
          <span className="label-text">{t('addVault.storageType')}</span>
        </label>
        <div className="join">
          <button
            className={`join-item btn ${storageType === StorageProviderType.LOCAL ? 'btn-primary' : 'btn-outline'}`}
            onClick={() => onStorageTypeChange(StorageProviderType.LOCAL)}
            disabled={disabled}
          >
            {t('addVault.localStorage')}
          </button>
          <button
            className={`join-item btn ${storageType === StorageProviderType.GOOGLE_DRIVE ? 'btn-primary' : 'btn-outline'}`}
            onClick={() => onStorageTypeChange(StorageProviderType.GOOGLE_DRIVE)}
            disabled={disabled}
          >
            {t('addVault.googleDrive')}
          </button>
        </div>
      </div>
      
      {storageType === StorageProviderType.GOOGLE_DRIVE && (
        <div className="form-control">
          <label className="label">
            <span className="label-text">{t('addVault.storageProvider')}</span>
          </label>
          {availableProviders.length > 0 ? (
            <select
              className="select select-bordered"
              value={selectedProvider}
              onChange={(e) => onProviderChange(e.target.value)}
              disabled={disabled}
            >
              <option value="">{t('addVault.selectProvider')}</option>
              {availableProviders.map(provider => (
                <option key={provider.name} value={provider.name}>
                  {provider.name}
                </option>
              ))}
            </select>
          ) : (
            <div className="alert alert-warning">
              <svg xmlns="http://www.w3.org/2000/svg" className="stroke-current shrink-0 h-6 w-6" fill="none" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
              <span>{t('addVault.noGoogleDriveProviders')}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
```

## 8. Backward Compatibility Approach

### 8.1 Migration Strategy

```typescript
// src/services/vault-migration.ts
export class VaultMigrationService {
  static async migrateLocalToCloud(
    vaultId: string, 
    targetProvider: string
  ): Promise<void> {
    const vaultManager = VaultManager.getInstance();
    const vaultInstance = vaultManager.getInstance(vaultId);
    
    if (!vaultInstance) {
      throw new Error('Vault not found');
    }
    
    const vault = vaultInstance.vault;
    
    // Ensure vault is unlocked
    if (vault.isLocked) {
      throw new Error('Vault must be unlocked to migrate');
    }
    
    try {
      // Create cloud vault with current content
      const vaultContent = {
        updated_at: new Date().toISOString(),
        hmac: '',
        entries: vault.volatile.entries,
      };
      
      const cloudVaultId = await CloudStorageCommands.createCloudVault({
        vaultName: vault.name,
        password: vault.volatile.credential,
        vaultContent,
        providerName: targetProvider,
      });
      
      // Update vault metadata to reflect cloud storage
      const updatedVault: Vault = {
        ...vault,
        storageType: StorageProviderType.GOOGLE_DRIVE,
        providerName: targetProvider,
        cloudVaultId,
        path: cloudVaultId,
      };
      
      // Update Redux state
      const dispatch = store.dispatch;
      dispatch(updateVault(updatedVault));
      
      // Optionally delete local file after successful migration
      // await VaultCommands.delete(vault.path);
      
    } catch (error) {
      throw new Error(`Migration failed: ${error}`);
    }
  }
  
  static async migrateCloudToLocal(
    vaultId: string, 
    localPath: string
  ): Promise<void> {
    const vaultManager = VaultManager.getInstance();
    const vaultInstance = vaultManager.getInstance(vaultId);
    
    if (!vaultInstance) {
      throw new Error('Vault not found');
    }
    
    const vault = vaultInstance.vault;
    
    if (vault.storageType !== StorageProviderType.GOOGLE_DRIVE) {
      throw new Error('Vault is not a cloud vault');
    }
    
    try {
      // Create local vault with current content
      const vaultContent = {
        updated_at: new Date().toISOString(),
        hmac: '',
        entries: vault.volatile.entries,
      };
      
      await VaultCommands.write(localPath, vault.volatile.credential, vaultContent);
      
      // Update vault metadata to reflect local storage
      const updatedVault: Vault = {
        ...vault,
        storageType: StorageProviderType.LOCAL,
        providerName: undefined,
        cloudVaultId: undefined,
        path: localPath,
      };
      
      // Update Redux state
      const dispatch = store.dispatch;
      dispatch(updateVault(updatedVault));
      
      // Optionally delete cloud vault after successful migration
      // if (vault.cloudVaultId && vault.providerName) {
      //   await CloudStorageCommands.deleteCloudVault({
      //     vaultId: vault.cloudVaultId,
      //     providerName: vault.providerName,
      //   });
      // }
      
    } catch (error) {
      throw new Error(`Migration failed: ${error}`);
    }
  }
}
```

### 8.2 Automatic Vault Detection

```typescript
// src/services/vault-detector.ts
export class VaultDetector {
  static async detectVaultType(vaultPath: string): Promise<{
    type: StorageProviderType;
    providerName?: string;
    cloudVaultId?: string;
  }> {
    // Check if path looks like a cloud vault ID
    if (this.isCloudVaultId(vaultPath)) {
      return {
        type: StorageProviderType.GOOGLE_DRIVE,
        cloudVaultId: vaultPath,
      };
    }
    
    // Check if it's a local file path
    if (await this.isLocalFile(vaultPath)) {
      return {
        type: StorageProviderType.LOCAL,
      };
    }
    
    // Default to local for unknown paths
    return {
      type: StorageProviderType.LOCAL,
    };
  }
  
  private static isCloudVaultId(path: string): boolean {
    // Cloud vault IDs are typically UUIDs or similar identifiers
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    return uuidRegex.test(path);
  }
  
  private static async isLocalFile(path: string): Promise<boolean> {
    try {
      // Check if file exists locally
      await fs.access(path);
      return true;
    } catch {
      return false;
    }
  }
}
```

## 9. Error Handling and Loading States

### 9.1 Async Operation Management

```typescript
// src/hooks/useAsyncOperation.ts
export const useAsyncOperation = <T, Args extends any[]>(
  operation: (...args: Args) => Promise<T>
) => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<T | null>(null);
  
  const execute = useCallback(async (...args: Args) => {
    setLoading(true);
    setError(null);
    
    try {
      const result = await operation(...args);
      setData(result);
      return result;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      setError(errorMessage);
      throw err;
    } finally {
      setLoading(false);
    }
  }, [operation]);
  
  const reset = useCallback(() => {
    setLoading(false);
    setError(null);
    setData(null);
  }, []);
  
  return { execute, loading, error, data, reset };
};
```

### 9.2 Cloud Storage Error Types

```typescript
// src/interfaces/errors.interface.ts
export enum CloudStorageErrorType {
  AUTHENTICATION_FAILED = 'AUTHENTICATION_FAILED',
  TOKEN_EXPIRED = 'TOKEN_EXPIRED',
  NETWORK_ERROR = 'NETWORK_ERROR',
  QUOTA_EXCEEDED = 'QUOTA_EXCEEDED',
  VAULT_NOT_FOUND = 'VAULT_NOT_FOUND',
  PERMISSION_DENIED = 'PERMISSION_DENIED',
  PROVIDER_NOT_CONFIGURED = 'PROVIDER_NOT_CONFIGURED',
  INVALID_CREDENTIALS = 'INVALID_CREDENTIALS',
}

export class CloudStorageError extends Error {
  constructor(
    public type: CloudStorageErrorType,
    message: string,
    public providerName?: string,
    public originalError?: Error
  ) {
    super(message);
    this.name = 'CloudStorageError';
  }
}

export const handleCloudStorageError = (error: any): CloudStorageError => {
  if (error instanceof CloudStorageError) {
    return error;
  }
  
  // Parse common error patterns
  const message = String(error).toLowerCase();
  
  if (message.includes('authentication') || message.includes('unauthorized')) {
    return new CloudStorageError(
      CloudStorageErrorType.AUTHENTICATION_FAILED,
      'Authentication failed. Please re-authenticate with the storage provider.'
    );
  }
  
  if (message.includes('token') && message.includes('expired')) {
    return new CloudStorageError(
      CloudStorageErrorType.TOKEN_EXPIRED,
      'Authentication token has expired. Please re-authenticate.'
    );
  }
  
  if (message.includes('network') || message.includes('connection')) {
    return new CloudStorageError(
      CloudStorageErrorType.NETWORK_ERROR,
      'Network error. Please check your internet connection and try again.'
    );
  }
  
  if (message.includes('quota') || message.includes('storage')) {
    return new CloudStorageError(
      CloudStorageErrorType.QUOTA_EXCEEDED,
      'Storage quota exceeded. Please free up space or upgrade your storage plan.'
    );
  }
  
  // Default error
  return new CloudStorageError(
    CloudStorageErrorType.NETWORK_ERROR,
    'An unexpected error occurred. Please try again.',
    undefined,
    error instanceof Error ? error : new Error(String(error))
  );
};
```

## 10. Implementation Roadmap

### Phase 1: Foundation (Week 1-2)
1. **Type Definitions**: Create all TypeScript interfaces
2. **Redux Setup**: Implement storage provider slice and enhance vault slice
3. **Service Layer**: Implement CloudStorageCommands and OAuthService
4. **Basic UI**: Create storage provider management components

### Phase 2: OAuth Integration (Week 3)
1. **WebView Implementation**: Create OAuthWebView component
2. **OAuth Flow**: Implement complete OAuth flow with state management
3. **Provider Setup**: Create Google Drive setup flow
4. **Authentication**: Implement token refresh and error handling

### Phase 3: Vault Operations (Week 4-5)
1. **Cloud Vault CRUD**: Implement create, read, update, delete operations
2. **Enhanced Vault Manager**: Add cloud-specific methods to VaultManager
3. **Vault Creation**: Update AddVaultForm with storage location selection
4. **Migration Tools**: Implement vault migration utilities

### Phase 4: UI Polish (Week 6)
1. **Storage Settings**: Create comprehensive storage settings page
2. **Cloud Vault List**: Implement cloud vault browsing and management
3. **Error Handling**: Add comprehensive error states and user feedback
4. **Loading States**: Implement proper loading indicators for all async operations

### Phase 5: Testing & Refinement (Week 7-8)
1. **Unit Tests**: Test all new services and components
2. **Integration Tests**: Test complete cloud storage workflows
3. **User Testing**: Gather feedback and refine UX
4. **Documentation**: Update user documentation and help content

## 11. Security Considerations

### 11.1 Token Security
- Store OAuth tokens securely using Tauri's secure storage
- Implement automatic token refresh before expiration
- Clear tokens from memory when not in use
- Use short-lived access tokens with refresh token rotation

### 11.2 Data Protection
- Maintain end-to-end encryption for vault data
- Never store passwords in plain text
- Validate all cloud storage operations
- Implement proper error handling to prevent data leakage

### 11.3 Network Security
- Use HTTPS for all OAuth and API communications
- Validate SSL certificates
- Implement request timeouts and retry logic
- Sanitize all user inputs before API calls

## 12. Performance Optimizations

### 12.1 Caching Strategy
- Cache provider authentication status
- Cache cloud vault metadata (not content)
- Implement intelligent sync intervals
- Use background sync for non-critical operations

### 12.2 Lazy Loading
- Load cloud vault list on-demand
- Implement progressive loading for large vault lists
- Cache frequently accessed vaults in memory
- Use pagination for large datasets

### 12.3 Offline Support
- Detect network connectivity
- Queue operations for when online
- Provide clear offline indicators
- Allow read-only access to cached vault data

This comprehensive architecture plan provides a solid foundation for integrating Google Drive cloud storage while maintaining the security, performance, and user experience standards of the Monark password manager.