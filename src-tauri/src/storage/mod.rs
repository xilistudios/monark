pub mod config;
pub mod error;
pub mod manager;
pub mod providers;

#[cfg(test)]
mod tests;

pub use config::{ProviderConfig, StorageConfig};
pub use config::set_storage_config_path;
pub use config::reset_storage_config_path;
pub use error::{StorageError, StorageResult};
pub use manager::StorageManager;
pub use providers::{StorageProvider, StorageProviderType};

use std::sync::Arc;

/// Initialize the storage manager with default configuration
pub async fn init_storage_manager() -> Arc<StorageManager> {
    // Try to load config from disk, fallback to default if not found
    let config = StorageConfig::load().unwrap_or_default();
    Arc::new(
        StorageManager::new(config)
            .await
            .expect("Failed to initialize storage manager"),
    )
}
