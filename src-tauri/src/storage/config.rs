use super::providers::google_drive::GoogleDriveConfig;
use super::providers::webdav::WebDavConfig;
use super::{StorageProviderType, StorageResult};
use chrono;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::OnceLock;

/// Store sensitive fields of a GoogleDriveConfig in the keychain and return a sanitized copy.
fn store_and_strip_gd_secrets(
    provider_name: &str,
    config: &GoogleDriveConfig,
) -> GoogleDriveConfig {
    let mut sanitized = config.clone();
    let key_prefix = format!("monark_secret::{}", provider_name);
    if !config.client_secret.is_empty() {
        let _ = crate::storage::keychain::set_secret(
            &format!("{}::client_secret", key_prefix),
            &config.client_secret,
        );
    }
    if let Some(ref token) = config.access_token {
        let _ =
            crate::storage::keychain::set_secret(&format!("{}::access_token", key_prefix), token);
    }
    if let Some(ref token) = config.refresh_token {
        let _ =
            crate::storage::keychain::set_secret(&format!("{}::refresh_token", key_prefix), token);
    }
    if let Some(expiry) = config.token_expires_at {
        let _ = crate::storage::keychain::set_secret(
            &format!("{}::token_expires_at", key_prefix),
            &expiry.to_rfc3339(),
        );
    }
    // Clear secrets from the copy that will be written to disk
    sanitized.client_secret = String::new();
    sanitized.access_token = None;
    sanitized.refresh_token = None;
    sanitized.token_expires_at = None;
    sanitized
}

/// Load sensitive fields from keychain and merge them into a GoogleDriveConfig.
fn load_gd_secrets(provider_name: &str, config: &mut GoogleDriveConfig) {
    let key_prefix = format!("monark_secret::{}", provider_name);
    if let Ok(Some(secret)) =
        crate::storage::keychain::get_secret(&format!("{}::client_secret", key_prefix))
    {
        if !secret.is_empty() {
            config.client_secret = secret;
        }
    }
    if let Ok(Some(token)) =
        crate::storage::keychain::get_secret(&format!("{}::access_token", key_prefix))
    {
        config.access_token = Some(token);
    }
    if let Ok(Some(token)) =
        crate::storage::keychain::get_secret(&format!("{}::refresh_token", key_prefix))
    {
        config.refresh_token = Some(token);
    }
    if let Ok(Some(expiry_str)) =
        crate::storage::keychain::get_secret(&format!("{}::token_expires_at", key_prefix))
    {
        if let Ok(expiry) = chrono::DateTime::parse_from_rfc3339(&expiry_str) {
            config.token_expires_at = Some(expiry.with_timezone(&chrono::Utc));
        }
    }
}

/// Store sensitive fields of a WebDavConfig in the keychain and return a sanitized copy.
fn store_and_strip_webdav_secrets(provider_name: &str, config: &WebDavConfig) -> WebDavConfig {
    let mut sanitized = config.clone();
    let key_prefix = format!("monark_secret::{}", provider_name);
    if !config.password.is_empty() {
        let _ = crate::storage::keychain::set_secret(
            &format!("{}::password", key_prefix),
            &config.password,
        );
    }
    sanitized.password = String::new();
    sanitized
}

/// Load sensitive fields from keychain and merge them into a WebDavConfig.
fn load_webdav_secrets(provider_name: &str, config: &mut WebDavConfig) {
    let key_prefix = format!("monark_secret::{}", provider_name);
    if let Ok(Some(password)) =
        crate::storage::keychain::get_secret(&format!("{}::password", key_prefix))
    {
        if !password.is_empty() {
            config.password = password;
        }
    }
}

static STORAGE_CONFIG_PATH: OnceLock<PathBuf> = OnceLock::new();

