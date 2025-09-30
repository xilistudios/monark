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
    let config = StorageConfig::default();
    Arc::new(StorageManager::new(config).await.expect("Failed to initialize storage manager"))
}