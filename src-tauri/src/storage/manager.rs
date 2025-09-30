use super::{StorageProvider, StorageError, StorageResult, StorageConfig, ProviderConfig};
use super::providers::{LocalStorageProvider, GoogleDriveProvider};
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::RwLock;

pub struct StorageManager {
    providers: Arc<RwLock<HashMap<String, Box<dyn StorageProvider>>>>,
    config: Arc<RwLock<StorageConfig>>,
}

impl std::fmt::Debug for StorageManager {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("StorageManager")
            .field("providers", &"<providers>")
            .field("config", &"<config>")
            .finish()
    }
}

impl StorageManager {
    pub async fn new(config: StorageConfig) -> StorageResult<Self> {
        let manager = Self {
            providers: Arc::new(RwLock::new(HashMap::new())),
            config: Arc::new(RwLock::new(config)),
        };

        // Initialize default provider
        manager.initialize_default_provider().await?;
        Ok(manager)
    }

    async fn initialize_default_provider(&self) -> StorageResult<()> {
        let config = self.config.read().await;
        let default_provider_name = &config.default_provider;

        if let Some(provider_config) = config.get_provider_config(default_provider_name) {
            let provider = self.create_provider_from_config(provider_config)?;
            let mut providers = self.providers.write().await;
            providers.insert(default_provider_name.clone(), provider);
        }

        Ok(())
    }

    fn create_provider_from_config(&self, config: &ProviderConfig) -> StorageResult<Box<dyn StorageProvider>> {
        match config {
            ProviderConfig::Local { base_path } => {
                Ok(Box::new(LocalStorageProvider::new(base_path)))
            }
            ProviderConfig::GoogleDrive { config } => {
                Ok(Box::new(GoogleDriveProvider::new(config.clone())))
            }
        }
    }

    pub async fn add_provider(&self, name: String, provider_config: ProviderConfig) -> StorageResult<()> {
        let provider = self.create_provider_from_config(&provider_config)?;

        // Add provider to the map
        {
            let mut providers = self.providers.write().await;
            providers.insert(name.clone(), provider);
        }

        // Update config
        {
            let mut config = self.config.write().await;
            config.add_provider(name.clone(), provider_config);
        }

        Ok(())
    }

    pub async fn remove_provider(&self, name: &str) -> StorageResult<()> {
        // Cannot remove the default provider
        {
            let config = self.config.read().await;
            if config.default_provider == name {
                return Err(StorageError::invalid_configuration(
                    "Cannot remove the default provider"
                ));
            }
        }

        // Remove from providers map
        {
            let mut providers = self.providers.write().await;
            providers.remove(name);
        }

        // Remove from config
        {
            let mut config = self.config.write().await;
            config.providers.remove(name);
        }

        Ok(())
    }

    pub async fn set_default_provider(&self, name: String) -> StorageResult<()> {
        // Check if provider exists
        {
            let providers = self.providers.read().await;
            if !providers.contains_key(&name) {
                return Err(StorageError::invalid_configuration(
                    "Provider does not exist"
                ));
            }
        }

        // Update config
        {
            let mut config = self.config.write().await;
            *config = config.clone().set_default_provider(name);
        }

        Ok(())
    }

    pub async fn get_provider(&self, name: Option<String>) -> StorageResult<Arc<dyn StorageProvider>> {
        let provider_name = if let Some(name) = name {
            name
        } else {
            let config = self.config.read().await;
            config.default_provider.clone()
        };

        let providers = self.providers.read().await;

        if let Some(_provider) = providers.get(&provider_name) {
            // We need to convert Box<dyn StorageProvider> to Arc<dyn StorageProvider>
            // This is a bit tricky because we can't directly convert Box to Arc
            // For now, we'll create a new instance from config
            drop(providers);

            let config = self.config.read().await;
            if let Some(provider_config) = config.get_provider_config(&provider_name) {
                let provider = self.create_provider_from_config(provider_config)?;
                return Ok(Arc::from(provider));
            }
        }

        Err(StorageError::provider_not_supported(provider_name))
    }

    pub async fn get_provider_mut(&self, name: Option<String>) -> StorageResult<Box<dyn StorageProvider>> {
        let provider_name = if let Some(name) = name {
            name
        } else {
            let config = self.config.read().await;
            config.default_provider.clone()
        };

        let config = self.config.read().await;
        if let Some(provider_config) = config.get_provider_config(&provider_name) {
            let provider = self.create_provider_from_config(provider_config)?;
            return Ok(provider);
        }

        Err(StorageError::provider_not_supported(provider_name))
    }

