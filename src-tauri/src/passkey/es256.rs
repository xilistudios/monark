//! ES256 (ECDSA over NIST P-256 with SHA-256) signing and verification.
//!
//! WebAuthn's `alg: -7` is ES256: the signature is an ASN.1 DER
//! `ECDSA-Sig-Value` over `authenticatorData || SHA-256(clientDataJSON)`, with
//! the `s` half of the signature normalized to the lower half of the curve
//! order (low-S). Low-S is not required by WebAuthn itself, but it is required
//! by many verifiers (and by every Bitcoin-style malleability check), and it
//! makes our signatures canonical: one message has exactly one valid encoding.
//!
//! Keys are handled as PKCS#8 DER (the format stored in the vault and in CXF
//! exports) and as `p256::ecdsa::SigningKey` in memory. `SigningKey` zeroizes
//! its scalar on drop (`SecretKey<C>: ZeroizeOnDrop`), so no manual zeroization
//! of the key object is needed — only of the raw byte buffers we hand to it.

use crate::commands::errors::CommandError;
use crate::crypto::random::generate_random_bytes;
use p256::ecdsa::signature::{SignatureEncoding, Signer, Verifier};
use p256::ecdsa::{DerSignature, Signature, SigningKey, VerifyingKey};
use p256::pkcs8::der::Decode;
use p256::pkcs8::{DecodePrivateKey, EncodePrivateKey};
use sec1::EcPrivateKey;
use zeroize::Zeroizing;

/// SEC1 `ECPrivateKey` (RFC 5915) — the ASN.1 structure carried inside the
/// PKCS#8 `privateKey` OCTET STRING of a P-256 key. Used only to read the
/// encoded width of the private scalar before it is handed to `p256`.
type EcPrivateKeyDer<'a> = EcPrivateKey<'a>;

/// COSE algorithm identifier for ECDSA P-256 with SHA-256 (RFC 9053 §2).
pub const ALG_ES256: i32 = -7;

/// Length of a P-256 private scalar in bytes.
const P256_SCALAR_LEN: usize = 32;

/// Generates a fresh ES256 signing key from the platform CSPRNG.
///
/// The 32 random bytes are produced by [`crate::crypto::random`] (the only
/// sanctioned randomness source in this crate) and wrapped in `Zeroizing` so the
/// buffer is wiped when this function returns; the `SigningKey` keeps its own
/// zeroizing copy. `SigningKey::from_slice` rejects the (astronomically
/// unlikely) zero / out-of-range scalars instead of silently reducing them.
pub fn generate_signing_key() -> Result<SigningKey, CommandError> {
    let bytes = Zeroizing::new(
        generate_random_bytes(P256_SCALAR_LEN)
            .map_err(|_| CommandError::Crypto("Failed to generate a signing key".to_string()))?,
    );
    SigningKey::from_slice(bytes.as_slice())
        .map_err(|_| CommandError::Crypto("Failed to generate a signing key".to_string()))
}

/// Parses a PKCS#8 DER private key (P-256 only).
///
/// Rejects anything that is not a P-256 PKCS#8 key: Ed25519, RSA, P-384 and
/// garbage all fail here. The error never echoes key material.
///
/// The private scalar must additionally be encoded at its **full width**
/// (32 bytes): `p256`'s PKCS#8 path reaches `SecretKey::from_slice`, which
/// left-pads any scalar between 24 and 31 bytes instead of rejecting it, and
/// `SecretKey::to_bytes` always returns a 32-byte `FieldBytes`, so the padding
/// is invisible after the fact. A short scalar is therefore rejected here, on
/// the encoded bytes, before the key object exists.
pub fn signing_key_from_pkcs8_der(der: &[u8]) -> Result<SigningKey, CommandError> {
    reject_short_encoded_scalar(der)?;
    SigningKey::from_pkcs8_der(der).map_err(|_| invalid_pkcs8())
}

