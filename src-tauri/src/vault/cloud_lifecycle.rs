use crate::commands::errors::CommandError;
use crate::commands::storage::StorageState;
use crate::crypto;
use crate::models::{Argon2Params, EncryptedData, Vault, VaultFile};
use crate::storage::StorageManager;
use crate::storage::providers::{CreateFileRequest, UpdateFileRequest, StorageFile};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use chrono::Utc;
use std::sync::Arc;

const CURRENT_VAULT_VERSION: &str = "1.0";
const KEY_LENGTH: usize = 32;
const VAULT_EXTENSION: &str = "monark";

const ARGON2_MEMORY_COST_KIB: u32 = 65536;
const ARGON2_ITERATIONS: u32 = 3;
const ARGON2_PARALLELISM: u32 = 4;

#[tauri::command(async)]
pub async fn write_cloud_vault(
    vault_name: String,
    password: String,
    vault_content: Vault,
    provider_name: Option<String>,
    parent_id: Option<String>,
    state: tauri::State<'_, StorageState>,
) -> Result<String, CommandError> {
    let storage_manager = &state.manager;

    // Use provided parent_id or ensure default vault folder exists
    let vault_folder_id = if let Some(pid) = parent_id {
        pid
    } else {
        storage_manager.ensure_vault_folder(provider_name.clone()).await
            .map_err(|e| CommandError::Io(format!("Failed to ensure vault folder: {}", e)))?
    };

    let vault_file_name = format!("{}.{}", vault_name, VAULT_EXTENSION);
    let vault_path = format!("/vaults/{}", vault_file_name);

    // Check if vault already exists
    let existing_vaults = storage_manager.list_vaults(provider_name.clone()).await
        .map_err(|e| CommandError::Io(format!("Failed to list vaults: {}", e)))?;

    if let Some(existing_vault) = existing_vaults.iter().find(|v| v.name == vault_file_name) {
        // Update existing vault
        update_existing_cloud_vault(
            &existing_vault.id,
            &password,
            vault_content,
            provider_name,
            storage_manager,
        ).await?;
        Ok(existing_vault.id.clone())
    } else {
        // Create new vault
        create_new_cloud_vault(
            &vault_file_name,
            &vault_path,
            &password,
            vault_content,
            Some(vault_folder_id),
            provider_name,
            storage_manager,
        ).await
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

    let vault_data = storage_manager.read_file(vault_id.clone(), provider_name).await
        .map_err(|e| CommandError::Io(format!("Failed to read vault file: {}", e)))?;

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

    storage_manager.delete_file(vault_id, provider_name).await
        .map_err(|e| CommandError::Io(format!("Failed to delete vault: {}", e)))?;
    Ok(())
}

#[tauri::command(async)]
pub async fn list_cloud_vaults(
    provider_name: Option<String>,
    state: tauri::State<'_, StorageState>,
) -> Result<Vec<StorageFile>, CommandError> {
    let storage_manager = &state.manager;

    storage_manager.list_vaults(provider_name).await
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

    let create_request = CreateFileRequest {
        name: vault_name.to_string(),
        path: vault_path.to_string(),
        content: vault_bytes,
        parent_id,
        mime_type: Some("application/octet-stream".to_string()),
        metadata: None,
    };

    let created_file = storage_manager.create_file(create_request, provider_name).await
        .map_err(|e| CommandError::Io(format!("Failed to create vault file: {}", e)))?;

    Ok(created_file.id)
}

async fn update_existing_cloud_vault(
    vault_id: &str,
    password: &str,
    mut new_vault_content: Vault,
    provider_name: Option<String>,
    storage_manager: &Arc<StorageManager>,
) -> Result<(), CommandError> {
    let vault_data = storage_manager.read_file(vault_id.to_string(), provider_name.clone()).await
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

    let update_request = UpdateFileRequest {
        id: vault_id.to_string(),
        content: vault_bytes,
        metadata: None,
    };

    storage_manager.update_file(update_request, provider_name).await
        .map_err(|e| CommandError::Io(format!("Failed to update vault file: {}", e)))?;

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
        .map_err(|e| CommandError::Crypto(format!("Failed to base64 decode vault content: {}", e)))?;

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