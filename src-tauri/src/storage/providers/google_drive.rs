use super::{
    CreateFileRequest, CreateFolderRequest, StorageFile, StorageProvider, StorageProviderType,
    UpdateFileRequest,
};
use crate::storage::{StorageError, StorageResult};
use async_trait::async_trait;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::OnceLock;
use tauri_plugin_http::reqwest;

const GOOGLE_DRIVE_API_BASE: &str = "https://www.googleapis.com/drive/v3";
const GOOGLE_DRIVE_UPLOAD_API_BASE: &str = "https://www.googleapis.com/upload/drive/v3";

/// Maximum number of retry attempts for token refresh
const MAX_REFRESH_RETRIES: u32 = 3;
/// Initial delay for exponential backoff (in milliseconds)
const INITIAL_RETRY_DELAY_MS: u64 = 1000;
/// Maximum delay for exponential backoff (in milliseconds)
const MAX_RETRY_DELAY_MS: u64 = 10000;

fn oauth_token_url() -> String {
    // Test-only override for integration tests.
    // Keeps production behavior stable while letting tests point the refresh flow
    // at a local mock server.
    #[cfg(test)]
    {
        if let Ok(url) = std::env::var("MONARK_GOOGLE_OAUTH_TOKEN_URL") {
            return url;
        }
    }

    "https://oauth2.googleapis.com/token".to_string()
}

// Static HTTP client for connection pooling and reuse
static HTTP_CLIENT: OnceLock<reqwest::Client> = OnceLock::new();

/// Get or create the shared HTTP client
fn get_http_client() -> &'static reqwest::Client {
    HTTP_CLIENT.get_or_init(|| {
        reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(30))
            .user_agent("Monark-App/1.0")
            .build()
            .expect("Failed to create HTTP client")
    })
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GoogleDriveConfig {
    pub client_id: String,
    pub client_secret: String,
    pub redirect_uri: String,
    pub access_token: Option<String>,
    pub refresh_token: Option<String>,
    pub token_expires_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone)]
pub struct GoogleDriveProvider {
    config: GoogleDriveConfig,
}

