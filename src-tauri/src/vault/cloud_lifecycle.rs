//! Cloud (provider-backed) vault lifecycle.
//!
//! Like the local lifecycle, this module only orchestrates: provider IO, the
//! offline cache, rate limiting, the version gate and the write-path merge. The
//! cryptographic steps are the shared ones in [`crate::vault::keys`] (T07), so a
//! local and a cloud vault are unwrapped, decrypted and re-wrapped by exactly
//! the same code.

use crate::commands::errors::CommandError;
use crate::commands::storage::StorageState;
use crate::models::{Vault, VaultFile, VaultView};
use crate::storage::providers::{CreateFileRequest, StorageFile, UpdateFileRequest};
use crate::storage::StorageManager;
use crate::vault::keys;
use crate::vault::merge::merge_vault_view;
use crate::vault::version;
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use chrono::Utc;
use std::fs;
use std::path::PathBuf;
use std::sync::{Arc, OnceLock};
use zeroize::Zeroizing;

static CLOUD_CACHE_BASE_DIR: OnceLock<PathBuf> = OnceLock::new();

/// Set the cloud cache base directory. Called from Tauri `.setup()`.
pub fn set_cloud_cache_path(path: PathBuf) {
    let _ = CLOUD_CACHE_BASE_DIR.set(path);
}

const VAULT_EXTENSION: &str = "monark";

fn sanitize_path_component(input: &str) -> String {
    let sanitized: String = input
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '-' || c == '_' {
                c
            } else {
                '_'
            }
        })
        .collect();

    if sanitized.trim_matches('_').is_empty() {
        "default".to_string()
    } else {
        sanitized
    }
}

fn cloud_cache_file_path(provider: &str, vault_id: &str) -> PathBuf {
    let base_dir = CLOUD_CACHE_BASE_DIR.get().cloned().unwrap_or_else(|| {
        dirs::data_dir()
            .unwrap_or_else(|| PathBuf::from("."))
            .join("monark")
            .join("cloud_cache")
    });
    base_dir
        .join(sanitize_path_component(provider))
        .join(format!("{}.monark", sanitize_path_component(vault_id)))
}

pub(crate) fn cache_vault_bytes(
    provider: &str,
    vault_id: &str,
    data: &[u8],
) -> Result<(), CommandError> {
    let path = cloud_cache_file_path(provider, vault_id);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|_e| CommandError::Io("Failed to create cloud cache directory".to_string()))?;
    }

    // Atomic write: write to temp file, then rename.
    // This prevents corruption if the app is killed mid-write (common on mobile).
    let tmp_path = path.with_extension("monark.tmp");
    fs::write(&tmp_path, data)
        .map_err(|_e| CommandError::Io("Failed to write cached cloud vault".to_string()))?;
    fs::rename(&tmp_path, &path)
        .map_err(|_e| CommandError::Io("Failed to rename cached cloud vault".to_string()))
}

fn load_cached_vault(provider: &str, vault_id: &str) -> Result<Vec<u8>, CommandError> {
    let path = cloud_cache_file_path(provider, vault_id);
    fs::read(&path).map_err(|_e| CommandError::Io("Failed to read cached cloud vault".to_string()))
}

fn map_provider_name_for_cache(provider_name: &str) -> String {
    let normalized = provider_name.trim().to_lowercase().replace([' ', '-'], "_");

    if normalized == "drive" || normalized == "google_drive" {
        "google_drive".to_string()
    } else {
        provider_name.to_string()
    }
}

pub(crate) async fn resolve_provider_name(
    storage_manager: &Arc<StorageManager>,
    provider_name: &Option<String>,
) -> Result<String, CommandError> {
    let raw_name = if let Some(name) = provider_name {
        name.clone()
    } else {
        storage_manager.get_default_provider().await
    };

    Ok(map_provider_name_for_cache(&raw_name))
}

#[tauri::command(async)]
pub async fn write_cloud_vault(
    vault_name: String,
    password: String,
    vault_content: VaultView,
    provider_name: Option<String>,
    parent_id: Option<String>,
    vault_id: Option<String>,
    state: tauri::State<'_, StorageState>,
) -> Result<String, CommandError> {
    write_cloud_vault_with(
        vault_name,
        password,
        vault_content,
        provider_name,
        parent_id,
        vault_id,
        &state.manager,
    )
    .await
}

