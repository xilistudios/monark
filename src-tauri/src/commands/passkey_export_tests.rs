//! End-to-end tests of the CXF export command (T17).
//!
//! Every test drives the real command body ([`export_cxf_with`]) against a
//! **real local vault file** in a temp dir: no mocked crypto, no mocked vault,
//! no mocked storage manager. The exported document is then re-parsed with the
//! T15 parser and each credential re-validated with the T15 validator, and the
//! `key` member is compared against the PKCS#8 blob that is actually on disk
//! (read through the decryption seam, not through the export), so a
//! re-encoding or truncation bug cannot hide behind its own output.
//!
//! The negative controls at the bottom prove the two properties that matter
//! most here can fail: the **consent gate fires before any IO** (a wrong
//! password cannot mask it, and neither can a bogus path) and the export is
//! **read-only** (the vault file is byte-identical afterwards and no file is
//! created next to it).

use super::*;
use crate::commands::passkey::{passkey_create_with, CREDENTIAL_ID_LEN};
use crate::crypto::base64::{decode_base64_urlsafe, encode_base64_urlsafe};
use crate::models::{Entry, SecretPkcs8, Vault};
use crate::passkey::cxf::{
    build_export, parse_envelope, validate_credential, EXPORTER_DISPLAY_NAME, EXPORTER_RP_ID,
    PASSKEY_CREDENTIAL_TYPE,
};
use crate::passkey::es256::{generate_signing_key, signing_key_to_pkcs8_der, ALG_ES256};
use crate::passkey::store::load_vault;
use crate::passkey::types::{
    AuthenticatorSelection, PasskeyCreateRequest, PubKeyCredParam, RpEntity, UserEntity,
};
use crate::storage::{StorageConfig, StorageManager};
use crate::vault::rate_limit;
use chrono::{DateTime, Utc};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tempfile::TempDir;
use uuid::Uuid;
use zeroize::Zeroizing;

const PASSWORD: &str = "t17-export-password";
const WRONG_PASSWORD: &str = "t17-not-the-password";
const RP_ID: &str = "example.com";
const RP_NAME: &str = "Example";
const ORIGIN: &str = "https://example.com";
/// Fixed 32-byte challenge (0x11 repeated) in base64url.
const CHALLENGE_B64: &str = "ERERERERERERERERERERERERERERERERERERERERERE";
/// Fixed 4-byte user handle (`AQIDBA` = 0x01 0x02 0x03 0x04).
const USER_HANDLE_B64: &str = "AQIDBA";
/// Published CXF Appendix A example key (PKCS#8 DER, base64url) — the same
/// non-secret vector T15 pins; used to seed a passkey without a ceremony.
const SPEC_KEY_B64URL: &str = "MIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQgARu_0sCt20EpgVxb4Puq3Ga5VVLpuTY75ngvZlyq3X6hRANCAASmdk1xLsK0oOlhxIPp0d1ZuS0sT9nf6BZtSelhqvLBW0fOL33l_bXgsr_STUHjCLn8l6gcRJwe7OQvbQubZ1dY";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

fn fixed_time() -> DateTime<Utc> {
    DateTime::parse_from_rfc3339("2026-01-02T03:04:05Z")
        .expect("fixed timestamp parses")
        .with_timezone(&Utc)
}

/// A valid registration request, matching the shape the frontend forwards.
fn create_request(user_name: &str) -> PasskeyCreateRequest {
    PasskeyCreateRequest {
        rp: RpEntity {
            id: RP_ID.to_string(),
            name: RP_NAME.to_string(),
        },
        user: UserEntity {
            id: USER_HANDLE_B64.to_string(),
            name: user_name.to_string(),
            display_name: format!("{user_name} Display"),
        },
        challenge: CHALLENGE_B64.to_string(),
        origin: ORIGIN.to_string(),
        pub_key_cred_params: vec![PubKeyCredParam {
            type_: crate::passkey::types::PUBLIC_KEY_TYPE.to_string(),
            alg: ALG_ES256,
        }],
        authenticator_selection: Some(AuthenticatorSelection {
            resident_key: Some("required".to_string()),
            user_verification: Some("required".to_string()),
            authenticator_attachment: Some("platform".to_string()),
        }),
        exclude_credentials: None,
        attestation: Some("none".to_string()),
    }
}

fn data_entry(name: &str) -> Entry {
    Entry::Data {
        id: Uuid::new_v4(),
        name: name.to_string(),
        data_type: "login".to_string(),
        created_at: fixed_time(),
        updated_at: fixed_time(),
        fields: Vec::new(),
        tags: Vec::new(),
    }
}

fn group_entry(name: &str, children: Vec<Entry>) -> Entry {
    Entry::Group {
        id: Uuid::new_v4(),
        name: name.to_string(),
        data_type: "group".to_string(),
        children,
    }
}

/// A passkey entry built from the published vector key (no ceremony needed).
fn seeded_passkey(name: &str, rp_id: &str, credential_id: &[u8]) -> Entry {
    let der = decode_base64_urlsafe(SPEC_KEY_B64URL).expect("vector key is base64url");
    seeded_passkey_with_key(name, rp_id, credential_id, &der, 0)
}

