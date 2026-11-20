//! CXF (Credential Exchange Format) subset: serde types, strict validation and
//! export building.
//!
//! Pinned to the FIDO Alliance **CXF 1.0 review draft 2025-03-13**
//! (§3.1 Header, §3.2.1 Account, §3.2.3 Item, §3.3.12 Passkey, Appendix A). Only
//! `PasskeyCredential` (`type: "passkey"`) is imported or exported; every other
//! credential type is skipped **with a per-credential report entry** — never
//! silently (review rule: no new silent drops).
//!
//! This module is pure parsing/validation: no vault IO, no commands, no logging.
//! The command layer (T16/T17) owns persistence and consent.
//!
//! # Design notes
//!
//! * **Lenient envelope, strict credentials.** The spec says importers MUST
//!   ignore unknown fields, so the envelope structs simply do not declare them
//!   (serde ignores undeclared keys by default). Credentials, in contrast, are
//!   validated field by field in [`validate_passkey`] so that a single bad
//!   credential is rejected *with a precise reason* instead of failing the file.
//! * **`credentials` is `Vec<serde_json::Value>`.** Deserializing into an enum
//!   would lose the original `type` string of an unsupported credential
//!   (`#[serde(other)]` keeps no payload), and the report must name the exact
//!   type. The values are parsed per credential by [`validate_credential`].
//! * **`key`, not `privateKey`.** The CXF member carrying the PKCS#8 DER private
//!   key is `key` (§3.3.12). It is ES256-only: a P-384 or Ed25519 PKCS#8 blob is
//!   rejected by [`crate::passkey::es256::signing_key_from_pkcs8_der`].
//! * **No secrets in errors.** Every rejection reason is a fixed template naming
//!   the field or the rule; no input value is ever interpolated into a message,
//!   so a private key can never reach a log or a UI error string.

use crate::commands::errors::CommandError;
use crate::crypto::base64::{decode_base64_urlsafe, encode_base64_urlsafe};
use crate::models::{Entry, SecretPkcs8};
use crate::passkey::es256::{signing_key_from_pkcs8_der, ALG_ES256};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use zeroize::Zeroizing;

/// Hard cap on the imported document size: 10 MiB (§4.2, DoS guard).
///
/// A CXF file is text; a legitimate export of thousands of passkeys stays far
/// below this. The cap is checked **before** parsing so a hostile input cannot
/// make `serde_json` allocate proportionally to its size.
pub const MAX_ENVELOPE_BYTES: usize = 10 * 1024 * 1024;

/// `exporterRpId` written by Monark on export (§4.1 constant).
pub const EXPORTER_RP_ID: &str = "monark.app";
/// `exporterDisplayName` written by Monark on export (§4.1 constant).
pub const EXPORTER_DISPLAY_NAME: &str = "Monark";
/// The only `version.major` this importer accepts.
pub const SUPPORTED_MAJOR_VERSION: u8 = 1;
/// The `version.minor` Monark writes on export.
pub const EXPORT_MINOR_VERSION: u8 = 0;
/// The only credential `type` this module imports/exports.
pub const PASSKEY_CREDENTIAL_TYPE: &str = "passkey";
/// Report note emitted when a credential carried `fido2Extensions` (ignored).
pub const EXTENSIONS_IGNORED_NOTE: &str = "extension data ignored (fido2Extensions)";
/// Report note emitted when an export skips a passkey with a non-zero counter.
pub const NONZERO_SIGNCOUNT_NOTE: &str = "passkey excluded from export: non-zero signature counter";

/// Maximum decoded length of a `credentialId` (WebAuthn allows 1..=1023 bytes).
const MAX_CREDENTIAL_ID_LEN: usize = 1023;
/// Maximum decoded length of a `userHandle` (WebAuthn: 1..=64 bytes; CXF allows 0).
const MAX_USER_HANDLE_LEN: usize = 64;
/// Maximum length, in characters, of `username` / `userDisplayName`.
const MAX_USER_NAME_CHARS: usize = 256;
/// Length of the random account/item id Monark writes on export (16 bytes).
const EXPORT_ID_BYTES: usize = 16;

// ---------------------------------------------------------------------------
// Envelope types (§4.1)
// ---------------------------------------------------------------------------

/// Top-level CXF document (§3.1 Header).
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CxfHeader {
    pub version: CxfVersion,
    pub exporter_rp_id: String,
    pub exporter_display_name: String,
    pub timestamp: u64,
    /// Required array; may be empty.
    pub accounts: Vec<CxfAccount>,
}

/// CXF format version. Import accepts any `minor` as long as `major` is 1.
#[derive(Serialize, Deserialize, Debug, Clone, Copy, PartialEq, Eq)]
pub struct CxfVersion {
    pub major: u8,
    pub minor: u8,
}

/// CXF account (§3.2.1). Monark has no account concept, so the fields are
/// carried through but only `items` is used on import.
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CxfAccount {
    pub id: String,
    pub username: String,
    pub email: String,
    #[serde(default)]
    pub full_name: Option<String>,
    /// Groups are not mapped in F1; parsed only to keep the shape honest.
    #[serde(default)]
    pub collections: Vec<Value>,
    pub items: Vec<CxfItem>,
}

/// CXF item (§3.2.3): one vault entry.
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CxfItem {
    pub id: String,
    /// Optional on the wire: `None` is omitted on export (`skip_serializing_if`)
    /// so the emitted document carries only the members we actually have.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub creation_at: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub modified_at: Option<u64>,
    /// Required `tstr`; becomes the entry name on import.
    pub title: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub subtitle: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub favorite: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub scope: Option<Value>,
    /// Kept as raw JSON so an unsupported credential keeps its exact `type`
    /// string for the skip report (see the module docs).
    pub credentials: Vec<Value>,
    #[serde(default)]
    pub tags: Option<Vec<String>>,
}

/// Passkey credential (§3.3.12). Every member is required; validation of the
/// *values* happens in [`validate_passkey`].
///
/// `key` is the PKCS#8 DER private key, base64url — **not** `privateKey`.
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CxfPasskey {
    pub credential_id: String,
    pub rp_id: String,
    pub username: String,
    pub user_display_name: String,
    pub user_handle: String,
    pub key: String,
    /// Optional extension data: ignored on import, reported, never exported
    /// (`skip_serializing_if` keeps the emitted credential free of the member).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub fido2_extensions: Option<Value>,
}

/// Export-only credential enum, so `serde` emits the `type` tag.
///
/// Import does **not** use this type (it would discard the original type string
/// of an unsupported credential); see [`CxfItem::credentials`].
#[derive(Serialize, Debug, Clone, PartialEq)]
#[serde(tag = "type")]
pub enum CxfCredential {
    #[serde(rename = "passkey")]
    Passkey(CxfPasskey),
}

// ---------------------------------------------------------------------------
// Validation results and report
// ---------------------------------------------------------------------------

/// A passkey credential that passed every §4.2 rule.
///
/// `pkcs8_der` is secret material: it is wrapped in [`Zeroizing`] so the buffer
/// is scrubbed when the value is dropped, and it has no `Debug`/`Display` path
/// that could print it.
#[derive(Clone, PartialEq, Eq)]
pub struct ValidatedPasskey {
    pub credential_id: Vec<u8>,
    pub rp_id: String,
    pub user_name: String,
    pub user_display_name: String,
    pub user_handle: Vec<u8>,
    pub pkcs8_der: Zeroizing<Vec<u8>>,
    /// `true` when the credential carried `fido2Extensions` (ignored, reported).
    pub extensions_present: bool,
}

