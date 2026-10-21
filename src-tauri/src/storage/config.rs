use super::providers::google_drive::GoogleDriveConfig;
use super::providers::webdav::WebDavConfig;
use super::{StorageError, StorageProviderType, StorageResult};
use chrono;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;

/// Store sensitive fields of a GoogleDriveConfig in the keychain and return a sanitized copy.
///
/// Returns `Err` if any keychain write fails, ensuring secrets are never
/// silently lost.
fn store_and_strip_gd_secrets(
    provider_name: &str,
    config: &GoogleDriveConfig,
) -> StorageResult<GoogleDriveConfig> {
    let sanitized = config.clone();
    let key_prefix = format!("monark_secret::{}", provider_name);
    if !config.client_secret.is_empty() {
        crate::storage::keychain::set_secret(
            &format!("{}::client_secret", key_prefix),
            &config.client_secret,
        )
        .map_err(StorageError::Keychain)?;
    }
    if let Some(ref token) = config.access_token {
        crate::storage::keychain::set_secret(&format!("{}::access_token", key_prefix), token)
            .map_err(StorageError::Keychain)?;
    }
    if let Some(ref token) = config.refresh_token {
        crate::storage::keychain::set_secret(&format!("{}::refresh_token", key_prefix), token)
            .map_err(StorageError::Keychain)?;
    }
    if let Some(expiry) = config.token_expires_at {
        crate::storage::keychain::set_secret(
            &format!("{}::token_expires_at", key_prefix),
            &expiry.to_rfc3339(),
        )
        .map_err(StorageError::Keychain)?;
    }
    // All keychain writes succeeded — safe to strip secrets from the disk copy.
    let mut sanitized = sanitized;
    sanitized.client_secret = String::new();
    sanitized.access_token = None;
    sanitized.refresh_token = None;
    sanitized.token_expires_at = None;
    Ok(sanitized)
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
///
/// Returns `Err` if any keychain write fails, ensuring secrets are never
/// silently lost.
fn store_and_strip_webdav_secrets(
    provider_name: &str,
    config: &WebDavConfig,
) -> StorageResult<WebDavConfig> {
    let sanitized = config.clone();
    let key_prefix = format!("monark_secret::{}", provider_name);
    if !config.password.is_empty() {
        crate::storage::keychain::set_secret(
            &format!("{}::password", key_prefix),
            &config.password,
        )
        .map_err(StorageError::Keychain)?;
    }
    // All keychain writes succeeded — safe to strip secrets from the disk copy.
    let mut sanitized = sanitized;
    sanitized.password = String::new();
    Ok(sanitized)
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

/// Fallback pointer to the config file, used when no task-local override is in
/// effect (see [`STORAGE_CONFIG_PATH_OVERRIDE`]). A `Mutex<Option<PathBuf>>`
/// (not a `OnceLock`) so the app can set it at startup and tests can reset it.
static STORAGE_CONFIG_PATH: std::sync::Mutex<Option<PathBuf>> = std::sync::Mutex::new(None);

// Task-local override of the config file path.
//
// Tests (and only tests) run each case on its own tokio task. When a test
// installs a task-local override, `save`/`load` resolve the path from *this*
// cell first, so concurrently-running tests never fight over the
// process-global [`STORAGE_CONFIG_PATH`] and cannot redirect each other's
// reads/writes. Outside a tokio task (i.e. in production), the override is
// always `None` and the process-global cell is used.
tokio::task_local! {
    static STORAGE_CONFIG_PATH_OVERRIDE: PathBuf;
}

#[cfg(test)]
thread_local! {
    /// Test-only *thread*-local override, used when the caller is not running
    /// inside a tokio task (e.g. a plain `#[test]`) or has spawned a blocking
    /// thread from inside a scoped override. `config_file_path()` consults
    /// this after the task-local override, then falls back to the
    /// process-global cell.
    static THREAD_LOCAL_CONFIG_PATH: std::cell::RefCell<Option<PathBuf>> =
        const { std::cell::RefCell::new(None) };
}

/// The name used for the default Google Drive provider created from environment variables.
pub const MONARK_DEFAULT_PROVIDER_NAME: &str = "Google Drive";

/// Write `contents` to `path` atomically: serialise to a sibling temp file,
/// then `std::fs::rename` it over `path`.
///
/// `std::fs::rename` replaces the destination on Unix and on Windows
/// (`MOVEFILE_REPLACE_EXISTING`), so a reader racing with this write observes
/// either the old file or the new one — never a truncated/partial JSON document.
/// The temp file lives in the same directory as `path`, which guarantees both
/// are on the same filesystem (a rename across filesystems would fail with
/// `EXDEV`).
///
/// On failure the temp file is removed and the original file is left untouched;
/// the `rename` error is propagated.
fn write_config_atomically(path: &std::path::Path, contents: &str) -> StorageResult<()> {
    let temp_path = path.with_extension(format!(
        "json.tmp-{}-{}",
        std::process::id(),
        // A per-call unique suffix so two concurrent `save()`s in this process
        // (or a leftover temp file from a crashed run) never collide.
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0),
    ));

    if let Err(err) = std::fs::write(&temp_path, contents) {
        let _ = std::fs::remove_file(&temp_path);
        return Err(err.into());
    }

    if let Err(err) = std::fs::rename(&temp_path, path) {
        let _ = std::fs::remove_file(&temp_path);
        return Err(err.into());
    }

    Ok(())
}

pub fn set_storage_config_path(path: PathBuf) {
    let mut guard = STORAGE_CONFIG_PATH.lock().unwrap();
    *guard = Some(path);
}

/// Run `fut` with `StorageConfig::save`/`load` pointed at `path` for the
/// duration of the returned future. No global state is touched, so
/// concurrently-running tests on other tokio tasks are unaffected; the
/// override is scoped to the future (via tokio's task-local) and cleared
/// automatically when it completes.
#[cfg(test)]
pub(crate) async fn with_storage_config_path<R>(
    path: PathBuf,
    fut: impl std::future::Future<Output = R>,
) -> R {
    // Set the thread-local on the *calling* thread too, so any synchronous
    // work done by `fut` before its first await (and any code running on this
    // thread between polls) also sees the override.
    let previous = THREAD_LOCAL_CONFIG_PATH.with(|c| c.borrow_mut().replace(path.clone()));
    let result = STORAGE_CONFIG_PATH_OVERRIDE.scope(path, fut).await;
    THREAD_LOCAL_CONFIG_PATH.with(|c| {
        *c.borrow_mut() = previous;
    });
    result
}

pub fn reset_storage_config_path() {
    let mut guard = STORAGE_CONFIG_PATH.lock().unwrap();
    *guard = None;
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
    Local {
        base_path: String,
    },
    GoogleDrive {
        config: GoogleDriveConfig,
    },
    #[serde(rename = "webdav")]
    WebDav {
        config: WebDavConfig,
    },
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
        // Prefer the task-local override so tests running on distinct tokio
        // tasks never interfere with each other.
        if let Ok(path) = STORAGE_CONFIG_PATH_OVERRIDE.try_with(|p| p.clone()) {
            return path;
        }
        // Fall back to the thread-local override (set by `with_storage_config_path`
        // on the calling thread, for callers outside a tokio task or on blocking
        // threads spawned from a scoped override).
        #[cfg(test)]
        if let Some(path) = THREAD_LOCAL_CONFIG_PATH.with(|c| c.borrow().clone()) {
            return path;
        }
        let g = STORAGE_CONFIG_PATH.lock().unwrap();
        g.clone().unwrap_or_else(|| {
            dirs::data_dir()
                .unwrap_or_else(|| PathBuf::from("."))
                .join("monark")
                .join("storage_config.json")
        })
    }

    /// Test-only: expose the resolved config file path so tests can read back
    /// the exact file that `save`/`load` will use (respecting task-local and
    /// thread-local overrides).
    #[cfg(test)]
    pub(crate) fn config_file_path_for_test() -> PathBuf {
        Self::config_file_path()
    }

    /// Load configuration from disk, merging secrets from the OS keychain.
    #[track_caller]
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
    ///
    /// The write is **atomic**: the JSON is serialised to a sibling temp file
    /// first and then `rename`d over the destination, so a concurrent reader
    /// (another `StorageConfig::load`, a `migrate_secrets_from_disk`, the test
    /// suite's shared config path) either sees the previous file or the new one
    /// — never a truncated/partial file. `std::fs::rename` replaces the
    /// destination on both Unix and Windows (`MOVEFILE_REPLACE_EXISTING`), so
    /// the observable behaviour (same path, same contents) is unchanged.
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
                            config: store_and_strip_gd_secrets(k, config)?,
                        },
                        ProviderConfig::WebDav { config } => ProviderConfig::WebDav {
                            config: store_and_strip_webdav_secrets(k, config)?,
                        },
                        other => other.clone(),
                    };
                    Ok((k.clone(), sanitized))
                })
                .collect::<Result<HashMap<_, _>, StorageError>>()?,
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

        write_config_atomically(&config_path, &config_str)?;

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
    pub fn migrate_secrets_from_disk() -> StorageResult<bool> {
        let config_path = Self::config_file_path();
        if !config_path.exists() {
            return Ok(false);
        }

        let config_str = std::fs::read_to_string(&config_path)?;
        let config: StorageConfig = serde_json::from_str(&config_str)?;

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
                            config: store_and_strip_gd_secrets(k, config)?,
                        },
                        ProviderConfig::WebDav { config } => ProviderConfig::WebDav {
                            config: store_and_strip_webdav_secrets(k, config)?,
                        },
                        other => other.clone(),
                    };
                    Ok((k.clone(), sanitized_provider))
                })
                .collect::<Result<HashMap<_, _>, StorageError>>()?,
            default_provider: config.default_provider.clone(),
            vault_folder: config.vault_folder.clone(),
        };

        let sanitized_str = serde_json::to_string_pretty(&sanitized)?;
        write_config_atomically(&config_path, &sanitized_str)?;

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
