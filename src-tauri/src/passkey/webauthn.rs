//! WebAuthn data structures: client data, authenticator data and the
//! assertion signature input.
//!
//! Layouts (WebAuthn L2 §6.1, §5.1):
//!
//! ```text
//! authenticatorData = rpIdHash(32) || flags(1) || signCount(4, big endian)
//!                     [ || aaguid(16) || credIdLen(2, big endian) || credId || COSE_Key ]  (AT set)
//! signatureInput    = authenticatorData || SHA-256(clientDataJSON)
//! ```
//!
//! Monark is a software authenticator: the AAGUID is all-zero and the
//! attestation statement is `"none"` (ruling Q3), and `signCount` is always `0`
//! and never incremented (ruling Q15) — the vault is the only source of truth
//! for the credential, so a counter would be a false anti-cloning signal.
//!
//! # RP ID canonicalization and origin binding
//!
//! Two client duties of WebAuthn L2 §5.1.4 are implemented here so that every
//! entry point shares one implementation:
//!
//! * [`validate_rp_id`] returns the **canonical** RP ID (ASCII-lowercased), and
//!   that canonical string is what gets hashed into `rpIdHash`, stored in the
//!   vault and compared during selection. A credential registered for
//!   `Example.COM` is therefore the same credential as one for `example.com`.
//! * [`validate_rp_id_binding`] enforces `rpId` ≡ the origin's effective domain
//!   (or a domain suffix of it), the check that stops a caller from obtaining a
//!   signature over `rpIdHash = SHA-256(victim.example)` with
//!   `clientDataJSON.origin = "https://evil.example"`.
//!
//! **Known limitation (F0, tracked for T14):** the binding is a plain domain
//! suffix check, with no public-suffix-list lookup. `rpId = "com"` is therefore
//! accepted for `origin = "https://evil.com"`. Full registrable-domain
//! validation is out of scope for F0 and is documented in `docs/passkeys.md`.

use crate::commands::errors::CommandError;
use crate::crypto::base64::decode_base64_urlsafe;
use crate::passkey::cose::verifying_key_from_cose;
use ciborium::value::Value;
use p256::ecdsa::VerifyingKey;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

/// `UP` — user present.
pub const FLAG_UP: u8 = 0x01;
/// `UV` — user verified.
pub const FLAG_UV: u8 = 0x04;
/// `AT` — attested credential data included.
pub const FLAG_AT: u8 = 0x40;

/// AAGUID of a software authenticator without attestation identity (ruling Q3).
pub const AAGUID_ZERO: [u8; 16] = [0u8; 16];

/// Signature counter value stored in every credential (ruling Q15).
pub const SIGN_COUNT: u32 = 0;

/// Client data type of a registration ceremony.
pub const CLIENT_DATA_TYPE_CREATE: &str = "webauthn.create";
/// Client data type of an authentication ceremony.
pub const CLIENT_DATA_TYPE_GET: &str = "webauthn.get";

/// Minimum accepted challenge length in bytes (WebAuthn recommends ≥16).
pub const MIN_CHALLENGE_LEN: usize = 16;
/// Maximum accepted challenge length in bytes (DoS cap, matches the plan).
pub const MAX_CHALLENGE_LEN: usize = 1024;

/// Length of the fixed authenticator-data prefix.
const AUTH_DATA_PREFIX_LEN: usize = 32 + 1 + 4;
/// Length of the attested-credential-data header (AAGUID + credential id length).
const ATTESTED_HEADER_LEN: usize = 16 + 2;
/// Maximum credential id length accepted on parse.
const MAX_CREDENTIAL_ID_LEN: usize = 1023;

fn validation(message: &str) -> CommandError {
    CommandError::Validation(message.to_string())
}

fn sha256(bytes: &[u8]) -> [u8; 32] {
    let digest = Sha256::digest(bytes);
    let mut out = [0u8; 32];
    out.copy_from_slice(&digest);
    out
}

/// `SHA-256(rpId)` — the first 32 bytes of authenticator data.
pub fn rp_id_hash(rp_id: &str) -> [u8; 32] {
    sha256(rp_id.as_bytes())
}

/// The parsed `clientDataJSON` we emit (and accept).
///
/// `challenge` is kept as raw bytes here; the JSON form is base64url
/// (URL_SAFE_NO_PAD) per WebAuthn's `Base64urlEncoding` of `BufferSource`.
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Eq)]
pub struct ClientData {
    #[serde(rename = "type")]
    pub type_: String,
    pub challenge: String,
    pub origin: String,
}

