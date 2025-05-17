use rand::{rngs::OsRng as RandOsRng, RngCore};
use crate::crypto::error::CryptoError;
use crate::crypto::constants::{SALT_LEN, KEY_LEN, NONCE_LEN};

// --- Random Data Generation ---

/// Generates cryptographically secure random bytes.
pub fn generate_random_bytes(len: usize) -> Result<Vec<u8>, CryptoError> {
    let mut bytes = vec![0u8; len];
    RandOsRng
        .try_fill_bytes(&mut bytes)
        .map_err(|e| CryptoError::Rng(e.to_string()))?;
    Ok(bytes)
}

/// Generates a secure random salt (default length).
pub fn generate_salt() -> Result<Vec<u8>, CryptoError> {
    generate_random_bytes(SALT_LEN)
}

/// Generates a secure random key (default length).
pub fn generate_key() -> Result<Vec<u8>, CryptoError> {
    generate_random_bytes(KEY_LEN)
}

/// Generates a secure random XNonce for XChaCha20Poly1305.
pub fn generate_nonce() -> Result<Vec<u8>, CryptoError> {
    generate_random_bytes(NONCE_LEN)
}