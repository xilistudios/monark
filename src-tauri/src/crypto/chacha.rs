use chacha20poly1305::{
    aead::{Aead, KeyInit},
    Key as ChaChaKey,
    XChaCha20Poly1305,
    XNonce,
};
use crate::crypto::error::CryptoError;
use crate::crypto::constants::{KEY_LEN, NONCE_LEN};

// --- XChaCha20Poly1305 Encryption/Decryption ---

/// Encrypts plaintext using XChaCha20Poly1305.
/// Takes key, nonce, and plaintext. Returns ciphertext.
/// Assumes key and nonce are correct lengths.
pub fn encrypt_xchacha20poly1305(
    key_bytes: &[u8],
    nonce_bytes: &[u8],
    plaintext: &[u8],
) -> Result<Vec<u8>, CryptoError> {
    if key_bytes.len() != KEY_LEN {
        return Err(CryptoError::InvalidKeyLength {
            expected: KEY_LEN,
            actual: key_bytes.len(),
        });
    }
    if nonce_bytes.len() != NONCE_LEN {
        return Err(CryptoError::InvalidNonceLength {
            expected: NONCE_LEN,
            actual: nonce_bytes.len(),
        });
    }

    let key = ChaChaKey::from_slice(key_bytes);
    let nonce = XNonce::from_slice(nonce_bytes);
    let cipher = XChaCha20Poly1305::new(key);

    cipher.encrypt(nonce, plaintext).map_err(CryptoError::Aead)
}

/// Decrypts ciphertext using XChaCha20Poly1305.
/// Takes key, nonce, and ciphertext. Returns plaintext.
/// Assumes key and nonce are correct lengths.
pub fn decrypt_xchacha20poly1305(
    key_bytes: &[u8],
    nonce_bytes: &[u8],
    ciphertext: &[u8],
) -> Result<Vec<u8>, CryptoError> {
    if key_bytes.len() != KEY_LEN {
        return Err(CryptoError::InvalidKeyLength {
            expected: KEY_LEN,
            actual: key_bytes.len(),
        });
    }
    if nonce_bytes.len() != NONCE_LEN {
        return Err(CryptoError::InvalidNonceLength {
            expected: NONCE_LEN,
            actual: nonce_bytes.len(),
        });
    }

    let key = ChaChaKey::from_slice(key_bytes);
    let nonce = XNonce::from_slice(nonce_bytes);
    let cipher = XChaCha20Poly1305::new(key);

    cipher.decrypt(nonce, ciphertext).map_err(CryptoError::Aead)
}