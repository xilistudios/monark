use crate::commands::errors::CommandError;
use crate::crypto;
use crate::io;
use crate::models::{Argon2Params, EncryptedData, Vault, VaultFile};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use chrono::Utc;
use std::path::{Path, PathBuf};
use zeroize::Zeroize;

const CURRENT_VAULT_VERSION: &str = "1.0";
const KEY_LENGTH: usize = 32;
const VAULT_EXTENSION: &str = "monark";

const ARGON2_MEMORY_COST_KIB: u32 = 65536;
const ARGON2_ITERATIONS: u32 = 3;
const ARGON2_PARALLELISM: u32 = 4;

/// Validates that a file path has the .monark extension and resolves it to a canonical path
/// to prevent path traversal attacks (e.g., via `..` components).
/// For new files, the parent directory must exist or will be created first.
/// Returns the canonicalized path if valid.
fn validate_vault_path(file_path: &str) -> Result<PathBuf, CommandError> {
    let path = Path::new(file_path);

    // Must have .monark extension
    if path.extension().and_then(|e| e.to_str()) != Some(VAULT_EXTENSION) {
        return Err(CommandError::Validation(
            "Invalid file type: only .monark files are allowed".to_string(),
        ));
    }

    // For write_vault: the file may not exist yet but the parent should.
    // Ensure parent exists, then canonicalize the parent to resolve symlinks and `..`.
    if let Some(parent) = path.parent() {
        if !parent.exists() {
            return Err(CommandError::Validation(
                "Parent directory does not exist".to_string(),
            ));
        }
        let canonical_parent = parent
            .canonicalize()
            .map_err(|_e| CommandError::Validation("Invalid parent path".to_string()))?;
        let file_name = path
            .file_name()
            .ok_or_else(|| CommandError::Validation("Invalid file name".to_string()))?;
        Ok(canonical_parent.join(file_name))
    } else {
        Err(CommandError::Validation("Invalid file path".to_string()))
    }
}

#[tauri::command(async)]
pub fn write_vault(
    file_path: String,
    password: String,
    vault_content: Vault,
) -> Result<(), CommandError> {
    let canonical_path = validate_vault_path(&file_path)?;
    let canonical_str = canonical_path.to_string_lossy().to_string();

    if let Some(parent) = canonical_path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|_e| CommandError::Io("Failed to create parent directory".to_string()))?;
    }

    if canonical_path.exists() {
        update_existing_vault(&canonical_str, &password, vault_content)
    } else {
        create_new_vault(&canonical_str, &password, vault_content)
    }
}

#[tauri::command(async)]
pub fn read_vault(file_path: String, password: String) -> Result<Vault, CommandError> {
    let canonical_path = validate_vault_path(&file_path)?;
    let canonical_str = canonical_path.to_string_lossy().to_string();
    let vault_file = io::vault::read_vault(canonical_str)?;

    let master_key = derive_and_decrypt_master_key(&password, &vault_file)?;

    let vault_nonce = URL_SAFE_NO_PAD
        .decode(&vault_file.vault.nonce)
        .map_err(|_e| CommandError::Crypto("Failed to decode vault nonce".to_string()))?;

    let vault_ciphertext = URL_SAFE_NO_PAD
        .decode(&vault_file.vault.ciphertext)
        .map_err(|_e| CommandError::Crypto("Failed to decode vault ciphertext".to_string()))?;

    let vault_json_bytes =
        crypto::chacha::decrypt_xchacha20poly1305(&master_key, &vault_nonce, &vault_ciphertext)?;

    serde_json::from_slice(&vault_json_bytes)
        .map_err(|_e| CommandError::Io("Failed to deserialize vault".to_string()))
}

#[tauri::command(async)]
pub fn delete_vault(file_path: String) -> Result<(), CommandError> {
    let canonical_path = validate_vault_path(&file_path)?;

    if !canonical_path.exists() {
        return Err(CommandError::NotFound(
            "Vault file does not exist".to_string(),
        ));
    }

    std::fs::remove_file(&canonical_path)
        .map_err(|_e| CommandError::Io("Failed to delete vault file".to_string()))
}

fn create_new_vault(
    file_path: &str,
    password: &str,
    mut initial_vault_content: Vault,
) -> Result<(), CommandError> {
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

    let mut kdf_key = crypto::argon2::derive_key_argon2id(
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
    kdf_key.zeroize(); // Clear intermediate key material from memory

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

fn validate_argon2_params(params: &Argon2Params) -> Result<(), CommandError> {
    if params.memory_cost_kib < ARGON2_MEMORY_COST_KIB {
        return Err(CommandError::Crypto(
            "Argon2 parameters below security minimum (possible downgrade attack)".to_string(),
        ));
    }
    if params.iterations < ARGON2_ITERATIONS {
        return Err(CommandError::Crypto(
            "Argon2 parameters below security minimum (possible downgrade attack)".to_string(),
        ));
    }
    if params.parallelism < 1 {
        return Err(CommandError::Crypto(
            "Argon2 parameters below security minimum (possible downgrade attack)".to_string(),
        ));
    }
    Ok(())
}

fn derive_and_decrypt_master_key(
    password: &str,
    vault_file: &VaultFile,
) -> Result<[u8; KEY_LENGTH], CommandError> {
    let user_salt = URL_SAFE_NO_PAD
        .decode(&vault_file.argon2_params.salt)
        .map_err(|_e| CommandError::Crypto("Failed to decode salt".to_string()))?;

    validate_argon2_params(&vault_file.argon2_params)?;

    let mut kdf_key = crypto::argon2::derive_key_argon2id(
        password.as_bytes(),
        &user_salt,
        vault_file.argon2_params.memory_cost_kib,
        vault_file.argon2_params.iterations,
        vault_file.argon2_params.parallelism,
        KEY_LENGTH as u32,
    )?;

    let mk_nonce = URL_SAFE_NO_PAD
        .decode(&vault_file.credentials.nonce)
        .map_err(|_e| CommandError::Crypto("Failed to decode master key nonce".to_string()))?;
    let mk_ciphertext = URL_SAFE_NO_PAD
        .decode(&vault_file.credentials.ciphertext)
        .map_err(|_e| CommandError::Crypto("Failed to decode master key ciphertext".to_string()))?;

    let master_key_vec =
        crypto::chacha::decrypt_xchacha20poly1305(&kdf_key, &mk_nonce, &mk_ciphertext)?;
    kdf_key.zeroize(); // Clear intermediate key material from memory

    master_key_vec
        .try_into()
        .map_err(|_| CommandError::Crypto("Invalid decrypted master key length".to_string()))
}
