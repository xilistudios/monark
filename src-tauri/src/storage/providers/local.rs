use super::{
    CreateFileRequest, CreateFolderRequest, StorageFile, StorageProvider, StorageProviderType,
    UpdateFileRequest,
};
use crate::storage::{StorageError, StorageResult};
use async_trait::async_trait;
use std::collections::HashMap;
#[cfg(unix)]
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use tokio::fs;

#[derive(Debug, Clone)]
pub struct LocalStorageProvider {
    base_path: PathBuf,
}

impl LocalStorageProvider {
    pub fn new(base_path: impl AsRef<Path>) -> Self {
        Self {
            base_path: base_path.as_ref().to_path_buf(),
        }
    }

    fn resolve_path(&self, path: &str) -> PathBuf {
        if path.starts_with('/') {
            self.base_path.join(path.trim_start_matches('/'))
        } else {
            self.base_path.join(path)
        }
    }

    fn file_to_storage_file(&self, path: &Path) -> StorageResult<StorageFile> {
        let metadata = std::fs::metadata(path).map_err(StorageError::Io)?;

        let name = path
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("")
            .to_string();

        let relative_path = path.strip_prefix(&self.base_path).map_err(|e| {
            StorageError::Io(std::io::Error::new(
                std::io::ErrorKind::Other,
                format!("Failed to get relative path: {}", e),
            ))
        })?;

        let path_str = format!("/{}", relative_path.display());
        let is_folder = metadata.is_dir();

        let mut storage_metadata = HashMap::new();
        #[cfg(unix)]
        storage_metadata.insert(
            "permissions".to_string(),
            format!("{:o}", metadata.permissions().mode()),
        );

        Ok(StorageFile {
            id: path_str.clone(),
            name,
            path: path_str,
            size: if is_folder {
                None
            } else {
                Some(metadata.len())
            },
            created_at: metadata.created().ok().map(|dt| dt.into()),
            modified_at: metadata.modified().ok().map(|dt| dt.into()),
            is_folder,
            mime_type: if is_folder {
                Some("application/x-directory".to_string())
            } else {
                None
            },
            parent_id: path.parent().and_then(|p| {
                p.strip_prefix(&self.base_path)
                    .ok()
                    .map(|rp| format!("/{}", rp.display()))
            }),
            metadata: storage_metadata,
        })
    }
}

#[async_trait]
impl StorageProvider for LocalStorageProvider {
    fn provider_type(&self) -> StorageProviderType {
        StorageProviderType::Local
    }

    async fn authenticate(&mut self) -> StorageResult<()> {
        // Local storage doesn't require authentication
        Ok(())
    }

    async fn is_authenticated(&self) -> bool {
        true
    }

    async fn list_files(&mut self, folder_id: Option<String>) -> StorageResult<Vec<StorageFile>> {
        let folder_path = if let Some(folder_id) = folder_id {
            self.resolve_path(&folder_id)
        } else {
            self.base_path.clone()
        };

        if !folder_path.exists() {
            return Err(StorageError::file_not_found(folder_path.to_string_lossy()));
        }

        let mut entries = Vec::new();
        let mut read_dir = fs::read_dir(&folder_path).await.map_err(StorageError::Io)?;

        while let Some(entry) = read_dir.next_entry().await.map_err(StorageError::Io)? {
            let path = entry.path();
            if let Ok(storage_file) = self.file_to_storage_file(&path) {
                entries.push(storage_file);
            }
        }

        Ok(entries)
    }

    async fn create_file(&mut self, request: CreateFileRequest) -> StorageResult<StorageFile> {
        let file_path = self.resolve_path(&request.path);

        if let Some(parent) = file_path.parent() {
            fs::create_dir_all(parent).await.map_err(StorageError::Io)?;
        }

        fs::write(&file_path, &request.content)
            .await
            .map_err(StorageError::Io)?;

        self.file_to_storage_file(&file_path)
    }