/// Builds the canonical `clientDataJSON` for a ceremony.
///
/// * `kind` must be `"webauthn.create"` or `"webauthn.get"`.
/// * `challenge_b64` must be URL_SAFE_NO_PAD base64 decoding to 16..=1024 bytes.
/// * `origin` must parse as an absolute `http`/`https` origin: no path (other
///   than `/`), no query, no fragment, no userinfo.
///
/// The `origin` member is **not** the caller's string: it is the canonical
/// serialization of the parsed URL (`Url::origin().ascii_serialization()`), so
/// `https://example.com:443` and `HTTPS://EXAMPLE.COM` both become
/// `https://example.com`. Relying parties compare `clientDataJSON.origin`
/// byte-for-byte against their own serialized origin, so echoing the raw input
/// would make a valid assertion fail the ceremony.
///
/// The output is compact JSON (no whitespace) with the member order
/// `type`, `challenge`, `origin`; it is the exact byte string that gets hashed
/// into the signature, so it must be reproducible.
pub fn build_client_data_json(
    kind: &str,
    challenge_b64: &str,
    origin: &str,
) -> Result<Vec<u8>, CommandError> {
    if kind != CLIENT_DATA_TYPE_CREATE && kind != CLIENT_DATA_TYPE_GET {
        return Err(validation("Unsupported client data type"));
    }
    let challenge = decode_base64_urlsafe(challenge_b64)
        .map_err(|_| validation("Challenge is not valid base64url"))?;
    if challenge.len() < MIN_CHALLENGE_LEN || challenge.len() > MAX_CHALLENGE_LEN {
        return Err(validation("Challenge length is out of range"));
    }
    let canonical_origin = canonical_origin(origin)?;

    let client_data = ClientData {
        type_: kind.to_string(),
        challenge: challenge_b64.to_string(),
        origin: canonical_origin,
    };
    serde_json::to_vec(&client_data).map_err(|_| validation("Failed to build client data"))
}

/// Validates a WebAuthn origin: absolute `http(s)` URL with no path/query/fragment.
pub fn validate_origin(origin: &str) -> Result<(), CommandError> {
    canonical_origin(origin).map(|_| ())
}

/// Validates `origin` and returns its canonical serialized form.
///
/// The canonical form is `scheme://host[:port]` with the scheme and host
/// lowercased and the port omitted when it is the scheme's default
/// (`Url::origin().ascii_serialization()`), which is what a relying party
/// compares against.
fn canonical_origin(origin: &str) -> Result<String, CommandError> {
    if origin.is_empty() {
        return Err(validation("Origin is empty"));
    }
    let parsed = url::Url::parse(origin).map_err(|_| validation("Origin is not a valid URL"))?;
    match parsed.scheme() {
        "https" | "http" => {}
        _ => return Err(validation("Origin must use http or https")),
    }
    if parsed.host_str().is_none() || parsed.host_str() == Some("") {
        return Err(validation("Origin has no host"));
    }
    if !parsed.username().is_empty() || parsed.password().is_some() {
        return Err(validation("Origin must not carry user information"));
    }
    if parsed.query().is_some() || parsed.fragment().is_some() {
        return Err(validation("Origin must not carry a query or fragment"));
    }
    let path = parsed.path();
    if !path.is_empty() && path != "/" {
        return Err(validation("Origin must not carry a path"));
    }
    Ok(parsed.origin().ascii_serialization())
}

/// Validates an RP ID and returns its **canonical** form.
///
/// The canonical form is the ASCII-lowercased RP ID (WebAuthn L2 §5.1.4: RP IDs
/// are domain names, and domain names are case-insensitive). Everything
/// downstream — `rpIdHash`, the stored `rp_id`, the exact-match selection — must
/// use the returned value, never the caller's string, so a credential registered
/// as `Example.COM` and asserted as `example.com` is the same credential.
///
/// The check itself is purely lexical: a bare host name, no scheme, path, port
/// or whitespace. [`validate_rp_id_binding`] is what ties the value to a real
/// origin; `list_for_rp` has no origin to bind to and stays lexical-only
/// (fail-closed: an RP ID that matches nothing returns an empty list).
pub fn validate_rp_id(rp_id: &str) -> Result<String, CommandError> {
    if rp_id.is_empty() {
        return Err(validation("RP ID is empty"));
    }
    if rp_id.len() > 253 {
        return Err(validation("RP ID is too long"));
    }
    if rp_id.contains("://") || rp_id.contains('/') || rp_id.contains(':') {
        return Err(validation("RP ID must be a bare host name"));
    }
    if rp_id.chars().any(|c| c.is_whitespace() || c.is_control()) {
        return Err(validation("RP ID must not contain whitespace"));
    }
    Ok(rp_id.to_ascii_lowercase())
}

