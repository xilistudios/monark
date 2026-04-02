use crate::commands::errors::CommandError;
use crate::commands::storage::StorageState;
use crate::crypto;
use crate::models::{Argon2Params, EncryptedData, Vault, VaultFile};
use crate::storage::providers::{CreateFileRequest, StorageFile, UpdateFileRequest};
use crate::storage::{StorageError, StorageManager};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use chrono::Utc;
use std::fs;
use std::path::PathBuf;
use std::sync::Arc;

const CURRENT_VAULT_VERSION: &str = "1.0";
const KEY_LENGTH: usize = 32;
const VAULT_EXTENSION: &str = "monark";

const ARGON2_MEMORY_COST_KIB: u32 = 65536;
const ARGON2_ITERATIONS: u32 = 3;
const ARGON2_PARALLELISM: u32 = 4;

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
    let base_dir = dirs::data_dir().unwrap_or_else(|| PathBuf::from("."));
    base_dir
        .join("monark")
        .join("cloud_cache")
        .join(sanitize_path_component(provider))
        .join(format!("{}.monark", sanitize_path_component(vault_id)))
}

fn cache_vault_bytes(provider: &str, vault_id: &str, data: &[u8]) -> Result<(), CommandError> {
    let path = cloud_cache_file_path(provider, vault_id);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| {
            CommandError::Io(format!(
                "Failed to create cloud cache directory '{}': {}",
                parent.display(),
                e
            ))
        })?;
    }

    fs::write(&path, data).map_err(|e| {
        CommandError::Io(format!(
            "Failed to write cached cloud vault '{}': {}",
            path.display(),
            e
        ))
    })
}

fn load_cached_vault(provider: &str, vault_id: &str) -> Result<Vec<u8>, CommandError> {
    let path = cloud_cache_file_path(provider, vault_id);
    fs::read(&path).map_err(|e| {
        CommandError::Io(format!(
            "Failed to read cached cloud vault '{}': {}",
            path.display(),
            e
        ))
    })
}

fn map_provider_name_for_cache(provider_name: &str) -> String {
    let normalized = provider_name.trim().to_lowercase().replace([' ', '-'], "_");

    if normalized == "drive" || normalized == "google_drive" {
        "google_drive".to_string()
    } else {
        provider_name.to_string()
    }
}

