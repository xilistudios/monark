use super::StorageManager;
use super::{StorageError, StorageResult};
use crate::storage::providers::{
    CreateFileRequest, CreateFolderRequest, StorageFile, UpdateFileRequest,
};

impl StorageManager {
    pub async fn authenticate(&self, provider_name: Option<String>) -> StorageResult<()> {
        let provider_name_str = if let Some(name) = &provider_name {
            name.clone()
        } else {
            let config = self.config.read().await;
            config.default_provider.clone()
        };

        let actual_provider_name = self.map_provider_name(&provider_name_str);

        {
            let mut providers = self.providers.write().await;
            if let Some(provider) = providers.get_mut(&actual_provider_name) {
                provider.authenticate().await?;
                return Ok(());
            }
        }

        let provider_config_opt = {
            let config = self.config.read().await;
            config.get_provider_config(&provider_name_str).cloned()
        };

        if let Some(provider_config) = provider_config_opt {
            let mut provider = self.create_provider_from_config(&provider_config)?;
            provider.authenticate().await?;

            let mut providers = self.providers.write().await;
            providers.insert(actual_provider_name.clone(), provider);

            Ok(())
        } else {
            Err(StorageError::provider_not_supported(actual_provider_name))
        }
    }

    pub async fn list_files(
        &self,
        folder_id: Option<String>,
        provider_name: Option<String>,
    ) -> StorageResult<Vec<StorageFile>> {
        let provider_name_str = if let Some(name) = &provider_name {
            name.clone()
        } else {
            let config = self.config.read().await;
            config.default_provider.clone()
        };

        let actual_provider_name = self.map_provider_name(&provider_name_str);

        let mut providers = self.providers.write().await;
        if let Some(provider) = providers.get_mut(&actual_provider_name) {
            return provider.list_files(folder_id).await;
        }

        drop(providers);

        let provider_config_opt = {
            let config = self.config.read().await;
            config.get_provider_config(&provider_name_str).cloned()
        };

        if let Some(provider_config) = provider_config_opt {
            let mut provider = self.create_provider_from_config(&provider_config)?;
            let result = provider.list_files(folder_id.clone()).await?;

            let mut providers = self.providers.write().await;
            providers.insert(actual_provider_name.clone(), provider);

            return Ok(result);
        }

        Err(StorageError::provider_not_supported(actual_provider_name))
    }

    pub async fn create_file(
        &self,
        request: CreateFileRequest,
        provider_name: Option<String>,
    ) -> StorageResult<StorageFile> {
        let provider_name_str = if let Some(name) = &provider_name {
            name.clone()
        } else {
            let config = self.config.read().await;
            config.default_provider.clone()
        };

        let actual_provider_name = self.map_provider_name(&provider_name_str);

        let mut providers = self.providers.write().await;
        if let Some(provider) = providers.get_mut(&actual_provider_name) {
            return provider.create_file(request).await;
        }

        drop(providers);

        let provider_config_opt = {
            let config = self.config.read().await;
            config.get_provider_config(&provider_name_str).cloned()
        };

        if let Some(provider_config) = provider_config_opt {
            let mut provider = self.create_provider_from_config(&provider_config)?;
            let result = provider.create_file(request).await?;

            let mut providers = self.providers.write().await;
            providers.insert(actual_provider_name.clone(), provider);

            return Ok(result);
        }

        Err(StorageError::provider_not_supported(actual_provider_name))
    }

    pub async fn read_file(
        &self,
        file_id: String,
        provider_name: Option<String>,
    ) -> StorageResult<Vec<u8>> {
        let provider_name_str = if let Some(name) = &provider_name {
            name.clone()
        } else {
            let config = self.config.read().await;
            config.default_provider.clone()
        };

        let actual_provider_name = self.map_provider_name(&provider_name_str);

        let mut providers = self.providers.write().await;
        if let Some(provider) = providers.get_mut(&actual_provider_name) {
            return provider.read_file(file_id).await;
        }

        drop(providers);

        let provider_config_opt = {
            let config = self.config.read().await;
            config.get_provider_config(&provider_name_str).cloned()
        };

        if let Some(provider_config) = provider_config_opt {
            let mut provider = self.create_provider_from_config(&provider_config)?;
            let result = provider.read_file(file_id.clone()).await?;

            let mut providers = self.providers.write().await;
            providers.insert(actual_provider_name.clone(), provider);

            return Ok(result);
        }

        Err(StorageError::provider_not_supported(actual_provider_name))
    }

    pub async fn delete_file(
        &self,
        file_id: String,
        provider_name: Option<String>,
    ) -> StorageResult<()> {
        let provider_name_str = if let Some(name) = &provider_name {
            name.clone()
        } else {
            let config = self.config.read().await;
            config.default_provider.clone()
        };

        let actual_provider_name = self.map_provider_name(&provider_name_str);

        let mut providers = self.providers.write().await;
        if let Some(provider) = providers.get_mut(&actual_provider_name) {
            return provider.delete_file(file_id).await;
        }

        drop(providers);

        let provider_config_opt = {
            let config = self.config.read().await;
            config.get_provider_config(&provider_name_str).cloned()
        };

        if let Some(provider_config) = provider_config_opt {
            let mut provider = self.create_provider_from_config(&provider_config)?;
            provider.delete_file(file_id.clone()).await?;

            let mut providers = self.providers.write().await;
            providers.insert(actual_provider_name.clone(), provider);

            return Ok(());
        }

        Err(StorageError::provider_not_supported(actual_provider_name))
    }