/// A passkey entry with a **freshly generated** P-256 key (no ceremony needed).
///
/// Used by the multi-passkey fixture so every item carries its own key: reusing
/// one PKCS#8 blob for all of them would make the "one item per passkey, with
/// its own key" assertion vacuous.
fn seeded_passkey_with_fresh_key(name: &str, rp_id: &str, credential_id: &[u8]) -> Entry {
    let key = generate_signing_key().expect("fresh signing key");
    let der = Zeroizing::new(signing_key_to_pkcs8_der(&key).expect("key encodes as PKCS#8"));
    seeded_passkey_with_key(name, rp_id, credential_id, &der, 0)
}

/// A passkey entry with an explicit PKCS#8 DER and signature counter.
///
/// `sign_count != 0` cannot be produced by this build (ruling Q15): it is the
/// shape of a credential read from a **foreign** vault, which is exactly what
/// the fail-closed guard has to handle.
fn seeded_passkey_with_key(
    name: &str,
    rp_id: &str,
    credential_id: &[u8],
    pkcs8_der: &[u8],
    sign_count: u32,
) -> Entry {
    Entry::Passkey {
        id: Uuid::new_v4(),
        name: name.to_string(),
        created_at: fixed_time(),
        updated_at: fixed_time(),
        tags: vec!["work".to_string()],
        rp_id: rp_id.to_string(),
        rp_name: rp_id.to_string(),
        credential_id: credential_id.to_vec(),
        user_handle: vec![0x01, 0x02, 0x03, 0x04],
        user_name: format!("{name}-user"),
        user_display_name: format!("{name} User"),
        private_key: SecretPkcs8::from_pkcs8_der(pkcs8_der),
        algorithm: ALG_ES256,
        sign_count,
        discoverable: true,
        transports: vec!["internal".to_string()],
        aaguid: Uuid::nil(),
    }
}

/// Writes a vault straight to disk, the way the app creates one: fresh master
/// key wrapped under [`PASSWORD`], format `1.0` (the version policy only bumps
/// on a *write*, and export never writes).
fn seed_vault(dir: &TempDir, name: &str, entries: Vec<Entry>) -> PathBuf {
    let path = dir.path().join(name);
    let vault = Vault {
        updated_at: fixed_time(),
        hmac: String::new(),
        entries,
    };
    let (argon2_params, credentials, master_key) =
        crate::vault::keys::create_key_material(PASSWORD).expect("seed key material");
    let encrypted =
        crate::vault::keys::encrypt_vault_content(&master_key, &vault).expect("seed encrypt");
    let vault_file = crate::models::VaultFile {
        version: "1.0".to_string(),
        argon2_params,
        credentials,
        vault: encrypted,
    };
    crate::io::vault::write_vault(path.to_string_lossy().to_string(), &vault_file)
        .expect("seed vault");
    path
}

fn local_ref(path: &Path) -> VaultRef {
    VaultRef::Local {
        file_path: path.to_string_lossy().to_string(),
    }
}

/// A hermetic storage manager backed by a temp directory (no network).
async fn local_manager(base: &TempDir) -> Arc<StorageManager> {
    let config = StorageConfig::new_local(base.path().to_string_lossy().to_string());
    Arc::new(
        StorageManager::new(config)
            .await
            .expect("local storage manager builds"),
    )
}

/// A seeded vault plus the manager that can open it.
async fn seeded(entries: Vec<Entry>) -> (TempDir, PathBuf, Arc<StorageManager>) {
    let dir = TempDir::new().expect("temp dir");
    let path = seed_vault(&dir, "export.monark", entries);
    let manager = local_manager(&dir).await;
    (dir, path, manager)
}

/// The stored PKCS#8 DER of a passkey entry, as a `Zeroizing` buffer.
fn stored_pkcs8(entry: &Entry) -> Zeroizing<Vec<u8>> {
    match entry {
        Entry::Passkey { private_key, .. } => private_key.to_pkcs8_der().expect("key decodes"),
        other => panic!("expected a passkey, got {other:?}"),
    }
}

/// The stored tags of a passkey entry.
fn stored_tags(entry: &Entry) -> Vec<String> {
    match entry {
        Entry::Passkey { tags, .. } => tags.clone(),
        other => panic!("expected a passkey, got {other:?}"),
    }
}

/// The stored `created_at` of a passkey entry, as UNIX seconds.
fn stored_created_at(entry: &Entry) -> u64 {
    match entry {
        Entry::Passkey { created_at, .. } => unix_secs_for_test(created_at),
        other => panic!("expected a passkey, got {other:?}"),
    }
}

/// The stored `updated_at` of a passkey entry, as UNIX seconds.
fn stored_updated_at(entry: &Entry) -> u64 {
    match entry {
        Entry::Passkey { updated_at, .. } => unix_secs_for_test(updated_at),
        other => panic!("expected a passkey, got {other:?}"),
    }
}