/// Enforces WebAuthn L2 §5.1.4: `rpId` must equal the origin's effective domain
/// or be a domain suffix of it.
///
/// Both arguments are expected to be canonical already — `rp_id` comes out of
/// [`validate_rp_id`] and `origin` out of [`canonical_origin`] — so the
/// comparison is a plain ASCII one. A suffix match must fall on a label
/// boundary: `example.com` binds to `sub.example.com` but **not** to
/// `notexample.com`.
///
/// This is defense in depth, not the vault's security boundary (the caller
/// already needs the vault password): without it a caller could obtain a
/// signature over `rpIdHash = SHA-256(victim.example)` carrying
/// `origin = "https://evil.example"`, which no real authenticator stack would
/// produce.
///
/// **F0 limitation:** no public-suffix-list lookup, so `rpId = "com"` binds to
/// `https://evil.com`. Registrable-domain validation is tracked for T14.
pub fn validate_rp_id_binding(rp_id: &str, origin: &str) -> Result<(), CommandError> {
    let host = origin_host(origin)?;
    if host == rp_id || host.ends_with(&format!(".{rp_id}")) {
        return Ok(());
    }
    Err(validation(
        "RP ID is not a domain suffix of the origin's host",
    ))
}

/// The ASCII-lowercased host of a canonical origin (`https://example.com:8443`
/// → `example.com`).
fn origin_host(origin: &str) -> Result<String, CommandError> {
    let parsed = url::Url::parse(origin).map_err(|_| validation("Origin is not a valid URL"))?;
    let host = parsed
        .host_str()
        .filter(|host| !host.is_empty())
        .ok_or_else(|| validation("Origin has no host"))?;
    Ok(host.to_ascii_lowercase())
}

/// Builds `authenticatorData`.
///
/// `attested` is `Some((aaguid, credential_id, cose_key))` for registration
/// (the `AT` flag must be set) and `None` for assertions (the `AT` flag must be
/// clear). Mismatches are rejected rather than silently producing data that a
/// relying party would parse differently than we do.
///
/// `rpIdHash` is `SHA-256` of the **canonical** RP ID ([`validate_rp_id`]), so
/// `Example.COM` and `example.com` produce the same first 32 bytes — which is
/// what a relying party computes on its side.
pub fn build_authenticator_data(
    rp_id: &str,
    flags: u8,
    sign_count: u32,
    attested: Option<(&[u8; 16], &[u8], &Value)>,
) -> Result<Vec<u8>, CommandError> {
    let canonical_rp_id = validate_rp_id(rp_id)?;
    let has_attested = attested.is_some();
    if has_attested != (flags & FLAG_AT != 0) {
        return Err(validation(
            "Attested credential data and the AT flag disagree",
        ));
    }

    let mut out = Vec::with_capacity(AUTH_DATA_PREFIX_LEN + 64);
    out.extend_from_slice(&rp_id_hash(&canonical_rp_id));
    out.push(flags);
    out.extend_from_slice(&sign_count.to_be_bytes());

    if let Some((aaguid, credential_id, cose_key)) = attested {
        if credential_id.is_empty() || credential_id.len() > MAX_CREDENTIAL_ID_LEN {
            return Err(validation("Credential ID length is out of range"));
        }
        let credential_id_len = u16::try_from(credential_id.len())
            .map_err(|_| validation("Credential ID length is out of range"))?;
        out.extend_from_slice(aaguid);
        out.extend_from_slice(&credential_id_len.to_be_bytes());
        out.extend_from_slice(credential_id);
        ciborium::ser::into_writer(cose_key, &mut out)
            .map_err(|_| CommandError::Serialization("CBOR encoding failed".to_string()))?;
    }

    Ok(out)
}

