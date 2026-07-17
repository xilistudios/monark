pub mod config;
pub mod error;
pub mod manager;
pub mod providers;

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

use std::sync::Arc;

/// Initialize the storage manager with default configuration
pub async fn init_storage_manager() -> Arc<StorageManager> {
    // Try to load config from disk, fallback to default if not found
    let mut config = StorageConfig::load().unwrap_or_default();

    // Ensure the default "Monark" Google Drive provider exists if env vars are set.
    // This auto-registers the provider with credentials from the environment,
    // preserving any existing OAuth tokens the user may have already obtained.
    if config.ensure_monark_provider() {
        let _ = config.save();
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

    Arc::new(
        StorageManager::new(config)
            .await
            .expect("Failed to initialize storage manager"),
    )
}
