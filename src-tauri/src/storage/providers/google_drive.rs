use super::{StorageProvider, StorageProviderType, StorageFile, CreateFileRequest, UpdateFileRequest, CreateFolderRequest};
use crate::storage::{StorageError, StorageResult};
use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use chrono::{DateTime, Utc};

const GOOGLE_DRIVE_API_BASE: &str = "https://www.googleapis.com/drive/v3";
const GOOGLE_DRIVE_UPLOAD_API_BASE: &str = "https://www.googleapis.com/upload/drive/v3";

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
    client: reqwest::Client,
}

#[derive(Debug, Serialize, Deserialize)]
struct OAuthTokenResponse {
    access_token: String,
    refresh_token: Option<String>,
    expires_in: u64,
    token_type: String,
}

#[derive(Debug, Serialize, Deserialize)]
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
struct GoogleDriveFileList {
    files: Vec<GoogleDriveFile>,
    next_page_token: Option<String>,
}

impl GoogleDriveProvider {
    pub fn new(config: GoogleDriveConfig) -> Self {
        Self {
            config,
            client: reqwest::Client::new(),
        }
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
        if let (Some(_token), Some(expires_at)) = (&self.config.access_token, &self.config.token_expires_at) {
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
        let refresh_token = self.config.refresh_token.as_ref()
            .ok_or_else(|| StorageError::authentication("No refresh token available"))?;

        let params = [
            ("client_id", self.config.client_id.as_str()),
            ("client_secret", self.config.client_secret.as_str()),
            ("refresh_token", refresh_token.as_str()),
            ("grant_type", "refresh_token"),
        ];

        let response = self.client
            .post("https://oauth2.googleapis.com/token")
            .form(&params)
            .send()
            .await
            .map_err(|e| StorageError::network(format!("Failed to refresh token: {}", e)))?;

        let status = response.status();
        if !status.is_success() {
            let error_text = response.text().await
                .unwrap_or_else(|_| "Unknown error".to_string());
            return Err(StorageError::authentication(
                format!("Failed to refresh access token ({}): {}", status, error_text)
            ));
        }

        let token_response: OAuthTokenResponse = response.json().await
            .map_err(|e| StorageError::network(format!("Failed to parse token response: {}", e)))?;

        self.config.access_token = Some(token_response.access_token.clone());
        self.config.token_expires_at = Some(Utc::now() + chrono::Duration::seconds(token_response.expires_in as i64));

        if let Some(refresh_token) = token_response.refresh_token {
            self.config.refresh_token = Some(refresh_token);
        }

        Ok(())
    }

    fn get_auth_headers(&self) -> StorageResult<HashMap<String, String>> {
        let access_token = self.config.access_token.as_ref()
            .ok_or_else(|| StorageError::authentication("No access token available"))?;

        let mut headers = HashMap::new();
        headers.insert("Authorization".to_string(), format!("Bearer {}", access_token));
        Ok(headers)
    }

    fn google_file_to_storage_file(&self, google_file: GoogleDriveFile) -> StorageFile {
        let is_folder = google_file.mime_type.as_ref()
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
            return Err(StorageError::authentication("No access token - OAuth flow required"));
        }

        self.ensure_valid_token().await?;

        let headers = self.get_auth_headers()?;
        let response = self.client
            .get(&format!("{}/about", GOOGLE_DRIVE_API_BASE))
            .header("Authorization", &headers["Authorization"])
            .query(&[("fields", "user")])
            .send()
            .await
            .map_err(|e| StorageError::network(format!("Failed to verify authentication: {}", e)))?;

        if response.status().is_success() {
            Ok(())
        } else {
            Err(StorageError::authentication("Invalid access token"))
        }
    }

    async fn is_authenticated(&self) -> bool {
        self.config.access_token.is_some() && !self.is_token_expired()
    }