/// `DateTime<Utc>` → UNIX seconds, the same conversion the CXF writer uses.
fn unix_secs_for_test(at: &DateTime<Utc>) -> u64 {
    u64::try_from(at.timestamp()).expect("the fixture timestamp is post-epoch")
}

/// Every passkey entry of a fixture tree, depth first (fixture-side mirror of
/// the production traversal, used to read the expected values from the input).
fn passkeys_of(entry: &Entry) -> Vec<&Entry> {
    match entry {
        Entry::Passkey { .. } => vec![entry],
        Entry::Group { children, .. } => children.iter().flat_map(passkeys_of).collect(),
        Entry::Data { .. } => Vec::new(),
    }
}

/// The sorted file names of a directory (used to prove the export creates no
/// file next to the vault).
fn dir_listing(dir: &Path) -> Vec<String> {
    let mut names: Vec<String> = std::fs::read_dir(dir)
        .expect("directory is readable")
        .map(|entry| {
            entry
                .expect("directory entry is readable")
                .file_name()
                .to_string_lossy()
                .to_string()
        })
        .collect();
    names.sort();
    names
}

/// Creates a passkey through the real T09 ceremony, returning its response.
async fn create_passkey(
    target: &VaultRef,
    manager: &Arc<StorageManager>,
    user_name: &str,
) -> crate::passkey::types::PasskeyCreateResponse {
    passkey_create_with(target, PASSWORD, create_request(user_name), manager)
        .await
        .expect("the registration ceremony succeeds")
}

// ---------------------------------------------------------------------------
// Criterion 1 — consent is required, and it is checked before any IO
// ---------------------------------------------------------------------------

/// Criterion 1: `consent: false` is refused with a fixed `Validation` error.
#[tokio::test]
async fn export_cxf_requires_consent() -> Result<(), CommandError> {
    let (_dir, path, manager) = seeded(vec![seeded_passkey("GitHub", "github.com", &[0xaa])]).await;
    let target = local_ref(&path);
    let before = std::fs::read(&path).expect("vault file readable");

    match export_cxf_with(&target, PASSWORD, false, &manager).await {
        Err(CommandError::Validation(message)) => {
            assert_eq!(message, CONSENT_REQUIRED_MESSAGE);
        }
        Err(other) => panic!("expected a validation error, got {other:?}"),
        Ok(json) => panic!("an export without consent must not produce a document: {json}"),
    }

    // Nothing was written either (the command has no write path at all).
    let after = std::fs::read(&path).expect("vault file readable");
    assert_eq!(before, after, "a refused export must not touch the vault");
    Ok(())
}

/// Criterion 1 (negative control of ordering): with a **wrong password**, the
/// consent error still wins. If the consent check moved below the unlock, this
/// test would observe the password error instead — and the rate limiter would
/// have recorded a failure, which the last assertion pins.
#[tokio::test]
async fn export_cxf_consent_is_checked_before_any_io() -> Result<(), CommandError> {
    let (_dir, path, manager) = seeded(vec![seeded_passkey("GitHub", "github.com", &[0xaa])]).await;
    let target = local_ref(&path);
    // A canonical path is what the rate limiter keys on; start from a clean state.
    let canonical = std::fs::canonicalize(&path).expect("vault path canonicalizes");
    let canonical_str = canonical.to_string_lossy().to_string();
    rate_limit::reset_attempts(&canonical_str);
    assert_eq!(rate_limit::failure_count(&canonical_str), 0);

    // Wrong password AND no consent: consent must fire first.
    match export_cxf_with(&target, WRONG_PASSWORD, false, &manager).await {
        Err(CommandError::Validation(message)) => {
            assert_eq!(
                message, CONSENT_REQUIRED_MESSAGE,
                "the consent error must not be masked by the password error"
            );
        }
        Err(other) => panic!("expected the consent validation error, got {other:?}"),
        Ok(json) => panic!("an export without consent must not produce a document: {json}"),
    }

    // Proof that the vault was never opened: no failed attempt was recorded for
    // this vault (the unlock path is the only recorder).
    assert_eq!(
        rate_limit::failure_count(&canonical_str),
        0,
        "a refused export must not consume a rate-limit slot"
    );
    Ok(())
}

