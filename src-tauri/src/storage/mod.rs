pub mod providers;
pub mod manager;
pub mod error;
pub mod config;

#[cfg(test)]
mod tests;

pub use providers::{StorageProvider, StorageProviderType};
pub use manager::StorageManager;
pub use error::{StorageError, StorageResult};
pub use config::{StorageConfig, ProviderConfig};

use std::sync::Arc;

/// Initialize the storage manager with default configuration
pub async fn init_storage_manager() -> Arc<StorageManager> {
    // Try to load config from disk, fallback to default if not found
    let config = StorageConfig::load().unwrap_or_default();
    Arc::new(StorageManager::new(config).await.expect("Failed to initialize storage manager"))
}