    async fn list_files(&self, folder_id: Option<String>) -> StorageResult<Vec<StorageFile>> {
        let headers = self.get_auth_headers()?;

        let query = if let Some(folder_id) = folder_id {
            format!("'{}' in parents and trashed=false", folder_id)
        } else {
            "'root' in parents and trashed=false".to_string()
        };

        let response = self.client
            .get(&format!("{}/files", GOOGLE_DRIVE_API_BASE))
            .header("Authorization", &headers["Authorization"])
            .query(&[
                ("q", query.as_str()),
                ("fields", "files(id,name,parents,size,createdTime,modifiedTime,mimeType,kind)")
            ])
            .send()
            .await
            .map_err(|e| StorageError::network(format!("Failed to list files: {}", e)))?;

        let status = response.status();
        if !status.is_success() {
            let error_text = response.text().await
                .unwrap_or_else(|_| "Unknown error".to_string());
            return Err(StorageError::operation_failed(
                format!("Failed to list files ({}): {}", status, error_text)
            ));
        }

        let file_list: GoogleDriveFileList = response.json().await
            .map_err(|e| StorageError::network(format!("Failed to parse file list: {}", e)))?;

        Ok(file_list.files.into_iter()
            .map(|f| self.google_file_to_storage_file(f))
            .collect())
    }

    async fn create_file(&self, request: CreateFileRequest) -> StorageResult<StorageFile> {
        let headers = self.get_auth_headers()?;

        let mut metadata = serde_json::Map::new();
        metadata.insert("name".to_string(), serde_json::Value::String(request.name.clone()));
        if let Some(parent_id) = &request.parent_id {
            metadata.insert("parents".to_string(), serde_json::Value::Array(vec![
                serde_json::Value::String(parent_id.clone())
            ]));
        }

        let metadata_str = serde_json::to_string(&metadata)?;
        let file_name = request.name.clone(); // Clone the name to avoid lifetime issues
        let form = reqwest::multipart::Form::new()
            .part("metadata", reqwest::multipart::Part::text(metadata_str)
                .file_name("metadata.json")
                .mime_str("application/json")
                .map_err(|e| StorageError::network(format!("Failed to create multipart part: {}", e)))?)
            .part("file", reqwest::multipart::Part::bytes(request.content)
                .file_name(file_name) // Use the cloned value
                .mime_str(request.mime_type.as_deref().unwrap_or("application/octet-stream"))
                .map_err(|e| StorageError::network(format!("Failed to create multipart part: {}", e)))?);

        let response = self.client
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

        let google_file: GoogleDriveFile = response.json().await
            .map_err(|e| StorageError::network(format!("Failed to parse created file: {}", e)))?;

        Ok(self.google_file_to_storage_file(google_file))
    }

    async fn read_file(&self, file_id: String) -> StorageResult<Vec<u8>> {
        let headers = self.get_auth_headers()?;

        let response = self.client
            .get(&format!("{}/files/{}", GOOGLE_DRIVE_API_BASE, file_id))
            .header("Authorization", &headers["Authorization"])
            .query(&[("alt", "media")])
            .send()
            .await
            .map_err(|e| StorageError::network(format!("Failed to read file: {}", e)))?;

        if !response.status().is_success() {
            return Err(StorageError::file_not_found(file_id));
        }

        Ok(response.bytes().await
            .map_err(|e| StorageError::network(format!("Failed to read file content: {}", e)))?
            .to_vec())
    }