/// Redacted `Debug`: formatting a validated passkey never prints the key.
impl std::fmt::Debug for ValidatedPasskey {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("ValidatedPasskey")
            .field("credential_id", &self.credential_id)
            .field("rp_id", &self.rp_id)
            .field("user_name", &self.user_name)
            .field("user_display_name", &self.user_display_name)
            .field("user_handle", &self.user_handle)
            .field("pkcs8_der", &"[REDACTED]")
            .field("extensions_present", &self.extensions_present)
            .finish()
    }
}

/// One skipped credential, with the reason shown to the user.
///
/// `credential_type` is the exact `type` string found in the file (`"totp"`,
/// `"basic-auth"`, …) or `"(missing)"` when the member was absent.
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CxfSkipped {
    pub item_title: String,
    pub credential_type: String,
    pub reason: String,
}

/// Outcome of an import (T16 fills `imported`/`duplicates`; this module only
/// produces the `skipped` entries).
#[derive(Serialize, Deserialize, Debug, Clone, Default, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CxfImportReport {
    pub imported: u32,
    pub duplicates: u32,
    pub skipped: Vec<CxfSkipped>,
}

impl CxfImportReport {
    /// Records a skipped credential.
    pub fn push_skipped(&mut self, item_title: &str, credential_type: &str, reason: &str) {
        self.skipped.push(CxfSkipped {
            item_title: item_title.to_string(),
            credential_type: credential_type.to_string(),
            reason: reason.to_string(),
        });
    }
}

/// A stored passkey projected for export.
///
/// The command layer (T17) builds these from the decrypted vault; `pkcs8_b64url`
/// is the already-encoded `SecretPkcs8` string, so this module never has to
/// re-encode key material.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ExportPasskey {
    /// Entry name → `item.title`.
    pub name: String,
    /// Entry tags → `item.tags`.
    pub tags: Vec<String>,
    /// Entry creation time, UNIX seconds.
    pub created_at_secs: u64,
    /// Entry last-modified time, UNIX seconds.
    pub updated_at_secs: u64,
    pub rp_id: String,
    /// Raw credential id bytes (encoded to base64url on export).
    pub credential_id: Vec<u8>,
    /// Raw user handle bytes (encoded to base64url on export).
    pub user_handle: Vec<u8>,
    pub user_name: String,
    pub user_display_name: String,
    /// PKCS#8 DER, base64url — the `SecretPkcs8` string verbatim.
    pub pkcs8_b64url: String,
    /// Stored signature counter. Non-zero values are excluded from the export
    /// (spec rule), reported through [`ExportOutcome::notes`].
    pub sign_count: u32,
}

impl ExportPasskey {
    /// Projects a disk passkey entry onto the export shape.
    ///
    /// Returns `None` for any other entry variant: only passkeys are exported.
    pub fn from_entry(entry: &Entry) -> Option<Self> {
        match entry {
            Entry::Passkey {
                name,
                created_at,
                updated_at,
                tags,
                rp_id,
                credential_id,
                user_handle,
                user_name,
                user_display_name,
                private_key,
                sign_count,
                ..
            } => Some(Self {
                name: name.clone(),
                tags: tags.clone(),
                created_at_secs: unix_secs(*created_at),
                updated_at_secs: unix_secs(*updated_at),
                rp_id: rp_id.clone(),
                credential_id: credential_id.clone(),
                user_handle: user_handle.clone(),
                user_name: user_name.clone(),
                user_display_name: user_display_name.clone(),
                pkcs8_b64url: private_key.as_b64url().to_string(),
                sign_count: *sign_count,
            }),
            Entry::Group { .. } | Entry::Data { .. } => None,
        }
    }
}

/// Result of [`build_export`]: the JSON document plus the non-fatal notes the
/// caller must surface (today: excluded non-zero signature counters).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ExportOutcome {
    pub json: String,
    pub exported: u32,
    pub notes: Vec<String>,
}

/// Converts a `DateTime<Utc>` to UNIX seconds, clamping pre-epoch values to 0.
///
/// `u64` is the CXF type; a timestamp before 1970 cannot be represented and
/// cannot occur for a vault entry, so clamping is the honest fallback (never a
/// panic, never a negative cast).
fn unix_secs(at: chrono::DateTime<chrono::Utc>) -> u64 {
    u64::try_from(at.timestamp()).unwrap_or(0)
}

// ---------------------------------------------------------------------------
// parse_envelope
// ---------------------------------------------------------------------------

fn validation(message: &str) -> CommandError {
    CommandError::Validation(message.to_string())
}

/// Parses and structurally validates a CXF document.
///
/// Rejects (all as [`CommandError::Validation`], never a panic, never echoing
/// file content):
///
/// * input larger than [`MAX_ENVELOPE_BYTES`] (checked before parsing);
/// * invalid JSON;
/// * `version.major != 1` (any `minor` is accepted);
/// * `accounts`, or any `items`/`credentials` member, missing or not an array
///   (serde enforces the shape: those members are non-`Option` `Vec`s).
///
/// Unknown members anywhere are ignored, as the spec requires.
pub fn parse_envelope(json: &str) -> Result<CxfHeader, CommandError> {
    if json.len() > MAX_ENVELOPE_BYTES {
        return Err(validation("CXF document exceeds the 10 MiB limit"));
    }
    let header: CxfHeader =
        serde_json::from_str(json).map_err(|_| validation("CXF document is not valid JSON"))?;
    if header.version.major != SUPPORTED_MAJOR_VERSION {
        return Err(validation("Unsupported CXF major version"));
    }
    Ok(header)
}

// ---------------------------------------------------------------------------
// validate_passkey / validate_credential
// ---------------------------------------------------------------------------

/// Name used in the report when a credential object has no `type` member.
pub const MISSING_CREDENTIAL_TYPE: &str = "(missing)";

/// Reads the `type` member of a raw credential value.
///
/// Returns the exact string when present, [`MISSING_CREDENTIAL_TYPE`] when the
/// member is absent, and `None` when the value is not a JSON object at all.
pub fn credential_type(value: &Value) -> Option<&str> {
    let object = value.as_object()?;
    Some(match object.get("type") {
        Some(Value::String(type_)) => type_.as_str(),
        _ => MISSING_CREDENTIAL_TYPE,
    })
}

/// Validates one raw credential value from `item.credentials`.
///
/// * `Ok(Ok(passkey))` — a valid passkey credential.
/// * `Ok(Err(reason))` — the credential is skipped; `reason` is user-facing.
/// * The credential `type` is returned alongside so the caller can build the
///   report entry without re-parsing.
pub fn validate_credential(value: &Value) -> (String, Result<ValidatedPasskey, String>) {
    let Some(credential_type) = credential_type(value) else {
        return (
            MISSING_CREDENTIAL_TYPE.to_string(),
            Err("missing or malformed field: type".to_string()),
        );
    };
    if credential_type == MISSING_CREDENTIAL_TYPE {
        // The object has no `type` member (or it is not a string): that is a
        // malformed credential, not an unsupported type.
        return (
            credential_type.to_string(),
            Err("missing or malformed field: type".to_string()),
        );
    }
    if credential_type != PASSKEY_CREDENTIAL_TYPE {
        return (
            credential_type.to_string(),
            Err(format!("unsupported credential type: {credential_type}")),
        );
    }
    let passkey: CxfPasskey = match serde_json::from_value(value.clone()) {
        Ok(passkey) => passkey,
        Err(err) => {
            return (
                credential_type.to_string(),
                Err(malformed_field_reason(&err)),
            )
        }
    };
    (credential_type.to_string(), validate_passkey(&passkey))
}

