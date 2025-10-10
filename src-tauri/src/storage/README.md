# Modular Storage System

This module provides a modular storage system that allows multiple cloud/storage vendors to be used interchangeably. The system is designed around a common `StorageProvider` trait that defines the interface for all storage operations.

## Architecture

### Core Components

1. **StorageProvider Trait**: Defines the common interface for all storage providers
2. **StorageManager**: Manages multiple storage providers and provides high-level operations
3. **Provider Implementations**: Concrete implementations for different storage backends
4. **Configuration System**: Manages provider configurations and settings

### Supported Providers

- **Local Storage**: File system-based storage using `LocalStorageProvider`
- **Google Drive**: Cloud storage using `GoogleDriveProvider` (requires OAuth2 setup)

## Usage Examples

### Basic Storage Operations

```rust
use monark_lib::storage::{StorageManager, StorageConfig};
use monark_lib::storage::providers::{CreateFileRequest, CreateFolderRequest};

// Initialize storage manager with local storage
let config = StorageConfig::new_local("/path/to/storage".to_string());
let manager = StorageManager::new(config)?;

// Create a folder
let folder_request = CreateFolderRequest {
    name: "my_folder".to_string(),
    path: "/my_folder".to_string(),
    parent_id: None,
    metadata: None,
};
let created_folder = manager.create_folder(folder_request, None).await?;

// Create a file
let file_request = CreateFileRequest {
    name: "example.txt".to_string(),
    path: "/my_folder/example.txt".to_string(),
    content: b"Hello, World!".to_vec(),
    parent_id: Some(created_folder.id),
    mime_type: Some("text/plain".to_string()),
    metadata: None,
};
let created_file = manager.create_file(file_request, None).await?;

// Read file content
let content = manager.read_file(created_file.id, None).await?;
println!("File content: {}", String::from_utf8(content)?);
```

### Google Drive Integration

```rust
use monark_lib::storage::{StorageConfig, ProviderConfig};
use monark_lib::storage::providers::GoogleDriveConfig;

// Configure Google Drive provider
let google_drive_config = GoogleDriveConfig {
    client_id: "your_client_id".to_string(),
    client_secret: "your_client_secret".to_string(),
    redirect_uri: "http://localhost:8080/callback".to_string(),
    access_token: Some("access_token".to_string()),
    refresh_token: Some("refresh_token".to_string()),
    token_expires_at: Some(chrono::Utc::now() + chrono::Duration::hours(1)),
};

let mut config = StorageConfig::new_local("/local/path".to_string());
config = config.with_google_drive(google_drive_config);

let manager = StorageManager::new(config)?;

// Set Google Drive as default provider
manager.set_default_provider("google_drive".to_string()).await?;

// Authenticate with Google Drive
manager.authenticate(Some("google_drive".to_string())).await?;

// Use Google Drive for storage operations
let vaults = manager.list_vaults(Some("google_drive".to_string())).await?;
```

### Vault Operations

```rust
use monark_lib::storage::StorageManager;

// List all vaults from the default provider
let vaults = manager.list_vaults(None).await?;

// Ensure vault folder exists
let vault_folder_id = manager.ensure_vault_folder(None).await?;

// Create a new vault file
let vault_request = CreateFileRequest {
    name: "my_vault.monark".to_string(),
    path: "/vaults/my_vault.monark".to_string(),
    content: vault_data, // Encrypted vault data
    parent_id: Some(vault_folder_id),
    mime_type: Some("application/octet-stream".to_string()),
    metadata: None,
};
let vault_file = manager.create_file(vault_request, None).await?;
```

## Tauri Commands

The storage system exposes the following Tauri commands for frontend integration:

### Provider Management
- `list_providers`: List all configured storage providers
- `add_provider`: Add a new storage provider
- `remove_provider`: Remove a storage provider
- `set_default_provider`: Set the default storage provider
- `authenticate_provider`: Authenticate with a storage provider

### File Operations
- `list_files`: List files in a folder
- `create_file`: Create a new file
- `read_file`: Read file content
- `update_file`: Update an existing file
- `delete_file`: Delete a file
- `get_file_info`: Get file metadata
- `search_files`: Search for files

### Folder Operations
- `create_folder`: Create a new folder
- `delete_folder`: Delete a folder

### Vault Operations
- `list_vaults`: List all vault files
- `write_cloud_vault`: Write a vault to cloud storage
- `read_cloud_vault`: Read a vault from cloud storage
- `delete_cloud_vault`: Delete a vault from cloud storage

## Frontend Integration

### TypeScript Interfaces

```typescript
interface StorageFile {
  id: string;
  name: string;
  path: string;
  size?: number;
  created_at?: string;
  modified_at?: string;
  is_folder: boolean;
  mime_type?: string;
  parent_id?: string;
  metadata: Record<string, string>;
}

interface ProviderInfo {
  name: string;
  provider_type: string;
  is_default: boolean;
}

interface CreateFileRequest {
  name: string;
  path: string;
  content: ArrayBuffer;
  parent_id?: string;
  mime_type?: string;
  metadata?: Record<string, string>;
}
```

### Example Usage in React

```typescript
import { invoke } from '@tauri-apps/api/tauri';

// List available providers
const providers = await invoke<ProviderInfo[]>('list_providers');

// Add Google Drive provider
await invoke('add_provider', {
  name: 'google_drive',
  config: {
    type: 'google_drive',
    config: {
      client_id: 'your_client_id',
      client_secret: 'your_client_secret',
      // ... other config
    }
  }
});

// Authenticate with Google Drive
await invoke('authenticate_provider', { providerName: 'google_drive' });

// List vaults
const vaults = await invoke<StorageFile[]>('list_vaults', {
  providerName: 'google_drive'
});

// Create a new vault
const vaultId = await invoke<string>('write_cloud_vault', {
  vaultName: 'my_vault',
  password: 'secure_password',
  vaultContent: vaultData,
  providerName: 'google_drive'
});
```

## Security Considerations

1. **Token Management**: OAuth2 tokens are stored in memory and refreshed automatically
2. **Encryption**: All vault data is encrypted before storage
3. **Access Control**: Providers authenticate before allowing operations
4. **Error Handling**: All operations include proper error handling and logging

## Testing

Run the storage system tests:

```bash
cargo test storage::tests::test_local_storage_provider
cargo test storage::tests::test_storage_manager
cargo test storage::tests::test_vault_folder_operations
```

## Extending the System

To add a new storage provider:

1. Implement the `StorageProvider` trait for your provider
2. Add the provider to the `ProviderConfig` enum
3. Update the `StorageManager::create_provider_from_config` method
4. Add any necessary configuration structures

Example:

```rust
use async_trait::async_trait;
use monark_lib::storage::providers::*;

#[derive(Debug, Clone)]
pub struct MyCustomProvider {
    // Your provider configuration
}

#[async_trait]
impl StorageProvider for MyCustomProvider {
    fn provider_type(&self) -> StorageProviderType {
        StorageProviderType::Custom
    }

    async fn authenticate(&mut self) -> StorageResult<()> {
        // Implement authentication
    }

    // Implement other required methods...
}