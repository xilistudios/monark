use thiserror::Error;

// Custom Error Type
#[derive(Error, Debug)]
pub enum CryptoError {
    #[error("Argon2 hashing failed: {0}")]
    Argon2(#[from] argon2::password_hash::Error),
    #[error("Argon2 password verification failed")]
    Argon2Verify,
    #[error("Argon2 parameter error: {0}")]
    Argon2Params(#[from] argon2::Error),
    #[error("Argon2 hashing error: {0}")] // Specific variant for hash_password_into
    Argon2Hashing(argon2::Error),
    #[error("ChaCha20Poly1305 encryption/decryption failed")]
    Aead(chacha20poly1305::aead::Error),
    #[error("HKDF expansion failed")]
    HkdfExpand,
    #[error("HMAC calculation failed: {0}")] // Keep {0} as String implements Display
    Hmac(String),
    #[error("Base64 encoding/decoding failed: {0}")]
    Base64(#[from] base64::DecodeError),
    #[error("Invalid key length: expected {expected}, got {actual}")]
    InvalidKeyLength { expected: usize, actual: usize },
    #[error("Invalid nonce length: expected {expected}, got {actual}")]
    InvalidNonceLength { expected: usize, actual: usize },
    #[error("Invalid salt length: expected {expected}, got {actual}")]
    InvalidSaltLength { expected: usize, actual: usize },
    #[error("Random number generation failed: {0}")]
    Rng(String), // Wrap RNG errors if necessary, though OsRng is usually reliable
}
