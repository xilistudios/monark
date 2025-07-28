use crate::crypto;
use crate::io;
use crate::models::{
    Argon2Params, EncryptedData, VaultFile, Vault,
};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use chrono::Utc;
use crate::commands::errors::CommandError;

// Constants
const CURRENT_VAULT_VERSION: &str = "1.0";

#[tauri::command]
pub fn write_vault(
	file_path: String,
	password: String,
	vault_content: Option<Vault>,
) -> Result<(), CommandError> {
	if vault_content.is_none() {
		// CREATE logic
		if std::path::Path::new(&file_path).exists() {
			return Err(CommandError::Io("Vault file already exists".to_string()));
		}
		let master_key_vec = crypto::random::generate_key()?;
		let master_key: [u8; 32] = master_key_vec.try_into().map_err(|_| CommandError::Crypto("Invalid generated master key length".to_string()))?;
		let user_salt = crypto::random::generate_salt()?;
		let argon2_params = Argon2Params {
			salt: URL_SAFE_NO_PAD.encode(&user_salt),
			memory_cost_kib: 19 * 1024,
			iterations: 2,
			parallelism: 1,
		};
		let kdf_key = crypto::argon2::derive_key_argon2id(
			password.as_bytes(),
			&user_salt,
			argon2_params.memory_cost_kib,
			argon2_params.iterations,
			argon2_params.parallelism,
			32,
		)?;
		let mk_nonce = crypto::random::generate_nonce()?;
		let mk_ciphertext = crypto::chacha::encrypt_xchacha20poly1305(&kdf_key, &mk_nonce, &master_key)?;
		let credentials = EncryptedData {
			nonce: URL_SAFE_NO_PAD.encode(mk_nonce),
			ciphertext: URL_SAFE_NO_PAD.encode(mk_ciphertext),
		};
		let empty_vault = Vault {
			updated_at: Utc::now(),
			hmac: String::new(),
			entries: Vec::new(),
		};
		let vault_json_bytes = serde_json::to_vec(&empty_vault)?;
		let vault_nonce = crypto::random::generate_nonce()?;
		let vault_ciphertext = crypto::chacha::encrypt_xchacha20poly1305(&master_key, &vault_nonce, &vault_json_bytes)?;
		let vault_encrypted = EncryptedData {
			nonce: URL_SAFE_NO_PAD.encode(vault_nonce),
			ciphertext: URL_SAFE_NO_PAD.encode(vault_ciphertext),
		};
		let vault_file = VaultFile {
			version: CURRENT_VAULT_VERSION.to_string(),
			argon2_params: argon2_params.clone(),
			credentials,
			vault: vault_encrypted,
		};
		// Ensure parent directory exists
		let parent = std::path::Path::new(&file_path)
			.parent()
			.ok_or_else(|| CommandError::Io("Invalid parent directory".to_string()))?;
		std::fs::create_dir_all(parent)
			.map_err(|e| CommandError::Io(format!("Failed to create parent directory: {}", e)))?;
		io::vault::write_vault(file_path, &vault_file)?;
		Ok(())
	} else {
		// UPDATE logic
		let mut vault_file = io::vault::read_vault(file_path.clone())?;
		let user_salt = URL_SAFE_NO_PAD
			.decode(&vault_file.argon2_params.salt)
			.map_err(|e| CommandError::Crypto(format!("Failed to decode salt: {}", e)))?;
		let kdf_key = crypto::argon2::derive_key_argon2id(
			password.as_bytes(),
			&user_salt,
			vault_file.argon2_params.memory_cost_kib,
			vault_file.argon2_params.iterations,
			vault_file.argon2_params.parallelism,
			32,
		)?;
		let mk_nonce = URL_SAFE_NO_PAD
			.decode(&vault_file.credentials.nonce)
			.map_err(|e| CommandError::Crypto(format!("Failed to decode master key nonce: {}", e)))?;
		let mk_ciphertext = URL_SAFE_NO_PAD
			.decode(&vault_file.credentials.ciphertext)
			.map_err(|e| CommandError::Crypto(format!("Failed to decode master key ciphertext: {}", e)))?;
		let master_key_vec = crypto::chacha::decrypt_xchacha20poly1305(&kdf_key, &mk_nonce, &mk_ciphertext)?;
		let master_key: [u8; 32] = master_key_vec.try_into()
			.map_err(|_| CommandError::Crypto("Invalid decrypted master key length".to_string()))?;
		let mut vault_content = vault_content.unwrap();
		vault_content.updated_at = Utc::now();
		let vault_json_bytes = serde_json::to_vec(&vault_content)
			.map_err(|e| CommandError::Io(format!("Failed to serialize vault: {}", e)))?;
		let vault_nonce = crypto::random::generate_nonce()?;
		let vault_ciphertext = crypto::chacha::encrypt_xchacha20poly1305(&master_key, &vault_nonce, &vault_json_bytes)?;
		vault_file.vault.nonce = URL_SAFE_NO_PAD.encode(vault_nonce);
		vault_file.vault.ciphertext = URL_SAFE_NO_PAD.encode(vault_ciphertext);
		// Ensure parent directory exists
		let parent = std::path::Path::new(&file_path)
			.parent()
			.ok_or_else(|| CommandError::Io("Invalid parent directory".to_string()))?;
		std::fs::create_dir_all(parent)
			.map_err(|e| CommandError::Io(format!("Failed to create parent directory: {}", e)))?;
		io::vault::write_vault(file_path, &vault_file)?;
		Ok(())
	}
}