/// Criterion 1 (negative control of ordering, MENOR-2): the consent gate also
/// wins over **path validation / existence checks**.
///
/// The vault reference points at a file that does not exist. If any
/// `validate_vault_path` / existence check / file read ran above the consent
/// gate, this call would return `NotFound` or an "invalid file type" error
/// instead; observing the consent error is what pins "consent before **any**
/// IO" — the wrong-password control alone cannot, because both of its
/// observables are produced *inside* the unlock.
#[tokio::test]
async fn export_cxf_consent_is_checked_before_path_validation() -> Result<(), CommandError> {
    let (dir, _path, manager) = seeded(Vec::new()).await;
    let bogus = dir.path().join("does-not-exist.monark");
    assert!(!bogus.exists(), "the fixture path must not exist");
    let target = local_ref(&bogus);
    // The rate limiter keys on the canonicalized path; the parent exists, so
    // this is the key an unlock attempt would use.
    let canonical_str = std::fs::canonicalize(dir.path())
        .expect("the temp dir canonicalizes")
        .join("does-not-exist.monark")
        .to_string_lossy()
        .to_string();
    rate_limit::reset_attempts(&canonical_str);

    // (a) A missing `.monark` file: a path/existence check would answer here.
    match export_cxf_with(&target, PASSWORD, false, &manager).await {
        Err(CommandError::Validation(message)) => {
            assert_eq!(
                message, CONSENT_REQUIRED_MESSAGE,
                "the consent error must not be masked by a path/existence error"
            );
        }
        Err(other) => panic!("expected the consent validation error, got {other:?}"),
        Ok(json) => panic!("an export without consent must not produce a document: {json}"),
    }

    // (b) A path that is not even a vault file (wrong extension): the path
    // validator would reject it with "Invalid file type". Consent still wins,
    // which pins that the gate precedes the extension check too.
    let wrong_extension = dir.path().join("not-a-vault.txt");
    std::fs::write(&wrong_extension, b"not a vault").expect("fixture file is writable");
    match export_cxf_with(&local_ref(&wrong_extension), PASSWORD, false, &manager).await {
        Err(CommandError::Validation(message)) => {
            assert_eq!(
                message, CONSENT_REQUIRED_MESSAGE,
                "the consent error must not be masked by the file-type check"
            );
        }
        Err(other) => panic!("expected the consent validation error, got {other:?}"),
        Ok(json) => panic!("an export without consent must not produce a document: {json}"),
    }

    // No unlock was attempted either: nothing was recorded for that path.
    assert_eq!(
        rate_limit::failure_count(&canonical_str),
        0,
        "a refused export must not consume a rate-limit slot"
    );
    Ok(())
}

// ---------------------------------------------------------------------------
// Criterion 2 — roundtrip against a passkey created by the real ceremony
// ---------------------------------------------------------------------------

/// Criterion 2: a passkey created through `passkey_create` exports to a
/// document that re-parses, re-validates, and whose `key` is byte-equal to the
/// PKCS#8 blob on disk.
#[tokio::test]
async fn export_cxf_roundtrip_reparses_and_validates() -> Result<(), CommandError> {
    let (_dir, path, manager) = seeded(Vec::new()).await;
    let target = local_ref(&path);

    let created = create_passkey(&target, &manager, "alice").await;

    // The stored entry, read through the decryption seam (not through the
    // export): this is the source of truth the export must match.
    let loaded = load_vault(&target, PASSWORD, &manager).await?;
    let stored = loaded
        .vault
        .entries
        .iter()
        .find(|entry| matches!(entry, Entry::Passkey { .. }))
        .expect("the ceremony stored a passkey");
    let stored_der = stored_pkcs8(stored);
    let stored_tags = stored_tags(stored);
    let stored_created_at = stored_created_at(stored);
    let stored_updated_at = stored_updated_at(stored);

    let json = export_cxf_with(&target, PASSWORD, true, &manager).await?;

    // --- Envelope. ---
    let header = parse_envelope(&json)?;
    assert_eq!(header.exporter_rp_id, EXPORTER_RP_ID);
    assert_eq!(header.exporter_rp_id, "monark.app");
    assert_eq!(header.exporter_display_name, EXPORTER_DISPLAY_NAME);
    assert_eq!(header.version.major, 1);
    assert_eq!(header.version.minor, 0);
    assert!(header.timestamp > 0, "the timestamp must be numeric");
    assert_eq!(header.accounts.len(), 1, "exactly one account");
    let account = &header.accounts[0];
    assert_eq!(account.items.len(), 1, "one item per passkey");
    let item = &account.items[0];
    assert_eq!(item.title, "alice", "item title is the entry name");
    assert_eq!(
        item.tags.as_deref(),
        Some(stored_tags.as_slice()),
        "the entry tags are carried over verbatim"
    );
    // Exact values, not just presence: the mapping is entry → item, and a
    // `Some(0)` / swapped-field bug must not pass.
    assert_eq!(
        item.creation_at,
        Some(stored_created_at),
        "creationAt is the entry's created_at in UNIX seconds"
    );
    assert_eq!(
        item.modified_at,
        Some(stored_updated_at),
        "modifiedAt is the entry's updated_at in UNIX seconds"
    );
    assert_eq!(item.credentials.len(), 1);

    // --- Credential: re-validated by the T15 validator. ---
    let (credential_type, validated) = validate_credential(&item.credentials[0]);
    assert_eq!(credential_type, PASSKEY_CREDENTIAL_TYPE);
    let validated = validated.expect("the exported credential must validate");

    assert_eq!(validated.rp_id, RP_ID);
    assert_eq!(validated.user_name, "alice");
    assert_eq!(validated.user_display_name, "alice Display");
    assert_eq!(validated.user_handle, vec![0x01, 0x02, 0x03, 0x04]);
    assert_eq!(
        validated.credential_id,
        decode_base64_urlsafe(&created.id).expect("credential id is base64url")
    );
    assert_eq!(validated.credential_id.len(), CREDENTIAL_ID_LEN);
    // The key is the stored PKCS#8 blob, byte for byte.
    assert_eq!(
        validated.pkcs8_der.as_slice(),
        stored_der.as_slice(),
        "the exported key must be the stored PKCS#8 DER"
    );
    assert!(
        !validated.extensions_present,
        "extensions are never exported"
    );

    // --- Raw members: the acronyms/casing the spec requires. ---
    let raw = &item.credentials[0];
    assert_eq!(raw["type"], "passkey");
    assert_eq!(raw["rpId"], RP_ID);
    assert_eq!(raw["credentialId"], created.id);
    assert_eq!(raw["userHandle"], USER_HANDLE_B64);
    assert_eq!(
        raw["key"],
        encode_base64_urlsafe(&stored_der),
        "the `key` member is the base64url PKCS#8 string"
    );
    assert!(
        raw.get("privateKey").is_none(),
        "CXF carries the key in `key`, never `privateKey`"
    );
    assert!(
        raw.get("fido2Extensions").is_none(),
        "extensions are not exported"
    );
    Ok(())
}

