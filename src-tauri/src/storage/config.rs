use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use super::{StorageProviderType};
use super::providers::google_drive::GoogleDriveConfig;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StorageConfig {
    pub providers: HashMap<String, ProviderConfig>,
    pub default_provider: String,
    pub vault_folder: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ProviderConfig {
    Local {
        base_path: String,
    },
    GoogleDrive {
        config: GoogleDriveConfig,
    },
}

impl StorageConfig {
    pub fn new_local(base_path: String) -> Self {
        let mut providers = HashMap::new();
        providers.insert("local".to_string(), ProviderConfig::Local { base_path });

        Self {
            providers,
            default_provider: "local".to_string(),
            vault_folder: "vaults".to_string(),
        }
    }

    pub fn with_google_drive(mut self, config: GoogleDriveConfig) -> Self {
        self.providers.insert("google_drive".to_string(), ProviderConfig::GoogleDrive { config });
        self
    }

    pub fn set_default_provider(mut self, provider: String) -> Self {
        if self.providers.contains_key(&provider) {
            self.default_provider = provider;
        }
        self
    }

    pub fn add_provider(&mut self, name: String, config: ProviderConfig) {
        self.providers.insert(name, config);
    }

    pub fn get_provider_config(&self, name: &str) -> Option<&ProviderConfig> {
        self.providers.get(name)
    }

    pub fn get_default_provider_config(&self) -> Option<&ProviderConfig> {
        self.providers.get(&self.default_provider)
    }

    pub fn provider_exists(&self, name: &str) -> bool {
        self.providers.contains_key(name)
    }

    pub fn list_providers(&self) -> Vec<String> {
        self.providers.keys().cloned().collect()
    }
}

impl Default for StorageConfig {
    fn default() -> Self {
        let local_path = dirs::data_dir()
            .unwrap_or_else(|| std::path::PathBuf::from("."))
            .join("monark")
            .to_string_lossy()
            .to_string();

        Self::new_local(local_path)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StorageCredentials {
    pub provider_type: StorageProviderType,
    pub credentials: HashMap<String, String>,
}

impl StorageCredentials {
    pub fn new_google_drive(
        client_id: String,
        client_secret: String,
        access_token: String,
        refresh_token: String,
    ) -> Self {
        let mut credentials = HashMap::new();
        credentials.insert("client_id".to_string(), client_id);
        credentials.insert("client_secret".to_string(), client_secret);
        credentials.insert("access_token".to_string(), access_token);
        credentials.insert("refresh_token".to_string(), refresh_token);

        Self {
            provider_type: StorageProviderType::GoogleDrive,
            credentials,
        }
    }

    pub fn new_local() -> Self {
        Self {
            provider_type: StorageProviderType::Local,
            credentials: HashMap::new(),
        }
    }
}