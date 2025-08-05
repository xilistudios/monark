#[cfg(test)]
mod tests {
    use crate::crypto::constants::*;

    #[test]
    fn test_key_len() {
        assert_eq!(KEY_LEN, 32);
    }

    #[test]
    fn test_nonce_len() {
        assert_eq!(NONCE_LEN, 24);
    }

    #[test]
    fn test_salt_len() {
        assert_eq!(SALT_LEN, 16);
    }
}
