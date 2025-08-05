#[cfg(test)]
mod tests {
    use crate::crypto::base64::{decode_base64_urlsafe, encode_base64_urlsafe};

    #[test]
    fn test_encode_base64_urlsafe() {
        let bytes = b"hello world";
        let encoded = encode_base64_urlsafe(bytes);
        assert_eq!(encoded, "aGVsbG8gd29ybGQ");

        let bytes = b"";
        let encoded = encode_base64_urlsafe(bytes);
        assert_eq!(encoded, "");

        let bytes = b"\x00\xff\x7f";
        let encoded = encode_base64_urlsafe(bytes);
        assert_eq!(encoded, "AP9_");
    }

    #[test]
    fn test_decode_base64_urlsafe() {
        let encoded = "aGVsbG8gd29ybGQ";
        let decoded = decode_base64_urlsafe(encoded).unwrap();
        assert_eq!(decoded, b"hello world");

        let encoded = "";
        let decoded = decode_base64_urlsafe(encoded).unwrap();
        assert_eq!(decoded, b"");

        let encoded = "AP9_";
        let decoded = decode_base64_urlsafe(encoded).unwrap();
        assert_eq!(decoded, b"\x00\xff\x7f");

        let encoded = "invalid-base64!"; // Invalid base64 character
        let decoded = decode_base64_urlsafe(encoded);
        assert!(decoded.is_err());
    }
}
