pub mod config;
pub mod error;
pub mod keychain;
pub mod manager;
pub mod providers;
pub mod token_store;

#[cfg(test)]
mod tests;

pub use config::reset_storage_config_path;
pub use config::set_storage_config_path;
pub use config::{
    google_drive_config_from_env, ProviderConfig, StorageConfig, MONARK_DEFAULT_PROVIDER_NAME,
};
pub use error::{StorageError, StorageResult};
pub use manager::StorageManager;
pub use providers::{StorageProvider, StorageProviderType};
pub use token_store::{set_token_store_path, TokenStore};

use std::sync::Arc;

/// Initialize the storage manager with default configuration
pub async fn init_storage_manager() -> StorageResult<Arc<StorageManager>> {
    // One-time migration: move any plaintext secrets from disk files to OS keychain
    if let Err(e) = crate::storage::TokenStore::migrate_from_disk() {
        println!("[Storage] Warning: token store migration failed: {}", e);
    }
    if let Err(e) = crate::storage::StorageConfig::migrate_secrets_from_disk() {
        println!("[Storage] Warning: config secrets migration failed: {}", e);
    }

    // Try to load config from disk, fallback to default if not found
    let mut config = StorageConfig::load().unwrap_or_default();

    // Migration: Rename old "Monark" provider to "Google Drive" if it exists
    if let Some(provider) = config.providers.remove("Monark") {
        config
            .providers
            .insert(MONARK_DEFAULT_PROVIDER_NAME.to_string(), provider);
        println!(
            "[Storage] Renamed provider 'Monark' to '{}'",
            MONARK_DEFAULT_PROVIDER_NAME
        );
    }

    // Migration: Extract tokens from the built-in Google Drive provider in storage_config.json
    // and move them to the separate token store before removing the provider.
    if let Some(ProviderConfig::GoogleDrive { config: gd_config }) =
        config.providers.get(MONARK_DEFAULT_PROVIDER_NAME)
    {
        if gd_config.access_token.is_some() || gd_config.refresh_token.is_some() {
            println!(
                "[Storage] Migrating Google Drive tokens from storage_config.json to provider_tokens.json"
            );
            let mut token_store = TokenStore::load().unwrap_or_default();
            token_store.set_monark_tokens(gd_config.into());
            let _ = token_store.save();
        }
    }

    // Migration: Remove any persisted built-in Google Drive provider from disk config.
    // Its credentials are embedded in the binary and must never live on disk.
    if config
        .providers
        .remove(MONARK_DEFAULT_PROVIDER_NAME)
        .is_some()
    {
        println!(
            "[Storage] Removed persisted {} provider from config (credentials are built-in)",
            MONARK_DEFAULT_PROVIDER_NAME
        );
        let _ = config.save();
    }

    // Ensure the default Google Drive provider exists in memory if
    // env vars are set. save() filters it out so there is no need to persist here.
    config.ensure_monark_provider();

    // Load and merge stored OAuth tokens for the Google Drive provider.
    // The credentials (client_id, client_secret, redirect_uri) come from env vars
    // via ensure_monark_provider(), while the tokens live in provider_tokens.json.
    if let Ok(token_store) = TokenStore::load() {
        if let Some(stored_tokens) = token_store.get_monark_tokens() {
            if let Some(ProviderConfig::GoogleDrive { config: gd_config }) =
                config.providers.get_mut(MONARK_DEFAULT_PROVIDER_NAME)
            {
                stored_tokens.merge_into(gd_config);
                println!("[Storage] Loaded OAuth tokens for Monark provider");
            }
        }
    }

    // One-time migration: Remove duplicate "Monark" provider with no tokens
    // if another Google Drive provider with the same client_id has valid tokens.
    // This cleans up the state created by the old bug where `ensure_monark_provider`
    // would always create a "Monark" entry even when the user had already authenticated
    // under a different provider name.
    {
        let (has_empty_monark, monark_client_id) =
            match config.providers.get(MONARK_DEFAULT_PROVIDER_NAME) {
                Some(ProviderConfig::GoogleDrive { config: mc })
                    if mc.access_token.is_none() && mc.refresh_token.is_none() =>
                {
                    (true, mc.client_id.clone())
                }
                _ => (false, String::new()),
            };

        if has_empty_monark {
            let existing_name = config.providers.iter().find_map(|(name, provider)| {
                if name == MONARK_DEFAULT_PROVIDER_NAME {
                    return None;
                }
                match provider {
                    ProviderConfig::GoogleDrive { config: gd_config }
                        if gd_config.client_id == monark_client_id
                            && gd_config.access_token.is_some() =>
                    {
                        Some(name.clone())
                    }
                    _ => None,
                }
            });

            if let Some(existing_name) = existing_name {
                println!(
                    "[Storage] Removing duplicate Monark provider (no tokens) — existing '{}' provider has valid tokens",
                    existing_name
                );
                config.providers.remove(MONARK_DEFAULT_PROVIDER_NAME);
                let _ = config.save();
            }
        }
    }

    Ok(Arc::new(StorageManager::new(config).await?))
}
