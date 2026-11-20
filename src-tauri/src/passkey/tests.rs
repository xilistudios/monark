//! Cross-module tests for the passkey crypto core.
//!
//! These exercise the full primitive pipeline the ceremonies (T09/T10) will
//! use — key → COSE_Key → authenticatorData → attestationObject → clientDataJSON
//! → signature — against a **known-answer vector** built from the published CXF
//! specification example key (Appendix A of the CXF 1.0 review draft). That key
//! is an example credential, not a secret, and every input below is a constant,
//! so the assertions are exact rather than "it did not error".
//!
//! The negative controls at the bottom prove the vector bites: flipping one byte
//! of the authenticator data, of the client data JSON, or of the signature must
//! break verification.

use crate::crypto::base64::{decode_base64_urlsafe, encode_base64_urlsafe};
use crate::passkey::cose::{
    attestation_object_none, cose_key_from_verifying, parse_attestation_object,
    verifying_key_from_cose,
};
use crate::passkey::es256::{
    generate_signing_key, sign_es256, signing_key_from_pkcs8_der, verify_es256,
    verifying_key_from_signing, ALG_ES256,
};
use crate::passkey::types::PUBLIC_KEY_TYPE;
use crate::passkey::webauthn::{
    assertion_signature_input, build_authenticator_data, build_client_data_json,
    parse_authenticator_data, rp_id_hash, AAGUID_ZERO, CLIENT_DATA_TYPE_CREATE,
    CLIENT_DATA_TYPE_GET, FLAG_AT, FLAG_UP, FLAG_UV, SIGN_COUNT,
};

/// Published CXF example private key (PKCS#8 DER, base64url). Example data.
const VECTOR_KEY_B64URL: &str = "MIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQgARu_0sCt20EpgVxb4Puq3Ga5VVLpuTY75ngvZlyq3X6hRANCAASmdk1xLsK0oOlhxIPp0d1ZuS0sT9nf6BZtSelhqvLBW0fOL33l_bXgsr_STUHjCLn8l6gcRJwe7OQvbQubZ1dY";
/// Uncompressed SEC1 public point of the key above.
const VECTOR_PUBLIC_POINT_HEX: &str = "04a6764d712ec2b4a0e961c483e9d1dd59b92d2c4fd9dfe8166d49e961aaf2c15b47ce2f7de5fdb5e0b2bfd24d41e308b9fc97a81c449c1eece42f6d0b9b675758";
/// RP ID of the vector.
const VECTOR_RP_ID: &str = "example.com";
/// SHA-256("example.com").
const VECTOR_RP_ID_HASH_HEX: &str =
    "a379a6f6eeafb9a55e378c118034e2751e682fab9f2d30ab13d2125586ce1947";
/// Origin of the vector.
const VECTOR_ORIGIN: &str = "https://example.com";
/// Fixed 32-byte challenge (0x11 repeated) in base64url.
const VECTOR_CHALLENGE_B64: &str = "ERERERERERERERERERERERERERERERERERERERERERE";
/// Fixed credential id of the vector (32 bytes of 0x42).
const VECTOR_CREDENTIAL_ID: [u8; 32] = [0x42; 32];

fn vector_key() -> p256::ecdsa::SigningKey {
    let der = decode_base64_urlsafe(VECTOR_KEY_B64URL).expect("vector key decodes");
    signing_key_from_pkcs8_der(&der).expect("vector key parses")
}

