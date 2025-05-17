#[cfg(test)]
mod tests {
    use crate::crypto::argon2::derive_key_argon2id;
    use crate::crypto::random::generate_random_bytes;

    #[test]
    fn test_derive_key_argon2id() {
        let password = b"test_password";
        let salt = generate_random_bytes(16).unwrap(); // Use a random salt
        let memory_kib = 1024; // 1MB
        let iterations = 10;
        let parallelism = 1;
        let hash_len = 32; // 256 bits

        let derived_key_result = derive_key_argon2id(
            password,
            &salt,
            memory_kib,
            iterations,
            parallelism,
            hash_len,
        );

        assert!(derived_key_result.is_ok());
        let derived_key = derived_key_result.unwrap();
        assert_eq!(derived_key.len(), hash_len as usize);
    }
}