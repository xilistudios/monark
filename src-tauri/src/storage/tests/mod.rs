#[cfg(test)]
mod tests {
    use super::super::providers::*;
    use super::super::*;
    use tempfile::TempDir;
    use tokio;

    #[tokio::test]
    async fn test_local_storage_provider() {
        let temp_dir = TempDir::new().unwrap();
        let mut provider = LocalStorageProvider::new(temp_dir.path());

        // Test authentication (should always succeed for local)
        let mut auth_provider = provider.clone();
        auth_provider.authenticate().await.unwrap();
        assert!(auth_provider.is_authenticated().await);

        // Test creating a folder
        let folder_request = CreateFolderRequest {
            name: "test_folder".to_string(),
            path: "/test_folder".to_string(),
            parent_id: None,
            metadata: None,
        };

        let created_folder = provider.create_folder(folder_request).await.unwrap();
        assert_eq!(created_folder.name, "test_folder");
        assert!(created_folder.is_folder);

        // Test creating a file
        let file_request = CreateFileRequest {
            name: "test_file.txt".to_string(),
            path: "/test_folder/test_file.txt".to_string(),
            content: b"Hello, World!".to_vec(),
            parent_id: Some(created_folder.id.clone()),
            mime_type: Some("text/plain".to_string()),
            metadata: None,
        };

        let created_file = provider.create_file(file_request).await.unwrap();
        assert_eq!(created_file.name, "test_file.txt");
        assert!(!created_file.is_folder);

        // Test reading the file
        let file_content = provider.read_file(created_file.id.clone()).await.unwrap();
        assert_eq!(file_content, b"Hello, World!");

        // Test updating the file
        let update_request = UpdateFileRequest {
            id: created_file.id.clone(),
            content: b"Updated content".to_vec(),
            metadata: None,
        };

        let updated_file = provider.update_file(update_request).await.unwrap();
        assert_eq!(updated_file.id, created_file.id);

        let updated_content = provider.read_file(updated_file.id.clone()).await.unwrap();
        assert_eq!(updated_content, b"Updated content");

        // Test listing files
        let files = provider
            .list_files(Some(created_folder.id.clone()))
            .await
            .unwrap();
        assert_eq!(files.len(), 1);
        assert_eq!(files[0].name, "test_file.txt");

        // Test searching files
        let search_results = provider
            .search_files("test_file".to_string())
            .await
            .unwrap();
        assert_eq!(search_results.len(), 1);
        assert_eq!(search_results[0].name, "test_file.txt");

        // Test getting file info
        let file_info = provider
            .get_file_info(created_file.id.clone())
            .await
            .unwrap();
        assert_eq!(file_info.id, created_file.id);
        assert_eq!(file_info.name, "test_file.txt");

        // Test deleting the file
        provider.delete_file(created_file.id.clone()).await.unwrap();

        let files_after_delete = provider
            .list_files(Some(created_folder.id.clone()))
            .await
            .unwrap();
        assert_eq!(files_after_delete.len(), 0);

        // Test deleting the folder
        provider
            .delete_folder(created_folder.id.clone())
            .await
            .unwrap();
    }

    #[tokio::test]
    async fn test_storage_manager() {
        let temp_dir = TempDir::new().unwrap();
        let config = StorageConfig::new_local(temp_dir.path().to_string_lossy().to_string());
        let manager = StorageManager::new(config).await.unwrap();

        // Test listing providers
        let providers = manager.list_providers().await;
        assert_eq!(providers.len(), 1);
        assert_eq!(providers[0], "local");

        // Test default provider
        let default_provider = manager.get_default_provider().await;
        assert_eq!(default_provider, "local");

        // Test creating a file through manager
        let file_request = CreateFileRequest {
            name: "manager_test.txt".to_string(),
            path: "/manager_test.txt".to_string(),
            content: b"Manager test content".to_vec(),
            parent_id: None,
            mime_type: Some("text/plain".to_string()),
            metadata: None,
        };

        let created_file = manager.create_file(file_request, None).await.unwrap();
        assert_eq!(created_file.name, "manager_test.txt");

        // Test reading the file through manager
        let file_content = manager
            .read_file(created_file.id.clone(), None)
            .await
            .unwrap();
        assert_eq!(file_content, b"Manager test content");

        // Test listing files through manager
        let files = manager.list_files(None, None).await.unwrap();
        assert_eq!(files.len(), 1);
        assert_eq!(files[0].name, "manager_test.txt");

        // Test deleting the file through manager
        manager
            .delete_file(created_file.id.clone(), None)
            .await
            .unwrap();

        let files_after_delete = manager.list_files(None, None).await.unwrap();
        assert_eq!(files_after_delete.len(), 0);
    }

    #[tokio::test]
    async fn test_vault_folder_operations() {
        let temp_dir = TempDir::new().unwrap();
        let config = StorageConfig::new_local(temp_dir.path().to_string_lossy().to_string());
        let manager = StorageManager::new(config).await.unwrap();

        // Test ensuring vault folder exists
        let vault_folder_id = manager.ensure_vault_folder(None).await.unwrap();

        // Test listing vaults (should be empty initially)
        let vaults = manager.list_vaults(None).await.unwrap();
        assert_eq!(vaults.len(), 0);

        // Test creating a vault file
        let vault_request = CreateFileRequest {
            name: "test_vault.monark".to_string(),
            path: "/Monark/test_vault.monark".to_string(),
            content: b"Mock vault content".to_vec(),
            parent_id: Some(vault_folder_id.clone()),
            mime_type: Some("application/octet-stream".to_string()),
            metadata: None,
        };

        let created_vault = manager.create_file(vault_request, None).await.unwrap();
        assert_eq!(created_vault.name, "test_vault.monark");

        // Test listing vaults (should now contain our vault)
        let vaults_after_create = manager.list_vaults(None).await.unwrap();
        assert_eq!(vaults_after_create.len(), 1);
        assert_eq!(vaults_after_create[0].name, "test_vault.monark");

        // Test ensuring vault folder exists again (should return existing folder)
        let vault_folder_id_again = manager.ensure_vault_folder(None).await.unwrap();
        assert_eq!(vault_folder_id, vault_folder_id_again);
    }
}

#[cfg(test)]
mod google_drive_auth;