/// Rejects a PKCS#8 DER document whose encoded private scalar is not 32 bytes.
///
/// Walks the two ASN.1 layers that carry the scalar — `PrivateKeyInfo`
/// (`privateKey` OCTET STRING) and the RFC 5915 `ECPrivateKey` inside it
/// (`private_key` OCTET STRING) — and checks the length of the inner OCTET
/// STRING *as encoded*, which is the only place the padding is still visible.
///
/// Any structural problem is reported as a validation error here; the caller
/// would reject the document anyway, so this never turns a valid key into an
/// error.
fn reject_short_encoded_scalar(der: &[u8]) -> Result<(), CommandError> {
    let info = pkcs8::PrivateKeyInfo::try_from(der).map_err(|_| invalid_pkcs8())?;
    let ec = EcPrivateKeyDer::from_der(info.private_key).map_err(|_| invalid_pkcs8())?;
    if ec.private_key.len() != P256_SCALAR_LEN {
        return Err(invalid_pkcs8());
    }
    Ok(())
}

fn invalid_pkcs8() -> CommandError {
    CommandError::Validation("Private key is not a valid P-256 PKCS#8 key".to_string())
}

/// Serializes a signing key as PKCS#8 DER (the vault / CXF representation).
///
/// The returned buffer is secret material: callers must zeroize it after use
/// (`zeroize::Zeroizing<Vec<u8>>` is the intended wrapper).
pub fn signing_key_to_pkcs8_der(key: &SigningKey) -> Result<Vec<u8>, CommandError> {
    let document = key
        .to_pkcs8_der()
        .map_err(|_| CommandError::Crypto("Failed to encode the private key".to_string()))?;
    Ok(document.as_bytes().to_vec())
}

/// Derives the public verification key of a signing key.
pub fn verifying_key_from_signing(key: &SigningKey) -> VerifyingKey {
    *key.verifying_key()
}

/// Signs `message` with ES256 and returns the DER-encoded, low-S signature.
///
/// `Signer<Signature>` hashes the message with SHA-256 internally (RFC 6979
/// deterministic nonce), so the caller passes the raw WebAuthn signature input
/// (`authenticatorData || SHA-256(clientDataJSON)`), not a pre-hash.
pub fn sign_es256(key: &SigningKey, message: &[u8]) -> Result<Vec<u8>, CommandError> {
    let signature: Signature = key.sign(message);
    // ecdsa 0.16 returns `Option`: `None` only for the (unreachable for a valid
    // key) case where `s` cannot be negated.
    let normalized = signature.normalize_s().unwrap_or(signature);
    Ok(normalized.to_der().to_vec())
}