/// Structurally parsed `authenticatorData`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ParsedAuthData {
    pub rp_id_hash: [u8; 32],
    pub flags: u8,
    pub sign_count: u32,
    pub aaguid: Option<[u8; 16]>,
    pub credential_id: Option<Vec<u8>>,
    pub cose_key: Option<VerifyingKey>,
}

impl ParsedAuthData {
    /// True when the `UP` flag is set.
    pub fn user_present(&self) -> bool {
        self.flags & FLAG_UP != 0
    }

    /// True when the `UV` flag is set.
    pub fn user_verified(&self) -> bool {
        self.flags & FLAG_UV != 0
    }

    /// True when attested credential data is present.
    pub fn has_attested_credential(&self) -> bool {
        self.flags & FLAG_AT != 0
    }
}

/// Parses `authenticatorData`, including the attested credential data when the
/// `AT` flag is set.
///
/// Used by the ceremony commands to self-check what they emit, and by tests to
/// pin the byte layout. Trailing bytes after the attested credential data are
/// rejected (extensions are not implemented in F0): the COSE key must consume
/// the buffer exactly, which `ciborium::de::from_reader` does not check on its
/// own (it deserializes a single value and ignores whatever follows).
pub fn parse_authenticator_data(data: &[u8]) -> Result<ParsedAuthData, CommandError> {
    if data.len() < AUTH_DATA_PREFIX_LEN {
        return Err(validation("Authenticator data is too short"));
    }
    let mut rp_id_hash = [0u8; 32];
    rp_id_hash.copy_from_slice(&data[..32]);
    let flags = data[32];
    let sign_count = u32::from_be_bytes([data[33], data[34], data[35], data[36]]);

    if flags & FLAG_AT == 0 {
        if data.len() != AUTH_DATA_PREFIX_LEN {
            return Err(validation(
                "Authenticator data has unexpected trailing bytes",
            ));
        }
        return Ok(ParsedAuthData {
            rp_id_hash,
            flags,
            sign_count,
            aaguid: None,
            credential_id: None,
            cose_key: None,
        });
    }

    if data.len() < AUTH_DATA_PREFIX_LEN + ATTESTED_HEADER_LEN {
        return Err(validation(
            "Authenticator data is missing attested credential data",
        ));
    }
    let mut aaguid = [0u8; 16];
    aaguid.copy_from_slice(&data[AUTH_DATA_PREFIX_LEN..AUTH_DATA_PREFIX_LEN + 16]);
    let credential_id_len = u16::from_be_bytes([
        data[AUTH_DATA_PREFIX_LEN + 16],
        data[AUTH_DATA_PREFIX_LEN + 17],
    ]) as usize;
    if credential_id_len == 0 || credential_id_len > MAX_CREDENTIAL_ID_LEN {
        return Err(validation("Credential ID length is out of range"));
    }
    let credential_id_start = AUTH_DATA_PREFIX_LEN + ATTESTED_HEADER_LEN;
    let credential_id_end = credential_id_start
        .checked_add(credential_id_len)
        .ok_or_else(|| validation("Credential ID length is out of range"))?;
    if data.len() < credential_id_end {
        return Err(validation("Authenticator data is truncated"));
    }
    let credential_id = data[credential_id_start..credential_id_end].to_vec();

    let mut cose_bytes = &data[credential_id_end..];
    let cose: Value = ciborium::de::from_reader(&mut cose_bytes)
        .map_err(|_| validation("Authenticator data has a malformed COSE key"))?;
    if !cose_bytes.is_empty() {
        return Err(validation(
            "Authenticator data has trailing bytes after the COSE key",
        ));
    }
    let cose_key = verifying_key_from_cose(&cose)?;

    Ok(ParsedAuthData {
        rp_id_hash,
        flags,
        sign_count,
        aaguid: Some(aaguid),
        credential_id: Some(credential_id),
        cose_key: Some(cose_key),
    })
}