/// Criterion 2 (invariant pin, ruling E15): a vault produced by this build
/// exports with **zero** notes — `sign_count` is structurally `0` in F0/F1, so
/// `build_export` never excludes anything and the command can keep returning
/// the bare JSON string.
#[tokio::test]
async fn export_cxf_produces_no_notes_for_system_vaults() -> Result<(), CommandError> {
    let (_dir, path, manager) = seeded(Vec::new()).await;
    let target = local_ref(&path);
    create_passkey(&target, &manager, "alice").await;

    let loaded = load_vault(&target, PASSWORD, &manager).await?;
    let passkeys = collect_export_passkeys(&loaded.vault.entries);
    assert_eq!(passkeys.len(), 1);
    assert!(
        passkeys.iter().all(|passkey| passkey.sign_count == 0),
        "the registration ceremony stores sign_count 0"
    );

    let outcome = build_export(&passkeys)?;
    assert_eq!(outcome.exported, 1);
    assert!(
        outcome.notes.is_empty(),
        "F0/F1 vaults must export without notes, got {:?}",
        outcome.notes
    );
    Ok(())
}

// ---------------------------------------------------------------------------
// Fail closed (MENOR-1) — a partial export is refused, never returned
// ---------------------------------------------------------------------------

/// MENOR-1: a vault carrying a passkey with a **non-zero signature counter**
/// (only possible in a vault written by another build/version — Monark reads
/// 1.0 and 1.1 files) makes the export **fail**, instead of returning a
/// document that silently lost that credential.
///
/// The complement is `export_cxf_sign_count_zero_exports_normally` below: the
/// same fixture with `sign_count == 0` exports fine, so the refusal is the
/// counter's and not the fixture's.
#[tokio::test]
async fn export_cxf_refuses_partial_export_when_a_counter_is_nonzero() -> Result<(), CommandError> {
    let der = decode_base64_urlsafe(SPEC_KEY_B64URL).expect("vector key is base64url");
    let entries = vec![
        seeded_passkey_with_key("Counting passkey", "counting.example", &[0x0a], &der, 7),
        seeded_passkey("Clean passkey", "clean.example", &[0x0b]),
    ];
    let (_dir, path, manager) = seeded(entries).await;
    let target = local_ref(&path);

    // The fixture really is what the guard is about: `build_export` on its own
    // would drop the counting passkey and note it.
    let loaded = load_vault(&target, PASSWORD, &manager).await?;
    let passkeys = collect_export_passkeys(&loaded.vault.entries);
    assert_eq!(passkeys.len(), 2);
    let outcome = build_export(&passkeys)?;
    assert_eq!(outcome.exported, 1, "the counting passkey is excluded");
    assert_eq!(outcome.notes.len(), 1, "…and reported through notes");

    // The command must refuse rather than hand back that partial document.
    match export_cxf_with(&target, PASSWORD, true, &manager).await {
        Err(CommandError::Validation(message)) => {
            assert_eq!(message, PARTIAL_EXPORT_MESSAGE);
            // The fixed message never echoes the entry name, the key or the
            // document content.
            assert!(!message.contains("Counting passkey"), "got: {message}");
            assert!(!message.contains(SPEC_KEY_B64URL), "got: {message}");
            assert!(!message.contains(PASSWORD), "got: {message}");
        }
        Err(other) => panic!("expected the fail-closed validation error, got {other:?}"),
        Ok(json) => panic!(
            "a partial export must never be returned as a document ({} bytes)",
            json.len()
        ),
    }
    Ok(())
}

/// MENOR-1 (complement): the same fixture with `sign_count == 0` exports
/// normally — the refusal above is caused by the counter, not by the shape of
/// the seeded vault.
#[tokio::test]
async fn export_cxf_sign_count_zero_exports_normally() -> Result<(), CommandError> {
    let der = decode_base64_urlsafe(SPEC_KEY_B64URL).expect("vector key is base64url");
    let entries = vec![
        seeded_passkey_with_key("Counting passkey", "counting.example", &[0x0a], &der, 0),
        seeded_passkey("Clean passkey", "clean.example", &[0x0b]),
    ];
    let (_dir, path, manager) = seeded(entries).await;
    let target = local_ref(&path);

    let json = export_cxf_with(&target, PASSWORD, true, &manager).await?;
    let header = parse_envelope(&json)?;
    let titles: Vec<&str> = header.accounts[0]
        .items
        .iter()
        .map(|item| item.title.as_str())
        .collect();
    assert_eq!(
        titles,
        vec!["Counting passkey", "Clean passkey"],
        "both passkeys are exported when no counter is non-zero"
    );
    Ok(())
}