    async fn delete_file(&self, file_id: String) -> StorageResult<()> {
        let headers = self.get_auth_headers()?;

        let response = self.client
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

    async fn update_file(&self, request: UpdateFileRequest) -> StorageResult<StorageFile> {
        let headers = self.get_auth_headers()?;

        let form = reqwest::multipart::Form::new()
            .part("file", reqwest::multipart::Part::bytes(request.content)
                .file_name("update")
                .mime_str("application/octet-stream")
                .map_err(|e| StorageError::network(format!("Failed to create multipart part: {}", e)))?);

        let response = self.client
            .patch(&format!("{}/files/{}", GOOGLE_DRIVE_UPLOAD_API_BASE, request.id))
            .header("Authorization", &headers["Authorization"])
            .query(&[("uploadType", "media")])
            .multipart(form)
            .send()
            .await
            .map_err(|e| StorageError::network(format!("Failed to update file: {}", e)))?;

        if !response.status().is_success() {
            return Err(StorageError::operation_failed("Failed to update file"));
        }

        let google_file: GoogleDriveFile = response.json().await
            .map_err(|e| StorageError::network(format!("Failed to parse updated file: {}", e)))?;

        Ok(self.google_file_to_storage_file(google_file))
    }

    async fn create_folder(&self, request: CreateFolderRequest) -> StorageResult<StorageFile> {
        let headers = self.get_auth_headers()?;

        let mut metadata = serde_json::Map::new();
        metadata.insert("name".to_string(), serde_json::Value::String(request.name.clone()));
        metadata.insert("mimeType".to_string(), serde_json::Value::String("application/vnd.google-apps.folder".to_string()));
        if let Some(parent_id) = &request.parent_id {
            metadata.insert("parents".to_string(), serde_json::Value::Array(vec![
                serde_json::Value::String(parent_id.clone())
            ]));
        }

        let response = self.client
            .post(&format!("{}/files", GOOGLE_DRIVE_API_BASE))
            .header("Authorization", &headers["Authorization"])
            .json(&metadata)
            .send()
            .await
            .map_err(|e| StorageError::network(format!("Failed to create folder: {}", e)))?;

        if !response.status().is_success() {
            return Err(StorageError::operation_failed("Failed to create folder"));
        }

        let google_file: GoogleDriveFile = response.json().await
            .map_err(|e| StorageError::network(format!("Failed to parse created folder: {}", e)))?;

        Ok(self.google_file_to_storage_file(google_file))
    }

    async fn delete_folder(&self, folder_id: String) -> StorageResult<()> {
        self.delete_file(folder_id).await
    }

    async fn get_file_info(&self, file_id: String) -> StorageResult<StorageFile> {
        let headers = self.get_auth_headers()?;

        let response = self.client
            .get(&format!("{}/files/{}", GOOGLE_DRIVE_API_BASE, file_id))
            .header("Authorization", &headers["Authorization"])
            .query(&[("fields", "id,name,parents,size,createdTime,modifiedTime,mimeType,kind")])
            .send()
            .await
            .map_err(|e| StorageError::network(format!("Failed to get file info: {}", e)))?;

        if !response.status().is_success() {
            return Err(StorageError::file_not_found(file_id));
        }

        let google_file: GoogleDriveFile = response.json().await
            .map_err(|e| StorageError::network(format!("Failed to parse file info: {}", e)))?;

        Ok(self.google_file_to_storage_file(google_file))
    }

    async fn search_files(&self, query: String) -> StorageResult<Vec<StorageFile>> {
        let headers = self.get_auth_headers()?;

        let search_query = format!("name contains '{}' and trashed=false", query);

        let response = self.client
            .get(&format!("{}/files", GOOGLE_DRIVE_API_BASE))
            .header("Authorization", &headers["Authorization"])
            .query(&[
                ("q", search_query.as_str()),
                ("fields", "files(id,name,parents,size,createdTime,modifiedTime,mimeType,kind)")
            ])
            .send()
            .await
            .map_err(|e| StorageError::network(format!("Failed to search files: {}", e)))?;

        if !response.status().is_success() {
            return Err(StorageError::operation_failed("Failed to search files"));
        }

        let file_list: GoogleDriveFileList = response.json().await
            .map_err(|e| StorageError::network(format!("Failed to parse search results: {}", e)))?;

        Ok(file_list.files.into_iter()
            .map(|f| self.google_file_to_storage_file(f))
            .collect())
    }
}