/// Turns a `serde_json` struct error into `missing or malformed field: <name>`.
///
/// Only the *member name* is taken from the error, and only for the "missing"
/// case, where serde reports it unambiguously (`missing field \`rpId\``). For a
/// wrong JSON type serde's message quotes the *value*, not the member, so the
/// reason falls back to the generic `credential` name: the offending value must
/// never reach a rejection reason (it could be key material).
fn malformed_field_reason(err: &serde_json::Error) -> String {
    const MISSING_PREFIX: &str = "missing field `";
    let text = err.to_string();
    let name = text
        .strip_prefix(MISSING_PREFIX)
        .and_then(|rest| rest.split('`').next())
        .filter(|candidate| !candidate.is_empty() && candidate.len() <= 64)
        .unwrap_or("credential");
    format!("missing or malformed field: {name}")
}

/// Applies every §4.2 rule to a passkey credential.
///
/// The returned `Err` is the user-facing skip reason. Rules, in order:
///
/// 1. `credentialId` / `userHandle` / `key` must be URL_SAFE_NO_PAD base64.
/// 2. `credentialId` decoded length must be 1..=1023 bytes.
/// 3. `userHandle` decoded length must be 0..=64 bytes.
/// 4. `key` must parse as a P-256 PKCS#8 key (ES256-only).
/// 5. `rpId` must be non-empty and free of `://`, `/`, `:`, whitespace.
/// 6. `username` / `userDisplayName` must be at most 256 characters.
pub fn validate_passkey(passkey: &CxfPasskey) -> Result<ValidatedPasskey, String> {
    let credential_id = decode_field(&passkey.credential_id, "credentialId")?;
    if credential_id.is_empty() || credential_id.len() > MAX_CREDENTIAL_ID_LEN {
        return Err("credentialId must decode to 1..=1023 bytes".to_string());
    }

    let user_handle = decode_field(&passkey.user_handle, "userHandle")?;
    if user_handle.len() > MAX_USER_HANDLE_LEN {
        return Err("userHandle must decode to at most 64 bytes".to_string());
    }

    let pkcs8_der = decode_field(&passkey.key, "key")?;
    // ES256-only: rejects P-384, Ed25519, RSA and garbage. The error type is
    // discarded on purpose — the reason string below is the contract.
    signing_key_from_pkcs8_der(&pkcs8_der)
        .map_err(|_| "private key is not a valid P-256 PKCS#8 key".to_string())?;

    if !is_valid_rp_id(&passkey.rp_id) {
        return Err("rpId is not a valid relying party identifier".to_string());
    }

    if passkey.username.chars().count() > MAX_USER_NAME_CHARS {
        return Err("username exceeds 256 characters".to_string());
    }
    if passkey.user_display_name.chars().count() > MAX_USER_NAME_CHARS {
        return Err("userDisplayName exceeds 256 characters".to_string());
    }

    Ok(ValidatedPasskey {
        credential_id,
        rp_id: passkey.rp_id.clone(),
        user_name: passkey.username.clone(),
        user_display_name: passkey.user_display_name.clone(),
        user_handle,
        pkcs8_der: Zeroizing::new(pkcs8_der),
        extensions_present: passkey.fido2_extensions.is_some(),
    })
}

/// Decodes one base64url member, mapping any failure to a field-named reason.
fn decode_field(encoded: &str, field: &str) -> Result<Vec<u8>, String> {
    decode_base64_urlsafe(encoded)
        .map_err(|_| format!("{field} is not valid base64url (URL_SAFE_NO_PAD)"))
}

/// A WebAuthn RP ID is a bare domain: no scheme, no path, no port, no spaces.
///
/// Deliberately syntactic only (the WebAuthn-level checks — registrable-domain
/// suffix, public suffix — belong to the ceremony, not to a file import).
fn is_valid_rp_id(rp_id: &str) -> bool {
    !rp_id.is_empty()
        && !rp_id.contains("://")
        && !rp_id.contains('/')
        && !rp_id.contains(':')
        && !rp_id.chars().any(char::is_whitespace)
}

// ---------------------------------------------------------------------------
// build_export
// ---------------------------------------------------------------------------

/// Serializes one exported passkey as a `type: "passkey"` credential value.
///
/// `serde_json::to_value` cannot fail for a struct of strings and `None`s, but
/// the error is still mapped (never unwrapped) so a future field addition cannot
/// turn this into a panic.
fn credential_value(passkey: &ExportPasskey) -> Result<Value, CommandError> {
    serde_json::to_value(CxfCredential::Passkey(CxfPasskey {
        credential_id: encode_base64_urlsafe(&passkey.credential_id),
        rp_id: passkey.rp_id.clone(),
        username: passkey.user_name.clone(),
        user_display_name: passkey.user_display_name.clone(),
        user_handle: encode_base64_urlsafe(&passkey.user_handle),
        key: passkey.pkcs8_b64url.clone(),
        // Extensions are never exported: we ignore them on import and support
        // none, so there is nothing to write back.
        fido2_extensions: None,
    }))
    .map_err(|_| CommandError::Serialization("Failed to serialize a CXF credential".into()))
}

/// Builds a CXF document from stored passkeys (§4.1/§4.2 export shape).
///
/// * One account, one item per exported passkey.
/// * `version = {1, 0}`, `exporterRpId = "monark.app"`,
///   `exporterDisplayName = "Monark"`, `timestamp = now`.
/// * `key` is the stored base64url PKCS#8 string, byte-identical to the input.
/// * A passkey whose `sign_count != 0` is **excluded** and reported through
///   [`ExportOutcome::notes`] (spec rule; our authenticator always stores 0, the
///   filter keeps the invariant alive for future changes).
///
/// The returned JSON is a plain (unencrypted) document: the caller must have
/// collected explicit consent before writing it anywhere.
pub fn build_export(passkeys: &[ExportPasskey]) -> Result<ExportOutcome, CommandError> {
    let timestamp = unix_secs(chrono::Utc::now());
    let mut items = Vec::with_capacity(passkeys.len());
    let mut notes = Vec::new();
    let mut exported = 0u32;

    for passkey in passkeys {
        if passkey.sign_count != 0 {
            notes.push(format!("{}: {NONZERO_SIGNCOUNT_NOTE}", passkey.name));
            continue;
        }
        items.push(CxfItem {
            id: random_export_id()?,
            creation_at: Some(passkey.created_at_secs),
            modified_at: Some(passkey.updated_at_secs),
            title: passkey.name.clone(),
            subtitle: None,
            favorite: None,
            scope: None,
            credentials: vec![credential_value(passkey)?],
            tags: Some(passkey.tags.clone()),
        });
        exported += 1;
    }

    let header = CxfHeader {
        version: CxfVersion {
            major: SUPPORTED_MAJOR_VERSION,
            minor: EXPORT_MINOR_VERSION,
        },
        exporter_rp_id: EXPORTER_RP_ID.to_string(),
        exporter_display_name: EXPORTER_DISPLAY_NAME.to_string(),
        timestamp,
        accounts: vec![CxfAccount {
            id: random_export_id()?,
            username: String::new(),
            email: String::new(),
            full_name: None,
            collections: Vec::new(),
            items,
        }],
    };

    // `serde_json::to_string` (not `to_string_pretty`) keeps the document
    // compact; either way the output is valid JSON that re-parses below.
    let json = serde_json::to_string(&header)
        .map_err(|_| CommandError::Serialization("Failed to serialize the CXF export".into()))?;
    Ok(ExportOutcome {
        json,
        exported,
        notes,
    })
}

