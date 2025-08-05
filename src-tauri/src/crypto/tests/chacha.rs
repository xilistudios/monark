use crate::crypto::chacha::{decrypt_xchacha20poly1305, encrypt_xchacha20poly1305};
use crate::crypto::constants::{KEY_LEN, NONCE_LEN};
use crate::crypto::error::CryptoError;
use rand::{rngs::OsRng, RngCore};

#[test]
fn test_encrypt_decrypt_xchacha20poly1305() {
    let mut key_bytes = [0u8; KEY_LEN];
    OsRng.fill_bytes(&mut key_bytes);
    let mut nonce_bytes = [0u8; NONCE_LEN];
    OsRng.fill_bytes(&mut nonce_bytes);
    let plaintext = b"This is a test message.";

    let ciphertext =
        encrypt_xchacha20poly1305(&key_bytes, &nonce_bytes, plaintext).expect("Encryption failed");
    let decrypted_plaintext = decrypt_xchacha20poly1305(&key_bytes, &nonce_bytes, &ciphertext)
        .expect("Decryption failed");

    assert_eq!(plaintext.to_vec(), decrypted_plaintext);
}

#[test]
fn test_encrypt_invalid_key_length() {
    let key_bytes = [0u8; KEY_LEN - 1]; // Invalid key length
    let mut nonce_bytes = [0u8; NONCE_LEN];
    OsRng.fill_bytes(&mut nonce_bytes);
    let plaintext = b"This is a test message.";

    let result = encrypt_xchacha20poly1305(&key_bytes, &nonce_bytes, plaintext);

    match result {
        Err(CryptoError::InvalidKeyLength { expected, actual }) => {
            assert_eq!(expected, KEY_LEN);
            assert_eq!(actual, KEY_LEN - 1);
        }
        _ => panic!("Expected InvalidKeyLength error"),
    }
}

#[test]
fn test_encrypt_invalid_nonce_length() {
    let mut key_bytes = [0u8; KEY_LEN];
    OsRng.fill_bytes(&mut key_bytes);
    let nonce_bytes = [0u8; NONCE_LEN - 1]; // Invalid nonce length
    let plaintext = b"This is a test message.";

    let result = encrypt_xchacha20poly1305(&key_bytes, &nonce_bytes, plaintext);

    match result {
        Err(CryptoError::InvalidNonceLength { expected, actual }) => {
            assert_eq!(expected, NONCE_LEN);
            assert_eq!(actual, NONCE_LEN - 1);
        }
        _ => panic!("Expected InvalidNonceLength error"),
    }
}

#[test]
fn test_decrypt_invalid_key_length() {
    let key_bytes = [0u8; KEY_LEN - 1]; // Invalid key length
    let mut nonce_bytes = [0u8; NONCE_LEN];
    OsRng.fill_bytes(&mut nonce_bytes);
    let ciphertext = b"This is a test message.";

    let result = decrypt_xchacha20poly1305(&key_bytes, &nonce_bytes, ciphertext);

    match result {
        Err(CryptoError::InvalidKeyLength { expected, actual }) => {
            assert_eq!(expected, KEY_LEN);
            assert_eq!(actual, KEY_LEN - 1);
        }
        _ => panic!("Expected InvalidKeyLength error"),
    }
}

#[test]
fn test_decrypt_invalid_nonce_length() {
    let mut key_bytes = [0u8; KEY_LEN];
    OsRng.fill_bytes(&mut key_bytes);
    let nonce_bytes = [0u8; NONCE_LEN - 1]; // Invalid nonce length
    let ciphertext = b"This is a test message.";

    let result = decrypt_xchacha20poly1305(&key_bytes, &nonce_bytes, ciphertext);

    match result {
        Err(CryptoError::InvalidNonceLength { expected, actual }) => {
            assert_eq!(expected, NONCE_LEN);
            assert_eq!(actual, NONCE_LEN - 1);
        }
        _ => panic!("Expected InvalidNonceLength error"),
    }
}
