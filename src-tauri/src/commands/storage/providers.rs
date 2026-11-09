use super::StorageState;
use crate::commands::errors::CommandError;
use crate::storage::providers::{
    CreateFileRequest, CreateFolderRequest, StorageFile, UpdateFileRequest,
};
use crate::storage::{ProviderConfig, StorageConfig, StorageManager};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tauri::State;

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

/// Build the storage manager from the default configuration.
pub async fn init_storage_manager() -> Arc<StorageManager> {
    let config = StorageConfig::default();
    Arc::new(
        StorageManager::new(config)
            .await
            .expect("Failed to initialize storage manager"),
    )
}

#[tauri::command]
pub async fn list_providers(
    state: State<'_, StorageState>,
) -> Result<Vec<ProviderInfo>, CommandError> {
    let providers = state.manager.list_providers().await;
    let default_provider = state.manager.get_default_provider().await;

    let mut provider_infos = Vec::new();
    for provider_name in providers {
        let config = state.manager.get_config().await;
        if let Some(provider_config) = config.get_provider_config(&provider_name) {
            let provider_type = match provider_config {
                ProviderConfig::Local { .. } => "local".to_string(),
                ProviderConfig::GoogleDrive { .. } => "google_drive".to_string(),
                ProviderConfig::WebDav { .. } => "webdav".to_string(),
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
    state
        .manager
        .add_provider(request.name, request.config)
        .await
        .map_err(|_e| CommandError::Io("Failed to add provider".to_string()))?;
    Ok(())
}

#[tauri::command]
pub async fn remove_provider(
    name: String,
    state: State<'_, StorageState>,
) -> Result<(), CommandError> {
    if name == "local" {
        return Err(CommandError::Io(
            "Cannot remove the local provider".to_string(),
        ));
    }

    if name == crate::storage::MONARK_DEFAULT_PROVIDER_NAME {
        return Err(CommandError::Io(
            "Cannot remove the default Monark provider".to_string(),
        ));
    }

    state
        .manager
        .remove_provider(&name)
        .await
        .map_err(|_e| CommandError::Io("Failed to remove provider".to_string()))?;
    Ok(())
}

#[tauri::command]
pub async fn set_default_provider(
    name: String,
    state: State<'_, StorageState>,
) -> Result<(), CommandError> {
    state
        .manager
        .set_default_provider(name)
        .await
        .map_err(|_e| CommandError::Io("Failed to set default provider".to_string()))?;
    Ok(())
}

#[tauri::command]
pub async fn authenticate_provider(
    provider_name: Option<String>,
    state: State<'_, StorageState>,
) -> Result<(), CommandError> {
    state
        .manager
        .authenticate(provider_name)
        .await
        .map_err(|_e| CommandError::Io("Failed to authenticate provider".to_string()))?;
    Ok(())
}

fn provider_config_is_authenticated(provider_config: &ProviderConfig) -> bool {
    match provider_config {
        ProviderConfig::GoogleDrive { config } => config.has_usable_credentials(),
        ProviderConfig::WebDav { config } => {
            // WebDAV uses Basic auth — authenticated if credentials are present
            !config.username.is_empty() && !config.password.is_empty()
        }
        // Local provider doesn't need authentication
        ProviderConfig::Local { .. } => true,
    }
}

#[tauri::command]
pub async fn check_provider_auth_status(
    provider_name: String,
    state: State<'_, StorageState>,
) -> Result<bool, CommandError> {
    let config = state.manager.get_config().await;

    Ok(config
        .get_provider_config(&provider_name)
        .map(provider_config_is_authenticated)
        .unwrap_or(false))
}

#[tauri::command]
pub async fn list_files(
    folder_id: Option<String>,
    provider_name: Option<String>,
    state: State<'_, StorageState>,
) -> Result<Vec<StorageFile>, CommandError> {
    state
        .manager
        .list_files(folder_id, provider_name)
        .await
        .map_err(|_e| CommandError::Io("Failed to list files".to_string()))
}

#[tauri::command]
pub async fn create_file(
    request: CreateFileRequestDto,
    provider_name: Option<String>,
    state: State<'_, StorageState>,
) -> Result<StorageFile, CommandError> {
    let create_request = CreateFileRequest::from(request);
    state
        .manager
        .create_file(create_request, provider_name)
        .await
        .map_err(|_e| CommandError::Io("Failed to create file".to_string()))
}

#[tauri::command]
pub async fn read_file(
    file_id: String,
    provider_name: Option<String>,
    state: State<'_, StorageState>,
) -> Result<Vec<u8>, CommandError> {
    state
        .manager
        .read_file(file_id, provider_name)
        .await
        .map_err(|_e| CommandError::Io("Failed to read file".to_string()))
}

#[tauri::command]
pub async fn delete_file(
    file_id: String,
    provider_name: Option<String>,
    state: State<'_, StorageState>,
) -> Result<(), CommandError> {
    state
        .manager
        .delete_file(file_id, provider_name)
        .await
        .map_err(|_e| CommandError::Io("Failed to delete file".to_string()))?;
    Ok(())
}

#[tauri::command]
pub async fn update_file(
    request: UpdateFileRequestDto,
    provider_name: Option<String>,
    state: State<'_, StorageState>,
) -> Result<StorageFile, CommandError> {
    let update_request = UpdateFileRequest::from(request);
    state
        .manager
        .update_file(update_request, provider_name)
        .await
        .map_err(|_e| CommandError::Io("Failed to update file".to_string()))
}

#[tauri::command]
pub async fn create_folder(
    request: CreateFolderRequestDto,
    provider_name: Option<String>,
    state: State<'_, StorageState>,
) -> Result<StorageFile, CommandError> {
    let create_request = CreateFolderRequest::from(request);
    state
        .manager
        .create_folder(create_request, provider_name)
        .await
        .map_err(|_e| CommandError::Io("Failed to create folder".to_string()))
}

#[tauri::command]
pub async fn delete_folder(
    folder_id: String,
    provider_name: Option<String>,
    state: State<'_, StorageState>,
) -> Result<(), CommandError> {
    state
        .manager
        .delete_folder(folder_id, provider_name)
        .await
        .map_err(|_e| CommandError::Io("Failed to delete folder".to_string()))?;
    Ok(())
}

#[tauri::command]
pub async fn get_file_info(
    file_id: String,
    provider_name: Option<String>,
    state: State<'_, StorageState>,
) -> Result<StorageFile, CommandError> {
    state
        .manager
        .get_file_info(file_id, provider_name)
        .await
        .map_err(|_e| CommandError::Io("Failed to get file info".to_string()))
}

#[tauri::command]
pub async fn search_files(
    query: String,
    provider_name: Option<String>,
    state: State<'_, StorageState>,
) -> Result<Vec<StorageFile>, CommandError> {
    state
        .manager
        .search_files(query, provider_name)
        .await
        .map_err(|_e| CommandError::Io("Failed to search files".to_string()))
}

#[tauri::command]
pub async fn list_vaults(
    provider_name: Option<String>,
    state: State<'_, StorageState>,
) -> Result<Vec<StorageFile>, CommandError> {
    state
        .manager
        .list_vaults(provider_name)
        .await
        .map_err(|_e| CommandError::Io("Failed to list vaults".to_string()))
}

#[cfg(test)]
mod auth_status_tests {
    use super::provider_config_is_authenticated;
    use crate::storage::providers::google_drive::GoogleDriveConfig;
    use crate::storage::providers::webdav::WebDavConfig;
    use crate::storage::ProviderConfig;
    use chrono::{Duration, Utc};

    fn google_drive_config(
        access_token: Option<&str>,
        refresh_token: Option<&str>,
    ) -> GoogleDriveConfig {
        GoogleDriveConfig {
            client_id: "client_id".to_string(),
            client_secret: "client_secret".to_string(),
            redirect_uri: "http://localhost/callback".to_string(),
            access_token: access_token.map(str::to_string),
            refresh_token: refresh_token.map(str::to_string),
            // Always already expired: the point of these tests is that the
            // access token TTL must not decide the auth status.
            token_expires_at: Some(Utc::now() - Duration::minutes(10)),
        }
    }

    fn webdav_config(username: &str, password: &str) -> WebDavConfig {
        WebDavConfig {
            server_url: "https://example.com".to_string(),
            username: username.to_string(),
            password: password.to_string(),
            base_path: "/".to_string(),
        }
    }

    #[test]
    fn google_drive_with_expired_access_token_and_refresh_token_is_authenticated() {
        let provider_config = ProviderConfig::GoogleDrive {
            config: google_drive_config(Some("expired_access"), Some("refresh_token")),
        };

        assert!(
            provider_config_is_authenticated(&provider_config),
            "an expired access token with a refresh token only needs a silent refresh"
        );
    }

    #[test]
    fn google_drive_with_only_refresh_token_is_authenticated() {
        let provider_config = ProviderConfig::GoogleDrive {
            config: google_drive_config(None, Some("refresh_token")),
        };

        assert!(provider_config_is_authenticated(&provider_config));
    }

    #[test]
    fn google_drive_without_any_credentials_is_not_authenticated() {
        let provider_config = ProviderConfig::GoogleDrive {
            config: google_drive_config(None, None),
        };

        assert!(!provider_config_is_authenticated(&provider_config));
    }

    #[test]
    fn google_drive_with_expired_access_token_and_no_refresh_token_is_not_authenticated() {
        let provider_config = ProviderConfig::GoogleDrive {
            config: google_drive_config(Some("expired_access"), None),
        };

        assert!(!provider_config_is_authenticated(&provider_config));
    }

    #[test]
    fn webdav_requires_both_username_and_password() {
        assert!(provider_config_is_authenticated(&ProviderConfig::WebDav {
            config: webdav_config("user", "pass"),
        }));
        assert!(!provider_config_is_authenticated(&ProviderConfig::WebDav {
            config: webdav_config("user", ""),
        }));
    }

    #[test]
    fn local_provider_is_always_authenticated() {
        assert!(provider_config_is_authenticated(&ProviderConfig::Local {
            base_path: "/tmp".to_string(),
        }));
    }
}
