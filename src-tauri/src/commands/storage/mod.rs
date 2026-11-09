pub(crate) mod auth_status;
pub(crate) mod error;
pub(crate) mod oauth;
pub(crate) mod providers;

use std::sync::Arc;

use crate::storage::StorageManager;

/// Global state for the storage manager, injected into the commands through
/// Tauri's managed state.
pub struct StorageState {
    pub manager: Arc<StorageManager>,
}

pub use providers::{
    __cmd__add_provider, __cmd__authenticate_provider, __cmd__check_provider_auth_status,
    __cmd__create_file, __cmd__create_folder, __cmd__delete_file, __cmd__delete_folder,
    __cmd__get_file_info, __cmd__list_files, __cmd__list_providers, __cmd__list_vaults,
    __cmd__read_file, __cmd__remove_provider, __cmd__search_files, __cmd__set_default_provider,
    __cmd__update_file, add_provider, authenticate_provider, check_provider_auth_status,
    create_file, create_folder, delete_file, delete_folder, get_file_info, init_storage_manager,
    list_files, list_providers, list_vaults, read_file, remove_provider, search_files,
    set_default_provider, update_file, AddProviderRequest, CreateFileRequestDto,
    CreateFolderRequestDto, ProviderInfo, UpdateFileRequestDto,
};

pub use auth_status::{
    __cmd__get_provider_auth_info, __cmd__refresh_provider_auth, __cmd__test_webdav_connection,
    get_provider_auth_info, refresh_provider_auth, test_webdav_connection, ProviderAuthInfo,
};

pub use oauth::{
    __cmd__get_google_drive_oauth_url, __cmd__handle_google_drive_oauth_callback,
    get_google_drive_oauth_url, handle_google_drive_oauth_callback, OAuthCallbackRequest,
    OAuthUrlResponse,
};

// `classify_refresh_failure` is part of the storage error contract: it is
// referenced from `crate::storage::error` docs and exercised directly by the
// Google Drive auth tests in `crate::storage::tests`, which reach it through
// `crate::commands::storage::classify_refresh_failure`.
#[cfg(test)]
pub(crate) use auth_status::classify_refresh_failure;
