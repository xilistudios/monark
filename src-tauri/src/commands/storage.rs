use crate::commands::errors::CommandError;
use crate::storage::{StorageManager, StorageConfig, ProviderConfig};
use crate::storage::providers::{CreateFileRequest, UpdateFileRequest, CreateFolderRequest, StorageFile};
use crate::storage::providers::google_drive::GoogleDriveConfig;
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tauri::State;
use chrono::Utc;

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
pub async fn check_provider_auth_status(
    provider_name: String,
    state: State<'_, StorageState>,
) -> Result<bool, CommandError> {
    let config = state.manager.get_config().await;

    if let Some(provider_config) = config.get_provider_config(&provider_name) {
        match provider_config {
            ProviderConfig::GoogleDrive { config } => {
                // Provider is authenticated if it has an access token
                Ok(config.access_token.is_some())
            }
            ProviderConfig::Local { .. } => {
                // Local provider doesn't need authentication
                Ok(true)
            }
        }
    } else {
        Ok(false)
    }
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

#[derive(Debug, Serialize, Deserialize)]
pub struct OAuthUrlResponse {
    pub url: String,
    pub state: String,
}

#[tauri::command]
pub async fn get_google_drive_oauth_url(
    provider_name: String,
    state: State<'_, StorageState>,
) -> Result<OAuthUrlResponse, CommandError> {
    // Get the provider config
    let config = state.manager.get_config().await;
    let provider_config = config.get_provider_config(&provider_name)
        .ok_or_else(|| CommandError::Io("Provider not found".to_string()))?;

    match provider_config {
        ProviderConfig::GoogleDrive { config: gd_config } => {
            // Generate a random state for CSRF protection
            let oauth_state = format!("{}", uuid::Uuid::new_v4());

            // Build OAuth URL
            let scopes = "https://www.googleapis.com/auth/drive.file";
            let auth_url = format!(
                "https://accounts.google.com/o/oauth2/v2/auth?client_id={}&redirect_uri={}&response_type=code&scope={}&access_type=offline&state={}&prompt=consent",
                urlencoding::encode(&gd_config.client_id),
                urlencoding::encode(&gd_config.redirect_uri),
                urlencoding::encode(scopes),
                &oauth_state
            );

            Ok(OAuthUrlResponse {
                url: auth_url,
                state: oauth_state,
            })
        }
        _ => Err(CommandError::Io("Provider is not Google Drive".to_string())),
    }
}

#[derive(Debug, Serialize, Deserialize)]
pub struct OAuthCallbackRequest {
    pub provider_name: String,
    pub code: String,
    pub state: String,
}

#[tauri::command]
pub async fn handle_google_drive_oauth_callback(
    request: OAuthCallbackRequest,
    state: State<'_, StorageState>,
) -> Result<(), CommandError> {
    println!("OAuth callback received: provider={}, code={}, state={}",
        request.provider_name, &request.code[..10.min(request.code.len())], request.state);

    // Get the provider config
    let config = state.manager.get_config().await;
    let provider_config = config.get_provider_config(&request.provider_name)
        .ok_or_else(|| {
            println!("Provider not found: {}", request.provider_name);
            CommandError::Io("Provider not found".to_string())
        })?;

    let gd_config = match provider_config {
        ProviderConfig::GoogleDrive { config } => config.clone(),
        _ => {
            println!("Provider is not Google Drive: {}", request.provider_name);
            return Err(CommandError::Io("Provider is not Google Drive".to_string()));
        }
    };

    println!("Exchanging code for tokens with redirect_uri: {}", gd_config.redirect_uri);

    // Exchange authorization code for tokens
    let client = reqwest::Client::new();
    let params = [
        ("client_id", gd_config.client_id.as_str()),
        ("client_secret", gd_config.client_secret.as_str()),
        ("code", request.code.as_str()),
        ("redirect_uri", gd_config.redirect_uri.as_str()),
        ("grant_type", "authorization_code"),
    ];

    let response = client
        .post("https://oauth2.googleapis.com/token")
        .form(&params)
        .send()
        .await
        .map_err(|e| {
            println!("Failed to exchange code for tokens: {}", e);
            CommandError::Io(format!("Failed to exchange code for tokens: {}", e))
        })?;

    let status = response.status();
    println!("Token exchange response status: {}", status);

    if !status.is_success() {
        let error_text = response.text().await
            .unwrap_or_else(|_| "Unknown error".to_string());
        println!("Token exchange failed: {}", error_text);
        return Err(CommandError::Io(format!("Token exchange failed: {}", error_text)));
    }

    #[derive(Deserialize)]
    struct TokenResponse {
        access_token: String,
        refresh_token: Option<String>,
        expires_in: u64,
    }

    let token_response: TokenResponse = response.json().await
        .map_err(|e| {
            println!("Failed to parse token response: {}", e);
            CommandError::Io(format!("Failed to parse token response: {}", e))
        })?;

    println!("Tokens received successfully, expires_in: {}", token_response.expires_in);

    // Update the provider config with the new tokens
    let new_config = GoogleDriveConfig {
        client_id: gd_config.client_id,
        client_secret: gd_config.client_secret,
        redirect_uri: gd_config.redirect_uri,
        access_token: Some(token_response.access_token),
        refresh_token: token_response.refresh_token,
        token_expires_at: Some(Utc::now() + chrono::Duration::seconds(token_response.expires_in as i64)),
    };

    // Update the configuration
    state.manager.update_google_drive_config(&request.provider_name, new_config).await
        .map_err(|e| {
            println!("Failed to update provider config: {}", e);
            CommandError::Io(format!("Failed to update provider config: {}", e))
        })?;

    println!("OAuth callback completed successfully");
    Ok(())
}