async fn resolve_provider_name(
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
    vault_content: Vault,
    provider_name: Option<String>,
    parent_id: Option<String>,
    vault_id: Option<String>,
    state: tauri::State<'_, StorageState>,
) -> Result<String, CommandError> {
    let storage_manager = &state.manager;

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
            .map_err(|e| CommandError::Io(format!("Failed to ensure vault folder: {}", e)))?
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
        .map_err(|e| CommandError::Io(format!("Failed to list vaults: {}", e)))?;

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

#[tauri::command(async)]
pub async fn read_cloud_vault(
    vault_id: String,
    password: String,
    provider_name: Option<String>,
    state: tauri::State<'_, StorageState>,
) -> Result<Vault, CommandError> {
    let storage_manager = &state.manager;
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

            if matches!(
                err,
                StorageError::Network(_) | StorageError::Authentication(_)
            ) {
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
                        return Err(CommandError::Io(format!(
                            "Failed to read vault file ({}); no cached copy available",
                            err
                        )));
                    }
                }
            } else {
                return Err(CommandError::Io(format!(
                    "Failed to read vault file: {}",
                    err
                )));
            }
        }
    };

    let vault_file = parse_vault_from_bytes(&vault_data)?;

    let master_key = derive_and_decrypt_master_key(&password, &vault_file)?;

    let vault_nonce = URL_SAFE_NO_PAD
        .decode(&vault_file.vault.nonce)
        .map_err(|e| CommandError::Crypto(format!("Failed to decode vault nonce: {}", e)))?;

    let vault_ciphertext = URL_SAFE_NO_PAD
        .decode(&vault_file.vault.ciphertext)
        .map_err(|e| CommandError::Crypto(format!("Failed to decode vault ciphertext: {}", e)))?;

    let vault_json_bytes =
        crypto::chacha::decrypt_xchacha20poly1305(&master_key, &vault_nonce, &vault_ciphertext)?;

    serde_json::from_slice(&vault_json_bytes)
        .map_err(|e| CommandError::Io(format!("Failed to deserialize vault: {}", e)))
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
        .map_err(|e| CommandError::Io(format!("Failed to delete vault: {}", e)))?;

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
        .map_err(|e| CommandError::Io(format!("Failed to read existing vault: {}", e)))?;

    let mut vault_file = parse_vault_from_bytes(&vault_data)?;

    // Decrypt the master key with the OLD password
    let master_key = derive_and_decrypt_master_key(&old_password, &vault_file)?;

    // Generate new salt and derive new key with NEW password
    let user_salt = crypto::random::generate_salt()?;
    let argon2_params = Argon2Params {
        salt: URL_SAFE_NO_PAD.encode(&user_salt),
        memory_cost_kib: ARGON2_MEMORY_COST_KIB,
        iterations: ARGON2_ITERATIONS,
        parallelism: ARGON2_PARALLELISM,
    };

    let new_kdf_key = crypto::argon2::derive_key_argon2id(
        new_password.as_bytes(),
        &user_salt,
        argon2_params.memory_cost_kib,
        argon2_params.iterations,
        argon2_params.parallelism,
        KEY_LENGTH as u32,
    )?;

    // Re-encrypt the master key with the NEW password
    let mk_nonce = crypto::random::generate_nonce()?;
    let mk_ciphertext =
        crypto::chacha::encrypt_xchacha20poly1305(&new_kdf_key, &mk_nonce, &master_key)?;
    let new_credentials = EncryptedData {
        nonce: URL_SAFE_NO_PAD.encode(mk_nonce),
        ciphertext: URL_SAFE_NO_PAD.encode(mk_ciphertext),
    };

    // Update the vault file with new credentials and salt
    vault_file.argon2_params = argon2_params;
    vault_file.credentials = new_credentials;

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
        .map_err(|e| CommandError::Io(format!("Failed to update vault file: {}", e)))?;

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
        .map_err(|e| CommandError::Io(format!("Failed to list vaults: {}", e)))
}

