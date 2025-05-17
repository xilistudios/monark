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

