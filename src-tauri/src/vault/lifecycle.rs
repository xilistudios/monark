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
pub fn create_vault(
    file_path: String,
    password: String, // User's chosen master password
) ->  Result<(), CommandError> {
    if std::path::Path::new(&file_path).exists() {
        return Err(CommandError::Io("Vault file already exists".to_string()));
    }

    // 1. Generate Master Key
    let master_key_vec = crypto::random::generate_key()?; // Use generate_key which returns Vec<u8>
    let master_key: [u8; 32] = master_key_vec.try_into().map_err(|_| CommandError::Crypto("Invalid generated master key length".to_string()))?;


    // 2. Derive KDF Key from Password
    let user_salt = crypto::random::generate_salt()?;
    // TODO: Make Argon2 params configurable or use sensible defaults
    let argon2_params = Argon2Params {
        salt: URL_SAFE_NO_PAD.encode(&user_salt),
        memory_cost_kib: 19 * 1024, // 19 MiB
        iterations: 2,
        parallelism: 1,
    };
    let kdf_key = crypto::argon2::derive_key_argon2id(
        password.as_bytes(), // Convert String to &[u8]
        &user_salt,
        argon2_params.memory_cost_kib,
        argon2_params.iterations,
        argon2_params.parallelism,
        32, // 32 bytes for KDF key
    )?;

    // 3. Encrypt Master Key with KDF Key
    let mk_nonce = crypto::random::generate_nonce()?;
    let mk_ciphertext = crypto::chacha::encrypt_xchacha20poly1305(&kdf_key, &mk_nonce, &master_key)?;
    let credentials = EncryptedData {
        nonce: URL_SAFE_NO_PAD.encode(mk_nonce),
        ciphertext: URL_SAFE_NO_PAD.encode(mk_ciphertext),
    };

    // 4. Create Empty Vault Structure
    let empty_vault = Vault {
        updated_at: Utc::now(),
        hmac: String::new(),
        entries: Vec::new(),
    };

    // 5. Encrypt Empty Vault with Master Key
    let vault_json_bytes = serde_json::to_vec(&empty_vault)?;
    let vault_nonce = crypto::random::generate_nonce()?;
    let vault_ciphertext =
        crypto::chacha::encrypt_xchacha20poly1305(&master_key, &vault_nonce, &vault_json_bytes)?;
    let vault_encrypted = EncryptedData {
        nonce: URL_SAFE_NO_PAD.encode(vault_nonce),
        ciphertext: URL_SAFE_NO_PAD.encode(vault_ciphertext),
    };

    // 6. Create VaultFile
    let vault_file = VaultFile {
        version: CURRENT_VAULT_VERSION.to_string(), // Use the constant for versioning
        argon2_params: argon2_params.clone(), // Clone params for storage
        credentials,
        vault: vault_encrypted,
    };
    // 7. Write VaultFile to Disk
    io::vault::write_vault(file_path, &vault_file)?;

    Ok(())
}

#[tauri::command]
pub fn open_vault(
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
#[tauri::command]
pub fn update_vault(
	file_path: String,
	password: String,
	mut vault_content: Vault,
) -> Result<(), CommandError> {
	// 1. Read VaultFile from disk
	let mut vault_file = io::vault::read_vault(file_path.clone())?;

	// 2. Derive KDF Key from Password using stored Argon2 params
	let user_salt = base64::engine::general_purpose::URL_SAFE_NO_PAD
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

	// 3. Decrypt Master Key using KDF Key
	let mk_nonce = base64::engine::general_purpose::URL_SAFE_NO_PAD
		.decode(&vault_file.credentials.nonce)
		.map_err(|e| CommandError::Crypto(format!("Failed to decode master key nonce: {}", e)))?;
	let mk_ciphertext = base64::engine::general_purpose::URL_SAFE_NO_PAD
		.decode(&vault_file.credentials.ciphertext)
		.map_err(|e| CommandError::Crypto(format!("Failed to decode master key ciphertext: {}", e)))?;
	let master_key_vec = crypto::chacha::decrypt_xchacha20poly1305(&kdf_key, &mk_nonce, &mk_ciphertext)?;
	let master_key: [u8; 32] = master_key_vec.try_into()
		.map_err(|_| CommandError::Crypto("Invalid decrypted master key length".to_string()))?;

	// 4. Update vault_content.updated_at
	vault_content.updated_at = Utc::now();

	// 5. Serialize vault_content to JSON bytes
	let vault_json_bytes = serde_json::to_vec(&vault_content)
		.map_err(|e| CommandError::Io(format!("Failed to serialize vault: {}", e)))?;

	// 6. Generate new encryption nonce
	let vault_nonce = crypto::random::generate_nonce()?;

	// 7. Encrypt vault JSON with master key
	let vault_ciphertext = crypto::chacha::encrypt_xchacha20poly1305(&master_key, &vault_nonce, &vault_json_bytes)?;

	// 8. Update VaultFile's vault data
	vault_file.vault.nonce = base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(vault_nonce);
	vault_file.vault.ciphertext = base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(vault_ciphertext);

	// 9. Write updated VaultFile back to disk
	io::vault::write_vault(file_path, &vault_file)?;

	Ok(())
}

