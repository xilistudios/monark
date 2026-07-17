use super::providers::google_drive::GoogleDriveConfig;
use super::{StorageProviderType, StorageResult};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::OnceLock;

static STORAGE_CONFIG_PATH: OnceLock<PathBuf> = OnceLock::new();

/// The name used for the default Google Drive provider created from environment variables.
pub const MONARK_DEFAULT_PROVIDER_NAME: &str = "Monark";

pub fn set_storage_config_path(path: PathBuf) {
    let _ = STORAGE_CONFIG_PATH.set(path);
}

pub fn reset_storage_config_path() {
    let _ = STORAGE_CONFIG_PATH.get();
}

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
        STORAGE_CONFIG_PATH.get().cloned().unwrap_or_else(|| {
            dirs::data_dir()
                .unwrap_or_else(|| PathBuf::from("."))
                .join("monark")
                .join("storage_config.json")
        })
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

    /// Ensure the default "Monark" Google Drive provider exists if env vars are set.
    /// If the provider already exists, update its client_id/secret/redirect_uri from
    /// env vars but PRESERVE any existing OAuth tokens (access_token, refresh_token,
    /// token_expires_at).
    /// Returns `true` if the config was modified (provider added or credentials updated).
    pub fn ensure_monark_provider(&mut self) -> bool {
        let Some(env_config) = google_drive_config_from_env() else {
            return false;
        };

        if let Some(ProviderConfig::GoogleDrive { config: existing }) =
            self.providers.get(MONARK_DEFAULT_PROVIDER_NAME)
        {
            // Provider already exists — update credentials from env but preserve tokens
            let mut updated = existing.clone();
            updated.client_id = env_config.client_id;
            updated.client_secret = env_config.client_secret;
            updated.redirect_uri = env_config.redirect_uri;

            // Only update if something actually changed
            if updated.client_id != existing.client_id
                || updated.client_secret != existing.client_secret
                || updated.redirect_uri != existing.redirect_uri
            {
                self.providers.insert(
                    MONARK_DEFAULT_PROVIDER_NAME.to_string(),
                    ProviderConfig::GoogleDrive { config: updated },
                );
                return true;
            }
            return false;
        }

        // Provider named exactly "Monark" doesn't exist — but before creating it,
        // scan ALL existing providers for any Google Drive provider with the same
        // client_id as the env config. If found, update that provider's credentials
        // from env vars but PRESERVE its existing tokens, and do NOT create a duplicate.
        {
            let existing_name = self
                .providers
                .iter()
                .find_map(|(name, provider)| match provider {
                    ProviderConfig::GoogleDrive { config: gd_config }
                        if gd_config.client_id == env_config.client_id =>
                    {
                        Some(name.clone())
                    }
                    _ => None,
                });

            if let Some(existing_name) = existing_name {
                // Found a Google Drive provider with the same client_id — update its
                // credentials from env but preserve tokens.
                let existing_config = match self.providers.get(&existing_name) {
                    Some(ProviderConfig::GoogleDrive { config }) => config.clone(),
                    _ => return false,
                };

                let mut updated = existing_config.clone();
                updated.client_id = env_config.client_id;
                updated.client_secret = env_config.client_secret;
                updated.redirect_uri = env_config.redirect_uri;

                if updated.client_id != existing_config.client_id
                    || updated.client_secret != existing_config.client_secret
                    || updated.redirect_uri != existing_config.redirect_uri
                {
                    self.providers.insert(
                        existing_name,
                        ProviderConfig::GoogleDrive { config: updated },
                    );
                    return true;
                }
                return false;
            }
        }

        // No existing Google Drive provider with matching client_id — create "Monark"
        self.providers.insert(
            MONARK_DEFAULT_PROVIDER_NAME.to_string(),
            ProviderConfig::GoogleDrive { config: env_config },
        );
        true
    }
}

/// Read Google Drive OAuth credentials.
///
/// Tries **compile-time** env vars first (baked into the binary via `build.rs`
/// reading a local `.env` file), then falls back to **runtime** env vars for
/// dev/testing flexibility.
///
/// Returns `Some(config)` only if both `MONARK_GOOGLE_DRIVE_CLIENT_ID` and
/// `MONARK_GOOGLE_DRIVE_CLIENT_SECRET` are available and non-empty.
/// `MONARK_GOOGLE_DRIVE_REDIRECT_URI` is optional and defaults to
/// `https://monark-password-manager.web.app`.
pub fn google_drive_config_from_env() -> Option<GoogleDriveConfig> {
    // Helper: try compile-time (option_env!) first, then runtime (std::env::var)
    macro_rules! get_env {
        ($var:literal) => {{
            option_env!($var)
                .map(|s| s.trim())
                .filter(|s| !s.is_empty())
                .map(|s| s.to_string())
                .or_else(|| {
                    std::env::var($var)
                        .ok()
                        .map(|s| s.trim().to_string())
                        .filter(|s| !s.is_empty())
                })
        }};
    }

    let client_id = get_env!("MONARK_GOOGLE_DRIVE_CLIENT_ID")?;
    let client_secret = get_env!("MONARK_GOOGLE_DRIVE_CLIENT_SECRET")?;

    let redirect_uri = get_env!("MONARK_GOOGLE_DRIVE_REDIRECT_URI")
        .unwrap_or_else(|| "https://monark-password-manager.web.app".to_string());

    Some(GoogleDriveConfig {
        client_id,
        client_secret,
        redirect_uri,
        access_token: None,
        refresh_token: None,
        token_expires_at: None,
    })
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
