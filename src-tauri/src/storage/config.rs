use super::providers::google_drive::GoogleDriveConfig;
use super::{StorageProviderType, StorageResult};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StorageConfig {
    pub providers: HashMap<String, ProviderConfig>,
    pub default_provider: String,
    pub vault_folder: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ProviderConfig {
    Local { base_path: String },
    GoogleDrive { config: GoogleDriveConfig },
}

impl StorageConfig {
    pub fn new_local(base_path: String) -> Self {
        let mut providers = HashMap::new();
        providers.insert("local".to_string(), ProviderConfig::Local { base_path });

        Self {
            providers,
            default_provider: "local".to_string(),
            vault_folder: "Monark".to_string(), // Use "Monark" to match existing Google Drive folder structure
        }
    }

    pub fn with_google_drive(mut self, config: GoogleDriveConfig) -> Self {
        self.providers.insert(
            "google_drive".to_string(),
            ProviderConfig::GoogleDrive { config },
        );
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

    /// Get the path to the config file
    fn config_file_path() -> PathBuf {
        dirs::config_dir()
            .unwrap_or_else(|| PathBuf::from("."))
            .join("monark")
            .join("storage_config.json")
    }

    /// Load configuration from disk
    pub fn load() -> StorageResult<Self> {
        let config_path = Self::config_file_path();

        if !config_path.exists() {
            // Return default config if file doesn't exist
            return Ok(Self::default());
        }

        let config_str = std::fs::read_to_string(&config_path)?;

        let config: StorageConfig = serde_json::from_str(&config_str)?;

        Ok(config)
    }

    /// Save configuration to disk
    pub fn save(&self) -> StorageResult<()> {
        let config_path = Self::config_file_path();

        // Create parent directory if it doesn't exist
        if let Some(parent) = config_path.parent() {
            std::fs::create_dir_all(parent)?;
        }

        let config_str = serde_json::to_string_pretty(self)?;

        std::fs::write(&config_path, config_str)?;

        Ok(())
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
