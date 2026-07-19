use crate::storage::providers::google_drive::GoogleDriveConfig;
use crate::storage::{StorageError, StorageResult, MONARK_DEFAULT_PROVIDER_NAME};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::OnceLock;

const KEYCHAIN_KEY: &str = "monark_token_store";

static TOKEN_STORE_PATH: OnceLock<PathBuf> = OnceLock::new();

pub fn set_token_store_path(path: PathBuf) {
    let _ = TOKEN_STORE_PATH.set(path);
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StoredTokens {
    pub access_token: Option<String>,
    pub refresh_token: Option<String>,
    pub token_expires_at: Option<DateTime<Utc>>,
}

impl From<&GoogleDriveConfig> for StoredTokens {
    fn from(config: &GoogleDriveConfig) -> Self {
        Self {
            access_token: config.access_token.clone(),
            refresh_token: config.refresh_token.clone(),
            token_expires_at: config.token_expires_at,
        }
    }
}

impl StoredTokens {
    pub fn merge_into(&self, config: &mut GoogleDriveConfig) {
        config.access_token = self.access_token.clone();
        config.refresh_token = self.refresh_token.clone();
        config.token_expires_at = self.token_expires_at;
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct TokenStore {
    providers: HashMap<String, StoredTokens>,
}

impl TokenStore {
    /// Returns the legacy plaintext file path, used only for disk migration.
    fn token_file_path() -> PathBuf {
        TOKEN_STORE_PATH.get().cloned().unwrap_or_else(|| {
            dirs::data_dir()
                .unwrap_or_else(|| PathBuf::from("."))
                .join("monark")
                .join("provider_tokens.json")
        })
    }

    pub fn load() -> StorageResult<Self> {
        let json =
            crate::storage::keychain::get_secret(KEYCHAIN_KEY).map_err(StorageError::keychain)?;

        match json {
            Some(json) => {
                let mut store: TokenStore = serde_json::from_str(&json)?;

                // Migration: rename "Monark" provider to "Google Drive"
                if let Some(tokens) = store.providers.remove("Monark") {
                    store
                        .providers
                        .insert(MONARK_DEFAULT_PROVIDER_NAME.to_string(), tokens);
                    store.save()?;
                }

                Ok(store)
            }
            None => Ok(Self::default()),
        }
    }

    pub fn save(&self) -> StorageResult<()> {
        let json = serde_json::to_string_pretty(self)?;
        crate::storage::keychain::set_secret(KEYCHAIN_KEY, &json)
            .map_err(StorageError::keychain)?;
        Ok(())
    }

    /// One-time migration from legacy plaintext file on disk to the OS keychain.
    /// Returns `Ok(true)` if migration happened, `Ok(false)` if no old file was found.
    pub fn migrate_from_disk() -> Result<bool, String> {
        let path = Self::token_file_path();
        if !path.exists() {
            return Ok(false);
        }

        let content = std::fs::read_to_string(&path)
            .map_err(|e| format!("Failed to read old token file: {}", e))?;
        let store: TokenStore = serde_json::from_str(&content)
            .map_err(|e| format!("Failed to parse old token file: {}", e))?;
        store
            .save()
            .map_err(|e| format!("Failed to save tokens to keychain: {}", e))?;
        std::fs::remove_file(&path)
            .map_err(|e| format!("Failed to remove old token file: {}", e))?;

        Ok(true)
    }

    pub fn get_tokens(&self, provider_name: &str) -> Option<&StoredTokens> {
        self.providers.get(provider_name)
    }

    pub fn set_tokens(&mut self, provider_name: &str, tokens: StoredTokens) {
        self.providers.insert(provider_name.to_string(), tokens);
    }

    pub fn remove_tokens(&mut self, provider_name: &str) {
        self.providers.remove(provider_name);
    }

    pub fn get_monark_tokens(&self) -> Option<&StoredTokens> {
        self.get_tokens(MONARK_DEFAULT_PROVIDER_NAME)
    }

    pub fn set_monark_tokens(&mut self, tokens: StoredTokens) {
        self.set_tokens(MONARK_DEFAULT_PROVIDER_NAME, tokens);
    }
}
