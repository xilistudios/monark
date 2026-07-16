pub mod config;
pub mod error;
pub mod manager;
pub mod providers;

#[cfg(test)]
mod tests;

pub use config::{google_drive_config_from_env, ProviderConfig, StorageConfig, MONARK_DEFAULT_PROVIDER_NAME};
pub use config::set_storage_config_path;
pub use config::reset_storage_config_path;
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

    Arc::new(
        StorageManager::new(config)
            .await
            .expect("Failed to initialize storage manager"),
    )
}
