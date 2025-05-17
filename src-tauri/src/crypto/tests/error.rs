#[cfg(test)]
mod tests {
    use crate::crypto::error::CryptoError;
    use base64::DecodeError;

    #[test]
    fn test_crypto_error_variants() {
        // Test Argon2 errors
        let argon2_err = argon2::password_hash::Error::Password;
        let crypto_err = CryptoError::Argon2(argon2_err);
        assert_eq!(format!("{}", crypto_err), "Argon2 hashing failed: invalid password");

        let crypto_err = CryptoError::Argon2Verify;
        assert_eq!(format!("{}", crypto_err), "Argon2 password verification failed");

        let argon2_params_err = argon2::Error::OutputTooShort;
        let crypto_err = CryptoError::Argon2Params(argon2_params_err);
        assert_eq!(format!("{}", crypto_err), "Argon2 parameter error: output is too short");

        let argon2_hashing_err = argon2::Error::OutputTooShort;
        let crypto_err = CryptoError::Argon2Hashing(argon2_hashing_err);
        assert_eq!(format!("{}", crypto_err), "Argon2 hashing error: output is too short");

        // Test Aead error
        let aead_err = chacha20poly1305::aead::Error;
        let crypto_err = CryptoError::Aead(aead_err);
        assert_eq!(format!("{}", crypto_err), "ChaCha20Poly1305 encryption/decryption failed");

        // Test HkdfExpand error
        let crypto_err = CryptoError::HkdfExpand;
        assert_eq!(format!("{}", crypto_err), "HKDF expansion failed");

        // Test Hmac error
        let hmac_err_msg = "HMAC calculation failed";
        let crypto_err = CryptoError::Hmac(hmac_err_msg.to_string());
        assert_eq!(format!("{}", crypto_err), format!("HMAC calculation failed: {}", hmac_err_msg));

        // Test Base64 error
        let base64_err = DecodeError::InvalidLength(0);
        let crypto_err = CryptoError::Base64(base64_err);
        assert_eq!(format!("{}", crypto_err), "Base64 encoding/decoding failed: Invalid input length: 0");

        // Test InvalidKeyLength error
        let crypto_err = CryptoError::InvalidKeyLength { expected: 32, actual: 16 };
        assert_eq!(format!("{}", crypto_err), "Invalid key length: expected 32, got 16");

        // Test InvalidNonceLength error
        let crypto_err = CryptoError::InvalidNonceLength { expected: 12, actual: 8 };
        assert_eq!(format!("{}", crypto_err), "Invalid nonce length: expected 12, got 8");

        // Test InvalidSaltLength error
        let crypto_err = CryptoError::InvalidSaltLength { expected: 16, actual: 8 };
        assert_eq!(format!("{}", crypto_err), "Invalid salt length: expected 16, got 8");

        // Test Rng error
        let rng_err_msg = "Failed to get random bytes";
        let crypto_err = CryptoError::Rng(rng_err_msg.to_string());
        assert_eq!(format!("{}", crypto_err), format!("Random number generation failed: {}", rng_err_msg));
    }
}