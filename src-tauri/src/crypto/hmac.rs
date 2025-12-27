use crate::crypto::error::CryptoError;
use hmac::digest::KeyInit as HmacKeyInit;
use hmac::{Hmac, Mac};
use sha2::Sha256; // Import alias if needed

// --- HMAC-SHA256 Calculation ---

/// Calculates HMAC-SHA256.
/// Takes a key and message. Returns the HMAC tag.
pub fn calculate_hmac_sha256(key: &[u8], message: &[u8]) -> Result<Vec<u8>, CryptoError> {
    // Use fully qualified syntax for new_from_slice from KeyInit trait
    let mut mac = <Hmac<Sha256> as HmacKeyInit>::new_from_slice(key)
        // Construct the Hmac variant correctly
        .map_err(|e| CryptoError::Hmac(format!("Invalid key length for HMAC: {}", e)))?;
    mac.update(message);
    Ok(mac.finalize().into_bytes().to_vec())
}