/// Body of [`write_cloud_vault`], taking the storage manager directly.
///
/// The `tauri::State` wrapper only exists for IPC; keeping the logic here lets
/// the write-path merge be tested end to end against a real (local) provider
/// without building a Tauri app.
pub(crate) async fn write_cloud_vault_with(
    vault_name: String,
    password: String,
    vault_content: VaultView,
    provider_name: Option<String>,
    parent_id: Option<String>,
    vault_id: Option<String>,
    storage_manager: &Arc<StorageManager>,
) -> Result<String, CommandError> {
    // If vault_id is provided, directly update the existing vault
    if let Some(id) = vault_id {
        update_existing_cloud_vault(
            &id,
            &password,
            vault_content,
            provider_name,
            storage_manager,
        )
        .await?;
        return Ok(id);
    }

    // Use provided parent_id or ensure default vault folder exists
    let vault_folder_id = if let Some(pid) = parent_id {
        pid
    } else {
        storage_manager
            .ensure_vault_folder(provider_name.clone())
            .await
            .map_err(|_e| CommandError::Io("Failed to ensure vault folder".to_string()))?
    };

    let vault_file_name = format!("{}.{}", vault_name, VAULT_EXTENSION);

    // Get the vault folder name from config for the path
    let vault_folder_name = {
        let config = storage_manager.get_config().await;
        config.vault_folder.clone()
    };
    let vault_path = format!("/{}/{}", vault_folder_name, vault_file_name);

    // Check if vault already exists by filename (for backwards compatibility)
    println!(
        "[write_cloud_vault] Checking for existing vaults with name: '{}'",
        vault_file_name
    );
    let existing_vaults = storage_manager
        .list_vaults(provider_name.clone())
        .await
        .map_err(|_e| CommandError::Io("Failed to list vaults".to_string()))?;

    println!(
        "[write_cloud_vault] Found {} existing vaults",
        existing_vaults.len()
    );
    for (i, vault) in existing_vaults.iter().enumerate() {
        println!(
            "[write_cloud_vault]   [{}] name='{}', id='{}'",
            i, vault.name, vault.id
        );
    }

    if let Some(existing_vault) = existing_vaults.iter().find(|v| v.name == vault_file_name) {
        println!(
            "[write_cloud_vault] Found existing vault with matching name, updating: id='{}'",
            existing_vault.id
        );
        // Update existing vault
        update_existing_cloud_vault(
            &existing_vault.id,
            &password,
            vault_content,
            provider_name,
            storage_manager,
        )
        .await?;
        Ok(existing_vault.id.clone())
    } else {
        println!(
            "[write_cloud_vault] No existing vault found with name '{}', creating new vault",
            vault_file_name
        );
        // Create new vault
        create_new_cloud_vault(
            &vault_file_name,
            &vault_path,
            &password,
            vault_content,
            Some(vault_folder_id),
            provider_name,
            storage_manager,
        )
        .await
    }
}

/// Reads and decrypts a cloud vault, returning the **sanitized** IPC view.
///
/// Same rule as `lifecycle::read_vault`: the decrypted [`Vault`] (which holds
/// passkey private keys) is converted to [`VaultView`] and dropped (zeroized)
/// before returning.
#[tauri::command(async)]
pub async fn read_cloud_vault(
    vault_id: String,
    password: String,
    provider_name: Option<String>,
    state: tauri::State<'_, StorageState>,
) -> Result<VaultView, CommandError> {
    read_cloud_vault_with(vault_id, password, provider_name, &state.manager).await
}

/// Body of [`read_cloud_vault`], taking the storage manager directly.
pub(crate) async fn read_cloud_vault_with(
    vault_id: String,
    password: String,
    provider_name: Option<String>,
    storage_manager: &Arc<StorageManager>,
) -> Result<VaultView, CommandError> {
    let provider_cache_key = resolve_provider_name(storage_manager, &provider_name).await?;

    let vault_data = match storage_manager
        .read_file(vault_id.clone(), provider_name.clone())
        .await
    {
        Ok(data) => {
            if let Err(cache_err) = cache_vault_bytes(&provider_cache_key, &vault_id, &data) {
                println!(
                    "[read_cloud_vault] Failed to cache vault '{}' locally: {}",
                    vault_id, cache_err
                );
            }
            data
        }
        Err(err) => {
            println!(
                "[read_cloud_vault] Failed to fetch vault '{}' from provider '{}': {}",
                vault_id, provider_cache_key, err
            );

            if err.is_offline_or_auth_like() {
                match load_cached_vault(&provider_cache_key, &vault_id) {
                    Ok(cached) => {
                        println!(
                            "[read_cloud_vault] Using cached copy for vault '{}' (provider '{}')",
                            vault_id, provider_cache_key
                        );
                        cached
                    }
                    Err(cache_err) => {
                        println!(
                            "[read_cloud_vault] Cached copy unavailable for vault '{}': {}",
                            vault_id, cache_err
                        );
                        return Err(CommandError::Io(
                            "Failed to read vault file; no cached copy available".to_string(),
                        ));
                    }
                }
            } else {
                return Err(CommandError::Io("Failed to read vault file".to_string()));
            }
        }
    };

    let vault_file = parse_vault_from_bytes(&vault_data)?;
    // Fail fast on a format this build cannot read, before the rate-limit gate
    // and the Argon2 derivation (see `vault::version`).
    version::check_version(&vault_file.version)?;

    crate::vault::rate_limit::check_attempts(&vault_id)?;
    let master_key = match keys::derive_and_decrypt_master_key(&password, &vault_file) {
        Ok(key) => {
            crate::vault::rate_limit::reset_attempts(&vault_id);
            key
        }
        Err(err) => {
            crate::vault::rate_limit::record_failure(&vault_id);
            return Err(err);
        }
    };
    let master_key = Zeroizing::new(master_key);

    let vault = keys::decrypt_vault_content(&master_key, &vault_file)?;

    Ok(VaultView::from(&vault))
}