#[tauri::command]
pub fn read_vault(
    file_path: String,
    password: String,
) -> Result<Vault, CommandError> {
    // 1. Read VaultFile from disk
    let vault_file = io::vault::read_vault(file_path)?;

    // 2. Derive KDF Key from Password using stored Argon2 params
    let user_salt = URL_SAFE_NO_PAD
        .decode(&vault_file.argon2_params.salt)
        .map_err(|e| CommandError::Crypto(format!("Failed to decode salt: {}", e)))?;
    
    let kdf_key = crypto::argon2::derive_key_argon2id(
        password.as_bytes(),
        &user_salt,
        vault_file.argon2_params.memory_cost_kib,
        vault_file.argon2_params.iterations,
        vault_file.argon2_params.parallelism,
        32, // 32 bytes for KDF key
    )?;

    // 3. Decrypt Master Key using KDF Key
    let mk_nonce = URL_SAFE_NO_PAD
        .decode(&vault_file.credentials.nonce)
        .map_err(|e| CommandError::Crypto(format!("Failed to decode master key nonce: {}", e)))?;
    
    let mk_ciphertext = URL_SAFE_NO_PAD
        .decode(&vault_file.credentials.ciphertext)
        .map_err(|e| CommandError::Crypto(format!("Failed to decode master key ciphertext: {}", e)))?;
    
    let master_key_vec = crypto::chacha::decrypt_xchacha20poly1305(&kdf_key, &mk_nonce, &mk_ciphertext)?;
    let master_key: [u8; 32] = master_key_vec.try_into()
        .map_err(|_| CommandError::Crypto("Invalid decrypted master key length".to_string()))?;

    // 4. Decrypt Vault using Master Key
    let vault_nonce = URL_SAFE_NO_PAD
        .decode(&vault_file.vault.nonce)
        .map_err(|e| CommandError::Crypto(format!("Failed to decode vault nonce: {}", e)))?;
    
    let vault_ciphertext = URL_SAFE_NO_PAD
        .decode(&vault_file.vault.ciphertext)
        .map_err(|e| CommandError::Crypto(format!("Failed to decode vault ciphertext: {}", e)))?;
    
    let vault_json_bytes = crypto::chacha::decrypt_xchacha20poly1305(&master_key, &vault_nonce, &vault_ciphertext)?;

    // 5. Deserialize Vault
    let vault: Vault = serde_json::from_slice(&vault_json_bytes)
        .map_err(|e| CommandError::Io(format!("Failed to deserialize vault: {}", e)))?;

    Ok(vault)
}

/**
 * Deletes a vault file at the specified path, validating the `.monark` extension.
 *
 * # Arguments
 * * `file_path` - The path to the vault file to delete.
 *
 * # Returns
 * * `Ok(())` if the file was successfully deleted.
 * * `Err(CommandError)` if the file does not exist, has an invalid extension, or deletion fails.
 *
 * # Validation
 * This function only allows deletion of files with the `.monark` extension.
 */
#[tauri::command]
pub fn delete_vault(
	file_path: String,
) -> Result<(), CommandError> {
	let path = std::path::Path::new(&file_path);

	// Validate extension
	match path.extension().and_then(|ext| ext.to_str()) {
		Some("monark") => {},
		_ => {
			return Err(CommandError::Io("Invalid vault file extension".to_string()));
		}
	}

	if !path.exists() {
		return Err(CommandError::Io("Vault file does not exist".to_string()));
	}
	std::fs::remove_file(path)
		.map_err(|e| CommandError::Io(format!("Failed to delete vault file: {}", e)))?;
	Ok(())
}