#[test]
fn known_answer_registration_vector() {
    let key = vector_key();
    let verifying = verifying_key_from_signing(&key);
    assert_eq!(
        hex::encode(verifying.to_encoded_point(false).as_bytes()),
        VECTOR_PUBLIC_POINT_HEX
    );

    // 1. RP ID hash.
    assert_eq!(hex::encode(rp_id_hash(VECTOR_RP_ID)), VECTOR_RP_ID_HASH_HEX);

    // 2. clientDataJSON: canonical, byte-pinned.
    let client_data_json =
        build_client_data_json(CLIENT_DATA_TYPE_CREATE, VECTOR_CHALLENGE_B64, VECTOR_ORIGIN)
            .expect("client data");
    assert_eq!(
        String::from_utf8(client_data_json.clone()).expect("utf8"),
        format!(
            "{{\"type\":\"webauthn.create\",\"challenge\":\"{VECTOR_CHALLENGE_B64}\",\"origin\":\"{VECTOR_ORIGIN}\"}}"
        )
    );

    // 3. authenticatorData: flags UP|UV|AT = 0x45, counter 0, zero AAGUID.
    let cose = cose_key_from_verifying(&verifying).expect("cose");
    let auth_data = build_authenticator_data(
        VECTOR_RP_ID,
        FLAG_UP | FLAG_UV | FLAG_AT,
        SIGN_COUNT,
        Some((&AAGUID_ZERO, &VECTOR_CREDENTIAL_ID, &cose)),
    )
    .expect("auth data");
    assert_eq!(hex::encode(&auth_data[..32]), VECTOR_RP_ID_HASH_HEX);
    assert_eq!(auth_data[32], 0x45);
    assert_eq!(&auth_data[33..37], &[0x00, 0x00, 0x00, 0x00]);
    assert_eq!(&auth_data[37..53], &[0u8; 16]);
    assert_eq!(&auth_data[53..55], &[0x00, 0x20]);
    assert_eq!(&auth_data[55..87], &VECTOR_CREDENTIAL_ID);

    // 4. The authenticator data parses back to the same public key.
    let parsed = parse_authenticator_data(&auth_data).expect("parse");
    assert_eq!(
        parsed.credential_id.as_deref(),
        Some(VECTOR_CREDENTIAL_ID.as_slice())
    );
    assert_eq!(parsed.aaguid, Some(AAGUID_ZERO));
    assert_eq!(
        parsed.cose_key.expect("cose").to_encoded_point(false),
        verifying.to_encoded_point(false)
    );

    // 5. attestationObject wraps it unchanged.
    let attestation = attestation_object_none(&auth_data).expect("attestation");
    let (fmt, att_stmt, inner) = parse_attestation_object(&attestation).expect("parse");
    assert_eq!(fmt, "none");
    assert_eq!(att_stmt, ciborium::value::Value::Map(Vec::new()));
    assert_eq!(inner, auth_data);
}

#[test]
fn known_answer_assertion_vector() {
    let key = vector_key();
    let verifying = verifying_key_from_signing(&key);

    let client_data_json =
        build_client_data_json(CLIENT_DATA_TYPE_GET, VECTOR_CHALLENGE_B64, VECTOR_ORIGIN)
            .expect("client data");
    let auth_data = build_authenticator_data(VECTOR_RP_ID, FLAG_UP | FLAG_UV, SIGN_COUNT, None)
        .expect("auth data");
    assert_eq!(auth_data.len(), 37);
    assert_eq!(auth_data[32], 0x05);
    assert_eq!(&auth_data[33..37], &[0x00, 0x00, 0x00, 0x00]);

    let input = assertion_signature_input(&auth_data, &client_data_json);
    assert_eq!(input.len(), 37 + 32);

    let signature = sign_es256(&key, &input).expect("sign");
    verify_es256(&verifying, &input, &signature).expect("vector signature verifies");

    // Deterministic (RFC 6979) and low-S: signing twice yields the same DER and
    // the same DER verifies after a round-trip through base64url (the wire form).
    let again = sign_es256(&key, &input).expect("sign again");
    assert_eq!(signature, again);
    let wire = encode_base64_urlsafe(&signature);
    let decoded = decode_base64_urlsafe(&wire).expect("decode signature");
    verify_es256(&verifying, &input, &decoded).expect("wire signature verifies");
}

#[test]
fn negative_control_flipped_auth_data_byte_fails() {
    let key = vector_key();
    let verifying = verifying_key_from_signing(&key);
    let client_data_json =
        build_client_data_json(CLIENT_DATA_TYPE_GET, VECTOR_CHALLENGE_B64, VECTOR_ORIGIN)
            .expect("client data");
    let auth_data = build_authenticator_data(VECTOR_RP_ID, FLAG_UP | FLAG_UV, SIGN_COUNT, None)
        .expect("auth data");
    let signature = sign_es256(
        &key,
        &assertion_signature_input(&auth_data, &client_data_json),
    )
    .expect("sign");

    let mut tampered = auth_data.clone();
    tampered[0] ^= 0x01;
    let tampered_input = assertion_signature_input(&tampered, &client_data_json);
    assert!(
        verify_es256(&verifying, &tampered_input, &signature).is_err(),
        "a flipped authenticatorData byte must break verification"
    );
}