#[tauri::command(async)]
pub async fn delete_cloud_vault(
    vault_id: String,
    provider_name: Option<String>,
    state: tauri::State<'_, StorageState>,
) -> Result<(), CommandError> {
    let storage_manager = &state.manager;
    let provider_cache_key = resolve_provider_name(storage_manager, &provider_name).await?;
    let cached_vault_id = vault_id.clone();

    storage_manager
        .delete_file(vault_id, provider_name)
        .await
        .map_err(|_e| CommandError::Io("Failed to delete vault".to_string()))?;

    let cache_path = cloud_cache_file_path(&provider_cache_key, &cached_vault_id);
    if cache_path.exists() {
        if let Err(err) = fs::remove_file(&cache_path) {
            println!(
                "[delete_cloud_vault] Failed to remove cached vault '{}' at '{}': {}",
                cached_vault_id,
                cache_path.display(),
                err
            );
        }
    }
    Ok(())
}

#[tauri::command(async)]
pub async fn change_cloud_vault_password(
    vault_id: String,
    old_password: String,
    new_password: String,
    provider_name: Option<String>,
    state: tauri::State<'_, StorageState>,
) -> Result<(), CommandError> {
    let storage_manager = &state.manager;
    let provider_cache_key = resolve_provider_name(storage_manager, &provider_name).await?;

    // Read the existing vault file
    let vault_data = storage_manager
        .read_file(vault_id.clone(), provider_name.clone())
        .await
        .map_err(|_e| CommandError::Io("Failed to read existing vault".to_string()))?;

    let mut vault_file = parse_vault_from_bytes(&vault_data)?;

    // Prove the OLD password before touching anything: a wrong password is a
    // failed attempt, a right one clears the counter.
    match keys::derive_and_decrypt_master_key(&old_password, &vault_file) {
        Ok(_) => crate::vault::rate_limit::reset_attempts(&vault_id),
        Err(err) => {
            crate::vault::rate_limit::record_failure(&vault_id);
            return Err(err);
        }
    }

    // Fresh salt + default Argon2id parameters; the master key is re-wrapped
    // (never re-derived) so the stored blob stays readable.
    keys::rewrap_master_key(&old_password, &new_password, &mut vault_file)?;

    let vault_bytes = create_vault_bytes(&vault_file)?;
    let cached_bytes = vault_bytes.clone();

    // Update the vault file in storage
    let update_request = UpdateFileRequest {
        id: vault_id.clone(),
        content: vault_bytes,
        metadata: None,
    };

    storage_manager
        .update_file(update_request, provider_name)
        .await
        .map_err(|_e| CommandError::Io("Failed to update vault file".to_string()))?;

    // Update the local cache
    if let Err(cache_err) = cache_vault_bytes(&provider_cache_key, &vault_id, &cached_bytes) {
        println!(
            "[change_cloud_vault_password] Failed to update cached vault '{}' locally: {}",
            vault_id, cache_err
        );
    }

    Ok(())
}

#[tauri::command(async)]
pub async fn list_cloud_vaults(
    provider_name: Option<String>,
    state: tauri::State<'_, StorageState>,
) -> Result<Vec<StorageFile>, CommandError> {
    let storage_manager = &state.manager;

    storage_manager
        .list_vaults(provider_name)
        .await
        .map_err(|_e| CommandError::Io("Failed to list vaults".to_string()))
}