    pub async fn update_file(
        &self,
        request: UpdateFileRequest,
        provider_name: Option<String>,
    ) -> StorageResult<StorageFile> {
        let provider_name_str = if let Some(name) = &provider_name {
            name.clone()
        } else {
            let config = self.config.read().await;
            config.default_provider.clone()
        };

        let actual_provider_name = self.map_provider_name(&provider_name_str);

        let mut providers = self.providers.write().await;
        if let Some(provider) = providers.get_mut(&actual_provider_name) {
            return provider.update_file(request).await;
        }

        drop(providers);

        let provider_config_opt = {
            let config = self.config.read().await;
            config.get_provider_config(&provider_name_str).cloned()
        };

        if let Some(provider_config) = provider_config_opt {
            let mut provider = self.create_provider_from_config(&provider_config)?;
            let result = provider.update_file(request).await?;

            let mut providers = self.providers.write().await;
            providers.insert(actual_provider_name.clone(), provider);

            return Ok(result);
        }

        Err(StorageError::provider_not_supported(actual_provider_name))
    }

    pub async fn create_folder(
        &self,
        request: CreateFolderRequest,
        provider_name: Option<String>,
    ) -> StorageResult<StorageFile> {
        let provider_name_str = if let Some(name) = &provider_name {
            name.clone()
        } else {
            let config = self.config.read().await;
            config.default_provider.clone()
        };

        let actual_provider_name = self.map_provider_name(&provider_name_str);

        let mut providers = self.providers.write().await;
        if let Some(provider) = providers.get_mut(&actual_provider_name) {
            return provider.create_folder(request).await;
        }

        drop(providers);

        let provider_config_opt = {
            let config = self.config.read().await;
            config.get_provider_config(&provider_name_str).cloned()
        };

        if let Some(provider_config) = provider_config_opt {
            let mut provider = self.create_provider_from_config(&provider_config)?;
            let result = provider.create_folder(request).await?;

            let mut providers = self.providers.write().await;
            providers.insert(actual_provider_name.clone(), provider);

            return Ok(result);
        }

        Err(StorageError::provider_not_supported(actual_provider_name))
    }

    pub async fn delete_folder(
        &self,
        folder_id: String,
        provider_name: Option<String>,
    ) -> StorageResult<()> {
        let provider_name_str = if let Some(name) = &provider_name {
            name.clone()
        } else {
            let config = self.config.read().await;
            config.default_provider.clone()
        };

        let actual_provider_name = self.map_provider_name(&provider_name_str);

        let mut providers = self.providers.write().await;
        if let Some(provider) = providers.get_mut(&actual_provider_name) {
            return provider.delete_folder(folder_id).await;
        }

        drop(providers);

        let provider_config_opt = {
            let config = self.config.read().await;
            config.get_provider_config(&provider_name_str).cloned()
        };

        if let Some(provider_config) = provider_config_opt {
            let mut provider = self.create_provider_from_config(&provider_config)?;
            provider.delete_folder(folder_id.clone()).await?;

            let mut providers = self.providers.write().await;
            providers.insert(actual_provider_name.clone(), provider);

            return Ok(());
        }

        Err(StorageError::provider_not_supported(actual_provider_name))
    }

    pub async fn get_file_info(
        &self,
        file_id: String,
        provider_name: Option<String>,
    ) -> StorageResult<StorageFile> {
        let provider_name_str = if let Some(name) = &provider_name {
            name.clone()
        } else {
            let config = self.config.read().await;
            config.default_provider.clone()
        };

        let actual_provider_name = self.map_provider_name(&provider_name_str);

        let mut providers = self.providers.write().await;
        if let Some(provider) = providers.get_mut(&actual_provider_name) {
            return provider.get_file_info(file_id).await;
        }

        drop(providers);

        let provider_config_opt = {
            let config = self.config.read().await;
            config.get_provider_config(&provider_name_str).cloned()
        };

        if let Some(provider_config) = provider_config_opt {
            let mut provider = self.create_provider_from_config(&provider_config)?;
            let result = provider.get_file_info(file_id.clone()).await?;

            let mut providers = self.providers.write().await;
            providers.insert(actual_provider_name.clone(), provider);

            return Ok(result);
        }

        Err(StorageError::provider_not_supported(actual_provider_name))
    }

    pub async fn search_files(
        &self,
        query: String,
        provider_name: Option<String>,
    ) -> StorageResult<Vec<StorageFile>> {
        let provider_name_str = if let Some(name) = &provider_name {
            name.clone()
        } else {
            let config = self.config.read().await;
            config.default_provider.clone()
        };

        let actual_provider_name = self.map_provider_name(&provider_name_str);

        let mut providers = self.providers.write().await;
        if let Some(provider) = providers.get_mut(&actual_provider_name) {
            return provider.search_files(query).await;
        }

        drop(providers);

        let provider_config_opt = {
            let config = self.config.read().await;
            config.get_provider_config(&provider_name_str).cloned()
        };

        if let Some(provider_config) = provider_config_opt {
            let mut provider = self.create_provider_from_config(&provider_config)?;
            let result = provider.search_files(query.clone()).await?;

            let mut providers = self.providers.write().await;
            providers.insert(actual_provider_name.clone(), provider);

            return Ok(result);
        }

        Err(StorageError::provider_not_supported(actual_provider_name))
    }
}
