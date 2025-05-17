use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use crate::crypto::error::CryptoError;

// --- Base64 Helpers ---

/// Encodes bytes to a Base64 URL-safe string.
pub fn encode_base64_urlsafe(bytes: &[u8]) -> String {
    URL_SAFE_NO_PAD.encode(bytes)
}

/// Decodes a Base64 URL-safe string to bytes.
pub fn decode_base64_urlsafe(s: &str) -> Result<Vec<u8>, CryptoError> {
    URL_SAFE_NO_PAD.decode(s).map_err(CryptoError::Base64)
}