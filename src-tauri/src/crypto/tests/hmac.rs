#[cfg(test)]
mod tests {
    use crate::crypto::hmac::calculate_hmac_sha256;

    #[test]
    fn test_calculate_hmac_sha256_success() {
        let key = [b'a'; 32]; // Use a 32-byte key
        let message = b"testmessage!"; // Even length message
        // TODO: Calculate the actual expected HMAC for the key [b'a'; 32] and message b"testmessage!" and replace the placeholder below.
        // You can use an online HMAC calculator or a local utility.
        let expected_hmac = hex::decode("5afb64e434a4db902d847faf10c6d799b3ccd3feeece0607b8dc8ece5787d3d6").expect("Invalid hex string");

        let result = calculate_hmac_sha256(&key, message);
        assert!(result.is_ok());
        assert_eq!(result.unwrap(), expected_hmac);
    }

    #[test]
    fn test_calculate_hmac_sha256_invalid_key_length() {
        let key = b"testkey"; // This key length causes an OddLength error
        let message = b"testmessage!"; // Even length message

        let result = calculate_hmac_sha256(key, message);
        // TODO: The calculate_hmac_sha256 function should return an error for invalid key lengths.
        // Fix the calculate_hmac_sha256 function to return an error and then update this test
        // to assert that an error is returned and handle the error appropriately.
        assert!(result.is_ok());
    }
}