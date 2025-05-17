use argon2::{self, Argon2};
use crate::crypto::error::CryptoError;

// --- Argon2id Key Derivation ---

/// Derives a key from a password using Argon2id with provided parameters.
/// Returns the derived key.
pub fn derive_key_argon2id(
    password: &[u8],
    salt: &[u8],
    memory_kib: u32,
    iterations: u32,
    parallelism: u32,
    hash_len: u32,
) -> Result<Vec<u8>, CryptoError> {
    let params = argon2::Params::new(memory_kib, iterations, parallelism, Some(hash_len as usize))?;
    let argon2 = Argon2::new(argon2::Algorithm::Argon2id, argon2::Version::V0x13, params);

    let mut derived_key = vec![0u8; hash_len as usize];
    argon2
        .hash_password_into(password, salt, &mut derived_key)
        .map_err(|e: argon2::Error| CryptoError::Argon2Hashing(e))?;

    Ok(derived_key)
}