use crate::commands::errors::CommandError;
use crate::crypto;
use crate::io;
use crate::models::{Argon2Params, EncryptedData, Vault, VaultFile, VaultView};
use crate::vault::merge::merge_vault_view;
use crate::vault::version;
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use chrono::Utc;
use std::path::{Path, PathBuf};
use zeroize::Zeroize;

const KEY_LENGTH: usize = 32;
const VAULT_EXTENSION: &str = "monark";

const ARGON2_MEMORY_COST_KIB: u32 = 65536;
const ARGON2_ITERATIONS: u32 = 3;
const ARGON2_PARALLELISM: u32 = 4;
const ARGON2_MAX_MEMORY_COST_KIB: u32 = 262144; // 256 MiB upper bound (DoS prevention)
const ARGON2_MAX_ITERATIONS: u32 = 10;
const ARGON2_MAX_PARALLELISM: u32 = 16;

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

/// Writes a vault from the sanitized IPC view.
///
/// The payload is what `read_vault` handed the frontend, so passkey private
/// keys are absent by construction: [`update_existing_vault`] re-attaches them
/// from the decrypted on-disk vault (see [`crate::vault::merge`]).
#[tauri::command(async)]
pub fn write_vault(
    file_path: String,
    password: String,
    vault_content: VaultView,
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

/// Reads and decrypts a vault, returning the **sanitized** IPC view.
///
/// The decrypted [`Vault`] (which does hold passkey private keys) never leaves
/// this function: it is converted to [`VaultView`] and dropped (zeroized) at the
/// end of the scope.
#[tauri::command(async)]
pub fn read_vault(file_path: String, password: String) -> Result<VaultView, CommandError> {
    let canonical_path = validate_vault_path(&file_path)?;
    let canonical_str = canonical_path.to_string_lossy().to_string();
    let vault_file = io::vault::read_vault(canonical_str.clone())?;
    // Fail fast on a format this build cannot read: a version mismatch is not a
    // password attempt, so it must not consume a rate-limit slot nor pay for
    // Argon2 derivation (see `vault::version`).
    version::check_version(&vault_file.version)?;

    crate::vault::rate_limit::check_attempts(&canonical_str)?;
    let master_key = match derive_and_decrypt_master_key(&password, &vault_file) {
        Ok(key) => {
            crate::vault::rate_limit::reset_attempts(&canonical_str);
            key
        }
        Err(err) => {
            crate::vault::rate_limit::record_failure(&canonical_str);
            return Err(err);
        }
    };

    let vault_nonce = URL_SAFE_NO_PAD
        .decode(&vault_file.vault.nonce)
        .map_err(|_e| CommandError::Crypto("Failed to decode vault nonce".to_string()))?;

    let vault_ciphertext = URL_SAFE_NO_PAD
        .decode(&vault_file.vault.ciphertext)
        .map_err(|_e| CommandError::Crypto("Failed to decode vault ciphertext".to_string()))?;

    let vault_json_bytes =
        crypto::chacha::decrypt_xchacha20poly1305(&master_key, &vault_nonce, &vault_ciphertext)?;

    let vault: Vault = serde_json::from_slice(&vault_json_bytes)
        .map_err(|_e| CommandError::Io("Failed to deserialize vault".to_string()))?;

    Ok(VaultView::from(&vault))
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

/// Re-wraps the vault master key under a new password (cloud parity).
///
/// Mirrors `change_cloud_vault_password` (`cloud_lifecycle.rs`): the master key
/// is unwrapped with `old_password`, a fresh salt + default Argon2id parameters
/// are generated, and the *unchanged* master key is re-encrypted under the new
/// KDF key. Only `argon2_params` and `credentials` are replaced; the encrypted
/// vault blob (`vault_file.vault`) is left byte-identical, so every entry
/// (including future passkeys) survives untouched.
#[tauri::command(async)]
pub fn change_vault_password(
    file_path: String,
    old_password: String,
    new_password: String,
) -> Result<(), CommandError> {
    let canonical_path = validate_vault_path(&file_path)?;
    let canonical_str = canonical_path.to_string_lossy().to_string();

    if !canonical_path.exists() {
        return Err(CommandError::NotFound(
            "Vault file does not exist".to_string(),
        ));
    }

    crate::vault::rate_limit::check_attempts(&canonical_str)?;
    let mut vault_file = io::vault::read_vault(canonical_str.clone())?;

    let master_key = match derive_and_decrypt_master_key(&old_password, &vault_file) {
        Ok(key) => {
            crate::vault::rate_limit::reset_attempts(&canonical_str);
            key
        }
        Err(err) => {
            crate::vault::rate_limit::record_failure(&canonical_str);
            return Err(err);
        }
    };

    if new_password.is_empty() {
        return Err(CommandError::Validation(
            "New password is required".to_string(),
        ));
    }

    // Fresh salt + the same Argon2id defaults used when creating a vault.
    let user_salt = crypto::random::generate_salt()?;
    let argon2_params = Argon2Params {
        salt: URL_SAFE_NO_PAD.encode(&user_salt),
        memory_cost_kib: ARGON2_MEMORY_COST_KIB,
        iterations: ARGON2_ITERATIONS,
        parallelism: ARGON2_PARALLELISM,
    };

    let mut new_kdf_key = crypto::argon2::derive_key_argon2id(
        new_password.as_bytes(),
        &user_salt,
        argon2_params.memory_cost_kib,
        argon2_params.iterations,
        argon2_params.parallelism,
        KEY_LENGTH as u32,
    )?;

    // Re-wrap the SAME master key under the new password.
    let mk_nonce = crypto::random::generate_nonce()?;
    let mk_ciphertext =
        crypto::chacha::encrypt_xchacha20poly1305(&new_kdf_key, &mk_nonce, &master_key)?;
    new_kdf_key.zeroize(); // Clear intermediate key material from memory

    vault_file.argon2_params = argon2_params;
    vault_file.credentials = EncryptedData {
        nonce: URL_SAFE_NO_PAD.encode(mk_nonce),
        ciphertext: URL_SAFE_NO_PAD.encode(mk_ciphertext),
    };
    // `vault_file.vault` is deliberately NOT touched: the blob stays byte-identical.

    io::vault::write_vault(canonical_str, &vault_file)
}

fn create_new_vault(
    file_path: &str,
    password: &str,
    initial_vault_content: VaultView,
) -> Result<(), CommandError> {
    // A brand-new vault has no stored key material, so any passkey in the
    // creation payload fails closed here (see `merge_vault_view`).
    let empty_disk_vault = Vault {
        updated_at: Utc::now(),
        hmac: String::new(),
        entries: Vec::new(),
    };
    let mut initial_vault_content = merge_vault_view(initial_vault_content, &empty_disk_vault)?;
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
        version: version::CURRENT_VAULT_VERSION.to_string(),
        argon2_params,
        credentials,
        vault: vault_encrypted,
    };

    io::vault::write_vault(file_path.to_string(), &vault_file)
}

fn update_existing_vault(
    file_path: &str,
    password: &str,
    new_vault_content: VaultView,
) -> Result<(), CommandError> {
    crate::vault::rate_limit::check_attempts(file_path)?;
    let mut vault_file = io::vault::read_vault(file_path.to_string())?;

    let master_key = match derive_and_decrypt_master_key(password, &vault_file) {
        Ok(key) => {
            crate::vault::rate_limit::reset_attempts(file_path);
            key
        }
        Err(err) => {
            crate::vault::rate_limit::record_failure(file_path);
            return Err(err);
        }
    };

    // Re-attach the passkey secrets that only exist on disk, and keep every
    // passkey this (possibly stale) view does not mention.
    let disk_vault = decrypt_vault_blob(&master_key, &vault_file)?;
    let mut merged_vault = merge_vault_view(new_vault_content, &disk_vault)?;
    merged_vault.updated_at = Utc::now();

    let vault_json_bytes = serde_json::to_vec(&merged_vault)?;
    let vault_nonce = crypto::random::generate_nonce()?;
    let vault_ciphertext =
        crypto::chacha::encrypt_xchacha20poly1305(&master_key, &vault_nonce, &vault_json_bytes)?;

    vault_file.vault.nonce = URL_SAFE_NO_PAD.encode(vault_nonce);
    vault_file.vault.ciphertext = URL_SAFE_NO_PAD.encode(vault_ciphertext);
    // Keep the stored version unless the merged content now holds a passkey, in
    // which case the file becomes 1.1 (unreadable by pre-passkey clients).
    vault_file.version = version::version_for_content(&vault_file.version, &merged_vault);

    io::vault::write_vault(file_path.to_string(), &vault_file)
}

/// Decrypts the vault blob of `vault_file` with `master_key` into the disk
/// [`Vault`] (the shape that still holds passkey private keys).
///
/// Mirrors the decrypt chain of [`read_vault`], stopping before the view
/// conversion.
fn decrypt_vault_blob(
    master_key: &[u8; KEY_LENGTH],
    vault_file: &VaultFile,
) -> Result<Vault, CommandError> {
    let vault_nonce = URL_SAFE_NO_PAD
        .decode(&vault_file.vault.nonce)
        .map_err(|_e| CommandError::Crypto("Failed to decode vault nonce".to_string()))?;

    let vault_ciphertext = URL_SAFE_NO_PAD
        .decode(&vault_file.vault.ciphertext)
        .map_err(|_e| CommandError::Crypto("Failed to decode vault ciphertext".to_string()))?;

    let vault_json_bytes =
        crypto::chacha::decrypt_xchacha20poly1305(master_key, &vault_nonce, &vault_ciphertext)?;

    serde_json::from_slice(&vault_json_bytes)
        .map_err(|_e| CommandError::Crypto("Failed to deserialize existing vault".to_string()))
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
    if params.memory_cost_kib > ARGON2_MAX_MEMORY_COST_KIB {
        return Err(CommandError::Crypto(
            "Argon2 memory cost above security maximum (possible DoS)".to_string(),
        ));
    }
    if params.iterations > ARGON2_MAX_ITERATIONS {
        return Err(CommandError::Crypto(
            "Argon2 iterations above security maximum (possible DoS)".to_string(),
        ));
    }
    if params.parallelism > ARGON2_MAX_PARALLELISM {
        return Err(CommandError::Crypto(
            "Argon2 parallelism above security maximum (possible DoS)".to_string(),
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::Argon2Params;

    fn params(memory_cost_kib: u32, iterations: u32, parallelism: u32) -> Argon2Params {
        Argon2Params {
            salt: "c2FsdA".to_string(),
            memory_cost_kib,
            iterations,
            parallelism,
        }
    }

    #[test]
    fn validate_argon2_params_accepts_defaults() {
        let p = params(
            ARGON2_MEMORY_COST_KIB,
            ARGON2_ITERATIONS,
            ARGON2_PARALLELISM,
        );
        assert!(validate_argon2_params(&p).is_ok());
    }

    #[test]
    fn validate_argon2_params_rejects_excessive_memory_cost() {
        let p = params(
            ARGON2_MAX_MEMORY_COST_KIB + 1,
            ARGON2_ITERATIONS,
            ARGON2_PARALLELISM,
        );
        assert!(validate_argon2_params(&p).is_err());
    }

    #[test]
    fn validate_argon2_params_rejects_excessive_iterations() {
        let p = params(
            ARGON2_MEMORY_COST_KIB,
            ARGON2_MAX_ITERATIONS + 1,
            ARGON2_PARALLELISM,
        );
        assert!(validate_argon2_params(&p).is_err());
    }

    #[test]
    fn validate_argon2_params_rejects_excessive_parallelism() {
        let p = params(
            ARGON2_MEMORY_COST_KIB,
            ARGON2_ITERATIONS,
            ARGON2_MAX_PARALLELISM + 1,
        );
        assert!(validate_argon2_params(&p).is_err());
    }

    #[test]
    fn validate_argon2_params_rejects_below_minimum_memory_cost() {
        let p = params(1024, ARGON2_ITERATIONS, ARGON2_PARALLELISM);
        assert!(validate_argon2_params(&p).is_err());
    }
}