/// `authenticatorData || SHA-256(clientDataJSON)` — the bytes that get signed.
pub fn assertion_signature_input(auth_data: &[u8], client_data_json: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(auth_data.len() + 32);
    out.extend_from_slice(auth_data);
    out.extend_from_slice(&sha256(client_data_json));
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::crypto::base64::encode_base64_urlsafe;
    use crate::passkey::cose::cose_key_from_verifying;
    use crate::passkey::es256::{generate_signing_key, verifying_key_from_signing};

    const RP_ID: &str = "example.com";
    /// SHA-256("example.com"), pinned.
    const RP_ID_HASH_HEX: &str = "a379a6f6eeafb9a55e378c118034e2751e682fab9f2d30ab13d2125586ce1947";

    fn challenge_b64() -> String {
        encode_base64_urlsafe(&[0x11u8; 32])
    }

    #[test]
    fn rp_id_hash_matches_pinned_sha256() {
        assert_eq!(hex::encode(rp_id_hash(RP_ID)), RP_ID_HASH_HEX);
        assert_eq!(
            hex::encode(rp_id_hash("webauthn.io")),
            "74a6ea9213c99c2f74b22492b320cf40262a94c1a950a0397f29250b60841ef0"
        );
    }

    #[test]
    fn client_data_json_is_canonical() {
        let json = build_client_data_json(
            CLIENT_DATA_TYPE_CREATE,
            &challenge_b64(),
            "https://example.com",
        )
        .expect("build");
        let text = String::from_utf8(json).expect("utf8");
        assert_eq!(
            text,
            format!(
                "{{\"type\":\"webauthn.create\",\"challenge\":\"{}\",\"origin\":\"https://example.com\"}}",
                challenge_b64()
            )
        );
        let parsed: ClientData = serde_json::from_str(&text).expect("parse");
        assert_eq!(parsed.type_, "webauthn.create");
        assert_eq!(parsed.challenge, challenge_b64());
    }

    #[test]
    fn client_data_json_rejects_wrong_type() {
        assert!(
            build_client_data_json("webauthn.other", &challenge_b64(), "https://example.com")
                .is_err()
        );
        assert!(build_client_data_json("", &challenge_b64(), "https://example.com").is_err());
    }

    #[test]
    fn client_data_json_rejects_short_and_long_challenge() {
        let short = encode_base64_urlsafe(&[0u8; MIN_CHALLENGE_LEN - 1]);
        assert!(
            build_client_data_json(CLIENT_DATA_TYPE_GET, &short, "https://example.com").is_err()
        );
        let long = encode_base64_urlsafe(&vec![0u8; MAX_CHALLENGE_LEN + 1]);
        assert!(
            build_client_data_json(CLIENT_DATA_TYPE_GET, &long, "https://example.com").is_err()
        );
        assert!(build_client_data_json(
            CLIENT_DATA_TYPE_GET,
            "not base64!!",
            "https://example.com"
        )
        .is_err());
    }

    #[test]
    fn client_data_json_rejects_bad_origins() {
        for origin in [
            "",
            "ftp://example.com",
            "https://example.com/login",
            "https://example.com/?a=1",
            "https://example.com/#frag",
            "https://user:pw@example.com",
            "not a url",
            "example.com",
        ] {
            assert!(
                build_client_data_json(CLIENT_DATA_TYPE_GET, &challenge_b64(), origin).is_err(),
                "origin {origin:?} must be rejected"
            );
        }
        // Accepted shapes.
        for origin in [
            "https://example.com",
            "https://example.com/",
            "http://localhost:1420",
        ] {
            assert!(
                build_client_data_json(CLIENT_DATA_TYPE_GET, &challenge_b64(), origin).is_ok(),
                "origin {origin:?} must be accepted"
            );
        }
    }

    /// The `origin` member of `clientDataJSON` for `origin`, as a string.
    fn origin_member(origin: &str) -> String {
        let json = build_client_data_json(CLIENT_DATA_TYPE_GET, &challenge_b64(), origin)
            .expect("origin is accepted");
        let parsed: ClientData = serde_json::from_slice(&json).expect("parse");
        parsed.origin
    }

    #[test]
    fn client_data_json_serializes_the_canonical_origin() {
        // Default port is dropped: a relying party compares against
        // `https://example.com`, so echoing `:443` would fail the ceremony.
        assert_eq!(
            origin_member("https://example.com:443"),
            "https://example.com"
        );
        // Scheme and host are lowercased.
        assert_eq!(origin_member("HTTPS://EXAMPLE.COM"), "https://example.com");
        assert_eq!(origin_member("Http://Example.Com/"), "http://example.com");
        // A non-default port is preserved, and `http://` keeps its own default.
        assert_eq!(
            origin_member("https://example.com:8443"),
            "https://example.com:8443"
        );
        assert_eq!(origin_member("http://example.com:80"), "http://example.com");
        // Already-canonical origins are unchanged (the known-answer vector).
        assert_eq!(origin_member("https://example.com"), "https://example.com");
        assert_eq!(
            origin_member("http://localhost:1420"),
            "http://localhost:1420"
        );
    }

    #[test]
    fn client_data_json_origin_is_canonical_in_the_signed_bytes() {
        // The canonical form is what gets hashed, not just what gets parsed
        // back: the two spellings of the same origin must produce identical
        // bytes (and therefore identical signature inputs).
        let canonical = build_client_data_json(
            CLIENT_DATA_TYPE_GET,
            &challenge_b64(),
            "https://example.com",
        )
        .expect("build");
        for alias in [
            "https://example.com:443",
            "HTTPS://EXAMPLE.COM",
            "https://example.com/",
        ] {
            assert_eq!(
                build_client_data_json(CLIENT_DATA_TYPE_GET, &challenge_b64(), alias)
                    .expect("build"),
                canonical,
                "origin {alias:?} must serialize exactly like the canonical origin"
            );
        }
    }

    #[test]
    fn authenticator_data_layout_is_byte_exact() {
        let key = verifying_key_from_signing(&generate_signing_key().expect("generate"));
        let cose = cose_key_from_verifying(&key).expect("cose");
        let credential_id = [0x42u8; 32];
        let data = build_authenticator_data(
            RP_ID,
            FLAG_UP | FLAG_UV | FLAG_AT,
            SIGN_COUNT,
            Some((&AAGUID_ZERO, &credential_id, &cose)),
        )
        .expect("build");

        assert_eq!(&data[..32], &rp_id_hash(RP_ID));
        assert_eq!(data[32], 0x45);
        assert_eq!(&data[33..37], &[0, 0, 0, 0]);
        assert_eq!(&data[37..53], &[0u8; 16]);
        assert_eq!(&data[53..55], &[0x00, 0x20]);
        assert_eq!(&data[55..87], &credential_id);
        let mut expected_cose = Vec::new();
        ciborium::ser::into_writer(&cose, &mut expected_cose).expect("cbor");
        assert_eq!(&data[87..], expected_cose.as_slice());
    }

    #[test]
    fn authenticator_data_roundtrips() {
        let key = verifying_key_from_signing(&generate_signing_key().expect("generate"));
        let cose = cose_key_from_verifying(&key).expect("cose");
        let credential_id = [0x07u8; 16];
        let data = build_authenticator_data(
            RP_ID,
            FLAG_UP | FLAG_UV | FLAG_AT,
            SIGN_COUNT,
            Some((&AAGUID_ZERO, &credential_id, &cose)),
        )
        .expect("build");
        let parsed = parse_authenticator_data(&data).expect("parse");
        assert_eq!(parsed.rp_id_hash, rp_id_hash(RP_ID));
        assert_eq!(parsed.flags, 0x45);
        assert_eq!(parsed.sign_count, 0);
        assert_eq!(parsed.aaguid, Some(AAGUID_ZERO));
        assert_eq!(
            parsed.credential_id.as_deref(),
            Some(credential_id.as_slice())
        );
        assert_eq!(
            parsed.cose_key.expect("cose").to_encoded_point(false),
            key.to_encoded_point(false)
        );
        assert!(parsed.user_present());
        assert!(parsed.user_verified());
        assert!(parsed.has_attested_credential());
    }

    #[test]
    fn assertion_authenticator_data_has_no_attested_data() {
        let data =
            build_authenticator_data(RP_ID, FLAG_UP | FLAG_UV, SIGN_COUNT, None).expect("build");
        assert_eq!(data.len(), 37);
        assert_eq!(data[32], 0x05);
        let parsed = parse_authenticator_data(&data).expect("parse");
        assert_eq!(parsed.aaguid, None);
        assert_eq!(parsed.credential_id, None);
        assert_eq!(parsed.cose_key, None);
    }

    #[test]
    fn authenticator_data_rejects_flag_mismatch() {
        let key = verifying_key_from_signing(&generate_signing_key().expect("generate"));
        let cose = cose_key_from_verifying(&key).expect("cose");
        let credential_id = [0x01u8; 32];
        // AT set but no attested data.
        assert!(build_authenticator_data(RP_ID, FLAG_UP | FLAG_AT, 0, None).is_err());
        // Attested data but AT clear.
        assert!(build_authenticator_data(
            RP_ID,
            FLAG_UP,
            0,
            Some((&AAGUID_ZERO, &credential_id, &cose))
        )
        .is_err());
    }

    #[test]
    fn authenticator_data_rejects_bad_rp_id_and_credential_id() {
        let key = verifying_key_from_signing(&generate_signing_key().expect("generate"));
        let cose = cose_key_from_verifying(&key).expect("cose");
        assert!(build_authenticator_data("", FLAG_UP, 0, None).is_err());
        assert!(build_authenticator_data("https://example.com", FLAG_UP, 0, None).is_err());
        assert!(build_authenticator_data("example.com/x", FLAG_UP, 0, None).is_err());
        assert!(build_authenticator_data(
            RP_ID,
            FLAG_UP | FLAG_AT,
            0,
            Some((&AAGUID_ZERO, &[], &cose))
        )
        .is_err());
        // A credential id longer than the 1023-byte cap is rejected too.
        let oversized = vec![0x01u8; 1024];
        assert!(build_authenticator_data(
            RP_ID,
            FLAG_UP | FLAG_AT,
            0,
            Some((&AAGUID_ZERO, &oversized, &cose))
        )
        .is_err());
    }

    #[test]
    fn parse_rejects_truncated_and_trailing_data() {
        assert!(parse_authenticator_data(&[]).is_err());
        assert!(parse_authenticator_data(&[0u8; 36]).is_err());
        // Assertion data with a trailing byte.
        let mut data = build_authenticator_data(RP_ID, FLAG_UP, 0, None).expect("build");
        data.push(0x00);
        assert!(parse_authenticator_data(&data).is_err());
        // AT data truncated inside the credential id.
        let key = verifying_key_from_signing(&generate_signing_key().expect("generate"));
        let cose = cose_key_from_verifying(&key).expect("cose");
        let full = build_authenticator_data(
            RP_ID,
            FLAG_UP | FLAG_AT,
            0,
            Some((&AAGUID_ZERO, &[0x02u8; 32], &cose)),
        )
        .expect("build");
        assert!(parse_authenticator_data(&full[..60]).is_err());
    }

    #[test]
    fn parse_rejects_trailing_bytes_after_the_cose_key() {
        let key = verifying_key_from_signing(&generate_signing_key().expect("generate"));
        let cose = cose_key_from_verifying(&key).expect("cose");
        let full = build_authenticator_data(
            RP_ID,
            FLAG_UP | FLAG_AT,
            0,
            Some((&AAGUID_ZERO, &[0x02u8; 32], &cose)),
        )
        .expect("build");
        // Sanity: the unmodified buffer parses.
        parse_authenticator_data(&full).expect("valid AT data parses");

        // A CBOR extension map appended after the COSE key. `ciborium`'s
        // `from_reader` deserializes one value and never checks EOF, so without
        // the explicit consumption check this buffer parses "successfully" and
        // the trailing extension is silently dropped.
        let mut extension = Vec::new();
        let extension_map = ciborium::value::Value::Map(vec![(
            ciborium::value::Value::Text("credProtect".to_string()),
            ciborium::value::Value::Integer(2.into()),
        )]);
        ciborium::ser::into_writer(&extension_map, &mut extension).expect("cbor");
        assert!(!extension.is_empty());

        let mut with_extension = full.clone();
        with_extension.extend_from_slice(&extension);
        assert!(
            parse_authenticator_data(&with_extension).is_err(),
            "trailing bytes after the COSE key must be rejected"
        );

        // A single stray byte is rejected too (not just well-formed CBOR).
        let mut with_byte = full.clone();
        with_byte.push(0x00);
        assert!(parse_authenticator_data(&with_byte).is_err());
    }

    #[test]
    fn signature_input_is_auth_data_then_client_data_hash() {
        let auth_data = vec![0x01u8; 37];
        let client_data = b"{\"type\":\"webauthn.get\"}";
        let input = assertion_signature_input(&auth_data, client_data);
        assert_eq!(input.len(), 37 + 32);
        assert_eq!(&input[..37], auth_data.as_slice());
        assert_eq!(&input[37..], &sha256(client_data));
    }

    #[test]
    fn validate_rp_id_returns_the_ascii_lowercase_canonical_form() {
        assert_eq!(validate_rp_id("example.com").expect("valid"), "example.com");
        assert_eq!(validate_rp_id("Example.COM").expect("valid"), "example.com");
        assert_eq!(
            validate_rp_id("LOGIN.Example.Com").expect("valid"),
            "login.example.com"
        );
        // Lexically invalid values are still rejected, before any lowercasing.
        for bad in [
            "",
            "https://example.com",
            "example.com/x",
            "example.com:443",
            "example com",
        ] {
            assert!(
                validate_rp_id(bad).is_err(),
                "rpId {bad:?} must be rejected"
            );
        }
    }

    #[test]
    fn rp_id_hash_uses_the_canonical_rp_id() {
        // The mixed-case spelling must hash exactly like the canonical one:
        // `build_authenticator_data` canonicalizes before hashing.
        let canonical = build_authenticator_data(RP_ID, FLAG_UP, SIGN_COUNT, None).expect("build");
        let mixed = build_authenticator_data("Example.COM", FLAG_UP, SIGN_COUNT, None)
            .expect("mixed case is canonicalized, not rejected");
        assert_eq!(canonical, mixed);
        assert_eq!(&mixed[..32], &rp_id_hash(RP_ID));
        assert_eq!(
            hex::encode(&mixed[..32]),
            RP_ID_HASH_HEX,
            "rpIdHash is SHA-256 of the canonical rpId, never of the raw input"
        );
    }

    #[test]
    fn rp_id_binding_accepts_equal_and_suffix_hosts() {
        // (a) exact match.
        validate_rp_id_binding("example.com", "https://example.com").expect("exact match");
        // (b) the RP ID is a domain suffix of the origin host.
        validate_rp_id_binding("example.com", "https://sub.example.com").expect("suffix match");
        validate_rp_id_binding("example.com", "https://a.b.example.com").expect("deep suffix");
        // A non-default port and the canonical origin form do not matter.
        validate_rp_id_binding("example.com", "https://example.com:8443").expect("port");
        validate_rp_id_binding("localhost", "http://localhost:1420").expect("localhost");
    }

    #[test]
    fn rp_id_binding_rejects_foreign_and_lookalike_hosts() {
        // (c) the review's case: a foreign RP ID with an attacker origin.
        let err = validate_rp_id_binding("victim.example", "https://evil.example")
            .expect_err("a foreign rpId must not bind");
        assert_eq!(
            err.to_string(),
            "Validation Error: RP ID is not a domain suffix of the origin's host"
        );
        // (d) a suffix that does not fall on a label boundary is not a suffix.
        assert!(validate_rp_id_binding("example.com", "https://notexample.com").is_err());
        assert!(validate_rp_id_binding("example.com", "https://example.org").is_err());
        // A malformed origin is reported as such, not as a binding failure.
        assert!(validate_rp_id_binding("example.com", "not a url").is_err());
    }

    /// Known F0 limitation, pinned so it cannot change silently: the binding is
    /// a plain domain-suffix check with **no** public-suffix-list lookup, so a
    /// bare TLD binds to any host under it. Registrable-domain validation is
    /// tracked for T14 (`docs/passkeys.md`); this test documents the gap rather
    /// than endorsing it.
    #[test]
    fn rp_id_binding_has_no_public_suffix_list_in_f0() {
        validate_rp_id_binding("com", "https://evil.com")
            .expect("F0: a bare TLD is a suffix of any host under it");
        // …but it still refuses a host that is not under the TLD at all.
        assert!(validate_rp_id_binding("com", "https://evil.example").is_err());
    }

    /// Negative control: the binding check bites. If `validate_rp_id_binding`
    /// were a no-op (the pre-fix state), the foreign-origin case below would be
    /// accepted and this test would fail.
    #[test]
    fn negative_control_rp_id_binding_is_not_a_no_op() {
        let foreign = validate_rp_id_binding("victim.example", "https://evil.example");
        assert!(
            foreign.is_err(),
            "the binding must reject a foreign rpId/origin pair"
        );
        // …and the same call on a legitimate pair succeeds, so the rejection
        // above is caused by the mismatch and not by a blanket error.
        validate_rp_id_binding("victim.example", "https://victim.example")
            .expect("the matching pair binds");
    }
}