async fn create_new_cloud_vault(
    vault_name: &str,
    vault_path: &str,
    password: &str,
    mut initial_vault_content: Vault,
    parent_id: Option<String>,
    provider_name: Option<String>,
    storage_manager: &Arc<StorageManager>,
) -> Result<String, CommandError> {
    let provider_cache_key = resolve_provider_name(storage_manager, &provider_name).await?;
    let master_key_vec = crypto::random::generate_key()?;
    let master_key: [u8; KEY_LENGTH] = master_key_vec
        .try_into()
        .map_err(|_| CommandError::Crypto("Invalid generated master key length".to_string()))?;
    let user_salt = crypto::random::generate_salt()?;

    let argon2_params = Argon2Params {
        salt: URL_SAFE_NO_PAD.encode(&user_salt),
        memory_cost_kib: ARGON2_MEMORY_COST_KIB,
        iterations: ARGON2_ITERATIONS,
        parallelism: ARGON2_PARALLELISM,
    };

    let kdf_key = crypto::argon2::derive_key_argon2id(
        password.as_bytes(),
        &user_salt,
        argon2_params.memory_cost_kib,
        argon2_params.iterations,
        argon2_params.parallelism,
        KEY_LENGTH as u32,
    )?;

    let mk_nonce = crypto::random::generate_nonce()?;
    let mk_ciphertext =
        crypto::chacha::encrypt_xchacha20poly1305(&kdf_key, &mk_nonce, &master_key)?;
    let credentials = EncryptedData {
        nonce: URL_SAFE_NO_PAD.encode(mk_nonce),
        ciphertext: URL_SAFE_NO_PAD.encode(mk_ciphertext),
    };

    initial_vault_content.updated_at = Utc::now();
    let vault_json_bytes = serde_json::to_vec(&initial_vault_content)?;
    let vault_nonce = crypto::random::generate_nonce()?;
    let vault_ciphertext =
        crypto::chacha::encrypt_xchacha20poly1305(&master_key, &vault_nonce, &vault_json_bytes)?;
    let vault_encrypted = EncryptedData {
        nonce: URL_SAFE_NO_PAD.encode(vault_nonce),
        ciphertext: URL_SAFE_NO_PAD.encode(vault_ciphertext),
    };

    let vault_file = VaultFile {
        version: CURRENT_VAULT_VERSION.to_string(),
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
        .map_err(|e| CommandError::Io(format!("Failed to create vault file: {}", e)))?;

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
    mut new_vault_content: Vault,
    provider_name: Option<String>,
    storage_manager: &Arc<StorageManager>,
) -> Result<(), CommandError> {
    let provider_cache_key = resolve_provider_name(storage_manager, &provider_name).await?;
    let vault_data = storage_manager
        .read_file(vault_id.to_string(), provider_name.clone())
        .await
        .map_err(|e| CommandError::Io(format!("Failed to read existing vault: {}", e)))?;

    let mut vault_file = parse_vault_from_bytes(&vault_data)?;

    let master_key = derive_and_decrypt_master_key(password, &vault_file)?;

    new_vault_content.updated_at = Utc::now();
    let vault_json_bytes = serde_json::to_vec(&new_vault_content)?;
    let vault_nonce = crypto::random::generate_nonce()?;
    let vault_ciphertext =
        crypto::chacha::encrypt_xchacha20poly1305(&master_key, &vault_nonce, &vault_json_bytes)?;

    vault_file.vault.nonce = URL_SAFE_NO_PAD.encode(vault_nonce);
    vault_file.vault.ciphertext = URL_SAFE_NO_PAD.encode(vault_ciphertext);

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
        .map_err(|e| CommandError::Io(format!("Failed to update vault file: {}", e)))?;

    if let Err(cache_err) = cache_vault_bytes(&provider_cache_key, vault_id, &cached_bytes) {
        println!(
            "[update_existing_cloud_vault] Failed to update cached vault '{}' locally: {}",
            vault_id, cache_err
        );
    }

    Ok(())
}

fn parse_vault_from_bytes(vault_data: &[u8]) -> Result<VaultFile, CommandError> {
    // Convert bytes to string
    let vault_data_str = String::from_utf8(vault_data.to_vec())
        .map_err(|e| CommandError::Io(format!("Failed to convert vault data to string: {}", e)))?;

    // Parse the signed content
    let parsed_content = crate::io::signature::parse_content(&vault_data_str);

    // Base64 decode the content
    let decoded_content = URL_SAFE_NO_PAD
        .decode(&parsed_content.content)
        .map_err(|e| {
            CommandError::Crypto(format!("Failed to base64 decode vault content: {}", e))
        })?;

    // Deserialize into VaultFile
    serde_json::from_slice(&decoded_content)
        .map_err(|e| CommandError::Io(format!("Failed to deserialize vault file: {}", e)))
}

fn create_vault_bytes(vault_file: &VaultFile) -> Result<Vec<u8>, CommandError> {
    let signed_vault = crate::io::signature::sign_vault(vault_file);
    Ok(signed_vault.into_bytes())
}

fn derive_and_decrypt_master_key(
    password: &str,
    vault_file: &VaultFile,
) -> Result<[u8; KEY_LENGTH], CommandError> {
    let user_salt = URL_SAFE_NO_PAD
        .decode(&vault_file.argon2_params.salt)
        .map_err(|e| CommandError::Crypto(format!("Failed to decode salt: {}", e)))?;

    let kdf_key = crypto::argon2::derive_key_argon2id(
        password.as_bytes(),
        &user_salt,
        vault_file.argon2_params.memory_cost_kib,
        vault_file.argon2_params.iterations,
        vault_file.argon2_params.parallelism,
        KEY_LENGTH as u32,
    )?;

    let mk_nonce = URL_SAFE_NO_PAD
        .decode(&vault_file.credentials.nonce)
        .map_err(|e| CommandError::Crypto(format!("Failed to decode master key nonce: {}", e)))?;
    let mk_ciphertext = URL_SAFE_NO_PAD
        .decode(&vault_file.credentials.ciphertext)
        .map_err(|e| {
            CommandError::Crypto(format!("Failed to decode master key ciphertext: {}", e))
        })?;

    let master_key_vec =
        crypto::chacha::decrypt_xchacha20poly1305(&kdf_key, &mk_nonce, &mk_ciphertext)?;

    master_key_vec
        .try_into()
        .map_err(|_| CommandError::Crypto("Invalid decrypted master key length".to_string()))
}
