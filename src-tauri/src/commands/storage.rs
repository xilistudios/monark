use crate::commands::errors::CommandError;
use crate::storage::{StorageManager, StorageConfig, ProviderConfig};
use crate::storage::providers::{CreateFileRequest, UpdateFileRequest, CreateFolderRequest, StorageFile};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tauri::State;

// Global state for storage manager
pub struct StorageState {
    pub manager: Arc<StorageManager>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ProviderInfo {
    pub name: String,
    pub provider_type: String,
    pub is_default: bool,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct AddProviderRequest {
    pub name: String,
    pub config: ProviderConfig,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct CreateFileRequestDto {
    pub name: String,
    pub path: String,
    pub content: Vec<u8>,
    pub parent_id: Option<String>,
    pub mime_type: Option<String>,
    pub metadata: Option<std::collections::HashMap<String, String>>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct UpdateFileRequestDto {
    pub id: String,
    pub content: Vec<u8>,
    pub metadata: Option<std::collections::HashMap<String, String>>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct CreateFolderRequestDto {
    pub name: String,
    pub path: String,
    pub parent_id: Option<String>,
    pub metadata: Option<std::collections::HashMap<String, String>>,
}

impl From<CreateFileRequestDto> for CreateFileRequest {
    fn from(dto: CreateFileRequestDto) -> Self {
        Self {
            name: dto.name,
            path: dto.path,
            content: dto.content,
            parent_id: dto.parent_id,
            mime_type: dto.mime_type,
            metadata: dto.metadata,
        }
    }
}

impl From<UpdateFileRequestDto> for UpdateFileRequest {
    fn from(dto: UpdateFileRequestDto) -> Self {
        Self {
            id: dto.id,
            content: dto.content,
            metadata: dto.metadata,
        }
    }
}

impl From<CreateFolderRequestDto> for CreateFolderRequest {
    fn from(dto: CreateFolderRequestDto) -> Self {
        Self {
            name: dto.name,
            path: dto.path,
            parent_id: dto.parent_id,
            metadata: dto.metadata,
        }
    }
}

// Initialize storage manager
pub async fn init_storage_manager() -> Arc<StorageManager> {
    let config = StorageConfig::default();
    Arc::new(StorageManager::new(config).await.expect("Failed to initialize storage manager"))
}

#[tauri::command]
pub async fn list_providers(state: State<'_, StorageState>) -> Result<Vec<ProviderInfo>, CommandError> {
    let providers = state.manager.list_providers().await;
    let default_provider = state.manager.get_default_provider().await;

    let mut provider_infos = Vec::new();
    for provider_name in providers {
        let config = state.manager.get_config().await;
        if let Some(provider_config) = config.get_provider_config(&provider_name) {
            let provider_type = match provider_config {
                ProviderConfig::Local { .. } => "local".to_string(),
                ProviderConfig::GoogleDrive { .. } => "google_drive".to_string(),
            };

            provider_infos.push(ProviderInfo {
                name: provider_name.clone(),
                provider_type,
                is_default: provider_name == default_provider,
            });
        }
    }

    Ok(provider_infos)
}

#[tauri::command]
pub async fn add_provider(
    request: AddProviderRequest,
    state: State<'_, StorageState>,
) -> Result<(), CommandError> {
    state.manager.add_provider(request.name, request.config).await
        .map_err(|e| CommandError::Io(format!("Failed to add provider: {}", e)))?;
    Ok(())
}

#[tauri::command]
pub async fn remove_provider(
    name: String,
    state: State<'_, StorageState>,
) -> Result<(), CommandError> {
    state.manager.remove_provider(&name).await
        .map_err(|e| CommandError::Io(format!("Failed to remove provider: {}", e)))?;
    Ok(())
}

#[tauri::command]
pub async fn set_default_provider(
    name: String,
    state: State<'_, StorageState>,
) -> Result<(), CommandError> {
    state.manager.set_default_provider(name).await
        .map_err(|e| CommandError::Io(format!("Failed to set default provider: {}", e)))?;
    Ok(())
}

#[tauri::command]
pub async fn authenticate_provider(
    provider_name: Option<String>,
    state: State<'_, StorageState>,
) -> Result<(), CommandError> {
    state.manager.authenticate(provider_name).await
        .map_err(|e| CommandError::Io(format!("Failed to authenticate provider: {}", e)))?;
    Ok(())
}

#[tauri::command]
pub async fn list_files(
    folder_id: Option<String>,
    provider_name: Option<String>,
    state: State<'_, StorageState>,
) -> Result<Vec<StorageFile>, CommandError> {
    state.manager.list_files(folder_id, provider_name).await
        .map_err(|e| CommandError::Io(format!("Failed to list files: {}", e)))
}

#[tauri::command]
pub async fn create_file(
    request: CreateFileRequestDto,
    provider_name: Option<String>,
    state: State<'_, StorageState>,
) -> Result<StorageFile, CommandError> {
    let create_request = CreateFileRequest::from(request);
    state.manager.create_file(create_request, provider_name).await
        .map_err(|e| CommandError::Io(format!("Failed to create file: {}", e)))
}

#[tauri::command]
pub async fn read_file(
    file_id: String,
    provider_name: Option<String>,
    state: State<'_, StorageState>,
) -> Result<Vec<u8>, CommandError> {
    state.manager.read_file(file_id, provider_name).await
        .map_err(|e| CommandError::Io(format!("Failed to read file: {}", e)))
}

#[tauri::command]
pub async fn delete_file(
    file_id: String,
    provider_name: Option<String>,
    state: State<'_, StorageState>,
) -> Result<(), CommandError> {
    state.manager.delete_file(file_id, provider_name).await
        .map_err(|e| CommandError::Io(format!("Failed to delete file: {}", e)))?;
    Ok(())
}

#[tauri::command]
pub async fn update_file(
    request: UpdateFileRequestDto,
    provider_name: Option<String>,
    state: State<'_, StorageState>,
) -> Result<StorageFile, CommandError> {
    let update_request = UpdateFileRequest::from(request);
    state.manager.update_file(update_request, provider_name).await
        .map_err(|e| CommandError::Io(format!("Failed to update file: {}", e)))
}

#[tauri::command]
pub async fn create_folder(
    request: CreateFolderRequestDto,
    provider_name: Option<String>,
    state: State<'_, StorageState>,
) -> Result<StorageFile, CommandError> {
    let create_request = CreateFolderRequest::from(request);
    state.manager.create_folder(create_request, provider_name).await
        .map_err(|e| CommandError::Io(format!("Failed to create folder: {}", e)))
}

#[tauri::command]
pub async fn delete_folder(
    folder_id: String,
    provider_name: Option<String>,
    state: State<'_, StorageState>,
) -> Result<(), CommandError> {
    state.manager.delete_folder(folder_id, provider_name).await
        .map_err(|e| CommandError::Io(format!("Failed to delete folder: {}", e)))?;
    Ok(())
}

#[tauri::command]
pub async fn get_file_info(
    file_id: String,
    provider_name: Option<String>,
    state: State<'_, StorageState>,
) -> Result<StorageFile, CommandError> {
    state.manager.get_file_info(file_id, provider_name).await
        .map_err(|e| CommandError::Io(format!("Failed to get file info: {}", e)))
}

#[tauri::command]
pub async fn search_files(
    query: String,
    provider_name: Option<String>,
    state: State<'_, StorageState>,
) -> Result<Vec<StorageFile>, CommandError> {
    state.manager.search_files(query, provider_name).await
        .map_err(|e| CommandError::Io(format!("Failed to search files: {}", e)))
}

#[tauri::command]
pub async fn list_vaults(
    provider_name: Option<String>,
    state: State<'_, StorageState>,
) -> Result<Vec<StorageFile>, CommandError> {
    state.manager.list_vaults(provider_name).await
        .map_err(|e| CommandError::Io(format!("Failed to list vaults: {}", e)))
}