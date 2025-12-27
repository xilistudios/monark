use super::StorageManager;
use super::{ProviderConfig, StorageConfig, StorageError, StorageResult};
use crate::storage::providers::{
    google_drive::GoogleDriveConfig, GoogleDriveProvider, StorageProvider,
};
use chrono::{DateTime, Utc};
use std::sync::Arc;

impl StorageManager {
    pub async fn add_provider(
        &self,
        name: String,
        provider_config: ProviderConfig,
    ) -> StorageResult<()> {
        let provider = self.create_provider_from_config(&provider_config)?;

        {
            let mut providers = self.providers.write().await;
            let actual_name = self.map_provider_name(&name);
            providers.insert(actual_name, provider);
        }

        {
            let mut config = self.config.write().await;
            config.add_provider(name.clone(), provider_config);
            config.save()?;
        }

        Ok(())
    }

    /// Get a read-only copy of the current configuration
    pub async fn get_config(&self) -> StorageConfig {
        let config = self.config.read().await;
        config.clone()
    }

    pub async fn remove_provider(&self, name: &str) -> StorageResult<()> {
        {
            let config = self.config.read().await;
            if config.default_provider == name {
                return Err(StorageError::invalid_configuration(
                    "Cannot remove the default provider",
                ));
            }
        }

        let actual_name = self.map_provider_name(name);

        {
            let mut providers = self.providers.write().await;
            providers.remove(&actual_name);
        }

        {
            let mut cache = self.vault_folder_cache.write().await;
            cache.remove(&actual_name);
        }

        {
            let mut locks = self.folder_creation_locks.write().await;
            locks.remove(&actual_name);
        }

        {
            let mut config = self.config.write().await;
            config.providers.remove(name);
            config.save()?;
        }

        Ok(())
    }

    pub async fn set_default_provider(&self, name: String) -> StorageResult<()> {
        {
            let config = self.config.read().await;
            if !config.provider_exists(&name) {
                return Err(StorageError::provider_not_supported(name));
            }
        }

        {
            let mut config = self.config.write().await;
            config.default_provider = name;
            config.save()?;
        }

        Ok(())
    }

    pub async fn get_provider(
        &self,
        name: Option<String>,
    ) -> StorageResult<Arc<dyn StorageProvider>> {
        let provider_name = if let Some(name) = name {
            name
        } else {
            let config = self.config.read().await;
            config.default_provider.clone()
        };

        let actual_provider_name = self.map_provider_name(&provider_name);

        let providers = self.providers.read().await;

        if let Some(_provider) = providers.get(&actual_provider_name) {
            drop(providers);

            let config = self.config.read().await;
            if let Some(provider_config) = config.get_provider_config(&provider_name) {
                let provider = self.create_provider_from_config(provider_config)?;
                return Ok(Arc::from(provider));
            }
        }

        Err(StorageError::provider_not_supported(actual_provider_name))
    }

    pub async fn get_provider_mut(
        &self,
        name: Option<String>,
    ) -> StorageResult<Box<dyn StorageProvider>> {
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

    pub async fn update_config(&self, new_config: StorageConfig) -> StorageResult<()> {
        for (_name, provider_config) in &new_config.providers {
            self.create_provider_from_config(provider_config)?;
        }

        {
            let mut config = self.config.write().await;
            *config = new_config;
        }

        {
            let mut providers = self.providers.write().await;
            providers.clear();
        }

        self.initialize_all_providers().await?;
        Ok(())
    }

    /// Update a Google Drive provider's configuration (e.g., after token refresh)
    pub async fn update_google_drive_config(
        &self,
        provider_name: &str,
        new_config: GoogleDriveConfig,
    ) -> StorageResult<()> {
        println!(
            "update_google_drive_config called for provider: {}",
            provider_name
        );
        println!(
            "New config has access_token: {}",
            new_config.access_token.is_some()
        );

        {
            let mut config = self.config.write().await;
            if let Some(provider_config) = config.providers.get_mut(provider_name) {
                if let ProviderConfig::GoogleDrive { config } = provider_config {
                    println!("Updating GoogleDrive config in memory");
                    *config = new_config.clone();
                } else {
                    return Err(StorageError::invalid_configuration(
                        "Provider is not Google Drive",
                    ));
                }
            } else {
                return Err(StorageError::provider_not_supported(
                    provider_name.to_string(),
                ));
            }
            println!("Saving config to disk...");
            config.save()?;
            println!("Config saved successfully");
        }

        {
            let mut providers = self.providers.write().await;
            let actual_name = self.map_provider_name(provider_name);
            if let Some(provider) = providers.get_mut(&actual_name) {
                *provider = Box::new(GoogleDriveProvider::new(new_config));
            }
        }

        Ok(())
    }

    /// Ensure Google Drive token is valid and refresh if needed, persisting the updated config
    pub async fn ensure_google_drive_token_valid(
        &self,
        provider_name: &str,
    ) -> StorageResult<GoogleDriveConfig> {
        let _actual_provider_name = self.map_provider_name(provider_name);

        // Get refresh lock to prevent concurrent refreshes
        let refresh_lock = self.get_refresh_lock(provider_name).await;
        let _guard = refresh_lock.lock().await;

        // Get current config.
        // Important: do NOT hold the RwLock guard across `.await` points below,
        // otherwise we'll deadlock when we later try to acquire a write lock in
        // `update_google_drive_config`.
        let gd_config = {
            let config = self.config.read().await;
            let provider_config = config
                .get_provider_config(provider_name)
                .ok_or_else(|| StorageError::provider_not_supported(provider_name.to_string()))?;

            match provider_config {
                ProviderConfig::GoogleDrive { config } => config.clone(),
                _ => {
                    return Err(StorageError::invalid_configuration(
                        "Provider is not Google Drive",
                    ));
                }
            }
        };

        // Check if token needs refresh
        let provider = GoogleDriveProvider::new(gd_config.clone());
        if provider.is_token_expired() {
            // Refresh token and get updated config
            let updated_config = GoogleDriveProvider::refresh_access_token_for_config(gd_config).await?;

            // Update the configuration
            self.update_google_drive_config(provider_name, updated_config.clone())
                .await?;

            Ok(updated_config)
        } else {
            Ok(gd_config)
        }
    }

    /// Get authentication info for a provider
    pub async fn get_provider_auth_info(
        &self,
        provider_name: &str,
    ) -> StorageResult<(bool, Option<DateTime<Utc>>)> {
        let config = self.config.read().await;
        let provider_config = config
            .get_provider_config(provider_name)
            .ok_or_else(|| StorageError::provider_not_supported(provider_name.to_string()))?;

        match provider_config {
            ProviderConfig::GoogleDrive { config } => {
                let authenticated = config.access_token.is_some() && !config.is_token_expired();
                Ok((authenticated, config.token_expires_at))
            }
            ProviderConfig::Local { .. } => {
                // Local provider doesn't need authentication
                Ok((true, None))
            }
        }
    }
}

impl GoogleDriveConfig {
    pub fn is_token_expired(&self) -> bool {
        if let (Some(_token), Some(expires_at)) =
            (&self.access_token, &self.token_expires_at)
        {
            Utc::now() >= *expires_at - chrono::Duration::minutes(5)
        } else {
            true
        }
    }
}