/// Verifies a DER-encoded ES256 signature over `message`.
///
/// Uses an independent `VerifyingKey` path (public key only): a signature that
/// only the private key could have produced must verify here, which is what the
/// known-answer tests assert.
pub fn verify_es256(
    key: &VerifyingKey,
    message: &[u8],
    der_sig: &[u8],
) -> Result<(), CommandError> {
    let der = DerSignature::from_bytes(der_sig)
        .map_err(|_| CommandError::Validation("Malformed ES256 signature".to_string()))?;
    let signature = Signature::try_from(der)
        .map_err(|_| CommandError::Validation("Malformed ES256 signature".to_string()))?;
    key.verify(message, &signature)
        .map_err(|_| CommandError::Validation("ES256 signature verification failed".to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::crypto::base64::{decode_base64_urlsafe, encode_base64_urlsafe};
    use p256::pkcs8::der::Encode;

    /// Published CXF specification example key (Appendix A of the CXF 1.0 review
    /// draft). It is an example credential, NOT a real secret.
    const CXF_EXAMPLE_KEY_B64URL: &str = "MIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQgARu_0sCt20EpgVxb4Puq3Ga5VVLpuTY75ngvZlyq3X6hRANCAASmdk1xLsK0oOlhxIPp0d1ZuS0sT9nf6BZtSelhqvLBW0fOL33l_bXgsr_STUHjCLn8l6gcRJwe7OQvbQubZ1dY";
    /// Private scalar of the example key above.
    const CXF_EXAMPLE_SCALAR_HEX: &str =
        "011bbfd2c0addb4129815c5be0fbaadc66b95552e9b9363be6782f665caadd7e";
    /// Uncompressed SEC1 public point of the example key above.
    const CXF_EXAMPLE_PUBLIC_POINT_HEX: &str = "04a6764d712ec2b4a0e961c483e9d1dd59b92d2c4fd9dfe8166d49e961aaf2c15b47ce2f7de5fdb5e0b2bfd24d41e308b9fc97a81c449c1eece42f6d0b9b675758";

    fn example_key() -> SigningKey {
        let der = decode_base64_urlsafe(CXF_EXAMPLE_KEY_B64URL).expect("fixture decodes");
        signing_key_from_pkcs8_der(&der).expect("fixture parses")
    }

    #[test]
    fn known_answer_vector_parses_and_derives_published_point() {
        let key = example_key();
        assert_eq!(hex::encode(key.to_bytes()), CXF_EXAMPLE_SCALAR_HEX);
        let verifying = verifying_key_from_signing(&key);
        assert_eq!(
            hex::encode(verifying.to_encoded_point(false).as_bytes()),
            CXF_EXAMPLE_PUBLIC_POINT_HEX
        );
    }

    #[test]
    fn pkcs8_roundtrip_preserves_public_key() {
        let key = example_key();
        let der = signing_key_to_pkcs8_der(&key).expect("encode");
        let reparsed = signing_key_from_pkcs8_der(&der).expect("decode");
        assert_eq!(
            verifying_key_from_signing(&key).to_encoded_point(false),
            verifying_key_from_signing(&reparsed).to_encoded_point(false)
        );
        // The re-encoded DER is byte-identical to the published fixture.
        assert_eq!(encode_base64_urlsafe(&der), CXF_EXAMPLE_KEY_B64URL);
    }

    #[test]
    fn generated_key_roundtrips_through_pkcs8() {
        let key = generate_signing_key().expect("generate");
        let der = Zeroizing::new(signing_key_to_pkcs8_der(&key).expect("encode"));
        let reparsed = signing_key_from_pkcs8_der(&der).expect("decode");
        assert_eq!(
            verifying_key_from_signing(&key).to_encoded_point(false),
            verifying_key_from_signing(&reparsed).to_encoded_point(false)
        );
    }

    #[test]
    fn generated_keys_differ() {
        let a = generate_signing_key().expect("generate a");
        let b = generate_signing_key().expect("generate b");
        assert_ne!(a.to_bytes(), b.to_bytes());
    }

    #[test]
    fn signature_is_der_and_low_s() {
        let key = example_key();
        let message = b"monark es256 known-answer message";
        let der = sign_es256(&key, message).expect("sign");
        // DER SEQUENCE header.
        assert_eq!(der[0], 0x30);
        let parsed =
            Signature::try_from(DerSignature::from_bytes(&der).expect("der")).expect("signature");
        assert!(
            parsed.normalize_s().is_none(),
            "s must already be in the lower half of the curve order"
        );
        verify_es256(&verifying_key_from_signing(&key), message, &der).expect("verifies");
    }

    #[test]
    fn signing_is_deterministic_rfc6979() {
        let key = example_key();
        let message = b"deterministic";
        assert_eq!(
            sign_es256(&key, message).expect("sign 1"),
            sign_es256(&key, message).expect("sign 2")
        );
    }

    #[test]
    fn verify_rejects_flipped_signature_byte() {
        let key = example_key();
        let message = b"flip";
        let mut der = sign_es256(&key, message).expect("sign");
        let last = der.len() - 1;
        der[last] ^= 0x01;
        assert!(verify_es256(&verifying_key_from_signing(&key), message, &der).is_err());
    }

    #[test]
    fn verify_rejects_wrong_message_and_wrong_key() {
        let key = example_key();
        let der = sign_es256(&key, b"one").expect("sign");
        assert!(verify_es256(&verifying_key_from_signing(&key), b"two", &der).is_err());
        let other = generate_signing_key().expect("generate");
        assert!(verify_es256(&verifying_key_from_signing(&other), b"one", &der).is_err());
    }

    #[test]
    fn verify_rejects_garbage_signature() {
        let key = example_key();
        let verifying = verifying_key_from_signing(&key);
        assert!(verify_es256(&verifying, b"m", &[]).is_err());
        assert!(verify_es256(&verifying, b"m", &[0x30, 0x00]).is_err());
        assert!(verify_es256(&verifying, b"m", &[0xff; 70]).is_err());
    }

    #[test]
    fn rejects_non_p256_pkcs8() {
        // Ed25519 PKCS#8 (RFC 8410 example key, public test vector).
        let ed25519 = hex::decode(
            "302e020100300506032b657004220420d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a",
        )
        .expect("hex");
        assert!(signing_key_from_pkcs8_der(&ed25519).is_err());
        assert!(signing_key_from_pkcs8_der(&[]).is_err());
        assert!(signing_key_from_pkcs8_der(b"not der at all").is_err());
    }

    /// Rebuilds the CXF fixture as a PKCS#8 document whose RFC 5915
    /// `ECPrivateKey.private_key` OCTET STRING carries `scalar` verbatim.
    ///
    /// The rest of the structure (version, OIDs, public point) is copied from
    /// the published fixture, so the only difference from a valid key is the
    /// encoded width of the scalar — exactly the input the guard must catch.
    fn pkcs8_with_encoded_scalar(scalar: &[u8]) -> Vec<u8> {
        let fixture = decode_base64_urlsafe(CXF_EXAMPLE_KEY_B64URL).expect("fixture decodes");
        let info = pkcs8::PrivateKeyInfo::try_from(fixture.as_slice()).expect("fixture is pkcs8");
        let ec = EcPrivateKeyDer::from_der(info.private_key).expect("fixture is ECPrivateKey");
        assert_eq!(
            ec.private_key.len(),
            P256_SCALAR_LEN,
            "fixture is full width"
        );

        // The public point is dropped: a left-padded scalar no longer matches
        // the fixture's point, and `p256` would reject that mismatch for the
        // wrong reason (BIT STRING value error) instead of on the width.
        let rebuilt = EcPrivateKeyDer {
            private_key: scalar,
            parameters: ec.parameters,
            public_key: None,
        };
        let ec_der = rebuilt.to_der().expect("encode ECPrivateKey");
        let document = pkcs8::PrivateKeyInfo::new(info.algorithm, &ec_der);
        document.to_der().expect("encode PKCS#8")
    }

    #[test]
    fn rejects_short_encoded_scalar() {
        // A 31-byte scalar is left-padded by `SecretKey::from_slice` and would
        // come back as a 32-byte `FieldBytes`, so only the encoded length can
        // catch it. 31 bytes of the fixture scalar, unchanged otherwise.
        let scalar = hex::decode(CXF_EXAMPLE_SCALAR_HEX).expect("hex");
        let short = &scalar[1..];
        assert_eq!(short.len(), 31);
        let der = pkcs8_with_encoded_scalar(short);
        assert!(
            signing_key_from_pkcs8_der(&der).is_err(),
            "a 31-byte encoded scalar must be rejected"
        );

        // Same document, full-width scalar: accepted and identical to the
        // fixture key, which proves the rejection above is about the width and
        // not about the re-encoding.
        let full = pkcs8_with_encoded_scalar(&scalar);
        let key = signing_key_from_pkcs8_der(&full).expect("full-width scalar is accepted");
        assert_eq!(hex::encode(key.to_bytes()), CXF_EXAMPLE_SCALAR_HEX);
    }

    #[test]
    fn rejects_scalar_shorter_than_the_padding_threshold() {
        // 23 bytes is below `SecretKey::MIN_SIZE` (24): `p256` rejects it on its
        // own, and so must we (with the same validation error, never a panic).
        let scalar = hex::decode(CXF_EXAMPLE_SCALAR_HEX).expect("hex");
        let der = pkcs8_with_encoded_scalar(&scalar[9..]);
        assert!(signing_key_from_pkcs8_der(&der).is_err());
    }

    #[test]
    fn errors_never_echo_key_material() {
        let err = signing_key_from_pkcs8_der(b"garbage").expect_err("must fail");
        let rendered = format!("{err:?} {}", err);
        assert!(!rendered.contains("MIGHAgEA"));
    }
}