// ---------------------------------------------------------------------------
// Criterion 3 — no key material in errors or logs
// ---------------------------------------------------------------------------

/// Criterion 3: every error this module **originates** is fixed text — it
/// cannot carry vault content, a path, a password or key material.
///
/// Two cases, because they are the two strings the module owns: the consent
/// rejection and the fail-closed rejection (MENOR-1). The latter is the
/// interesting one: `build_export`'s notes *do* carry entry names, so the test
/// proves they are not forwarded.
#[tokio::test]
async fn export_cxf_error_messages_carry_no_secret() -> Result<(), CommandError> {
    let (_dir, path, manager) = seeded(vec![seeded_passkey("GitHub", "github.com", &[0xaa])]).await;
    let target = local_ref(&path);

    let error = export_cxf_with(&target, PASSWORD, false, &manager)
        .await
        .expect_err("consent is required");
    let rendered = error.to_string();
    assert_eq!(
        rendered,
        format!("Validation Error: {CONSENT_REQUIRED_MESSAGE}")
    );
    assert!(!rendered.contains(SPEC_KEY_B64URL));
    assert!(!rendered.contains(PASSWORD));
    assert!(!rendered.contains("export.monark"));

    // The fail-closed rejection: same guarantees, and the excluded entry's name
    // (which the note carries) must not leak into the message.
    let der = decode_base64_urlsafe(SPEC_KEY_B64URL).expect("vector key is base64url");
    let (_dir2, path2, manager2) = seeded(vec![seeded_passkey_with_key(
        "Secret entry name",
        "counting.example",
        &[0x0a],
        &der,
        3,
    )])
    .await;
    let error = export_cxf_with(&local_ref(&path2), PASSWORD, true, &manager2)
        .await
        .expect_err("a partial export is refused");
    let rendered = error.to_string();
    assert_eq!(
        rendered,
        format!("Validation Error: {PARTIAL_EXPORT_MESSAGE}")
    );
    assert!(!rendered.contains("Secret entry name"), "got: {rendered}");
    assert!(!rendered.contains(SPEC_KEY_B64URL), "got: {rendered}");
    assert!(!rendered.contains(PASSWORD), "got: {rendered}");
    Ok(())
}

// ---------------------------------------------------------------------------
// Criterion 4 — empty vault (and non-passkey content) → valid empty envelope
// ---------------------------------------------------------------------------

/// Criterion 4: a vault with no passkeys exports a valid, empty document.
#[tokio::test]
async fn export_cxf_empty_vault() -> Result<(), CommandError> {
    let (_dir, path, manager) = seeded(Vec::new()).await;
    let target = local_ref(&path);

    let json = export_cxf_with(&target, PASSWORD, true, &manager).await?;

    let header = parse_envelope(&json)?;
    assert_eq!(header.accounts.len(), 1);
    assert!(
        header.accounts[0].items.is_empty(),
        "an empty vault exports zero items"
    );
    assert_eq!(header.exporter_rp_id, EXPORTER_RP_ID);
    Ok(())
}

/// Criterion 4: data entries and groups (including empty groups) never produce
/// an item, and a group-only vault is still a valid empty envelope.
#[tokio::test]
async fn export_cxf_ignores_non_passkey_entries() -> Result<(), CommandError> {
    let entries = vec![
        data_entry("Login"),
        group_entry("Empty group", Vec::new()),
        group_entry("Nested data", vec![data_entry("Deep login")]),
    ];
    let (_dir, path, manager) = seeded(entries).await;
    let target = local_ref(&path);

    let json = export_cxf_with(&target, PASSWORD, true, &manager).await?;

    let header = parse_envelope(&json)?;
    assert_eq!(header.accounts.len(), 1);
    assert!(header.accounts[0].items.is_empty());
    Ok(())
}

// ---------------------------------------------------------------------------
// Criterion 5 — wrong password is rate-limited
// ---------------------------------------------------------------------------

