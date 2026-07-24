use crate::commands::errors::CommandError;
use crate::storage::providers::google_drive::GoogleDriveConfig;
use crate::storage::providers::{
    CreateFileRequest, CreateFolderRequest, StorageFile, UpdateFileRequest,
};
use crate::storage::{ProviderConfig, StorageConfig, StorageManager};
use base64::Engine;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::{Arc, Mutex, OnceLock};
use std::time::Instant;
use tauri::State;

// Global state for storage manager
pub struct StorageState {
    pub manager: Arc<StorageManager>,
}

/// Pending OAuth state entry for CSRF protection and PKCE.
struct OAuthPendingState {
    created_at: Instant,
    code_verifier: String,
}

/// In-memory store for pending OAuth states (state → pending entry).
/// Entries expire after 5 minutes and are single-use.
fn oauth_state_store() -> &'static Mutex<HashMap<String, OAuthPendingState>> {
    static STORE: OnceLock<Mutex<HashMap<String, OAuthPendingState>>> = OnceLock::new();
    STORE.get_or_init(|| Mutex::new(HashMap::new()))
}

/// Generate a PKCE (code_verifier, code_challenge) pair using S256.
fn generate_pkce_pair() -> (String, String) {
    use rand::RngCore;
    use sha2::{Digest, Sha256};

    let mut verifier_bytes = [0u8; 32];
    rand::rngs::OsRng.fill_bytes(&mut verifier_bytes);
    let code_verifier = base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(verifier_bytes);

    let mut hasher = Sha256::new();
    hasher.update(code_verifier.as_bytes());
    let challenge_bytes = hasher.finalize();
    let code_challenge = base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(challenge_bytes);

    (code_verifier, code_challenge)
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

fn effective_google_drive_redirect_uri(config: &GoogleDriveConfig) -> String {
    config.redirect_uri.clone()
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

#[tauri::command]
pub async fn check_provider_auth_status(
    provider_name: String,
    state: State<'_, StorageState>,
) -> Result<bool, CommandError> {
    let config = state.manager.get_config().await;

    if let Some(provider_config) = config.get_provider_config(&provider_name) {
        match provider_config {
            ProviderConfig::GoogleDrive { config } => {
                // Provider is authenticated only if it has a non-expired access token
                Ok(config.access_token.is_some() && !config.is_token_expired())
            }
            ProviderConfig::WebDav { config } => {
                // WebDAV uses Basic auth — authenticated if credentials are present
                Ok(!config.username.is_empty() && !config.password.is_empty())
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
    let provider_config = config
        .get_provider_config(&provider_name)
        .ok_or_else(|| CommandError::Io("Provider not found".to_string()))?;

    match provider_config {
        ProviderConfig::GoogleDrive { config: gd_config } => {
            // Generate a random state for CSRF protection
            let oauth_state = format!("{}", uuid::Uuid::new_v4());

            // Generate PKCE pair
            let (code_verifier, code_challenge) = generate_pkce_pair();

            // Store state with code_verifier for later validation (5-min expiry)
            {
                let mut store = oauth_state_store().lock().unwrap();
                store.insert(
                    oauth_state.clone(),
                    OAuthPendingState {
                        created_at: Instant::now(),
                        code_verifier,
                    },
                );
            }

            // Build OAuth URL
            let scopes = "https://www.googleapis.com/auth/drive.file";
            // Only force consent prompt when we don't already have a refresh token,
            // so re-auth doesn't discard the existing one.
            let prompt_param = if gd_config.refresh_token.is_none() {
                "&prompt=consent"
            } else {
                ""
            };

            let auth_url = format!(
                "https://accounts.google.com/o/oauth2/v2/auth?client_id={}&redirect_uri={}&response_type=code&scope={}&access_type=offline&state={}&code_challenge={}&code_challenge_method=S256{}",
                urlencoding::encode(&gd_config.client_id),
                urlencoding::encode(&gd_config.redirect_uri),
                urlencoding::encode(scopes),
                &oauth_state,
                &code_challenge,
                prompt_param,
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
    println!(
        "OAuth callback received for provider: {}",
        request.provider_name
    );

    // Validate OAuth state (CSRF protection): must exist, not expired (5 min), single-use
    const STATE_EXPIRY: std::time::Duration = std::time::Duration::from_secs(300);
    let code_verifier = {
        let mut store = oauth_state_store().lock().unwrap();
        match store.remove(&request.state) {
            Some(entry) => {
                if entry.created_at.elapsed() > STATE_EXPIRY {
                    return Err(CommandError::Io(
                        "Invalid or expired OAuth state".to_string(),
                    ));
                }
                entry.code_verifier
            }
            None => {
                return Err(CommandError::Io(
                    "Invalid or expired OAuth state".to_string(),
                ));
            }
        }
    };

    // Get the provider config
    let config = state.manager.get_config().await;
    let provider_config = config
        .get_provider_config(&request.provider_name)
        .ok_or_else(|| CommandError::Io("Provider not found".to_string()))?;

    let gd_config = match provider_config {
        ProviderConfig::GoogleDrive { config } => config.clone(),
        _ => {
            return Err(CommandError::Io("Provider is not Google Drive".to_string()));
        }
    };

    let redirect_uri = effective_google_drive_redirect_uri(&gd_config);

    // Exchange authorization code for tokens (with PKCE code_verifier)
    let client = reqwest::Client::new();
    let params = [
        ("client_id", gd_config.client_id.as_str()),
        ("client_secret", gd_config.client_secret.as_str()),
        ("code", request.code.as_str()),
        ("redirect_uri", redirect_uri.as_str()),
        ("grant_type", "authorization_code"),
        ("code_verifier", code_verifier.as_str()),
    ];

    let response = client
        .post("https://oauth2.googleapis.com/token")
        .form(&params)
        .send()
        .await
        .map_err(|_e| CommandError::Io("Failed to exchange OAuth code".to_string()))?;

    let status = response.status();

    if !status.is_success() {
        let _error_text = response
            .text()
            .await
            .unwrap_or_else(|_| "Unknown error".to_string());
        return Err(CommandError::Io("OAuth token exchange failed".to_string()));
    }

    #[derive(Deserialize)]
    struct TokenResponse {
        access_token: String,
        refresh_token: Option<String>,
        expires_in: u64,
    }

    let token_response: TokenResponse = response
        .json()
        .await
        .map_err(|_e| CommandError::Io("Failed to parse token response".to_string()))?;

    // Update the provider config with the new tokens
    let new_config = GoogleDriveConfig {
        client_id: gd_config.client_id,
        client_secret: gd_config.client_secret,
        redirect_uri,
        access_token: Some(token_response.access_token),
        refresh_token: token_response.refresh_token.or(gd_config.refresh_token),
        token_expires_at: Some(
            Utc::now() + chrono::Duration::seconds(token_response.expires_in as i64),
        ),
    };

    // Update the configuration
    state
        .manager
        .update_google_drive_config(&request.provider_name, new_config)
        .await
        .map_err(|_e| CommandError::Io("Failed to update provider config".to_string()))?;

    Ok(())
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ProviderAuthInfo {
    pub authenticated: bool,
    pub token_expires_at: Option<DateTime<Utc>>,
}

#[tauri::command]
pub async fn get_provider_auth_info(
    provider_name: String,
    state: State<'_, StorageState>,
) -> Result<ProviderAuthInfo, CommandError> {
    let (authenticated, token_expires_at) = state
        .manager
        .get_provider_auth_info(&provider_name)
        .await
        .map_err(|_e| CommandError::Io("Failed to get provider auth info".to_string()))?;

    Ok(ProviderAuthInfo {
        authenticated,
        token_expires_at,
    })
}

#[tauri::command]
pub async fn refresh_provider_auth(
    provider_name: String,
    state: State<'_, StorageState>,
) -> Result<ProviderAuthInfo, CommandError> {
    // Ensure token is valid (will refresh if needed)
    let updated_config = state
        .manager
        .ensure_google_drive_token_valid(&provider_name)
        .await
        .map_err(|_e| CommandError::Io("Failed to refresh provider auth".to_string()))?;

    Ok(ProviderAuthInfo {
        authenticated: true,
        token_expires_at: updated_config.token_expires_at,
    })
}

#[tauri::command]
pub async fn test_webdav_connection(
    server_url: String,
    username: String,
    password: String,
    base_path: String,
) -> Result<bool, CommandError> {
    use crate::storage::providers::webdav::{WebDavConfig, WebDavProvider};
    use crate::storage::StorageProvider;
    let config = WebDavConfig {
        server_url,
        username,
        password,
        base_path,
    };
    let mut provider = WebDavProvider::new(config);
    match provider.authenticate().await {
        Ok(()) => Ok(true),
        Err(_e) => Err(CommandError::Io("WebDAV connection failed".to_string())),
    }
}