    pub async fn list_providers(&self) -> Vec<String> {
        let config = self.config.read().await;
        config.list_providers()
    }

    pub async fn get_default_provider(&self) -> String {
        let config = self.config.read().await;
        config.default_provider.clone()
    }

    pub async fn get_config(&self) -> StorageConfig {
        self.config.read().await.clone()
    }

    pub async fn update_config(&self, new_config: StorageConfig) -> StorageResult<()> {
        // Validate that all providers in the new config can be created
        for (_name, provider_config) in &new_config.providers {
            self.create_provider_from_config(provider_config)?;
        }

        // Update config
        {
            let mut config = self.config.write().await;
            *config = new_config;
        }

        // Reinitialize providers
        {
            let mut providers = self.providers.write().await;
            providers.clear();
        }

        self.initialize_default_provider().await?;
        Ok(())
    }
}

// High-level storage operations that work with the default provider
impl StorageManager {
    pub async fn authenticate(&self, provider_name: Option<String>) -> StorageResult<()> {
        let mut provider = self.get_provider_mut(provider_name).await?;
        provider.authenticate().await?;
        Ok(())
    }

    pub async fn list_files(&self, folder_id: Option<String>, provider_name: Option<String>) -> StorageResult<Vec<super::providers::StorageFile>> {
        let provider = self.get_provider(provider_name).await?;
        provider.list_files(folder_id).await
    }

    pub async fn create_file(&self, request: super::providers::CreateFileRequest, provider_name: Option<String>) -> StorageResult<super::providers::StorageFile> {
        let provider = self.get_provider(provider_name).await?;
        provider.create_file(request).await
    }

    pub async fn read_file(&self, file_id: String, provider_name: Option<String>) -> StorageResult<Vec<u8>> {
        let provider = self.get_provider(provider_name).await?;
        provider.read_file(file_id).await
    }

    pub async fn delete_file(&self, file_id: String, provider_name: Option<String>) -> StorageResult<()> {
        let provider = self.get_provider(provider_name).await?;
        provider.delete_file(file_id).await
    }

    pub async fn update_file(&self, request: super::providers::UpdateFileRequest, provider_name: Option<String>) -> StorageResult<super::providers::StorageFile> {
        let provider = self.get_provider(provider_name).await?;
        provider.update_file(request).await
    }

    pub async fn create_folder(&self, request: super::providers::CreateFolderRequest, provider_name: Option<String>) -> StorageResult<super::providers::StorageFile> {
        let provider = self.get_provider(provider_name).await?;
        provider.create_folder(request).await
    }

    pub async fn delete_folder(&self, folder_id: String, provider_name: Option<String>) -> StorageResult<()> {
        let provider = self.get_provider(provider_name).await?;
        provider.delete_folder(folder_id).await
    }

    pub async fn get_file_info(&self, file_id: String, provider_name: Option<String>) -> StorageResult<super::providers::StorageFile> {
        let provider = self.get_provider(provider_name).await?;
        provider.get_file_info(file_id).await
    }

    pub async fn search_files(&self, query: String, provider_name: Option<String>) -> StorageResult<Vec<super::providers::StorageFile>> {
        let provider = self.get_provider(provider_name).await?;
        provider.search_files(query).await
    }

    // Vault-specific operations
    pub async fn ensure_vault_folder(&self, provider_name: Option<String>) -> StorageResult<String> {
        let config = self.config.read().await;
        let vault_folder_name = &config.vault_folder;

        // Try to find the vault folder
        let provider = self.get_provider(provider_name.clone()).await?;
        let files = provider.list_files(None).await?;

        if let Some(vault_folder) = files.iter().find(|f| f.name == *vault_folder_name && f.is_folder) {
            Ok(vault_folder.id.clone())
        } else {
            // Create the vault folder
            let create_request = super::providers::CreateFolderRequest {
                name: vault_folder_name.clone(),
                path: format!("/{}", vault_folder_name),
                parent_id: None,
                metadata: None,
            };

            let folder = provider.create_folder(create_request).await?;
            Ok(folder.id)
        }
    }

    pub async fn list_vaults(&self, provider_name: Option<String>) -> StorageResult<Vec<super::providers::StorageFile>> {
        let vault_folder_id = self.ensure_vault_folder(provider_name.clone()).await?;
        let provider = self.get_provider(provider_name).await?;

        let files = provider.list_files(Some(vault_folder_id)).await?;
        Ok(files.into_iter().filter(|f| f.name.ends_with(".monark")).collect())
    }
}