/// Criterion 5: with consent given, a wrong password goes through the seam and
/// is rate-limited exactly like every other vault unlock.
#[tokio::test]
async fn export_cxf_wrong_password() -> Result<(), CommandError> {
    let (_dir, path, manager) = seeded(vec![seeded_passkey("GitHub", "github.com", &[0xaa])]).await;
    let target = local_ref(&path);
    let canonical = std::fs::canonicalize(&path).expect("vault path canonicalizes");
    let canonical_str = canonical.to_string_lossy().to_string();
    rate_limit::reset_attempts(&canonical_str);

    // The limiter allows MAX_FREE_ATTEMPTS (3) failures before imposing a delay.
    for _ in 0..4 {
        assert!(
            export_cxf_with(&target, WRONG_PASSWORD, true, &manager)
                .await
                .is_err(),
            "a wrong password must never export"
        );
    }
    match export_cxf_with(&target, WRONG_PASSWORD, true, &manager).await {
        Err(CommandError::Validation(message)) => {
            assert!(
                message.contains("Too many failed attempts"),
                "got: {message}"
            );
        }
        Err(other) => panic!("expected a rate-limit error, got {other:?}"),
        Ok(json) => panic!("a rate-limited attempt must not export: {json}"),
    }

    // The correct password still works afterwards (the limiter is not a lock).
    rate_limit::reset_attempts(&canonical_str);
    let json = export_cxf_with(&target, PASSWORD, true, &manager).await?;
    assert_eq!(parse_envelope(&json)?.accounts[0].items.len(), 1);
    Ok(())
}

// ---------------------------------------------------------------------------
// Criterion 6 — multi-passkey, nested in groups
// ---------------------------------------------------------------------------