async fn create_new_cloud_vault(
    vault_name: &str,
    vault_path: &str,
    password: &str,
    initial_vault_content: VaultView,
    parent_id: Option<String>,
    provider_name: Option<String>,
    storage_manager: &Arc<StorageManager>,
) -> Result<String, CommandError> {
    // A brand-new vault has no stored key material, so any passkey in the
    // creation payload fails closed here (see `merge_vault_view`).
    let empty_disk_vault = Vault {
        updated_at: Utc::now(),
        hmac: String::new(),
        entries: Vec::new(),
    };
    let mut initial_vault_content = merge_vault_view(initial_vault_content, &empty_disk_vault)?;

    let provider_cache_key = resolve_provider_name(storage_manager, &provider_name).await?;

    let (argon2_params, credentials, master_key) = keys::create_key_material(password)?;
    let master_key = Zeroizing::new(master_key);

    initial_vault_content.updated_at = Utc::now();
    let vault_encrypted = keys::encrypt_vault_content(&master_key, &initial_vault_content)?;

    let vault_file = VaultFile {
        version: version::CURRENT_VAULT_VERSION.to_string(),
        argon2_params,
        credentials,
        vault: vault_encrypted,
    };

    let vault_bytes = create_vault_bytes(&vault_file)?;
    let cached_bytes = vault_bytes.clone();

    let create_request = CreateFileRequest {
        name: vault_name.to_string(),
        path: vault_path.to_string(),
        content: vault_bytes,
        parent_id,
        mime_type: Some("application/octet-stream".to_string()),
        metadata: None,
    };

    let created_file = storage_manager
        .create_file(create_request, provider_name)
        .await
        .map_err(|_e| CommandError::Io("Failed to create vault file".to_string()))?;

    if let Err(cache_err) = cache_vault_bytes(&provider_cache_key, &created_file.id, &cached_bytes)
    {
        println!(
            "[create_new_cloud_vault] Failed to cache new vault '{}' locally: {}",
            created_file.id, cache_err
        );
    }

    Ok(created_file.id)
}

async fn update_existing_cloud_vault(
    vault_id: &str,
    password: &str,
    new_vault_content: VaultView,
    provider_name: Option<String>,
    storage_manager: &Arc<StorageManager>,
) -> Result<(), CommandError> {
    let provider_cache_key = resolve_provider_name(storage_manager, &provider_name).await?;
    let vault_data = storage_manager
        .read_file(vault_id.to_string(), provider_name.clone())
        .await
        .map_err(|_e| CommandError::Io("Failed to read existing vault".to_string()))?;

    let mut vault_file = parse_vault_from_bytes(&vault_data)?;
    // Refuse to re-encrypt a format this build cannot read (review finding
    // E14b): a future format must not be silently rewritten by today's
    // serializer. Same error and same position as the read paths.
    version::check_version(&vault_file.version)?;

    let master_key = Zeroizing::new(keys::derive_and_decrypt_master_key(password, &vault_file)?);

    // Re-attach the passkey secrets that only exist in the stored file, and
    // keep every passkey this (possibly stale) view does not mention.
    let disk_vault = keys::decrypt_vault_content(&master_key, &vault_file)?;
    let mut merged_vault = merge_vault_view(new_vault_content, &disk_vault)?;
    merged_vault.updated_at = Utc::now();

    vault_file.vault = keys::encrypt_vault_content(&master_key, &merged_vault)?;
    // Keep the stored version unless the merged content now holds a passkey, in
    // which case the file becomes 1.1 (unreadable by pre-passkey clients).
    vault_file.version = version::version_for_content(&vault_file.version, &merged_vault);

    let vault_bytes = create_vault_bytes(&vault_file)?;
    let cached_bytes = vault_bytes.clone();

    let update_request = UpdateFileRequest {
        id: vault_id.to_string(),
        content: vault_bytes,
        metadata: None,
    };

    storage_manager
        .update_file(update_request, provider_name)
        .await
        .map_err(|_e| CommandError::Io("Failed to update vault file".to_string()))?;

    if let Err(cache_err) = cache_vault_bytes(&provider_cache_key, vault_id, &cached_bytes) {
        println!(
            "[update_existing_cloud_vault] Failed to update cached vault '{}' locally: {}",
            vault_id, cache_err
        );
    }

    Ok(())
}

pub(crate) fn parse_vault_from_bytes(vault_data: &[u8]) -> Result<VaultFile, CommandError> {
    // Convert bytes to string
    let vault_data_str = String::from_utf8(vault_data.to_vec())
        .map_err(|_e| CommandError::Io("Failed to convert vault data".to_string()))?;

    // Parse the signed content
    let parsed_content = crate::io::signature::parse_content(&vault_data_str);

    // Base64 decode the content
    let decoded_content = URL_SAFE_NO_PAD
        .decode(&parsed_content.content)
        .map_err(|_e| CommandError::Crypto("Failed to decode vault content".to_string()))?;

    // Deserialize into VaultFile
    serde_json::from_slice(&decoded_content)
        .map_err(|_e| CommandError::Io("Failed to deserialize vault file".to_string()))
}

pub(crate) fn create_vault_bytes(vault_file: &VaultFile) -> Result<Vec<u8>, CommandError> {
    let signed_vault = crate::io::signature::sign_vault(vault_file);
    Ok(signed_vault.into_bytes())
}
