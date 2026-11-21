//! Local (filesystem) vault lifecycle.
//!
//! This module owns *orchestration* only: path validation, rate limiting, the
//! version gate, the write-path merge and the atomic file write. Every
//! cryptographic step lives in [`crate::vault::keys`], shared with the cloud
//! lifecycle so the two backends cannot drift apart (T07).

use crate::commands::errors::CommandError;
use crate::io;
use crate::models::{Vault, VaultFile, VaultView};
use crate::vault::keys;
use crate::vault::merge::merge_vault_view;
use crate::vault::version;
use chrono::Utc;
use std::path::{Path, PathBuf};
use zeroize::Zeroizing;

const VAULT_EXTENSION: &str = "monark";

/// Validates that a file path has the .monark extension and resolves it to a canonical path
/// to prevent path traversal attacks (e.g., via `..` components).
/// For new files, the parent directory must exist or will be created first.
/// Returns the canonicalized path if valid.
pub(crate) fn validate_vault_path(file_path: &str) -> Result<PathBuf, CommandError> {
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
    let master_key = match keys::derive_and_decrypt_master_key(&password, &vault_file) {
        Ok(key) => {
            crate::vault::rate_limit::reset_attempts(&canonical_str);
            key
        }
        Err(err) => {
            crate::vault::rate_limit::record_failure(&canonical_str);
            return Err(err);
        }
    };
    let master_key = Zeroizing::new(master_key);

    let vault = keys::decrypt_vault_content(&master_key, &vault_file)?;

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
    // Refuse to touch a format this build cannot read (review NIT-2, rule
    // E14b): the re-wrap rewrites `argon2_params`/`credentials` with today's
    // serializer, so a future format must not be silently rewritten by it.
    // The check runs before the rate-limit accounting of the password, exactly
    // like the read and update paths (`lifecycle.rs`, `cloud_lifecycle.rs`,
    // `passkey/store.rs`).
    version::check_version(&vault_file.version)?;

    // Prove the old password before touching anything: a wrong password is a
    // failed attempt, a right one clears the counter. The unwrap is repeated
    // inside `keys::rewrap_master_key`, which is the same Argon2 work the
    // pre-refactor code did twice as well.
    match keys::derive_and_decrypt_master_key(&old_password, &vault_file) {
        Ok(_) => crate::vault::rate_limit::reset_attempts(&canonical_str),
        Err(err) => {
            crate::vault::rate_limit::record_failure(&canonical_str);
            return Err(err);
        }
    }

    if new_password.is_empty() {
        return Err(CommandError::Validation(
            "New password is required".to_string(),
        ));
    }

    // Fresh salt + the same Argon2id defaults used when creating a vault; the
    // master key is re-wrapped (never re-derived) so the blob stays readable.
    keys::rewrap_master_key(&old_password, &new_password, &mut vault_file)?;

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

    io::vault::write_vault(file_path.to_string(), &vault_file)
}

fn update_existing_vault(
    file_path: &str,
    password: &str,
    new_vault_content: VaultView,
) -> Result<(), CommandError> {
    crate::vault::rate_limit::check_attempts(file_path)?;
    let mut vault_file = io::vault::read_vault(file_path.to_string())?;
    // Refuse to re-encrypt a format this build cannot read: without this gate the
    // update path would decrypt (and fail) or, worse, rewrite a future format
    // with today's serializer (review finding E14b). The check runs before the
    // rate-limit accounting of the password, exactly like the read paths.
    version::check_version(&vault_file.version)?;

    let master_key = match keys::derive_and_decrypt_master_key(password, &vault_file) {
        Ok(key) => {
            crate::vault::rate_limit::reset_attempts(file_path);
            key
        }
        Err(err) => {
            crate::vault::rate_limit::record_failure(file_path);
            return Err(err);
        }
    };
    let master_key = Zeroizing::new(master_key);

    // Re-attach the passkey secrets that only exist on disk, and keep every
    // passkey this (possibly stale) view does not mention.
    let disk_vault = keys::decrypt_vault_content(&master_key, &vault_file)?;
    let mut merged_vault = merge_vault_view(new_vault_content, &disk_vault)?;
    merged_vault.updated_at = Utc::now();

    vault_file.vault = keys::encrypt_vault_content(&master_key, &merged_vault)?;
    // Keep the stored version unless the merged content now holds a passkey, in
    // which case the file becomes 1.1 (unreadable by pre-passkey clients).
    vault_file.version = version::version_for_content(&vault_file.version, &merged_vault);

    io::vault::write_vault(file_path.to_string(), &vault_file)
}