    async fn read_file(&mut self, file_id: String) -> StorageResult<Vec<u8>> {
        let file_path = self.resolve_path(&file_id);

        if !file_path.exists() {
            return Err(StorageError::file_not_found(file_path.to_string_lossy()));
        }

        fs::read(&file_path).await.map_err(StorageError::Io)
    }

    async fn delete_file(&mut self, file_id: String) -> StorageResult<()> {
        let file_path = self.resolve_path(&file_id);

        if !file_path.exists() {
            return Err(StorageError::file_not_found(file_path.to_string_lossy()));
        }

        fs::remove_file(&file_path).await.map_err(StorageError::Io)
    }

    async fn update_file(&mut self, request: UpdateFileRequest) -> StorageResult<StorageFile> {
        let file_path = self.resolve_path(&request.id);

        if !file_path.exists() {
            return Err(StorageError::file_not_found(file_path.to_string_lossy()));
        }

        fs::write(&file_path, &request.content)
            .await
            .map_err(StorageError::Io)?;

        self.file_to_storage_file(&file_path)
    }

    async fn create_folder(&mut self, request: CreateFolderRequest) -> StorageResult<StorageFile> {
        let folder_path = self.resolve_path(&request.path);

        fs::create_dir_all(&folder_path)
            .await
            .map_err(StorageError::Io)?;

        self.file_to_storage_file(&folder_path)
    }

    async fn delete_folder(&mut self, folder_id: String) -> StorageResult<()> {
        let folder_path = self.resolve_path(&folder_id);

        if !folder_path.exists() {
            return Err(StorageError::file_not_found(folder_path.to_string_lossy()));
        }

        fs::remove_dir_all(&folder_path)
            .await
            .map_err(StorageError::Io)
    }

    async fn get_file_info(&mut self, file_id: String) -> StorageResult<StorageFile> {
        let file_path = self.resolve_path(&file_id);

        if !file_path.exists() {
            return Err(StorageError::file_not_found(file_path.to_string_lossy()));
        }

        self.file_to_storage_file(&file_path)
    }

    async fn search_files(&mut self, query: String) -> StorageResult<Vec<StorageFile>> {
        let mut results = Vec::new();
        Box::pin(self.search_files_recursive(&self.base_path, &query, &mut results)).await?;
        Ok(results)
    }

    /// Lists vault files with .monark extension in the base directory
    /// This is a simple file listing - no cloud folder search logic
    async fn list_vaults(&mut self) -> StorageResult<Vec<StorageFile>> {
        let mut entries = Vec::new();
        let mut read_dir = fs::read_dir(&self.base_path)
            .await
            .map_err(StorageError::Io)?;

        while let Some(entry) = read_dir.next_entry().await.map_err(StorageError::Io)? {
            let path = entry.path();
            // Only include files with .monark extension
            if path.is_file() && path.to_string_lossy().ends_with(".monark") {
                if let Ok(storage_file) = self.file_to_storage_file(&path) {
                    entries.push(storage_file);
                }
            }
        }

        Ok(entries)
    }
}

impl LocalStorageProvider {
    async fn search_files_recursive(
        &self,
        dir: &Path,
        query: &str,
        results: &mut Vec<StorageFile>,
    ) -> StorageResult<()> {
        let mut read_dir = fs::read_dir(dir).await.map_err(StorageError::Io)?;

        while let Some(entry) = read_dir.next_entry().await.map_err(StorageError::Io)? {
            let path = entry.path();

            if let Ok(storage_file) = self.file_to_storage_file(&path) {
                if storage_file
                    .name
                    .to_lowercase()
                    .contains(&query.to_lowercase())
                {
                    results.push(storage_file);
                }
            }

            if path.is_dir() {
                Box::pin(self.search_files_recursive(&path, query, results)).await?;
            }
        }

        Ok(())
    }
}
