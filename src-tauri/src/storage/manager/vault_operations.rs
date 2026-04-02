use super::StorageManager;
use super::{StorageError, StorageResult};
use crate::storage::providers::{StorageFile, StorageProviderType};
use std::sync::Arc;
use tokio::sync::Mutex;

impl StorageManager {
    pub async fn ensure_vault_folder(
        &self,
        provider_name: Option<String>,
    ) -> StorageResult<String> {
        let provider_name_str = if let Some(name) = &provider_name {
            name.clone()
        } else {
            let config = self.config.read().await;
            config.default_provider.clone()
        };

        println!(
            "[StorageManager::ensure_vault_folder] Ensuring vault folder for provider: '{}'",
            provider_name_str
        );

        let actual_provider_name = self.resolve_provider_key(&provider_name_str).await;

        // Check if provider is local - local storage doesn't need a vault folder
        {
            let providers = self.providers.read().await;
            if let Some(provider) = providers.get(&actual_provider_name) {
                if provider.provider_type() == StorageProviderType::Local {
                    println!(
                        "[StorageManager::ensure_vault_folder] Local provider - no vault folder needed"
                    );
                    return Ok("local".to_string());
                }
            }
        }

        {
            let cache = self.vault_folder_cache.read().await;
            if let Some(folder_id) = cache.get(&actual_provider_name) {
                println!(
                    "[StorageManager::ensure_vault_folder] Found cached vault folder ID: '{}'",
                    folder_id
                );
                return Ok(folder_id.clone());
            }
        }

        let creation_lock = {
            let mut locks = self.folder_creation_locks.write().await;
            locks
                .entry(actual_provider_name.clone())
                .or_insert_with(|| Arc::new(Mutex::new(())))
                .clone()
        };

        let _guard = creation_lock.lock().await;

        {
            let cache = self.vault_folder_cache.read().await;
            if let Some(folder_id) = cache.get(&actual_provider_name) {
                return Ok(folder_id.clone());
            }
        }

        let config = self.config.read().await;
        let vault_folder_name = config.vault_folder.clone();
        drop(config);

        let mut providers = self.providers.write().await;
        if let Some(provider) = providers.get_mut(&actual_provider_name) {
            let search_results = provider.search_files(vault_folder_name.clone()).await?;

            println!(
                "[StorageManager] Search results for '{}': {} items",
                vault_folder_name,
                search_results.len()
            );
            for (i, file) in search_results.iter().enumerate() {
                println!(
                    "[StorageManager]   [{}] name='{}', is_folder={}, id='{}', parent_id={:?}, mime_type={:?}",
                    i,
                    file.name,
                    file.is_folder,
                    file.id,
                    file.parent_id,
                    file.mime_type
                );
            }

            let folder_candidates: Vec<_> = search_results
                .iter()
                .filter(|f| {
                    let is_valid_folder = f.is_folder
                        && !f.id.starts_with('/')
                        && (f.mime_type.is_none()
                            || f.mime_type.as_ref().map_or(true, |mt| {
                                mt == "application/vnd.google-apps.folder" || mt.contains("folder")
                            }));

                    if !is_valid_folder && f.is_folder {
                        println!(
                            "[StorageManager]   Skipping folder candidate '{}' (id='{}') - failed validation",
                            f.name,
                            f.id
                        );
                    }

                    is_valid_folder
                })
                .collect();

            println!(
                "[StorageManager] Found {} valid folder candidates after filtering",
                folder_candidates.len()
            );

            if let Some(vault_folder) = folder_candidates.first() {
                let folder_id = vault_folder.id.clone();
                println!(
                    "[StorageManager] Using existing folder: id='{}', name='{}'",
                    folder_id, vault_folder.name
                );
                drop(providers);

                let mut cache = self.vault_folder_cache.write().await;
                cache.insert(actual_provider_name.clone(), folder_id.clone());
                return Ok(folder_id);
            }

            println!("[StorageManager] No existing folder found, creating new one");

            let create_request = crate::storage::providers::CreateFolderRequest {
                name: vault_folder_name.clone(),
                path: format!("/{}", vault_folder_name),
                parent_id: None,
                metadata: None,
            };

            let folder = provider.create_folder(create_request).await?;
            let folder_id = folder.id.clone();
            println!(
                "[StorageManager] Created new folder: id='{}', name='{}'",
                folder_id, folder.name
            );
            drop(providers);

            let mut cache = self.vault_folder_cache.write().await;
            cache.insert(actual_provider_name.clone(), folder_id.clone());

            return Ok(folder_id);
        }

        Err(StorageError::provider_not_supported(actual_provider_name))
    }

    pub async fn list_vaults(
        &self,
        provider_name: Option<String>,
    ) -> StorageResult<Vec<StorageFile>> {
        let provider_name_str = if let Some(name) = &provider_name {
            name.clone()
        } else {
            let config = self.config.read().await;
            config.default_provider.clone()
        };

        println!(
            "[StorageManager::list_vaults] Listing vaults for provider: '{}'",
            provider_name_str
        );

        let actual_provider_name = self.resolve_provider_key(&provider_name_str).await;

        let mut providers = self.providers.write().await;
        if let Some(provider) = providers.get_mut(&actual_provider_name) {
            // Use the provider's list_vaults method directly
            // This handles local vs cloud providers appropriately
            let vault_files = provider.list_vaults().await?;

            println!(
                "[StorageManager::list_vaults] Found {} vault files for provider '{}'",
                vault_files.len(),
                actual_provider_name
            );
            for (i, file) in vault_files.iter().enumerate() {
                println!(
                    "[StorageManager::list_vaults]   [{}] name='{}', id='{}'",
                    i, file.name, file.id
                );
            }
            return Ok(vault_files);
        }

        Err(StorageError::provider_not_supported(actual_provider_name))
    }
}
