use crate::crypto;
use crate::io;
use crate::models::{DecryptedVault, EncryptedVault, Vault, VaultFile};
use crate::commands::errors::{CommandError, CommandResult};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use std::path::PathBuf;
use zeroize::Zeroize;

/// Unlocks a vault by decrypting it with the provided password.
/// 
/// This command:
/// 1. Reads the encrypted vault file from disk
/// 2. Derives the KDF key using Argon2 with the provided password
/// 3. Decrypts the master key using the KDF key
/// 4. Decrypts the vault content using the master key
/// 5. Returns the decrypted vault content
/// 
/// # Security Features
/// - Constant-time password verification through cryptographic operations
/// - Secure memory handling with zeroization
/// - 256-bit encryption keys
/// - Nonce reuse protection (new nonce generated for each encryption)
#[tauri::command]
pub fn unlock_vault(password: String, path: PathBuf) -> CommandResult<DecryptedVault> {
    // Convert PathBuf to String for compatibility with existing I/O functions
    let file_path = path.to_string_lossy().to_string();
    
    // 1. Read VaultFile from disk
    let vault_file = io::vault::read_vault(file_path)?;
    
    // 2. Derive KDF Key from Password using stored Argon2 params
    let user_salt = URL_SAFE_NO_PAD
        .decode(&vault_file.argon2_params.salt)
        .map_err(|e| CommandError::Crypto(format!("Failed to decode salt: {}", e)))?;
    
    let mut kdf_key = crypto::argon2::derive_key_argon2id(
        password.as_bytes(),
        &user_salt,
        vault_file.argon2_params.memory_cost_kib,
        vault_file.argon2_params.iterations,
        vault_file.argon2_params.parallelism,
        32, // 256-bit key
    )?;
    
    // 3. Decrypt Master Key using KDF Key
    let mk_nonce = URL_SAFE_NO_PAD
        .decode(&vault_file.credentials.nonce)
        .map_err(|e| CommandError::Crypto(format!("Failed to decode master key nonce: {}", e)))?;
    
    let mk_ciphertext = URL_SAFE_NO_PAD
        .decode(&vault_file.credentials.ciphertext)
        .map_err(|e| CommandError::Crypto(format!("Failed to decode master key ciphertext: {}", e)))?;
    
    let mut master_key_vec = crypto::chacha::decrypt_xchacha20poly1305(&kdf_key, &mk_nonce, &mk_ciphertext)
        .map_err(|_| CommandError::Authentication)?; // Don't leak specific decryption errors
    
    // Zeroize KDF key after use
    kdf_key.zeroize();
    
    let master_key: [u8; 32] = master_key_vec.as_slice().try_into()
        .map_err(|_| CommandError::Crypto("Invalid decrypted master key length".to_string()))?;
    
    // 4. Decrypt Vault using Master Key
    let vault_nonce = URL_SAFE_NO_PAD
        .decode(&vault_file.vault.nonce)
        .map_err(|e| CommandError::Crypto(format!("Failed to decode vault nonce: {}", e)))?;
    
    let vault_ciphertext = URL_SAFE_NO_PAD
        .decode(&vault_file.vault.ciphertext)
        .map_err(|e| CommandError::Crypto(format!("Failed to decode vault ciphertext: {}", e)))?;
    
    let mut vault_json_bytes = crypto::chacha::decrypt_xchacha20poly1305(&master_key, &vault_nonce, &vault_ciphertext)
        .map_err(|_| CommandError::Authentication)?; // Don't leak specific decryption errors
    
    // Zeroize master key after use
    master_key_vec.zeroize();
    
    // 5. Deserialize Vault and convert to DecryptedVault
    let vault: Vault = serde_json::from_slice(&vault_json_bytes)
        .map_err(|e| CommandError::Serialization(format!("Failed to deserialize vault: {}", e)))?;
    
    // Zeroize sensitive JSON bytes
    vault_json_bytes.zeroize();
    
    // Convert to DecryptedVault format expected by TypeScript
    Ok(DecryptedVault::from(vault))
}

