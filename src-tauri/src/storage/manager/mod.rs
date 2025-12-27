use super::providers::{GoogleDriveProvider, LocalStorageProvider};
use super::{ProviderConfig, StorageConfig, StorageError, StorageProvider, StorageResult};
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::{Mutex, RwLock};

mod file_operations;
mod provider_management;
mod vault_operations;

pub struct StorageManager {
    providers: Arc<RwLock<HashMap<String, Box<dyn StorageProvider>>>>,
    config: Arc<RwLock<StorageConfig>>,
    /// Cache of vault folder IDs per provider to avoid creating duplicate folders
    vault_folder_cache: Arc<RwLock<HashMap<String, String>>>,
    /// Mutex to prevent concurrent folder creation operations per provider
    folder_creation_locks: Arc<RwLock<HashMap<String, Arc<Mutex<()>>>>>,
    /// Mutex to prevent concurrent token refresh operations per provider
    refresh_locks: Arc<RwLock<HashMap<String, Arc<Mutex<()>>>>>,
}

impl std::fmt::Debug for StorageManager {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("StorageManager")
            .field("providers", &"<providers>")
            .field("config", &"<config>")
            .field("vault_folder_cache", &"<cache>")
            .field("folder_creation_locks", &"<locks>")
            .finish()
    }
}

impl StorageManager {
    /// Helper function to handle provider name mapping (e.g., "Drive" -> "google_drive")
    fn map_provider_name(&self, provider_name: &str) -> String {
        if provider_name == "Drive" {
            "google_drive".to_string()
        } else {
            provider_name.to_string()
        }
    }

    pub async fn new(config: StorageConfig) -> StorageResult<Self> {
        let manager = Self {
            providers: Arc::new(RwLock::new(HashMap::new())),
            config: Arc::new(RwLock::new(config)),
            vault_folder_cache: Arc::new(RwLock::new(HashMap::new())),
            folder_creation_locks: Arc::new(RwLock::new(HashMap::new())),
            refresh_locks: Arc::new(RwLock::new(HashMap::new())),
        };

        // Initialize all configured providers
        manager.initialize_all_providers().await?;
        Ok(manager)
    }

    /// Get or create a refresh lock for a specific provider
    pub async fn get_refresh_lock(&self, provider_name: &str) -> Arc<Mutex<()>> {
        let actual_provider_name = self.map_provider_name(provider_name);

        let mut locks = self.refresh_locks.write().await;
        if !locks.contains_key(&actual_provider_name) {
            locks.insert(actual_provider_name.clone(), Arc::new(Mutex::new(())));
        }

        locks.get(&actual_provider_name).unwrap().clone()
    }

    async fn initialize_all_providers(&self) -> StorageResult<()> {
        let config = self.config.read().await;
        let mut providers = self.providers.write().await;

        for (name, provider_config) in &config.providers {
            let provider = self.create_provider_from_config(provider_config)?;
            let actual_name = self.map_provider_name(name.as_str());
            providers.insert(actual_name, provider);
        }

        Ok(())
    }

    fn create_provider_from_config(
        &self,
        config: &ProviderConfig,
    ) -> StorageResult<Box<dyn StorageProvider>> {
        match config {
            ProviderConfig::Local { base_path } => {
                Ok(Box::new(LocalStorageProvider::new(base_path)))
            }
            ProviderConfig::GoogleDrive { config } => {
                Ok(Box::new(GoogleDriveProvider::new(config.clone())))
            }
        }
    }
}