/// The name used for the default Google Drive provider created from environment variables.
pub const MONARK_DEFAULT_PROVIDER_NAME: &str = "Google Drive";

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
    #[serde(rename = "webdav")]
    WebDav { config: WebDavConfig },
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

    /// Load configuration from disk, merging secrets from the OS keychain.
    pub fn load() -> StorageResult<Self> {
        let config_path = Self::config_file_path();

        if !config_path.exists() {
            // Return default config if file doesn't exist
            return Ok(Self::default());
        }

        let config_str = std::fs::read_to_string(&config_path)?;

        let mut config: StorageConfig = serde_json::from_str(&config_str)?;

        // Merge secrets from keychain into each Google Drive provider
        for (name, provider) in config.providers.iter_mut() {
            if let ProviderConfig::GoogleDrive { config: gd_config } = provider {
                load_gd_secrets(name, gd_config);
            } else if let ProviderConfig::WebDav { config: wd_config } = provider {
                load_webdav_secrets(name, wd_config);
            }
        }

        Ok(config)
    }

    /// Save configuration to disk.
    ///
    /// The built-in "Monark" Google Drive provider (whose credentials are
    /// embedded in the binary) is **never** written to disk.
    /// Sensitive fields (client_secret, tokens) for user-added Google Drive
    /// providers are stored in the OS keychain and stripped before writing.
    pub fn save(&self) -> StorageResult<()> {
        let config_path = Self::config_file_path();

        // Create parent directory if it doesn't exist
        if let Some(parent) = config_path.parent() {
            std::fs::create_dir_all(parent)?;
        }

        // Filter out the built-in Monark provider — its credentials are embedded
        // in the binary and must never be written to disk.
        // For remaining Google Drive providers, strip secrets into keychain.
        let to_save = StorageConfig {
            providers: self
                .providers
                .iter()
                .filter(|(name, _)| name.as_str() != MONARK_DEFAULT_PROVIDER_NAME)
                .map(|(k, v)| {
                    let sanitized = match v {
                        ProviderConfig::GoogleDrive { config } => ProviderConfig::GoogleDrive {
                            config: store_and_strip_gd_secrets(k, config),
                        },
                        ProviderConfig::WebDav { config } => ProviderConfig::WebDav {
                            config: store_and_strip_webdav_secrets(k, config),
                        },
                        other => other.clone(),
                    };
                    (k.clone(), sanitized)
                })
                .collect(),
            default_provider: if self.default_provider == MONARK_DEFAULT_PROVIDER_NAME {
                // If the built-in was the default, fall back to "local" or the
                // first remaining provider.
                self.providers
                    .keys()
                    .find(|k| k.as_str() != MONARK_DEFAULT_PROVIDER_NAME)
                    .cloned()
                    .unwrap_or_else(|| "local".to_string())
            } else {
                self.default_provider.clone()
            },
            vault_folder: self.vault_folder.clone(),
        };

        let config_str = serde_json::to_string_pretty(&to_save)?;

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

    /// One-time migration: move secrets from plaintext on disk into the OS keychain.
    ///
    /// Loads the raw config from disk (without keychain merging), checks if any
    /// Google Drive provider still has non-empty secrets, and if so strips them
    /// into the keychain and re-saves the sanitized config.
    ///
    /// Returns `Ok(true)` if migration happened, `Ok(false)` if no migration was needed.
    pub fn migrate_secrets_from_disk() -> Result<bool, String> {
        let config_path = Self::config_file_path();
        if !config_path.exists() {
            return Ok(false);
        }

        let config_str = std::fs::read_to_string(&config_path)
            .map_err(|e| format!("Failed to read config: {}", e))?;
        let config: StorageConfig = serde_json::from_str(&config_str)
            .map_err(|e| format!("Failed to parse config: {}", e))?;

        // Check if any Google Drive provider has secrets on disk
        let needs_migration = config.providers.iter().any(|(_, provider)| match provider {
            ProviderConfig::GoogleDrive { config: gd_config } => {
                !gd_config.client_secret.is_empty()
                    || gd_config.access_token.is_some()
                    || gd_config.refresh_token.is_some()
                    || gd_config.token_expires_at.is_some()
            }
            ProviderConfig::WebDav { config: wd_config } => !wd_config.password.is_empty(),
            _ => false,
        });

        if !needs_migration {
            return Ok(false);
        }

        // Strip secrets into keychain and build sanitized config
        let sanitized = StorageConfig {
            providers: config
                .providers
                .iter()
                .map(|(k, v)| {
                    let sanitized_provider = match v {
                        ProviderConfig::GoogleDrive { config } => ProviderConfig::GoogleDrive {
                            config: store_and_strip_gd_secrets(k, config),
                        },
                        ProviderConfig::WebDav { config } => ProviderConfig::WebDav {
                            config: store_and_strip_webdav_secrets(k, config),
                        },
                        other => other.clone(),
                    };
                    (k.clone(), sanitized_provider)
                })
                .collect(),
            default_provider: config.default_provider.clone(),
            vault_folder: config.vault_folder.clone(),
        };

        let sanitized_str = serde_json::to_string_pretty(&sanitized)
            .map_err(|e| format!("Failed to serialize config: {}", e))?;
        std::fs::write(&config_path, sanitized_str)
            .map_err(|e| format!("Failed to write config: {}", e))?;

        Ok(true)
    }

    /// Delete all keychain entries for a given provider.
    ///
    /// Call this when a provider is removed to clean up its secrets from the keychain.
    pub fn delete_provider_secrets(provider_name: &str) {
        let key_prefix = format!("monark_secret::{}", provider_name);
        let _ = crate::storage::keychain::delete_secret(&format!("{}::client_secret", key_prefix));
        let _ = crate::storage::keychain::delete_secret(&format!("{}::access_token", key_prefix));
        let _ = crate::storage::keychain::delete_secret(&format!("{}::refresh_token", key_prefix));
        let _ =
            crate::storage::keychain::delete_secret(&format!("{}::token_expires_at", key_prefix));
        let _ = crate::storage::keychain::delete_secret(&format!("{}::password", key_prefix));
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