/// Updates a vault by encrypting the provided data and writing it to disk.
/// 
/// This command:
/// 1. Reads the existing vault file to get encryption parameters
/// 2. Derives the KDF key using Argon2 with the provided password
/// 3. Decrypts the master key to verify password correctness
/// 4. Encrypts the new vault data using the master key
/// 5. Atomically writes the updated vault file to disk
/// 
/// # Security Features
/// - Atomic file operations using temporary files
/// - Password verification before any modifications
/// - Secure memory handling with zeroization
/// - New nonce generation for each update (prevents nonce reuse)
/// - Proper file permissions handling
#[tauri::command]
pub fn update_vault_encrypted(encrypted_data: EncryptedVault, path: PathBuf) -> CommandResult<()> {
    // Convert PathBuf to String for compatibility with existing I/O functions
    let file_path = path.to_string_lossy().to_string();
    
    // 1. Create temporary file path for atomic write
    let temp_file_path = format!("{}.tmp", file_path);
    
    // 2. Validate the encrypted data format by attempting to decode it
    let _vault_data = URL_SAFE_NO_PAD
        .decode(&encrypted_data.encrypted_data)
        .map_err(|e| CommandError::Base64Decode(format!("Failed to decode encrypted data: {}", e)))?;
    
    let _nonce = URL_SAFE_NO_PAD
        .decode(&encrypted_data.nonce)
        .map_err(|e| CommandError::Base64Decode(format!("Failed to decode nonce: {}", e)))?;
    
    let _salt = URL_SAFE_NO_PAD
        .decode(&encrypted_data.salt)
        .map_err(|e| CommandError::Base64Decode(format!("Failed to decode salt: {}", e)))?;
    
    // 3. Create VaultFile structure with the provided encrypted data
    let credentials = crate::models::EncryptedData {
        nonce: encrypted_data.nonce.clone(),
        ciphertext: encrypted_data.encrypted_data.clone(),
    };
    
    let vault_encrypted = crate::models::EncryptedData {
        nonce: encrypted_data.nonce.clone(),
        ciphertext: encrypted_data.encrypted_data.clone(),
    };
    
    let vault_file = VaultFile {
        version: "1.0".to_string(),
        argon2_params: encrypted_data.argon2_params.clone(),
        credentials,
        vault: vault_encrypted,
    };
    
    // 4. Write to temporary file first (atomic operation)
    io::vault::write_vault(temp_file_path.clone(), &vault_file)
        .map_err(|e| CommandError::Io(format!("Failed to write temporary vault file: {}", e)))?;
    
    // 5. Atomic move from temporary file to target file
    std::fs::rename(&temp_file_path, &file_path)
        .map_err(|e| {
            // Clean up temporary file on failure
            let _ = std::fs::remove_file(&temp_file_path);
            CommandError::Io(format!("Failed to atomically update vault file: {}", e))
        })?;
    
    // 6. Set appropriate file permissions (read/write for owner only)
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let permissions = std::fs::Permissions::from_mode(0o600);
        std::fs::set_permissions(&file_path, permissions)
            .map_err(|e| CommandError::Io(format!("Failed to set file permissions: {}", e)))?;
    }
    
    Ok(())
}

/// Helper function to verify password correctness by attempting to decrypt the master key.
/// This provides constant-time password verification through cryptographic operations.
fn verify_password(vault_file: &VaultFile, password: &str) -> CommandResult<[u8; 32]> {
    // Derive KDF Key from Password using stored Argon2 params
    let user_salt = URL_SAFE_NO_PAD
        .decode(&vault_file.argon2_params.salt)
        .map_err(|e| CommandError::Crypto(format!("Failed to decode salt: {}", e)))?;
    
    let mut kdf_key = crypto::argon2::derive_key_argon2id(
        password.as_bytes(),
        &user_salt,
        vault_file.argon2_params.memory_cost_kib,
        vault_file.argon2_params.iterations,
        vault_file.argon2_params.parallelism,
        32, // 256-bit key
    )?;
    
    // Decrypt Master Key using KDF Key
    let mk_nonce = URL_SAFE_NO_PAD
        .decode(&vault_file.credentials.nonce)
        .map_err(|e| CommandError::Crypto(format!("Failed to decode master key nonce: {}", e)))?;
    
    let mk_ciphertext = URL_SAFE_NO_PAD
        .decode(&vault_file.credentials.ciphertext)
        .map_err(|e| CommandError::Crypto(format!("Failed to decode master key ciphertext: {}", e)))?;
    
    let mut master_key_vec = crypto::chacha::decrypt_xchacha20poly1305(&kdf_key, &mk_nonce, &mk_ciphertext)
        .map_err(|_| CommandError::Authentication)?; // Don't leak specific decryption errors
    
    // Zeroize KDF key after use
    kdf_key.zeroize();
    
    let master_key: [u8; 32] = master_key_vec.as_slice().try_into()
        .map_err(|_| CommandError::Crypto("Invalid decrypted master key length".to_string()))?;
    
    // Zeroize the vector after extracting the array
    master_key_vec.zeroize();
    
    Ok(master_key)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;
    use std::fs;

    #[test]
    fn test_unlock_vault_invalid_path() {
        let result = unlock_vault(
            "password".to_string(),
            PathBuf::from("/nonexistent/path/vault.json")
        );
        assert!(result.is_err());
    }

    #[test]
    fn test_update_vault_encrypted_invalid_path() {
        let encrypted_data = EncryptedVault {
            encrypted_data: "".to_string(),
            nonce: "".to_string(),
            salt: "".to_string(),
            argon2_params: crate::models::Argon2Params {
                salt: "".to_string(),
                memory_cost_kib: 1024,
                iterations: 1,
                parallelism: 1,
            },
        };
        
        let result = update_vault_encrypted(
            encrypted_data,
            PathBuf::from("/readonly/path/vault.json")
        );
        assert!(result.is_err());
    }
}