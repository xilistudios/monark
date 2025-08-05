use crate::io::signature::{is_valid_signature, parse_content, sign_content};

#[test]
fn test_is_valid_signature_valid() {
    let valid_sig = "p->monark/some_content";
    assert_eq!(is_valid_signature(valid_sig), true);
}

#[test]
fn test_is_valid_signature_invalid() {
    let invalid_sig = "invalid/signature";
    assert_eq!(is_valid_signature(invalid_sig), false);
}

#[test]
fn test_sign_content() {
    let content = "test content";
    let signed = sign_content(content);
    assert_eq!(signed, "p->monark/test content");
}

#[test]
fn test_parse_content_valid() {
    let signed_content = "p->monark/some data";
    let parsed = parse_content(signed_content);
    assert_eq!(parsed.signature, ""); // The split removes the signature prefix
    assert_eq!(parsed.content, "some data");
}

#[test]
fn test_parse_content_empty() {
    let signed_content = "p->monark/";
    let parsed = parse_content(signed_content);
    assert_eq!(parsed.signature, "");
    assert_eq!(parsed.content, "");
}

#[test]
fn test_parse_content_malformed() {
    let malformed_content = "just some content";
    let parsed = parse_content(malformed_content);
    assert_eq!(parsed.signature, "just some content");
    assert_eq!(parsed.content, "");
}
