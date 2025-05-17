// Constants
pub const KEY_LEN: usize = 32; // 256 bits for XChaCha20Poly1305 and HKDF output
pub const NONCE_LEN: usize = 24; // XNonce length for XChaCha20Poly1305
pub const SALT_LEN: usize = 16; // Recommended salt length for Argon2 and HKDF