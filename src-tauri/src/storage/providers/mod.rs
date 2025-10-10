pub mod google_drive;
pub mod local;

use crate::storage::StorageResult;
use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum StorageProviderType {
    Local,
    GoogleDrive,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StorageFile {
    pub id: String,
    pub name: String,
    pub path: String,
    pub size: Option<u64>,
    pub created_at: Option<chrono::DateTime<chrono::Utc>>,
    pub modified_at: Option<chrono::DateTime<chrono::Utc>>,
    pub is_folder: bool,
    pub mime_type: Option<String>,
    pub parent_id: Option<String>,
    pub metadata: HashMap<String, String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateFileRequest {
    pub name: String,
    pub path: String,
    pub content: Vec<u8>,
    pub parent_id: Option<String>,
    pub mime_type: Option<String>,
    pub metadata: Option<HashMap<String, String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateFileRequest {
    pub id: String,
    pub content: Vec<u8>,
    pub metadata: Option<HashMap<String, String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateFolderRequest {
    pub name: String,
    pub path: String,
    pub parent_id: Option<String>,
    pub metadata: Option<HashMap<String, String>>,
}

#[async_trait]
pub trait StorageProvider: Send + Sync {
    fn provider_type(&self) -> StorageProviderType;

    async fn authenticate(&mut self) -> StorageResult<()>;

    async fn is_authenticated(&self) -> bool;

    async fn list_files(&mut self, folder_id: Option<String>) -> StorageResult<Vec<StorageFile>>;

    async fn create_file(&mut self, request: CreateFileRequest) -> StorageResult<StorageFile>;

    async fn read_file(&mut self, file_id: String) -> StorageResult<Vec<u8>>;

    async fn delete_file(&mut self, file_id: String) -> StorageResult<()>;

    async fn update_file(&mut self, request: UpdateFileRequest) -> StorageResult<StorageFile>;

    async fn create_folder(&mut self, request: CreateFolderRequest) -> StorageResult<StorageFile>;

    async fn delete_folder(&mut self, folder_id: String) -> StorageResult<()>;

    async fn get_file_info(&mut self, file_id: String) -> StorageResult<StorageFile>;

    async fn search_files(&mut self, query: String) -> StorageResult<Vec<StorageFile>>;
}

pub use google_drive::GoogleDriveProvider;
pub use local::LocalStorageProvider;