#[derive(Debug, Serialize, Deserialize)]
struct OAuthTokenResponse {
    access_token: String,
    refresh_token: Option<String>,
    expires_in: u64,
    token_type: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GoogleDriveFile {
    id: String,
    name: String,
    parents: Option<Vec<String>>,
    size: Option<String>,
    created_time: Option<DateTime<Utc>>,
    modified_time: Option<DateTime<Utc>>,
    mime_type: Option<String>,
    kind: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GoogleDriveFileList {
    files: Vec<GoogleDriveFile>,
    next_page_token: Option<String>,
}

impl GoogleDriveProvider {
    pub fn new(config: GoogleDriveConfig) -> Self {
        Self { config }
    }

    pub fn with_tokens(access_token: String, refresh_token: String, expires_in: u64) -> Self {
        let config = GoogleDriveConfig {
            client_id: String::new(),
            client_secret: String::new(),
            redirect_uri: String::new(),
            access_token: Some(access_token),
            refresh_token: Some(refresh_token),
            token_expires_at: Some(Utc::now() + chrono::Duration::seconds(expires_in as i64)),
        };
        Self::new(config)
    }

    pub async fn ensure_valid_token(&mut self) -> StorageResult<()> {
        if self.is_token_expired() {
            self.refresh_access_token().await?;
        }
        Ok(())
    }

    pub fn is_token_expired(&self) -> bool {
        if let (Some(_token), Some(expires_at)) =
            (&self.config.access_token, &self.config.token_expires_at)
        {
            Utc::now() >= *expires_at - chrono::Duration::minutes(5)
        } else {
            true
        }
    }

    pub fn get_config(&self) -> &GoogleDriveConfig {
        &self.config
    }

    pub fn update_config(&mut self, config: GoogleDriveConfig) {
        self.config = config;
    }

    pub async fn refresh_access_token(&mut self) -> StorageResult<()> {
        let refresh_token = self
            .config
            .refresh_token
            .as_ref()
            .ok_or_else(|| StorageError::authentication("No refresh token available"))?;

        let params = [
            ("client_id", self.config.client_id.as_str()),
            ("client_secret", self.config.client_secret.as_str()),
            ("refresh_token", refresh_token.as_str()),
            ("grant_type", "refresh_token"),
        ];

        let token_url = oauth_token_url();

        let mut attempt = 0;
        let client = get_http_client();

        loop {
            attempt += 1;
            println!(
                "[Google Drive] Token refresh triggered (attempt {}/{})",
                attempt, MAX_REFRESH_RETRIES
            );

            match client.post(&token_url).form(&params).send().await {
                Ok(response) => {
                    let status = response.status();
                    if !status.is_success() {
                        let error_text = response
                            .text()
                            .await
                            .unwrap_or_else(|_| "Unknown error".to_string());
                        let error_msg = format!(
                            "Failed to refresh access token ({}): {}",
                            status, error_text
                        );
                        if attempt >= MAX_REFRESH_RETRIES {
                            println!(
                                "[Google Drive] Token refresh failed after {} attempts: {}",
                                attempt, error_msg
                            );
                            return Err(StorageError::authentication(error_msg));
                        }
                        println!(
                            "[Google Drive] Token refresh failed (attempt {}): {}",
                            attempt, error_msg
                        );
                        let delay_ms = std::cmp::min(
                            INITIAL_RETRY_DELAY_MS * (2_u64.pow(attempt - 1)),
                            MAX_RETRY_DELAY_MS,
                        );
                        tokio::time::sleep(std::time::Duration::from_millis(delay_ms)).await;
                        continue;
                    }

                    match response.json::<OAuthTokenResponse>().await {
                        Ok(token_response) => {
                            self.config.access_token = Some(token_response.access_token.clone());
                            self.config.token_expires_at = Some(
                                Utc::now()
                                    + chrono::Duration::seconds(token_response.expires_in as i64),
                            );

                            if let Some(refresh_token) = token_response.refresh_token {
                                self.config.refresh_token = Some(refresh_token);
                            }
                            println!("[Google Drive] Token refresh succeeded");
                            return Ok(());
                        }
                        Err(e) => {
                            let error_msg = format!("Failed to parse token response: {}", e);
                            if attempt >= MAX_REFRESH_RETRIES {
                                println!(
                                    "[Google Drive] Token refresh failed after {} attempts: {}",
                                    attempt, error_msg
                                );
                                return Err(StorageError::network(error_msg));
                            }
                            println!(
                                "[Google Drive] Token refresh failed (attempt {}): {}",
                                attempt, error_msg
                            );
                            let delay_ms = std::cmp::min(
                                INITIAL_RETRY_DELAY_MS * (2_u64.pow(attempt - 1)),
                                MAX_RETRY_DELAY_MS,
                            );
                            tokio::time::sleep(std::time::Duration::from_millis(delay_ms)).await;
                            continue;
                        }
                    }
                }
                Err(e) => {
                    let error_msg = format!("Network error during token refresh: {}", e);
                    if attempt >= MAX_REFRESH_RETRIES {
                        println!(
                            "[Google Drive] Token refresh failed after {} attempts: {}",
                            attempt, error_msg
                        );
                        return Err(StorageError::network(error_msg));
                    }
                    println!(
                        "[Google Drive] Token refresh failed (attempt {}): {}",
                        attempt, error_msg
                    );
                    let delay_ms = std::cmp::min(
                        INITIAL_RETRY_DELAY_MS * (2_u64.pow(attempt - 1)),
                        MAX_RETRY_DELAY_MS,
                    );
                    tokio::time::sleep(std::time::Duration::from_millis(delay_ms)).await;
                    continue;
                }
            }
        }
    }

    /// Refresh access token for a given config and return the updated config
    /// This is used to ensure token refreshes are persisted even when providers are created per-operation
    pub async fn refresh_access_token_for_config(
        config: GoogleDriveConfig,
    ) -> StorageResult<GoogleDriveConfig> {
        let refresh_token = config
            .refresh_token
            .as_ref()
            .ok_or_else(|| StorageError::authentication("No refresh token available"))?;

        let params = [
            ("client_id", config.client_id.as_str()),
            ("client_secret", config.client_secret.as_str()),
            ("refresh_token", refresh_token.as_str()),
            ("grant_type", "refresh_token"),
        ];

        let token_url = oauth_token_url();

        let mut attempt = 0;
        let client = get_http_client();

        loop {
            attempt += 1;
            println!(
                "[Google Drive] Token refresh triggered for config (attempt {}/{})",
                attempt, MAX_REFRESH_RETRIES
            );

            match client.post(&token_url).form(&params).send().await {
                Ok(response) => {
                    let status = response.status();
                    if !status.is_success() {
                        let error_text = response
                            .text()
                            .await
                            .unwrap_or_else(|_| "Unknown error".to_string());
                        let error_msg = format!(
                            "Failed to refresh access token ({}): {}",
                            status, error_text
                        );
                        if attempt >= MAX_REFRESH_RETRIES {
                            println!(
                                "[Google Drive] Token refresh failed after {} attempts: {}",
                                attempt, error_msg
                            );
                            return Err(StorageError::authentication(error_msg));
                        }
                        println!(
                            "[Google Drive] Token refresh failed (attempt {}): {}",
                            attempt, error_msg
                        );
                        let delay_ms = std::cmp::min(
                            INITIAL_RETRY_DELAY_MS * (2_u64.pow(attempt - 1)),
                            MAX_RETRY_DELAY_MS,
                        );
                        tokio::time::sleep(std::time::Duration::from_millis(delay_ms)).await;
                        continue;
                    }

                    match response.json::<OAuthTokenResponse>().await {
                        Ok(token_response) => {
                            let mut new_config = config;
                            new_config.access_token = Some(token_response.access_token);
                            new_config.token_expires_at = Some(
                                Utc::now()
                                    + chrono::Duration::seconds(token_response.expires_in as i64),
                            );

                            if let Some(refresh_token) = token_response.refresh_token {
                                new_config.refresh_token = Some(refresh_token);
                            }
                            println!("[Google Drive] Token refresh succeeded for config");
                            return Ok(new_config);
                        }
                        Err(e) => {
                            let error_msg = format!("Failed to parse token response: {}", e);
                            if attempt >= MAX_REFRESH_RETRIES {
                                println!(
                                    "[Google Drive] Token refresh failed after {} attempts: {}",
                                    attempt, error_msg
                                );
                                return Err(StorageError::network(error_msg));
                            }
                            println!(
                                "[Google Drive] Token refresh failed (attempt {}): {}",
                                attempt, error_msg
                            );
                            let delay_ms = std::cmp::min(
                                INITIAL_RETRY_DELAY_MS * (2_u64.pow(attempt - 1)),
                                MAX_RETRY_DELAY_MS,
                            );
                            tokio::time::sleep(std::time::Duration::from_millis(delay_ms)).await;
                            continue;
                        }
                    }
                }
                Err(e) => {
                    let error_msg = format!("Network error during token refresh: {}", e);
                    if attempt >= MAX_REFRESH_RETRIES {
                        println!(
                            "[Google Drive] Token refresh failed after {} attempts: {}",
                            attempt, error_msg
                        );
                        return Err(StorageError::network(error_msg));
                    }
                    println!(
                        "[Google Drive] Token refresh failed (attempt {}): {}",
                        attempt, error_msg
                    );
                    let delay_ms = std::cmp::min(
                        INITIAL_RETRY_DELAY_MS * (2_u64.pow(attempt - 1)),
                        MAX_RETRY_DELAY_MS,
                    );
                    tokio::time::sleep(std::time::Duration::from_millis(delay_ms)).await;
                    continue;
                }
            }
        }
    }

    pub fn get_auth_headers(&self) -> StorageResult<HashMap<String, String>> {
        let access_token = self
            .config
            .access_token
            .as_ref()
            .ok_or_else(|| StorageError::authentication("No access token available"))?;

        let mut headers = HashMap::new();
        headers.insert(
            "Authorization".to_string(),
            format!("Bearer {}", access_token),
        );
        Ok(headers)
    }

    fn google_file_to_storage_file(&self, google_file: GoogleDriveFile) -> StorageFile {
        let is_folder = google_file
            .mime_type
            .as_ref()
            .map_or(false, |mime| mime == "application/vnd.google-apps.folder");

        let path = if let Some(parents) = &google_file.parents {
            if let Some(parent_id) = parents.first() {
                format!("/{}/{}", parent_id, google_file.name)
            } else {
                format!("/{}", google_file.name)
            }
        } else {
            format!("/{}", google_file.name)
        };

        let mut metadata = HashMap::new();
        metadata.insert("kind".to_string(), google_file.kind);

        StorageFile {
            id: google_file.id.clone(),
            name: google_file.name.clone(),
            path,
            size: google_file.size.and_then(|s| s.parse().ok()),
            created_at: google_file.created_time,
            modified_at: google_file.modified_time,
            is_folder,
            mime_type: google_file.mime_type,
            parent_id: google_file.parents.and_then(|p| p.first().cloned()),
            metadata,
        }
    }
}

#[async_trait]
impl StorageProvider for GoogleDriveProvider {
    fn provider_type(&self) -> StorageProviderType {
        StorageProviderType::GoogleDrive
    }

    async fn authenticate(&mut self) -> StorageResult<()> {
        if self.config.access_token.is_none() {
            return Err(StorageError::authentication(
                "No access token - OAuth flow required",
            ));
        }

        self.ensure_valid_token().await?;

        let headers = self.get_auth_headers()?;
        let client = get_http_client();
        let response = client
            .get(&format!("{}/about", GOOGLE_DRIVE_API_BASE))
            .header("Authorization", &headers["Authorization"])
            .query(&[("fields", "user")])
            .send()
            .await
            .map_err(|e| {
                StorageError::network(format!("Failed to verify authentication: {}", e))
            })?;

        if response.status().is_success() {
            Ok(())
        } else {
            Err(StorageError::authentication("Invalid access token"))
        }
    }

    async fn is_authenticated(&self) -> bool {
        self.config.access_token.is_some() && !self.is_token_expired()
    }

    async fn list_files(&mut self, folder_id: Option<String>) -> StorageResult<Vec<StorageFile>> {
        // Ensure token is valid before making API call
        self.ensure_valid_token().await?;

        let headers = self.get_auth_headers()?;

        let query = if let Some(folder_id) = folder_id {
            format!("'{}' in parents and trashed=false", folder_id)
        } else {
            "'root' in parents and trashed=false".to_string()
        };

        let client = get_http_client();
        let response = client
            .get(&format!("{}/files", GOOGLE_DRIVE_API_BASE))
            .header("Authorization", &headers["Authorization"])
            .query(&[
                ("q", query.as_str()),
                (
                    "fields",
                    "files(id,name,parents,size,createdTime,modifiedTime,mimeType,kind)",
                ),
            ])
            .send()
            .await
            .map_err(|e| StorageError::network(format!("Failed to list files: {}", e)))?;

        let status = response.status();
        if !status.is_success() {
            let error_text = response
                .text()
                .await
                .unwrap_or_else(|_| "Unknown error".to_string());
            return Err(StorageError::operation_failed(format!(
                "Failed to list files ({}): {}",
                status, error_text
            )));
        }

        let file_list: GoogleDriveFileList = response
            .json()
            .await
            .map_err(|e| StorageError::network(format!("Failed to parse file list: {}", e)))?;

        Ok(file_list
            .files
            .into_iter()
            .map(|f| self.google_file_to_storage_file(f))
            .collect())
    }

    async fn create_file(&mut self, request: CreateFileRequest) -> StorageResult<StorageFile> {
        // Ensure token is valid before making API call
        self.ensure_valid_token().await?;

        let headers = self.get_auth_headers()?;

        let mut metadata = serde_json::Map::new();
        metadata.insert(
            "name".to_string(),
            serde_json::Value::String(request.name.clone()),
        );
        if let Some(parent_id) = &request.parent_id {
            metadata.insert(
                "parents".to_string(),
                serde_json::Value::Array(vec![serde_json::Value::String(parent_id.clone())]),
            );
        }

        let metadata_str = serde_json::to_string(&metadata)?;
        let file_name = request.name.clone(); // Clone the name to avoid lifetime issues
        let form = reqwest::multipart::Form::new()
            .part(
                "metadata",
                reqwest::multipart::Part::text(metadata_str)
                    .file_name("metadata.json")
                    .mime_str("application/json")
                    .map_err(|e| {
                        StorageError::network(format!("Failed to create multipart part: {}", e))
                    })?,
            )
            .part(
                "file",
                reqwest::multipart::Part::bytes(request.content)
                    .file_name(file_name) // Use the cloned value
                    .mime_str(
                        request
                            .mime_type
                            .as_deref()
                            .unwrap_or("application/octet-stream"),
                    )
                    .map_err(|e| {
                        StorageError::network(format!("Failed to create multipart part: {}", e))
                    })?,
            );

        let client = get_http_client();
        let response = client
            .post(&format!("{}/files", GOOGLE_DRIVE_UPLOAD_API_BASE))
            .header("Authorization", &headers["Authorization"])
            .query(&[("uploadType", "multipart")])
            .multipart(form)
            .send()
            .await
            .map_err(|e| StorageError::network(format!("Failed to create file: {}", e)))?;

        if !response.status().is_success() {
            return Err(StorageError::operation_failed("Failed to create file"));
        }

        let google_file: GoogleDriveFile = response
            .json()
            .await
            .map_err(|e| StorageError::network(format!("Failed to parse created file: {}", e)))?;

        Ok(self.google_file_to_storage_file(google_file))
    }

    async fn read_file(&mut self, file_id: String) -> StorageResult<Vec<u8>> {
        // Ensure token is valid before making API call
        self.ensure_valid_token().await?;

        let headers = self.get_auth_headers()?;

        let client = get_http_client();
        let response = client
            .get(&format!("{}/files/{}", GOOGLE_DRIVE_API_BASE, file_id))
            .header("Authorization", &headers["Authorization"])
            .query(&[("alt", "media")])
            .send()
            .await
            .map_err(|e| StorageError::network(format!("Failed to read file: {}", e)))?;

        if !response.status().is_success() {
            return Err(StorageError::file_not_found(file_id));
        }

        Ok(response
            .bytes()
            .await
            .map_err(|e| StorageError::network(format!("Failed to read file content: {}", e)))?
            .to_vec())
    }

    async fn delete_file(&mut self, file_id: String) -> StorageResult<()> {
        // Ensure token is valid before making API call
        self.ensure_valid_token().await?;

        let headers = self.get_auth_headers()?;

        let client = get_http_client();
        let response = client
            .delete(&format!("{}/files/{}", GOOGLE_DRIVE_API_BASE, file_id))
            .header("Authorization", &headers["Authorization"])
            .send()
            .await
            .map_err(|e| StorageError::network(format!("Failed to delete file: {}", e)))?;

        if response.status().is_success() {
            Ok(())
        } else {
            Err(StorageError::operation_failed("Failed to delete file"))
        }
    }

    async fn update_file(&mut self, request: UpdateFileRequest) -> StorageResult<StorageFile> {
        // Ensure token is valid before making API call
        self.ensure_valid_token().await?;

        let headers = self.get_auth_headers()?;

        // For media upload, send raw bytes without multipart
        // See: https://developers.google.com/drive/api/guides/manage-uploads#simple
        let client = get_http_client();
        let response = client
            .patch(&format!(
                "{}/files/{}",
                GOOGLE_DRIVE_UPLOAD_API_BASE, request.id
            ))
            .header("Authorization", &headers["Authorization"])
            .header("Content-Type", "application/octet-stream")
            .query(&[("uploadType", "media")])
            .body(request.content)
            .send()
            .await
            .map_err(|e| StorageError::network(format!("Failed to update file: {}", e)))?;

        if !response.status().is_success() {
            let error_text = response
                .text()
                .await
                .unwrap_or_else(|_| "Unknown error".to_string());
            return Err(StorageError::operation_failed(format!(
                "Failed to update file: {}",
                error_text
            )));
        }

        let google_file: GoogleDriveFile = response
            .json()
            .await
            .map_err(|e| StorageError::network(format!("Failed to parse updated file: {}", e)))?;

        Ok(self.google_file_to_storage_file(google_file))
    }

    async fn create_folder(&mut self, request: CreateFolderRequest) -> StorageResult<StorageFile> {
        // Ensure token is valid before making API call
        self.ensure_valid_token().await?;

        let headers = self.get_auth_headers()?;

        let mut metadata = serde_json::Map::new();
        metadata.insert(
            "name".to_string(),
            serde_json::Value::String(request.name.clone()),
        );
        metadata.insert(
            "mimeType".to_string(),
            serde_json::Value::String("application/vnd.google-apps.folder".to_string()),
        );
        if let Some(parent_id) = &request.parent_id {
            metadata.insert(
                "parents".to_string(),
                serde_json::Value::Array(vec![serde_json::Value::String(parent_id.clone())]),
            );
        }

        let client = get_http_client();
        let response = client
            .post(&format!("{}/files", GOOGLE_DRIVE_API_BASE))
            .header("Authorization", &headers["Authorization"])
            .json(&metadata)
            .send()
            .await
            .map_err(|e| StorageError::network(format!("Failed to create folder: {}", e)))?;

        if !response.status().is_success() {
            return Err(StorageError::operation_failed("Failed to create folder"));
        }

        let google_file: GoogleDriveFile = response
            .json()
            .await
            .map_err(|e| StorageError::network(format!("Failed to parse created folder: {}", e)))?;

        Ok(self.google_file_to_storage_file(google_file))
    }

    async fn delete_folder(&mut self, folder_id: String) -> StorageResult<()> {
        self.delete_file(folder_id).await
    }

    async fn get_file_info(&mut self, file_id: String) -> StorageResult<StorageFile> {
        // Ensure token is valid before making API call
        self.ensure_valid_token().await?;

        let headers = self.get_auth_headers()?;

        let client = get_http_client();
        let response = client
            .get(&format!("{}/files/{}", GOOGLE_DRIVE_API_BASE, file_id))
            .header("Authorization", &headers["Authorization"])
            .query(&[(
                "fields",
                "id,name,parents,size,createdTime,modifiedTime,mimeType,kind",
            )])
            .send()
            .await
            .map_err(|e| StorageError::network(format!("Failed to get file info: {}", e)))?;

        if !response.status().is_success() {
            return Err(StorageError::file_not_found(file_id));
        }

        let google_file: GoogleDriveFile = response
            .json()
            .await
            .map_err(|e| StorageError::network(format!("Failed to parse file info: {}", e)))?;

        Ok(self.google_file_to_storage_file(google_file))
    }

    async fn search_files(&mut self, query: String) -> StorageResult<Vec<StorageFile>> {
        // Ensure token is valid before making API call
        self.ensure_valid_token().await?;

        let headers = self.get_auth_headers()?;

        // Use exact name match with "name = 'query'" for more precise results
        // This prevents returning "vaults_backup" when searching for "vaults"
        let search_query = format!("name = '{}' and trashed=false", query);

        let client = get_http_client();
        let response = client
            .get(&format!("{}/files", GOOGLE_DRIVE_API_BASE))
            .header("Authorization", &headers["Authorization"])
            .query(&[
                ("q", search_query.as_str()),
                (
                    "fields",
                    "files(id,name,parents,size,createdTime,modifiedTime,mimeType,kind)",
                ),
            ])
            .send()
            .await
            .map_err(|e| StorageError::network(format!("Failed to search files: {}", e)))?;

        if !response.status().is_success() {
            return Err(StorageError::operation_failed("Failed to search files"));
        }

        let file_list: GoogleDriveFileList = response
            .json()
            .await
            .map_err(|e| StorageError::network(format!("Failed to parse search results: {}", e)))?;

        Ok(file_list
            .files
            .into_iter()
            .map(|f| self.google_file_to_storage_file(f))
            .collect())
    }

    async fn list_vaults(&mut self) -> StorageResult<Vec<StorageFile>> {
        // For Google Drive, we need to find the vault folder first, then list files in it
        // This uses the existing cloud logic for Google Drive
        self.ensure_valid_token().await?;

        let headers = self.get_auth_headers()?;

        // Search for the vault folder
        let vault_folder_name = "Monark"; // Default vault folder name
        let search_query = format!(
            "name = '{}' and mimeType = 'application/vnd.google-apps.folder' and trashed=false",
            vault_folder_name
        );

        let client = get_http_client();
        let response = client
            .get(&format!("{}/files", GOOGLE_DRIVE_API_BASE))
            .header("Authorization", &headers["Authorization"])
            .query(&[
                ("q", search_query.as_str()),
                (
                    "fields",
                    "files(id,name,parents,size,createdTime,modifiedTime,mimeType,kind)",
                ),
            ])
            .send()
            .await
            .map_err(|e| {
                StorageError::network(format!("Failed to search for vault folder: {}", e))
            })?;

        if !response.status().is_success() {
            return Err(StorageError::operation_failed(
                "Failed to search for vault folder",
            ));
        }

        let file_list: GoogleDriveFileList = response.json().await.map_err(|e| {
            StorageError::network(format!(
                "Failed to parse vault folder search results: {}",
                e
            ))
        })?;

        // If no vault folder found, return empty list
        let vault_folder_id = if let Some(folder) = file_list.files.first() {
            folder.id.clone()
        } else {
            return Ok(Vec::new());
        };

        // Now list files in the vault folder and filter by .monark extension in Rust
        // Note: Google Drive API doesn't support "ends with" operator, so we filter locally
        let vault_query = format!("'{}' in parents and trashed=false", vault_folder_id);

        let response = client
            .get(&format!("{}/files", GOOGLE_DRIVE_API_BASE))
            .header("Authorization", &headers["Authorization"])
            .query(&[
                ("q", vault_query.as_str()),
                (
                    "fields",
                    "files(id,name,parents,size,createdTime,modifiedTime,mimeType,kind)",
                ),
            ])
            .send()
            .await
            .map_err(|e| StorageError::network(format!("Failed to list vault files: {}", e)))?;

        if !response.status().is_success() {
            return Err(StorageError::operation_failed("Failed to list vault files"));
        }

        let file_list: GoogleDriveFileList = response.json().await.map_err(|e| {
            StorageError::network(format!("Failed to parse vault files list: {}", e))
        })?;

        Ok(file_list
            .files
            .into_iter()
            .filter(|f| f.name.ends_with(".monark"))
            .map(|f| self.google_file_to_storage_file(f))
            .collect())
    }
}
