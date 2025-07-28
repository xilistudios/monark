use crate::crypto;
use crate::io;
use crate::models::{Argon2Params, EncryptedData, Vault, VaultFile};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use chrono::Utc;
use crate::commands::errors::CommandError;
use std::path::Path;

const CURRENT_VAULT_VERSION: &str = "1.0";
const KEY_LENGTH: usize = 32;
const VAULT_EXTENSION: &str = "monark";

const ARGON2_MEMORY_COST_KIB: u32 = 65536;
const ARGON2_ITERATIONS: u32 = 3;
const ARGON2_PARALLELISM: u32 = 4;

#[tauri::command]
pub fn write_vault(
    file_path: String,
    password: String,
    vault_content: Vault,
) -> Result<(), CommandError> {
    let path = Path::new(&file_path);

    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| CommandError::Io(format!("Failed to create parent directory: {}", e)))?;
    }

    if path.exists() {
        update_existing_vault(&file_path, &password, vault_content)
    } else {
        create_new_vault(&file_path, &password, vault_content)
    }
}

#[tauri::command]
pub fn read_vault(file_path: String, password: String) -> Result<Vault, CommandError> {
    let vault_file = io::vault::read_vault(file_path)?;

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

#[tauri::command]
pub fn delete_vault(file_path: String) -> Result<(), CommandError> {
    let path = Path::new(&file_path);

    match path.extension().and_then(|ext| ext.to_str()) {
        Some(VAULT_EXTENSION) => {}
        _ => {
            return Err(CommandError::Io(
                "Invalid vault file extension".to_string(),
            ));
        }
    }

    if !path.exists() {
        return Err(CommandError::Io("Vault file does not exist".to_string()));
    }

    std::fs::remove_file(path)
        .map_err(|e| CommandError::Io(format!("Failed to delete vault file: {}", e)))
}


fn create_new_vault(
    file_path: &str,
    password: &str,
    mut initial_vault_content: Vault,
) -> Result<(), CommandError> {
    let master_key_vec = crypto::random::generate_key()?;
    let master_key: [u8; KEY_LENGTH] = master_key_vec.try_into().map_err(|_| {
        CommandError::Crypto("Invalid generated master key length".to_string())
    })?;
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

    io::vault::write_vault(file_path.to_string(), &vault_file)
}

fn update_existing_vault(
    file_path: &str,
    password: &str,
    mut new_vault_content: Vault,
) -> Result<(), CommandError> {
    let mut vault_file = io::vault::read_vault(file_path.to_string())?;

    let master_key = derive_and_decrypt_master_key(password, &vault_file)?;

    new_vault_content.updated_at = Utc::now();
    let vault_json_bytes = serde_json::to_vec(&new_vault_content)?;
    let vault_nonce = crypto::random::generate_nonce()?;
    let vault_ciphertext =
        crypto::chacha::encrypt_xchacha20poly1305(&master_key, &vault_nonce, &vault_json_bytes)?;

    vault_file.vault.nonce = URL_SAFE_NO_PAD.encode(vault_nonce);
    vault_file.vault.ciphertext = URL_SAFE_NO_PAD.encode(vault_ciphertext);

    io::vault::write_vault(file_path.to_string(), &vault_file)
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
        .map_err(|e| CommandError::Crypto(format!("Failed to decode master key ciphertext: {}", e)))?;

    let master_key_vec =
        crypto::chacha::decrypt_xchacha20poly1305(&kdf_key, &mk_nonce, &mk_ciphertext)?;

    master_key_vec.try_into().map_err(|_| {
        CommandError::Crypto("Invalid decrypted master key length".to_string())
    })
}