/// Criterion 6: every passkey of the tree is exported once, at any depth, with
/// its own item **and its own key**.
#[tokio::test]
async fn export_cxf_multi_passkey_items() -> Result<(), CommandError> {
    // One freshly generated P-256 key per passkey: sharing a single PKCS#8 blob
    // would make the per-item key assertion vacuous.
    let entries = vec![
        seeded_passkey_with_fresh_key("Root passkey", "root.example", &[0x01]),
        data_entry("A login"),
        group_entry(
            "Work",
            vec![
                seeded_passkey_with_fresh_key("Nested passkey", "nested.example", &[0x02]),
                group_entry(
                    "Deeper",
                    vec![
                        seeded_passkey_with_fresh_key("Deep passkey", "deep.example", &[0x03]),
                        data_entry("Deep login"),
                    ],
                ),
            ],
        ),
    ];
    // The keys the export must reproduce, read from the fixture entries (not
    // from the export's own output).
    let expected_keys: Vec<Zeroizing<Vec<u8>>> = entries
        .iter()
        .flat_map(passkeys_of)
        .map(stored_pkcs8)
        .collect();
    assert_eq!(expected_keys.len(), 3, "the fixture holds three passkeys");
    assert_ne!(
        expected_keys[0].as_slice(),
        expected_keys[1].as_slice(),
        "each fixture passkey must carry a distinct key"
    );
    assert_ne!(
        expected_keys[1].as_slice(),
        expected_keys[2].as_slice(),
        "each fixture passkey must carry a distinct key"
    );

    let (_dir, path, manager) = seeded(entries).await;
    let target = local_ref(&path);

    let json = export_cxf_with(&target, PASSWORD, true, &manager).await?;

    let header = parse_envelope(&json)?;
    assert_eq!(header.accounts.len(), 1);
    let items = &header.accounts[0].items;
    assert_eq!(items.len(), 3, "one item per passkey, groups not exported");

    // Depth-first order mirrors the vault tree.
    let titles: Vec<&str> = items.iter().map(|item| item.title.as_str()).collect();
    assert_eq!(
        titles,
        vec!["Root passkey", "Nested passkey", "Deep passkey"]
    );

    // Every credential validates and keeps its own rpId/credentialId/key, and
    // the tags of the fixture survive the trip.
    let expected = [
        ("root.example", vec![0x01u8]),
        ("nested.example", vec![0x02u8]),
        ("deep.example", vec![0x03u8]),
    ];
    for ((item, (rp_id, credential_id)), expected_key) in
        items.iter().zip(expected).zip(&expected_keys)
    {
        assert_eq!(item.credentials.len(), 1);
        assert_eq!(
            item.tags.as_deref(),
            Some(["work".to_string()].as_slice()),
            "non-empty tags are preserved for every item"
        );
        let (_, validated) = validate_credential(&item.credentials[0]);
        let validated = validated.expect("every exported credential validates");
        assert_eq!(validated.rp_id, rp_id);
        assert_eq!(validated.credential_id, credential_id);
        assert_eq!(
            validated.pkcs8_der.as_slice(),
            expected_key.as_slice(),
            "each item carries its own stored key"
        );
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Criterion 7 — read-only
// ---------------------------------------------------------------------------

/// Criterion 7: the vault file is byte-identical before and after an export
/// (a regression that re-saved the vault would change the ciphertext, the
/// `updated_at` stamp and the version bump — all visible in the bytes), and no
/// file appears next to it (a "write the export to a temp file, then read it
/// back" regression would show up in the directory listing).
#[tokio::test]
async fn export_cxf_is_read_only() -> Result<(), CommandError> {
    let (dir, path, manager) = seeded(vec![
        seeded_passkey("Root passkey", "root.example", &[0x01]),
        group_entry(
            "Work",
            vec![seeded_passkey("Nested", "nested.example", &[0x02])],
        ),
    ])
    .await;
    let target = local_ref(&path);
    let before = std::fs::read(&path).expect("vault file readable");
    let listing_before = dir_listing(dir.path());

    let json = export_cxf_with(&target, PASSWORD, true, &manager).await?;
    assert_eq!(parse_envelope(&json)?.accounts[0].items.len(), 2);

    let after = std::fs::read(&path).expect("vault file readable");
    assert_eq!(
        before, after,
        "export must not modify the vault file (read-only command)"
    );
    assert_eq!(
        listing_before,
        dir_listing(dir.path()),
        "export must not create any file next to the vault"
    );
    Ok(())
}

// ---------------------------------------------------------------------------
// Negative controls — these prove the assertions above can fail
// ---------------------------------------------------------------------------

/// Negative control (a): the consent gate really is what refuses the export.
///
/// Mutating the flag to `true` on the *same* vault+password makes the very same
/// call succeed, so `export_cxf_requires_consent` fails for the right reason
/// (the flag), not because the vault was unreadable.
#[tokio::test]
async fn negative_control_consent_flag_is_the_gate() -> Result<(), CommandError> {
    let (_dir, path, manager) = seeded(vec![seeded_passkey("GitHub", "github.com", &[0xaa])]).await;
    let target = local_ref(&path);

    assert!(matches!(
        export_cxf_with(&target, PASSWORD, false, &manager).await,
        Err(CommandError::Validation(_))
    ));
    // Same vault, same password, only the flag differs.
    let json = export_cxf_with(&target, PASSWORD, true, &manager).await?;
    assert_eq!(parse_envelope(&json)?.accounts[0].items.len(), 1);
    Ok(())
}

/// Negative control (b): the read-only byte comparison bites.
///
/// A save through the seam (which the export must never do) changes the file
/// bytes, so the equality asserted by `export_cxf_is_read_only` is a real
/// assertion and not a tautology.
#[tokio::test]
async fn negative_control_a_save_changes_the_bytes() -> Result<(), CommandError> {
    let (_dir, path, manager) = seeded(vec![seeded_passkey("GitHub", "github.com", &[0xaa])]).await;
    let target = local_ref(&path);
    let before = std::fs::read(&path).expect("vault file readable");

    // The write path the export deliberately does not use.
    let mut loaded = load_vault(&target, PASSWORD, &manager).await?;
    crate::passkey::store::save_vault(&target, &mut loaded, &manager).await?;

    let after = std::fs::read(&path).expect("vault file readable");
    assert_ne!(
        before, after,
        "a save must change the bytes; otherwise the read-only assertion proves nothing"
    );
    Ok(())
}

/// Negative control (c): the roundtrip key comparison bites.
///
/// Exporting a passkey whose stored key differs from the vector makes the
/// byte-equality assertion of `export_cxf_roundtrip_matches_import` fail — the
/// comparison is against the disk blob, not against the export's own output.
#[tokio::test]
async fn negative_control_key_comparison_is_against_disk() -> Result<(), CommandError> {
    let (_dir, path, manager) = seeded(Vec::new()).await;
    let target = local_ref(&path);
    create_passkey(&target, &manager, "alice").await;

    let loaded = load_vault(&target, PASSWORD, &manager).await?;
    let stored_der = stored_pkcs8(
        loaded
            .vault
            .entries
            .iter()
            .find(|entry| matches!(entry, Entry::Passkey { .. }))
            .expect("passkey stored"),
    );
    let vector_der = decode_base64_urlsafe(SPEC_KEY_B64URL).expect("vector key");

    // The ceremony generated a fresh key: it must NOT equal the published
    // vector, which is what makes the byte comparison meaningful.
    assert_ne!(
        stored_der.as_slice(),
        vector_der.as_slice(),
        "the ceremony must generate a fresh key, not reuse the vector"
    );

    let json = export_cxf_with(&target, PASSWORD, true, &manager).await?;
    let header = parse_envelope(&json)?;
    let (_, validated) = validate_credential(&header.accounts[0].items[0].credentials[0]);
    let validated = validated.expect("exported credential validates");
    assert_eq!(validated.pkcs8_der.as_slice(), stored_der.as_slice());
    assert_ne!(validated.pkcs8_der.as_slice(), vector_der.as_slice());
    Ok(())
}

/// Negative control (d): the recursive collection really walks groups.
///
/// `collect_export_passkeys` on the flat root alone would return one passkey;
/// the nested one is only reachable through the group traversal, so
/// `export_cxf_multi_passkey_items` would fail if the recursion were dropped.
#[test]
fn negative_control_collection_is_recursive() {
    let nested = seeded_passkey("Nested", "nested.example", &[0x02]);
    let entries = vec![
        seeded_passkey("Root", "root.example", &[0x01]),
        group_entry("Work", vec![nested]),
    ];

    let collected = collect_export_passkeys(&entries);
    assert_eq!(collected.len(), 2, "the nested passkey must be collected");
    let names: Vec<&str> = collected
        .iter()
        .map(|passkey| passkey.name.as_str())
        .collect();
    assert_eq!(names, vec!["Root", "Nested"]);

    // Root-only collection (the mutation) sees just one.
    let root_only = collect_export_passkeys(&entries[..1]);
    assert_eq!(root_only.len(), 1);
}