/// Random 16-byte base64url id for exported accounts and items.
fn random_export_id() -> Result<String, CommandError> {
    let bytes = crate::crypto::random::generate_random_bytes(EXPORT_ID_BYTES)
        .map_err(|_| CommandError::Crypto("Failed to generate an export id".to_string()))?;
    Ok(encode_base64_urlsafe(&bytes))
}

/// Builds the [`SecretPkcs8`] of a validated passkey (import helper, T16).
///
/// Kept here so the "validated bytes → stored representation" step has exactly
/// one implementation and cannot drift from the export side.
pub fn secret_from_validated(passkey: &ValidatedPasskey) -> SecretPkcs8 {
    SecretPkcs8::from_pkcs8_der(&passkey.pkcs8_der)
}

/// The COSE algorithm Monark stores for an imported CXF passkey (ES256).
pub const IMPORTED_ALGORITHM: i32 = ALG_ES256; // ---------------------------------------------------------------------------
                                               // Tests
                                               // ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use crate::passkey::es256::signing_key_from_pkcs8_der;
    use chrono::{TimeZone, Utc};
    use serde_json::json;

    /// Published CXF Appendix A example key (PKCS#8 DER, base64url).
    ///
    /// An example credential from the specification, **not** a secret: it is the
    /// same value T02 pins as `VECTOR_KEY_B64URL`. See
    /// `fixtures/cxf/README.md` for provenance.
    const SPEC_KEY_B64URL: &str = "MIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQgARu_0sCt20EpgVxb4Puq3Ga5VVLpuTY75ngvZlyq3X6hRANCAASmdk1xLsK0oOlhxIPp0d1ZuS0sT9nf6BZtSelhqvLBW0fOL33l_bXgsr_STUHjCLn8l6gcRJwe7OQvbQubZ1dY";

    // Fixtures are `include_str!`d so a missing or renamed file is a compile
    // error, not a runtime surprise. The path is relative to this file:
    // `src-tauri/src/passkey/` → three levels up is the repo root.
    const FIXTURE_SPEC_APPENDIX_A: &str =
        include_str!("../../../fixtures/cxf/spec-appendix-a.json");
    const FIXTURE_VALID_SINGLE: &str = include_str!("../../../fixtures/cxf/valid-single.json");
    const FIXTURE_VALID_MULTI: &str =
        include_str!("../../../fixtures/cxf/valid-multi-account.json");
    const FIXTURE_DUPLICATE: &str = include_str!("../../../fixtures/cxf/duplicate-credential.json");
    const FIXTURE_BAD_BASE64: &str = include_str!("../../../fixtures/cxf/bad-base64.json");
    const FIXTURE_WRONG_CURVE: &str = include_str!("../../../fixtures/cxf/wrong-curve-key.json");
    const FIXTURE_BAD_RPID: &str = include_str!("../../../fixtures/cxf/bad-rpid.json");
    const FIXTURE_MISSING_FIELDS: &str = include_str!("../../../fixtures/cxf/missing-fields.json");
    const FIXTURE_WRONG_MAJOR: &str =
        include_str!("../../../fixtures/cxf/wrong-major-version.json");

    /// A minimal valid passkey credential built in-test (no fixture needed).
    fn valid_passkey() -> CxfPasskey {
        CxfPasskey {
            credential_id: "Y3JlZGVudGlhbElkRXhhbXBsZQ".to_string(),
            rp_id: "webauthn.io".to_string(),
            username: "johndoe".to_string(),
            user_display_name: "John Doe".to_string(),
            user_handle: "cnEzaNHWcYK3coWZjvoaV1Hj9gnI12mKe2dL2HZVFlY".to_string(),
            key: SPEC_KEY_B64URL.to_string(),
            fido2_extensions: None,
        }
    }

    /// Every credential of every item, as `(item title, raw credential value)`.
    fn all_credentials(header: &CxfHeader) -> Vec<(String, &Value)> {
        header
            .accounts
            .iter()
            .flat_map(|account| account.items.iter())
            .flat_map(|item| {
                item.credentials
                    .iter()
                    .map(move |credential| (item.title.clone(), credential))
            })
            .collect()
    }

    /// Runs the per-credential pipeline over a whole document and collects the
    /// `(title, type, reason)` of every skip — exactly what T16 will report.
    fn collect_skips(header: &CxfHeader) -> Vec<(String, String, String)> {
        all_credentials(header)
            .into_iter()
            .filter_map(|(title, credential)| {
                let (credential_type, outcome) = validate_credential(credential);
                match outcome {
                    Ok(_) => None,
                    Err(reason) => Some((title, credential_type, reason)),
                }
            })
            .collect()
    }

    /// Runs the per-credential pipeline and returns the valid passkeys.
    fn collect_valid(header: &CxfHeader) -> Vec<ValidatedPasskey> {
        all_credentials(header)
            .into_iter()
            .filter_map(|(_, credential)| validate_credential(credential).1.ok())
            .collect()
    }

    // -- parse_envelope -----------------------------------------------------

    #[test]
    fn parse_spec_appendix_a() {
        let header = parse_envelope(FIXTURE_SPEC_APPENDIX_A).expect("spec fixture parses");
        assert_eq!(header.version, CxfVersion { major: 1, minor: 0 });
        assert_eq!(header.exporter_rp_id, "example.com");
        assert_eq!(header.timestamp, 1_705_228_800);
        assert_eq!(header.accounts.len(), 1);

        let account = &header.accounts[0];
        assert_eq!(account.username, "johndoe");
        assert_eq!(account.full_name.as_deref(), Some("John Doe"));
        assert_eq!(account.items.len(), 3);

        let passkey_item = &account.items[0];
        assert_eq!(passkey_item.title, "WebAuthn.io");
        assert_eq!(passkey_item.creation_at, Some(1_705_142_400));
        assert_eq!(passkey_item.modified_at, Some(1_705_228_800));
        assert_eq!(
            passkey_item.tags.as_deref(),
            Some(&["work".to_string()][..])
        );
        assert_eq!(passkey_item.credentials.len(), 1);

        // The passkey credential keeps the spec member names (`key`, not
        // `privateKey`) and is the only one that validates.
        let parsed: CxfPasskey =
            serde_json::from_value(passkey_item.credentials[0].clone()).expect("passkey shape");
        assert_eq!(parsed.rp_id, "webauthn.io");
        assert_eq!(parsed.key, SPEC_KEY_B64URL);
        assert!(parsed.fido2_extensions.is_none());

        let valid = collect_valid(&header);
        assert_eq!(valid.len(), 1, "exactly one passkey credential");
        assert_eq!(valid[0].rp_id, "webauthn.io");
        assert_eq!(valid[0].user_name, "johndoe");
        assert!(!valid[0].extensions_present);
    }

    #[test]
    fn parse_ignores_unknown_members_everywhere() {
        // The spec says importers MUST ignore unknown fields; a document with
        // extra members at every level must parse identically.
        let header = parse_envelope(FIXTURE_VALID_SINGLE).expect("fixture parses");
        let mut document: Value = serde_json::from_str(FIXTURE_VALID_SINGLE).expect("json");
        let object = document.as_object_mut().expect("object");
        object.insert("futureHeaderField".to_string(), json!({"a": 1}));
        let account = object["accounts"][0].as_object_mut().expect("account");
        account.insert("futureAccountField".to_string(), json!([1, 2, 3]));
        let item = account["items"][0].as_object_mut().expect("item");
        item.insert("futureItemField".to_string(), json!("x"));
        let credential = item["credentials"][0].as_object_mut().expect("credential");
        credential.insert("futureCredentialField".to_string(), json!(true));

        let extended = parse_envelope(&document.to_string()).expect("extended document parses");
        // The envelope members are unaffected...
        assert_eq!(extended.version, header.version);
        assert_eq!(extended.exporter_rp_id, header.exporter_rp_id);
        assert_eq!(extended.timestamp, header.timestamp);
        assert_eq!(extended.accounts.len(), header.accounts.len());
        // ...and so is every *declared* member of the item and its credential.
        // (`credentials` is raw JSON by design, so the unknown member is still
        // visible there — that is what keeps the skip report honest.)
        let item = &extended.accounts[0].items[0];
        assert_eq!(item.title, "WebAuthn.io");
        assert_eq!(item.tags, header.accounts[0].items[0].tags);
        let (credential_type, outcome) = validate_credential(&item.credentials[0]);
        assert_eq!(credential_type, PASSKEY_CREDENTIAL_TYPE);
        let validated = outcome.expect("the credential still validates");
        assert_eq!(validated.rp_id, "webauthn.io");
        assert_eq!(validated.user_name, "johndoe");
    }

    #[test]
    fn parse_rejects_wrong_major_version() {
        let err = parse_envelope(FIXTURE_WRONG_MAJOR).expect_err("major 2 is rejected");
        assert!(matches!(err, CommandError::Validation(_)), "{err:?}");
        assert!(err.to_string().contains("major version"), "{err}");
    }

    #[test]
    fn parse_accepts_any_minor_version() {
        let document = json!({
            "version": { "major": 1, "minor": 99 },
            "exporterRpId": "example.com",
            "exporterDisplayName": "Example",
            "timestamp": 0,
            "accounts": []
        });
        let header = parse_envelope(&document.to_string()).expect("minor is ignored");
        assert_eq!(header.version.minor, 99);
        assert!(header.accounts.is_empty());
    }

    #[test]
    fn parse_rejects_invalid_json() {
        let err = parse_envelope("{ not json").expect_err("invalid JSON is rejected");
        assert!(matches!(err, CommandError::Validation(_)), "{err:?}");
        // The message must not echo the input.
        assert!(!err.to_string().contains("not json"), "{err}");
    }

    #[test]
    fn parse_rejects_non_array_accounts_items_credentials() {
        let cases = [
            json!({
                "version": { "major": 1, "minor": 0 },
                "exporterRpId": "example.com",
                "exporterDisplayName": "Example",
                "timestamp": 0,
                "accounts": "not-an-array"
            }),
            json!({
                "version": { "major": 1, "minor": 0 },
                "exporterRpId": "example.com",
                "exporterDisplayName": "Example",
                "timestamp": 0,
                "accounts": [{ "id": "a", "username": "u", "email": "e", "items": {} }]
            }),
            json!({
                "version": { "major": 1, "minor": 0 },
                "exporterRpId": "example.com",
                "exporterDisplayName": "Example",
                "timestamp": 0,
                "accounts": [{
                    "id": "a", "username": "u", "email": "e",
                    "items": [{ "id": "i", "title": "t", "credentials": 7 }]
                }]
            }),
            // `accounts` missing entirely.
            json!({
                "version": { "major": 1, "minor": 0 },
                "exporterRpId": "example.com",
                "exporterDisplayName": "Example",
                "timestamp": 0
            }),
        ];
        for (index, document) in cases.iter().enumerate() {
            let err = parse_envelope(&document.to_string())
                .err()
                .unwrap_or_else(|| panic!("case {index} must be rejected"));
            assert!(
                matches!(err, CommandError::Validation(_)),
                "case {index}: {err:?}"
            );
        }
    }

    #[test]
    fn parse_rejects_oversized_document() {
        // Generated in-test (never committed): a JSON string one byte over the
        // cap. The cap is checked before parsing, so the content is irrelevant.
        let oversized = "x".repeat(MAX_ENVELOPE_BYTES + 1);
        let err = parse_envelope(&oversized).expect_err("oversized input is rejected");
        assert!(matches!(err, CommandError::Validation(_)), "{err:?}");
        assert!(err.to_string().contains("10 MiB"), "{err}");

        // One byte under the cap is *not* rejected by the size rule (it is then
        // rejected as invalid JSON, which proves the size check let it through).
        let just_under = "x".repeat(MAX_ENVELOPE_BYTES);
        let err = parse_envelope(&just_under).expect_err("still not JSON");
        assert!(!err.to_string().contains("10 MiB"), "{err}");
    }

    // -- validate_passkey ---------------------------------------------------

    #[test]
    fn validate_spec_example_key() {
        let validated = validate_passkey(&valid_passkey()).expect("spec example key validates");
        assert_eq!(validated.rp_id, "webauthn.io");
        assert_eq!(validated.user_name, "johndoe");
        assert_eq!(validated.user_display_name, "John Doe");
        assert_eq!(validated.credential_id, b"credentialIdExample");
        assert_eq!(validated.user_handle.len(), 32);
        assert!(!validated.extensions_present);

        // The accepted bytes are the published PKCS#8 document and parse back as
        // a P-256 key: the ES256 gate accepted a real key, not just "something".
        assert_eq!(encode_base64_urlsafe(&validated.pkcs8_der), SPEC_KEY_B64URL);
        signing_key_from_pkcs8_der(&validated.pkcs8_der).expect("accepted key is P-256 PKCS#8");
    }

    #[test]
    fn validate_rejects_every_rule() {
        // Each case mutates exactly one field of the valid credential, so a
        // failure names the rule that broke.
        let long_name = "a".repeat(MAX_USER_NAME_CHARS + 1);
        let long_handle = encode_base64_urlsafe(&[0x11u8; MAX_USER_HANDLE_LEN + 1]);
        let oversized_credential_id = encode_base64_urlsafe(&[0x22u8; MAX_CREDENTIAL_ID_LEN + 1]);
        let empty_credential_id = String::new();

        let cases: Vec<(&str, CxfPasskey, &str)> = vec![
            (
                "credentialId not base64url",
                CxfPasskey {
                    credential_id: "not base64!!!".to_string(),
                    ..valid_passkey()
                },
                "credentialId is not valid base64url (URL_SAFE_NO_PAD)",
            ),
            (
                "credentialId padded",
                CxfPasskey {
                    credential_id: "Y3JlZGVudGlhbElkRXhhbXBsZQ==".to_string(),
                    ..valid_passkey()
                },
                "credentialId is not valid base64url (URL_SAFE_NO_PAD)",
            ),
            (
                "credentialId empty",
                CxfPasskey {
                    credential_id: empty_credential_id,
                    ..valid_passkey()
                },
                "credentialId must decode to 1..=1023 bytes",
            ),
            (
                "credentialId too long",
                CxfPasskey {
                    credential_id: oversized_credential_id,
                    ..valid_passkey()
                },
                "credentialId must decode to 1..=1023 bytes",
            ),
            (
                "userHandle not base64url",
                CxfPasskey {
                    user_handle: "ab+/cd==".to_string(),
                    ..valid_passkey()
                },
                "userHandle is not valid base64url (URL_SAFE_NO_PAD)",
            ),
            (
                "userHandle too long",
                CxfPasskey {
                    user_handle: long_handle,
                    ..valid_passkey()
                },
                "userHandle must decode to at most 64 bytes",
            ),
            (
                "key not base64url",
                CxfPasskey {
                    key: "not base64 at all!!!".to_string(),
                    ..valid_passkey()
                },
                "key is not valid base64url (URL_SAFE_NO_PAD)",
            ),
            (
                "key not PKCS#8",
                CxfPasskey {
                    key: encode_base64_urlsafe(b"not der"),
                    ..valid_passkey()
                },
                "private key is not a valid P-256 PKCS#8 key",
            ),
            (
                "rpId empty",
                CxfPasskey {
                    rp_id: String::new(),
                    ..valid_passkey()
                },
                "rpId is not a valid relying party identifier",
            ),
            (
                "rpId with scheme",
                CxfPasskey {
                    rp_id: "https://webauthn.io".to_string(),
                    ..valid_passkey()
                },
                "rpId is not a valid relying party identifier",
            ),
            (
                "rpId with path",
                CxfPasskey {
                    rp_id: "webauthn.io/login".to_string(),
                    ..valid_passkey()
                },
                "rpId is not a valid relying party identifier",
            ),
            (
                "rpId with port",
                CxfPasskey {
                    rp_id: "webauthn.io:443".to_string(),
                    ..valid_passkey()
                },
                "rpId is not a valid relying party identifier",
            ),
            (
                "rpId with whitespace",
                CxfPasskey {
                    rp_id: "webauthn io".to_string(),
                    ..valid_passkey()
                },
                "rpId is not a valid relying party identifier",
            ),
            (
                "username too long",
                CxfPasskey {
                    username: long_name.clone(),
                    ..valid_passkey()
                },
                "username exceeds 256 characters",
            ),
            (
                "userDisplayName too long",
                CxfPasskey {
                    user_display_name: long_name,
                    ..valid_passkey()
                },
                "userDisplayName exceeds 256 characters",
            ),
        ];

        for (label, passkey, expected) in cases {
            let reason = validate_passkey(&passkey)
                .err()
                .unwrap_or_else(|| panic!("{label} must be rejected"));
            assert_eq!(reason, expected, "{label}");
        }
    }

    #[test]
    fn validate_rejects_non_p256_keys_es256_only() {
        // Both fixtures are public test keys (RFC 8410 Ed25519, throwaway P-384).
        let header = parse_envelope(FIXTURE_WRONG_CURVE).expect("fixture parses");
        let credentials = all_credentials(&header);
        assert_eq!(credentials.len(), 2);

        for (title, credential) in credentials {
            let (credential_type, outcome) = validate_credential(credential);
            assert_eq!(credential_type, PASSKEY_CREDENTIAL_TYPE);
            let reason = match outcome {
                Ok(validated) => panic!("{title} must be rejected, got {validated:?}"),
                Err(reason) => reason,
            };
            assert_eq!(
                reason, "private key is not a valid P-256 PKCS#8 key",
                "{title} must be rejected by the ES256-only gate"
            );
        }
    }

    #[test]
    fn validate_allows_empty_user_handle() {
        // CXF permits a zero-length user handle (WebAuthn allows 0..=64 bytes).
        let validated = validate_passkey(&CxfPasskey {
            user_handle: String::new(),
            ..valid_passkey()
        })
        .expect("empty user handle is allowed");
        assert!(validated.user_handle.is_empty());
    }

    #[test]
    fn validate_accepts_256_char_names() {
        // The boundary is inclusive: exactly 256 characters is accepted.
        let name = "é".repeat(MAX_USER_NAME_CHARS);
        let validated = validate_passkey(&CxfPasskey {
            username: name.clone(),
            user_display_name: name.clone(),
            ..valid_passkey()
        })
        .expect("256 characters are allowed");
        assert_eq!(validated.user_name.chars().count(), 256);
        assert_eq!(validated.user_display_name, name);
    }

    #[test]
    fn validate_reports_extension_presence() {
        let passkey = CxfPasskey {
            fido2_extensions: Some(json!({ "credProtect": 2 })),
            ..valid_passkey()
        };
        let validated = validate_passkey(&passkey).expect("extensions do not invalidate");
        assert!(
            validated.extensions_present,
            "the caller needs this flag to add the report note"
        );
    }

    #[test]
    fn validated_passkey_debug_is_redacted() {
        let validated = validate_passkey(&valid_passkey()).expect("validates");
        let rendered = format!("{validated:?}");
        assert!(rendered.contains("[REDACTED]"), "{rendered}");
        assert!(!rendered.contains("MIGHAgEA"), "{rendered}");
    }

    // -- per-credential pipeline / report -----------------------------------

    #[test]
    fn non_passkey_skipped_with_type() {
        // Acceptance criterion 3: the spec fixture's basic-auth + totp items are
        // skipped with their exact type, never silently.
        let header = parse_envelope(FIXTURE_SPEC_APPENDIX_A).expect("fixture parses");
        let skips = collect_skips(&header);
        assert_eq!(skips.len(), 2, "two unsupported credentials: {skips:?}");

        let (title, credential_type, reason) = &skips[0];
        assert_eq!(title, "Example login");
        assert_eq!(credential_type, "basic-auth");
        assert_eq!(reason, "unsupported credential type: basic-auth");

        let (title, credential_type, reason) = &skips[1];
        assert_eq!(title, "Example TOTP");
        assert_eq!(credential_type, "totp");
        assert_eq!(reason, "unsupported credential type: totp");
    }

    #[test]
    fn malformed_credentials_skipped_with_field_reason() {
        let header = parse_envelope(FIXTURE_MISSING_FIELDS).expect("fixture parses");
        let skips = collect_skips(&header);
        assert_eq!(skips.len(), 5, "every credential is skipped: {skips:?}");

        let reasons: Vec<&str> = skips.iter().map(|(_, _, reason)| reason.as_str()).collect();
        assert_eq!(
            reasons,
            vec![
                // serde names the absent member...
                "missing or malformed field: rpId",
                "missing or malformed field: key",
                "missing or malformed field: type",
                // ...but for a wrong JSON type it quotes the *value*, so the
                // reason stays generic rather than echoing it.
                "missing or malformed field: credential",
                "missing or malformed field: type",
            ],
            "each credential names the member that broke"
        );
        // The non-object credential has no `type` member to report.
        assert_eq!(skips[4].1, MISSING_CREDENTIAL_TYPE);
    }

    #[test]
    fn bad_base64_fixture_reports_each_field() {
        let header = parse_envelope(FIXTURE_BAD_BASE64).expect("fixture parses");
        let skips = collect_skips(&header);
        let reasons: Vec<&str> = skips.iter().map(|(_, _, reason)| reason.as_str()).collect();
        assert_eq!(
            reasons,
            vec![
                "credentialId is not valid base64url (URL_SAFE_NO_PAD)",
                "userHandle is not valid base64url (URL_SAFE_NO_PAD)",
                "key is not valid base64url (URL_SAFE_NO_PAD)",
            ]
        );
    }

    #[test]
    fn bad_rpid_fixture_reports_every_shape() {
        let header = parse_envelope(FIXTURE_BAD_RPID).expect("fixture parses");
        let skips = collect_skips(&header);
        assert_eq!(
            skips.len(),
            5,
            "all five rpId shapes are rejected: {skips:?}"
        );
        for (_, _, reason) in &skips {
            assert_eq!(reason, "rpId is not a valid relying party identifier");
        }
    }

    #[test]
    fn multi_account_fixture_validates_all_and_flags_extensions() {
        let header = parse_envelope(FIXTURE_VALID_MULTI).expect("fixture parses");
        assert_eq!(header.accounts.len(), 2);
        assert!(collect_skips(&header).is_empty(), "no skips expected");

        let valid = collect_valid(&header);
        assert_eq!(valid.len(), 3);
        let with_extensions: Vec<&ValidatedPasskey> =
            valid.iter().filter(|p| p.extensions_present).collect();
        assert_eq!(with_extensions.len(), 1, "exactly one carries extensions");
        assert_eq!(with_extensions[0].user_name, "janedoe");
    }

    #[test]
    fn duplicate_fixture_keeps_same_id_under_different_rp_distinct() {
        // Dedup is T16's job, but the fixture must contain the two shapes the
        // rule distinguishes: identical (rpId, credentialId) and same id under a
        // different rpId. All three credentials validate on their own.
        let header = parse_envelope(FIXTURE_DUPLICATE).expect("fixture parses");
        let valid = collect_valid(&header);
        assert_eq!(valid.len(), 3);

        let keys: Vec<(String, Vec<u8>)> = valid
            .iter()
            .map(|p| (p.rp_id.clone(), p.credential_id.clone()))
            .collect();
        assert_eq!(keys[0], keys[1], "first two are the same credential");
        assert_eq!(keys[0].1, keys[2].1, "third shares the credential id");
        assert_ne!(keys[0].0, keys[2].0, "but lives under a different rpId");
    }

    #[test]
    fn skip_reasons_never_echo_key_material() {
        // A rejection reason is user-facing and may reach a log: it must never
        // carry the offending value.
        let passkey = CxfPasskey {
            key: format!("{SPEC_KEY_B64URL}!!"),
            ..valid_passkey()
        };
        let reason = validate_passkey(&passkey).expect_err("rejected");
        assert!(!reason.contains("MIGHAgEA"), "{reason}");
        assert!(reason.contains("key"), "{reason}");
    }

    // -- build_export -------------------------------------------------------

    fn export_passkey(name: &str) -> ExportPasskey {
        ExportPasskey {
            name: name.to_string(),
            tags: vec!["work".to_string()],
            created_at_secs: 1_705_142_400,
            updated_at_secs: 1_705_228_800,
            rp_id: "webauthn.io".to_string(),
            credential_id: b"credentialIdExample".to_vec(),
            user_handle: decode_base64_urlsafe("cnEzaNHWcYK3coWZjvoaV1Hj9gnI12mKe2dL2HZVFlY")
                .expect("user handle decodes"),
            user_name: "johndoe".to_string(),
            user_display_name: "John Doe".to_string(),
            pkcs8_b64url: SPEC_KEY_B64URL.to_string(),
            sign_count: 0,
        }
    }

    #[test]
    fn export_roundtrip() {
        // Acceptance criterion 5: the export re-parses and re-validates.
        let outcome = build_export(&[export_passkey("WebAuthn.io")]).expect("export builds");
        assert_eq!(outcome.exported, 1);
        assert!(outcome.notes.is_empty());

        let header = parse_envelope(&outcome.json).expect("export re-parses");
        assert_eq!(header.version, CxfVersion { major: 1, minor: 0 });
        assert_eq!(header.exporter_rp_id, EXPORTER_RP_ID);
        assert_eq!(header.exporter_display_name, EXPORTER_DISPLAY_NAME);
        assert!(header.timestamp > 0, "timestamp is a real UNIX time");
        assert_eq!(header.accounts.len(), 1);

        let account = &header.accounts[0];
        assert_eq!(account.username, "", "no account concept");
        assert_eq!(account.email, "");
        assert!(account.full_name.is_none());
        assert!(account.collections.is_empty());
        assert_eq!(account.items.len(), 1);

        let item = &account.items[0];
        assert_eq!(item.title, "WebAuthn.io");
        assert_eq!(item.creation_at, Some(1_705_142_400));
        assert_eq!(item.modified_at, Some(1_705_228_800));
        assert_eq!(item.tags.as_deref(), Some(&["work".to_string()][..]));
        assert!(item.subtitle.is_none(), "subtitle is omitted on export");
        assert_eq!(item.id.len(), 22, "16 random bytes, base64url, unpadded");

        let credential = &item.credentials[0];
        let passkey: CxfPasskey = serde_json::from_value(credential.clone()).expect("shape");
        assert_eq!(passkey.key, SPEC_KEY_B64URL, "key is byte-identical");
        assert_eq!(passkey.rp_id, "webauthn.io");
        assert_eq!(passkey.username, "johndoe");
        assert_eq!(passkey.user_display_name, "John Doe");
        assert_eq!(passkey.credential_id, "Y3JlZGVudGlhbElkRXhhbXBsZQ");
        assert_eq!(
            passkey.user_handle,
            "cnEzaNHWcYK3coWZjvoaV1Hj9gnI12mKe2dL2HZVFlY"
        );
        assert!(passkey.fido2_extensions.is_none(), "never exported");

        let validated = validate_passkey(&passkey).expect("exported credential validates");
        assert_eq!(
            validated.pkcs8_der.as_slice(),
            decode_base64_urlsafe(SPEC_KEY_B64URL)
                .expect("decode")
                .as_slice()
        );
    }

    #[test]
    fn export_emits_exactly_the_spec_members() {
        // The export shape is a contract with other CXF importers: no extra
        // members, and the credential is tagged `type: "passkey"`.
        let outcome = build_export(&[export_passkey("WebAuthn.io")]).expect("export builds");
        let document: Value = serde_json::from_str(&outcome.json).expect("json");

        let mut header_keys: Vec<&str> = document
            .as_object()
            .expect("object")
            .keys()
            .map(String::as_str)
            .collect();
        header_keys.sort_unstable();
        assert_eq!(
            header_keys,
            vec![
                "accounts",
                "exporterDisplayName",
                "exporterRpId",
                "timestamp",
                "version"
            ]
        );

        let item = &document["accounts"][0]["items"][0];
        let mut item_keys: Vec<&str> = item
            .as_object()
            .expect("object")
            .keys()
            .map(String::as_str)
            .collect();
        item_keys.sort_unstable();
        assert_eq!(
            item_keys,
            vec![
                "creationAt",
                "credentials",
                "id",
                "modifiedAt",
                "tags",
                "title"
            ]
        );

        let credential = &item["credentials"][0];
        assert_eq!(credential["type"], json!("passkey"));
        let mut credential_keys: Vec<&str> = credential
            .as_object()
            .expect("object")
            .keys()
            .map(String::as_str)
            .collect();
        credential_keys.sort_unstable();
        assert_eq!(
            credential_keys,
            vec![
                "credentialId",
                "key",
                "rpId",
                "type",
                "userDisplayName",
                "userHandle",
                "username"
            ],
            "`key` (not `privateKey`), the `type` tag, and no extensions"
        );
    }

    #[test]
    fn export_excludes_nonzero_signcount() {
        // Acceptance criterion 5: a non-zero counter is excluded AND reported.
        let mut skipped = export_passkey("Counter set");
        skipped.sign_count = 1;
        let outcome = build_export(&[export_passkey("Kept"), skipped]).expect("export builds");

        assert_eq!(outcome.exported, 1);
        assert_eq!(outcome.notes.len(), 1, "{:?}", outcome.notes);
        assert!(
            outcome.notes[0].contains("Counter set"),
            "{:?}",
            outcome.notes
        );
        assert!(
            outcome.notes[0].contains(NONZERO_SIGNCOUNT_NOTE),
            "{:?}",
            outcome.notes
        );

        let header = parse_envelope(&outcome.json).expect("re-parses");
        assert_eq!(header.accounts[0].items.len(), 1);
        assert_eq!(header.accounts[0].items[0].title, "Kept");
    }

    #[test]
    fn export_of_nothing_is_a_valid_empty_envelope() {
        let outcome = build_export(&[]).expect("empty export builds");
        assert_eq!(outcome.exported, 0);
        assert!(outcome.notes.is_empty());

        let header = parse_envelope(&outcome.json).expect("re-parses");
        assert_eq!(header.accounts.len(), 1);
        assert!(header.accounts[0].items.is_empty());
    }

    #[test]
    fn export_ids_are_random_per_document() {
        let first = build_export(&[export_passkey("A")]).expect("export");
        let second = build_export(&[export_passkey("A")]).expect("export");
        let first_doc: Value = serde_json::from_str(&first.json).expect("json");
        let second_doc: Value = serde_json::from_str(&second.json).expect("json");
        assert_ne!(
            first_doc["accounts"][0]["id"],
            second_doc["accounts"][0]["id"]
        );
        assert_ne!(
            first_doc["accounts"][0]["items"][0]["id"],
            second_doc["accounts"][0]["items"][0]["id"]
        );
    }

    #[test]
    fn export_passkey_projects_a_disk_entry() {
        let created = Utc.timestamp_opt(1_705_142_400, 0).single().expect("time");
        let updated = Utc.timestamp_opt(1_705_228_800, 0).single().expect("time");
        let der = decode_base64_urlsafe(SPEC_KEY_B64URL).expect("decode");
        let entry = Entry::Passkey {
            id: uuid::Uuid::nil(),
            name: "WebAuthn.io".to_string(),
            created_at: created,
            updated_at: updated,
            tags: vec!["work".to_string()],
            rp_id: "webauthn.io".to_string(),
            rp_name: "webauthn.io".to_string(),
            credential_id: b"credentialIdExample".to_vec(),
            user_handle: vec![0x01, 0x02],
            user_name: "johndoe".to_string(),
            user_display_name: "John Doe".to_string(),
            private_key: SecretPkcs8::from_pkcs8_der(&der),
            algorithm: ALG_ES256,
            sign_count: 0,
            discoverable: true,
            transports: vec!["internal".to_string()],
            aaguid: uuid::Uuid::nil(),
        };

        let projected = ExportPasskey::from_entry(&entry).expect("passkeys project");
        assert_eq!(projected.name, "WebAuthn.io");
        assert_eq!(projected.created_at_secs, 1_705_142_400);
        assert_eq!(projected.updated_at_secs, 1_705_228_800);
        assert_eq!(projected.pkcs8_b64url, SPEC_KEY_B64URL);
        assert_eq!(projected.sign_count, 0);

        // Non-passkey entries are not exported.
        let group = Entry::Group {
            id: uuid::Uuid::nil(),
            name: "Root".to_string(),
            data_type: "group".to_string(),
            children: Vec::new(),
        };
        assert!(ExportPasskey::from_entry(&group).is_none());
    }

    #[test]
    fn secret_from_validated_matches_the_fixture_key() {
        let validated = validate_passkey(&valid_passkey()).expect("validates");
        let secret = secret_from_validated(&validated);
        assert_eq!(secret.as_b64url(), SPEC_KEY_B64URL);
        assert_eq!(
            secret.to_pkcs8_der().expect("decodes").as_slice(),
            validated.pkcs8_der.as_slice()
        );
    }

    #[test]
    fn imported_algorithm_is_es256() {
        assert_eq!(IMPORTED_ALGORITHM, -7);
        assert_eq!(IMPORTED_ALGORITHM, ALG_ES256);
    }

    // -- negative controls --------------------------------------------------
    //
    // These prove the suite can go red. Each one mutates the *production* input
    // in the smallest way that a real bug would produce, and asserts the
    // specific test above would fail.

    /// Negative control for `validate_spec_example_key`: mutating the last
    /// base64url character of the key must break validation.
    ///
    /// The last character of the fixture encodes the final 4 bits of the DER
    /// document; flipping it keeps the string valid base64url of the same length
    /// but changes the DER bytes, so the PKCS#8 parse fails.
    #[test]
    fn negative_control_mutated_key_tail_fails_validation() {
        let mut mutated = valid_passkey();
        let last = mutated.key.pop().expect("key is not empty");
        let replacement = if last == 'A' { 'B' } else { 'A' };
        mutated.key.push(replacement);
        assert_ne!(mutated.key, SPEC_KEY_B64URL);

        let err = validate_passkey(&mutated).expect_err("mutated key must be rejected");
        assert_eq!(err, "private key is not a valid P-256 PKCS#8 key");

        // And the unmutated key still validates, so the failure is the mutation.
        validate_passkey(&valid_passkey()).expect("the pristine key still validates");
    }

    /// Negative control for `export_roundtrip`: a credential whose `key` was
    /// swapped for a different (valid) P-256 key must not round-trip as the
    /// fixture key — the `key` assertion in `export_roundtrip` is load-bearing.
    #[test]
    fn negative_control_export_key_substitution_is_detected() {
        let other_key = {
            let key = crate::passkey::es256::generate_signing_key().expect("generate");
            let der = crate::passkey::es256::signing_key_to_pkcs8_der(&key).expect("encode");
            encode_base64_urlsafe(&der)
        };
        assert_ne!(other_key, SPEC_KEY_B64URL);

        let mut passkey = export_passkey("WebAuthn.io");
        passkey.pkcs8_b64url = other_key.clone();
        let outcome = build_export(&[passkey]).expect("export builds");
        let header = parse_envelope(&outcome.json).expect("re-parses");
        let exported: CxfPasskey =
            serde_json::from_value(header.accounts[0].items[0].credentials[0].clone())
                .expect("shape");
        assert_eq!(exported.key, other_key);
        assert_ne!(
            exported.key, SPEC_KEY_B64URL,
            "a substituted key must not compare equal to the fixture key"
        );
    }

    /// Negative control for `non_passkey_skipped_with_type`: dropping the
    /// `type` member must change the reported type, proving the report reads the
    /// real member instead of hard-coding a value.
    #[test]
    fn negative_control_missing_type_changes_the_report() {
        let header = parse_envelope(FIXTURE_SPEC_APPENDIX_A).expect("fixture parses");
        let mut document = serde_json::to_value(&header).expect("serializes");
        let basic_auth = document["accounts"][0]["items"][1]["credentials"][0]
            .as_object_mut()
            .expect("object");
        basic_auth.remove("type");

        let mutated: CxfHeader = serde_json::from_value(document).expect("still parses");
        let skips = collect_skips(&mutated);
        assert_eq!(skips[0].1, MISSING_CREDENTIAL_TYPE);
        assert_eq!(skips[0].2, "missing or malformed field: type");
        // The pristine fixture reports the real type.
        assert_eq!(collect_skips(&header)[0].1, "basic-auth");
    }
}