#[test]
fn negative_control_flipped_client_data_byte_fails() {
    let key = vector_key();
    let verifying = verifying_key_from_signing(&key);
    let client_data_json =
        build_client_data_json(CLIENT_DATA_TYPE_GET, VECTOR_CHALLENGE_B64, VECTOR_ORIGIN)
            .expect("client data");
    let auth_data = build_authenticator_data(VECTOR_RP_ID, FLAG_UP | FLAG_UV, SIGN_COUNT, None)
        .expect("auth data");
    let signature = sign_es256(
        &key,
        &assertion_signature_input(&auth_data, &client_data_json),
    )
    .expect("sign");

    let mut tampered = client_data_json.clone();
    let last = tampered.len() - 1;
    tampered[last] ^= 0x01;
    let tampered_input = assertion_signature_input(&auth_data, &tampered);
    assert!(
        verify_es256(&verifying, &tampered_input, &signature).is_err(),
        "a flipped clientDataJSON byte must break verification"
    );
}

#[test]
fn negative_control_flipped_signature_byte_fails() {
    let key = vector_key();
    let verifying = verifying_key_from_signing(&key);
    let client_data_json =
        build_client_data_json(CLIENT_DATA_TYPE_GET, VECTOR_CHALLENGE_B64, VECTOR_ORIGIN)
            .expect("client data");
    let auth_data = build_authenticator_data(VECTOR_RP_ID, FLAG_UP | FLAG_UV, SIGN_COUNT, None)
        .expect("auth data");
    let input = assertion_signature_input(&auth_data, &client_data_json);
    let mut signature = sign_es256(&key, &input).expect("sign");
    let last = signature.len() - 1;
    signature[last] ^= 0x01;
    assert!(
        verify_es256(&verifying, &input, &signature).is_err(),
        "a flipped signature byte must break verification"
    );
}

#[test]
fn negative_control_other_key_does_not_verify() {
    let key = vector_key();
    let other = generate_signing_key().expect("generate");
    let client_data_json =
        build_client_data_json(CLIENT_DATA_TYPE_GET, VECTOR_CHALLENGE_B64, VECTOR_ORIGIN)
            .expect("client data");
    let auth_data = build_authenticator_data(VECTOR_RP_ID, FLAG_UP | FLAG_UV, SIGN_COUNT, None)
        .expect("auth data");
    let input = assertion_signature_input(&auth_data, &client_data_json);
    let signature = sign_es256(&key, &input).expect("sign");
    assert!(verify_es256(&verifying_key_from_signing(&other), &input, &signature).is_err());
}

#[test]
fn cose_key_of_vector_matches_published_point() {
    let key = vector_key();
    let cose = cose_key_from_verifying(&verifying_key_from_signing(&key)).expect("cose");
    let mut bytes = Vec::new();
    ciborium::ser::into_writer(&cose, &mut bytes).expect("cbor");
    let decoded: ciborium::value::Value =
        ciborium::de::from_reader(bytes.as_slice()).expect("cbor decode");
    let recovered = verifying_key_from_cose(&decoded).expect("cose decode");
    assert_eq!(
        hex::encode(recovered.to_encoded_point(false).as_bytes()),
        VECTOR_PUBLIC_POINT_HEX
    );
}

#[test]
fn response_type_constant_is_public_key() {
    assert_eq!(PUBLIC_KEY_TYPE, "public-key");
    assert_eq!(ALG_ES256, -7);
}

#[test]
fn base64url_ids_are_url_safe_no_pad() {
    let encoded = encode_base64_urlsafe(&VECTOR_CREDENTIAL_ID);
    assert!(!encoded.contains('='));
    assert!(!encoded.contains('+'));
    assert!(!encoded.contains('/'));
    assert_eq!(
        decode_base64_urlsafe(&encoded).expect("decode"),
        VECTOR_CREDENTIAL_ID
    );
}
