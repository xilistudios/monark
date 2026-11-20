//! End-to-end tests of the registration ceremony (T09).
//!
//! Every test drives the real command body ([`passkey_create_with`]) against a
//! **real local vault file** in a temp dir: no mocked crypto, no mocked vault.
//! That is what makes the acceptance criteria meaningful — the response is
//! parsed back with the T02 parsers, the stored entry is read from disk through
//! the `read_vault` command, and the public key in the attestation object is
//! compared with the key derived from the *stored* PKCS#8 blob.
//!
//! The negative controls at the bottom mutate the emitted structures (COSE key
//! coordinates, attestation `fmt`, credential id) and prove the assertions bite.

use super::*;
use crate::crypto::base64::{decode_base64_urlsafe, encode_base64_urlsafe};
use crate::models::{Vault, VaultView};
use crate::passkey::cose::parse_attestation_object;
use crate::passkey::es256::signing_key_from_pkcs8_der;
use crate::passkey::store::load_vault;
use crate::passkey::types::{AuthenticatorSelection, PubKeyCredParam, RpEntity, UserEntity};
use crate::passkey::webauthn::{parse_authenticator_data, rp_id_hash};
use crate::storage::{StorageConfig, StorageManager};
use crate::vault::lifecycle;
use crate::vault::version::CURRENT_VAULT_VERSION;
use chrono::{DateTime, Utc};
use ciborium::value::Value;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tempfile::TempDir;

const PASSWORD: &str = "t09-ceremony-password";
const RP_ID: &str = "example.com";
const RP_NAME: &str = "Example";
const ORIGIN: &str = "https://example.com";
/// Fixed 32-byte challenge (0x11 repeated) in base64url.
const CHALLENGE_B64: &str = "ERERERERERERERERERERERERERERERERERERERERERE";
/// Fixed 4-byte user handle (`AQIDBA` = 0x01 0x02 0x03 0x04).
const USER_HANDLE_B64: &str = "AQIDBA";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

fn fixed_time() -> DateTime<Utc> {
    DateTime::parse_from_rfc3339("2026-01-02T03:04:05Z")
        .expect("fixed timestamp parses")
        .with_timezone(&Utc)
}

/// A valid registration request, matching the shape the frontend forwards.
fn create_request() -> PasskeyCreateRequest {
    PasskeyCreateRequest {
        rp: RpEntity {
            id: RP_ID.to_string(),
            name: RP_NAME.to_string(),
        },
        user: UserEntity {
            id: USER_HANDLE_B64.to_string(),
            name: "alice".to_string(),
            display_name: "Alice".to_string(),
        },
        challenge: CHALLENGE_B64.to_string(),
        origin: ORIGIN.to_string(),
        pub_key_cred_params: vec![PubKeyCredParam {
            type_: PUBLIC_KEY_TYPE.to_string(),
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

/// A valid registration request with an explicit `rp.id` and `origin` (the
/// binding tests need the two to disagree).
fn create_request_for_origin(rp_id: &str, origin: &str) -> PasskeyCreateRequest {
    let mut request = create_request();
    request.rp.id = rp_id.to_string();
    request.origin = origin.to_string();
    request
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

/// Writes an empty (or `entries`-holding) vault straight to disk, the way the
/// app creates one: fresh master key wrapped under [`PASSWORD`].
///
/// The command write path only accepts sanitized views, so a seeded vault is
/// built here with the same key hierarchy (`vault::keys`) the lifecycles use.
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
    let path = seed_vault(&dir, "ceremony.monark", entries);
    let manager = local_manager(&dir).await;
    (dir, path, manager)
}

/// The single passkey stored in `vault` (panics when there is none).
fn only_passkey(vault: &Vault) -> &Entry {
    let mut found = vault
        .entries
        .iter()
        .filter(|entry| matches!(entry, Entry::Passkey { .. }));
    let first = found.next().expect("the vault must hold a passkey");
    assert!(found.next().is_none(), "expected exactly one passkey");
    first
}

/// The stored PKCS#8 DER of a passkey entry, as a `Zeroizing` buffer.
fn stored_pkcs8(entry: &Entry) -> Zeroizing<Vec<u8>> {
    match entry {
        Entry::Passkey { private_key, .. } => private_key.to_pkcs8_der().expect("key decodes"),
        other => panic!("expected a passkey, got {other:?}"),
    }
}

/// The stored credential id of a passkey entry.
fn stored_credential_id(entry: &Entry) -> Vec<u8> {
    match entry {
        Entry::Passkey { credential_id, .. } => credential_id.clone(),
        other => panic!("expected a passkey, got {other:?}"),
    }
}

/// Parsed `clientDataJSON` of a response.
fn parsed_client_data(response: &PasskeyCreateResponse) -> crate::passkey::webauthn::ClientData {
    let bytes = decode_base64_urlsafe(&response.response.client_data_json).expect("b64url");
    serde_json::from_slice(&bytes).expect("client data parses")
}

/// Parsed `attestationObject` of a response: `(fmt, attStmt, authData)`.
fn parsed_attestation(response: &PasskeyCreateResponse) -> (String, Value, Vec<u8>) {
    let bytes = decode_base64_urlsafe(&response.response.attestation_object).expect("b64url");
    parse_attestation_object(&bytes).expect("attestation object parses")
}

// ---------------------------------------------------------------------------
// Criterion 1 — happy path, full structure
// ---------------------------------------------------------------------------

#[tokio::test]
async fn create_happy_path_full_structure() -> Result<(), CommandError> {
    let (_dir, path, manager) = seeded(Vec::new()).await;
    let target = local_ref(&path);

    let response = passkey_create_with(&target, PASSWORD, create_request(), &manager).await?;

    // --- Response envelope. ---
    assert_eq!(response.type_, "public-key");
    assert_eq!(response.authenticator_attachment, "platform");
    assert_eq!(response.client_extension_results, serde_json::json!({}));
    assert_eq!(response.response.transports, vec!["internal".to_string()]);
    // `id == rawId == b64url(credential_id)`; the credential id is 32 bytes.
    assert_eq!(response.id, response.raw_id);
    let credential_id = decode_base64_urlsafe(&response.id).expect("credential id is b64url");
    assert_eq!(credential_id.len(), CREDENTIAL_ID_LEN);

    // --- clientDataJSON. ---
    let client_data = parsed_client_data(&response);
    assert_eq!(client_data.type_, "webauthn.create");
    assert_eq!(client_data.challenge, CHALLENGE_B64);
    assert_eq!(client_data.origin, ORIGIN);

    // --- attestationObject: fmt "none", empty attStmt. ---
    let (fmt, att_stmt, auth_data) = parsed_attestation(&response);
    assert_eq!(fmt, "none");
    assert_eq!(att_stmt, Value::Map(Vec::new()));

    // --- authenticatorData: flags 0x45, counter 0, zero AAGUID, same cred id. ---
    let parsed = parse_authenticator_data(&auth_data).expect("authData parses");
    assert_eq!(parsed.flags, 0x45, "UP|UV|AT");
    assert_eq!(parsed.sign_count, 0);
    assert_eq!(parsed.aaguid, Some(AAGUID_ZERO));
    assert_eq!(parsed.rp_id_hash, rp_id_hash(RP_ID));
    assert_eq!(
        parsed.credential_id.as_deref(),
        Some(credential_id.as_slice()),
        "the attested credential id must be the one in the response"
    );

    // --- The COSE key matches the key that is actually stored. ---
    let loaded = load_vault(&target, PASSWORD, &manager).await?;
    let entry = only_passkey(&loaded.vault);
    let stored_der = stored_pkcs8(entry);
    let stored_key = verifying_key_from_signing(&signing_key_from_pkcs8_der(&stored_der)?);
    let attested_key = parsed.cose_key.expect("attested COSE key");
    assert_eq!(
        attested_key.to_encoded_point(false),
        stored_key.to_encoded_point(false),
        "the attested public key must be the stored private key's public key"
    );
    assert_eq!(stored_credential_id(entry), credential_id);
    Ok(())
}

// ---------------------------------------------------------------------------
// Criterion 2 — the key is stored, the IPC view is sanitized, version bumps
// ---------------------------------------------------------------------------

#[tokio::test]
async fn create_stores_key_and_sanitizes_ipc() -> Result<(), CommandError> {
    let (_dir, path, manager) = seeded(Vec::new()).await;
    let target = local_ref(&path);
    let path_str = path.to_string_lossy().to_string();

    let response = passkey_create_with(&target, PASSWORD, create_request(), &manager).await?;

    // The `read_vault` command (the IPC read path) shows the passkey VIEW only.
    let view: VaultView = lifecycle::read_vault(path_str.clone(), PASSWORD.to_string())?;
    let view_json = serde_json::to_string(&view).expect("view serializes");
    assert!(
        !view_json.contains("private_key"),
        "the IPC view must never carry a private_key field: {view_json}"
    );
    assert_eq!(view.entries.len(), 1);
    let crate::models::EntryView::Passkey(passkey_view) = &view.entries[0] else {
        panic!("expected a passkey view, got {:?}", view.entries[0]);
    };
    assert_eq!(passkey_view.id.to_string(), response.entry_id);
    assert_eq!(passkey_view.rp_id, RP_ID);
    assert_eq!(passkey_view.rp_name, RP_NAME);
    assert_eq!(passkey_view.user_name, "alice");
    assert_eq!(passkey_view.user_display_name, "Alice");
    assert_eq!(passkey_view.algorithm, ALG_ES256);
    assert_eq!(passkey_view.sign_count, 0);
    assert!(passkey_view.discoverable);
    assert_eq!(passkey_view.transports, vec!["internal".to_string()]);
    assert_eq!(passkey_view.aaguid, Uuid::nil());
    assert_eq!(passkey_view.name, "alice", "entry name is user.name");
    assert_eq!(
        encode_base64_urlsafe(&passkey_view.credential_id),
        response.id
    );
    assert_eq!(
        encode_base64_urlsafe(&passkey_view.user_handle),
        USER_HANDLE_B64
    );

    // A direct disk decrypt (bypassing the view) DOES hold the key.
    let loaded = load_vault(&target, PASSWORD, &manager).await?;
    let stored_der = stored_pkcs8(only_passkey(&loaded.vault));
    assert!(!stored_der.is_empty(), "the private key must be on disk");
    assert_eq!(
        stored_der.len(),
        138,
        "a P-256 PKCS#8 DER document is 138 bytes"
    );

    // The version policy bumped the vault to the passkey format.
    let vault_file = crate::io::vault::read_vault(path_str)?;
    assert_eq!(vault_file.version, CURRENT_VAULT_VERSION);
    Ok(())
}

// ---------------------------------------------------------------------------
// Criterion 3 — rejections (one test per rule)
// ---------------------------------------------------------------------------

/// Asserts that `request` is refused with a `Validation` error and that the
/// vault file was **not** modified (validation happens before any IO).
async fn assert_rejected(request: PasskeyCreateRequest, expected: &str) {
    let (_dir, path, manager) = seeded(Vec::new()).await;
    let target = local_ref(&path);
    let before = std::fs::read(&path).expect("vault file readable");

    match passkey_create_with(&target, PASSWORD, request, &manager).await {
        Err(CommandError::Validation(message)) => {
            assert_eq!(message, expected, "unexpected validation message");
        }
        Err(other) => panic!("expected a validation error, got {other:?}"),
        Ok(_) => panic!("the request must be rejected"),
    }

    let after = std::fs::read(&path).expect("vault file readable");
    assert_eq!(
        before, after,
        "a rejected request must not touch the vault file"
    );
}

#[tokio::test]
async fn create_rejects_non_es256_params() {
    let mut request = create_request();
    request.pub_key_cred_params = vec![PubKeyCredParam {
        type_: PUBLIC_KEY_TYPE.to_string(),
        alg: -8, // EdDSA
    }];
    assert_rejected(request, "Only ES256 is supported").await;
}

#[tokio::test]
async fn create_rejects_empty_params_and_wrong_type() {
    let mut request = create_request();
    request.pub_key_cred_params.clear();
    assert_rejected(request, "Only ES256 is supported").await;

    let mut request = create_request();
    request.pub_key_cred_params[0].type_ = "other".to_string();
    assert_rejected(request, "Only ES256 is supported").await;
}

#[tokio::test]
async fn create_rejects_discouraged_resident_key() {
    let mut request = create_request();
    request
        .authenticator_selection
        .as_mut()
        .expect("selection")
        .resident_key = Some("discouraged".to_string());
    assert_rejected(request, "Discoverable credential required").await;
}

#[tokio::test]
async fn create_rejects_missing_selection_and_missing_resident_key() {
    let mut request = create_request();
    request.authenticator_selection = None;
    assert_rejected(request, "Discoverable credential required").await;

    let mut request = create_request();
    request
        .authenticator_selection
        .as_mut()
        .expect("selection")
        .resident_key = None;
    assert_rejected(request, "Discoverable credential required").await;
}

#[tokio::test]
async fn create_rejects_direct_attestation() {
    let mut request = create_request();
    request.attestation = Some("direct".to_string());
    assert_rejected(request, "Only attestation none is supported").await;
}

#[tokio::test]
async fn create_rejects_bad_origin() {
    let mut request = create_request();
    request.origin = "https://example.com/login".to_string();
    assert_rejected(request, "Origin must not carry a path").await;

    let mut request = create_request();
    request.origin = "ftp://example.com".to_string();
    assert_rejected(request, "Origin must use http or https").await;
}

/// MENOR-1: the registration ceremony binds `rp.id` to the origin host too.
#[tokio::test]
async fn create_rejects_rp_id_that_does_not_bind_to_the_origin() {
    let mut request = create_request();
    request.rp.id = "victim.example".to_string();
    request.origin = "https://evil.example".to_string();
    assert_rejected(request, "RP ID is not a domain suffix of the origin's host").await;

    let mut request = create_request();
    request.origin = "https://notexample.com".to_string();
    assert_rejected(request, "RP ID is not a domain suffix of the origin's host").await;
}

/// MENOR-1 (positive side): a sub-domain origin binds to its parent RP id.
#[tokio::test]
async fn create_accepts_rp_id_that_is_a_domain_suffix_of_the_origin() -> Result<(), CommandError> {
    let (_dir, path, manager) = seeded(Vec::new()).await;
    let target = local_ref(&path);

    passkey_create_with(
        &target,
        PASSWORD,
        create_request_for_origin("example.com", "https://login.example.com"),
        &manager,
    )
    .await?;

    let loaded = load_vault(&target, PASSWORD, &manager).await?;
    match only_passkey(&loaded.vault) {
        Entry::Passkey { rp_id, .. } => assert_eq!(rp_id, RP_ID),
        other => panic!("expected a passkey, got {other:?}"),
    }
    Ok(())
}

/// MENOR-2: a mixed-case `rp.id` is stored canonicalized (ASCII lowercase).
#[tokio::test]
async fn create_stores_the_canonical_rp_id() -> Result<(), CommandError> {
    let (_dir, path, manager) = seeded(Vec::new()).await;
    let target = local_ref(&path);

    passkey_create_with(
        &target,
        PASSWORD,
        create_request_for_origin("Example.COM", ORIGIN),
        &manager,
    )
    .await?;

    let loaded = load_vault(&target, PASSWORD, &manager).await?;
    match only_passkey(&loaded.vault) {
        Entry::Passkey { rp_id, .. } => assert_eq!(rp_id, "example.com"),
        other => panic!("expected a passkey, got {other:?}"),
    }
    Ok(())
}

/// NIT-3: `authenticatorSelection.userVerification` is validated against the
/// WebAuthn enum (same rule as the assertion request).
#[tokio::test]
async fn create_rejects_unknown_user_verification() {
    let mut request = create_request();
    request
        .authenticator_selection
        .as_mut()
        .expect("selection")
        .user_verification = Some("banana".to_string());
    assert_rejected(request, "Unsupported user verification requirement").await;

    // Absent is fine (the RP has no preference) and every enum member is fine.
    let mut request = create_request();
    request
        .authenticator_selection
        .as_mut()
        .expect("selection")
        .user_verification = None;
    let (_dir, path, manager) = seeded(Vec::new()).await;
    passkey_create_with(&local_ref(&path), PASSWORD, request, &manager)
        .await
        .expect("an absent userVerification is accepted");

    for value in ["required", "preferred", "discouraged"] {
        let mut request = create_request();
        request
            .authenticator_selection
            .as_mut()
            .expect("selection")
            .user_verification = Some(value.to_string());
        let (_dir, path, manager) = seeded(Vec::new()).await;
        passkey_create_with(&local_ref(&path), PASSWORD, request, &manager)
            .await
            .unwrap_or_else(|err| panic!("{value} must be accepted, got {err:?}"));
    }
}

#[tokio::test]
async fn create_rejects_short_and_long_challenge() {
    let mut request = create_request();
    request.challenge = encode_base64_urlsafe(&[0u8; MIN_CHALLENGE_LEN - 1]);
    assert_rejected(request, "Challenge length is out of range").await;

    let mut request = create_request();
    request.challenge = encode_base64_urlsafe(&[0u8; MAX_CHALLENGE_LEN + 1]);
    assert_rejected(request, "Challenge length is out of range").await;

    let mut request = create_request();
    request.challenge = "not base64!!".to_string();
    assert_rejected(request, "Challenge is not valid base64url").await;
}

#[tokio::test]
async fn create_rejects_oversized_user_handle() {
    let mut request = create_request();
    request.user.id = encode_base64_urlsafe(&[0x01u8; MAX_USER_HANDLE_LEN + 1]);
    assert_rejected(request, "User id length is out of range").await;

    let mut request = create_request();
    request.user.id = String::new();
    assert_rejected(request, "User id length is out of range").await;
}

#[tokio::test]
async fn create_rejects_bad_rp_id_and_long_names() {
    let mut request = create_request();
    request.rp.id = "https://example.com".to_string();
    assert_rejected(request, "RP ID must be a bare host name").await;

    let mut request = create_request();
    request.rp.id = String::new();
    assert_rejected(request, "RP ID is empty").await;

    let mut request = create_request();
    request.rp.name = "x".repeat(MAX_RP_NAME_CHARS + 1);
    assert_rejected(request, "RP name is too long").await;

    let mut request = create_request();
    request.user.name = "x".repeat(MAX_USER_NAME_CHARS + 1);
    assert_rejected(request, "User name is empty or too long").await;

    let mut request = create_request();
    request.user.display_name = "x".repeat(MAX_USER_NAME_CHARS + 1);
    assert_rejected(request, "User display name is too long").await;
}

/// A wrong password is an authentication failure, it counts against the
/// rate-limit budget of the vault, and it never creates a passkey.
///
/// The limiter is a process-global map keyed by the canonical vault path, so the
/// test asserts on the *counter* ([`crate::vault::rate_limit::failure_count`])
/// rather than on the imposed delay: the delay is time-based and the shared
/// target dir may run other tests concurrently, which would make a "the 5th
/// attempt is refused" assertion flaky. The refusal itself is covered by
/// `passkey::store::tests::local_load_wrong_password_rate_limited`.
///
/// The budget is deliberately left one attempt short of the gate
/// ([`crate::vault::rate_limit::MAX_FREE_ATTEMPTS`]): the point of this test is
/// that a wrong password is *counted*, not that the gate fires.
#[tokio::test]
async fn create_rejects_wrong_password_rate_limited() -> Result<(), CommandError> {
    let (_dir, path, manager) = seeded(Vec::new()).await;
    let target = local_ref(&path);
    let canonical = path
        .canonicalize()
        .expect("canonical path")
        .to_string_lossy()
        .to_string();
    // Start from a clean budget for this vault (the map is process-global).
    crate::vault::rate_limit::reset_attempts(&canonical);

    for attempt in 1..=crate::vault::rate_limit::MAX_FREE_ATTEMPTS {
        match passkey_create_with(&target, "wrong-password", create_request(), &manager).await {
            // A wrong password is never a request validation error: it must not
            // be confusable with a malformed request.
            Err(CommandError::Validation(message)) => panic!(
                "a wrong password must not be reported as a request validation error: {message}"
            ),
            Err(_) => {}
            Ok(_) => panic!("a wrong password must never create a passkey"),
        }
        // The key is the canonical path of this test's own temp dir, so the
        // count is exactly `attempt`: no other test can touch this key.
        assert_eq!(
            crate::vault::rate_limit::failure_count(&canonical),
            attempt,
            "attempt {attempt} must be counted exactly once"
        );
    }

    // The vault is untouched: still no passkey.
    let loaded = load_vault(&target, PASSWORD, &manager).await?;
    assert!(loaded.vault.entries.is_empty());
    Ok(())
}

// ---------------------------------------------------------------------------
// Criterion 4 — excludeCredentials is the only dedup; duplicates are allowed
// ---------------------------------------------------------------------------

#[tokio::test]
async fn create_exclude_credentials() -> Result<(), CommandError> {
    let (_dir, path, manager) = seeded(Vec::new()).await;
    let target = local_ref(&path);

    // First registration.
    let first = passkey_create_with(&target, PASSWORD, create_request(), &manager).await?;

    // A second registration for the same RP **and** user is allowed: WebAuthn
    // permits several credentials per account, and nothing but
    // `excludeCredentials` deduplicates.
    let second = passkey_create_with(&target, PASSWORD, create_request(), &manager).await?;
    assert_ne!(first.id, second.id, "each ceremony mints a new credential");
    let loaded = load_vault(&target, PASSWORD, &manager).await?;
    assert_eq!(
        loaded
            .vault
            .entries
            .iter()
            .filter(|e| matches!(e, Entry::Passkey { .. }))
            .count(),
        2
    );

    // Excluding the first credential refuses the ceremony…
    let mut request = create_request();
    request.exclude_credentials =
        Some(vec![crate::passkey::types::PublicKeyCredentialDescriptor {
            type_: PUBLIC_KEY_TYPE.to_string(),
            id: first.id.clone(),
        }]);
    match passkey_create_with(&target, PASSWORD, request, &manager).await {
        Err(CommandError::Validation(message)) => {
            assert_eq!(message, "Credential excluded by request");
        }
        Err(other) => panic!("expected a validation error, got {other:?}"),
        Ok(_) => panic!("an excluded credential must refuse the ceremony"),
    }

    // …and the vault still holds exactly the two passkeys.
    let loaded = load_vault(&target, PASSWORD, &manager).await?;
    assert_eq!(
        loaded
            .vault
            .entries
            .iter()
            .filter(|e| matches!(e, Entry::Passkey { .. }))
            .count(),
        2
    );
    Ok(())
}

/// An exclusion that names a credential of *another* RP does not apply.
#[tokio::test]
async fn create_exclude_credentials_is_scoped_to_the_rp() -> Result<(), CommandError> {
    let (_dir, path, manager) = seeded(Vec::new()).await;
    let target = local_ref(&path);

    let first = passkey_create_with(&target, PASSWORD, create_request(), &manager).await?;

    let mut request = create_request();
    request.rp.id = "other.example".to_string();
    request.origin = "https://other.example".to_string();
    request.exclude_credentials =
        Some(vec![crate::passkey::types::PublicKeyCredentialDescriptor {
            type_: PUBLIC_KEY_TYPE.to_string(),
            id: first.id.clone(),
        }]);
    let second = passkey_create_with(&target, PASSWORD, request, &manager).await?;
    assert_ne!(first.id, second.id);
    Ok(())
}

/// A passkey nested inside a group is still found by the exclusion check.
#[tokio::test]
async fn create_exclude_credentials_sees_nested_passkeys() -> Result<(), CommandError> {
    let (_dir, path, manager) = seeded(Vec::new()).await;
    let target = local_ref(&path);
    let first = passkey_create_with(&target, PASSWORD, create_request(), &manager).await?;

    // Move the passkey into a group on disk (load → mutate → save).
    let mut loaded = load_vault(&target, PASSWORD, &manager).await?;
    let passkey = loaded.vault.entries.remove(0);
    loaded.vault.entries.push(Entry::Group {
        id: Uuid::new_v4(),
        name: "Work".to_string(),
        data_type: "group".to_string(),
        children: vec![passkey],
    });
    store::save_vault(&target, &mut loaded, &manager).await?;

    let mut request = create_request();
    request.exclude_credentials =
        Some(vec![crate::passkey::types::PublicKeyCredentialDescriptor {
            type_: PUBLIC_KEY_TYPE.to_string(),
            id: first.id.clone(),
        }]);
    match passkey_create_with(&target, PASSWORD, request, &manager).await {
        Err(CommandError::Validation(message)) => {
            assert_eq!(message, "Credential excluded by request")
        }
        other => panic!("a nested passkey must still be excluded, got {other:?}"),
    }
    Ok(())
}

/// The passkey is written at the vault **root**, even when the vault already
/// holds groups.
#[tokio::test]
async fn create_writes_at_the_vault_root() -> Result<(), CommandError> {
    let (_dir, path, manager) = seeded(vec![Entry::Group {
        id: Uuid::new_v4(),
        name: "Work".to_string(),
        data_type: "group".to_string(),
        children: vec![data_entry("Mail")],
    }])
    .await;
    let target = local_ref(&path);

    let response = passkey_create_with(&target, PASSWORD, create_request(), &manager).await?;

    let loaded = load_vault(&target, PASSWORD, &manager).await?;
    assert_eq!(loaded.vault.entries.len(), 2);
    let root_passkey = loaded
        .vault
        .entries
        .iter()
        .find(|entry| matches!(entry, Entry::Passkey { .. }))
        .expect("the passkey must be at the root");
    match root_passkey {
        Entry::Passkey { id, .. } => assert_eq!(id.to_string(), response.entry_id),
        other => panic!("expected a passkey, got {other:?}"),
    }
    // The pre-existing group is untouched.
    assert!(matches!(loaded.vault.entries[0], Entry::Group { .. }));
    Ok(())
}

// ---------------------------------------------------------------------------
// Negative controls — these prove the assertions above can fail
// ---------------------------------------------------------------------------

/// Rebuilds an `attestationObject` from a mutated `authData` (so a test can
/// corrupt the attested credential data and still get a parseable object).
fn attestation_with_auth_data(auth_data: &[u8]) -> Vec<u8> {
    attestation_object_none(auth_data).expect("re-encode attestation object")
}

/// Negative control (a): tampering with the COSE key in the attestation object
/// makes the public-key-match assertion of the happy path fail.
#[tokio::test]
async fn negative_control_tampered_cose_key_breaks_the_match() -> Result<(), CommandError> {
    let (_dir, path, manager) = seeded(Vec::new()).await;
    let target = local_ref(&path);
    let response = passkey_create_with(&target, PASSWORD, create_request(), &manager).await?;

    let (_fmt, _att_stmt, auth_data) = parsed_attestation(&response);
    let parsed = parse_authenticator_data(&auth_data).expect("authData parses");
    let credential_id = parsed.credential_id.clone().expect("credential id");

    // Flip one byte of the COSE key's X coordinate and rebuild the authData.
    let cose = cose_key_from_verifying(&parsed.cose_key.expect("cose key"))?;
    let tampered_cose = match cose {
        Value::Map(entries) => Value::Map(
            entries
                .into_iter()
                .map(|(label, value)| match (label, value) {
                    (Value::Integer(int), Value::Bytes(mut bytes)) if i128::from(int) == -2 => {
                        bytes[0] ^= 0x01;
                        (Value::Integer(int), Value::Bytes(bytes))
                    }
                    other => other,
                })
                .collect(),
        ),
        other => other,
    };
    let tampered_auth_data = build_authenticator_data(
        RP_ID,
        FLAG_UP | FLAG_UV | FLAG_AT,
        SIGN_COUNT,
        Some((&AAGUID_ZERO, &credential_id, &tampered_cose)),
    )?;
    let tampered_object = attestation_with_auth_data(&tampered_auth_data);

    // The tampered object is still well-formed CBOR…
    let (fmt, _stmt, tampered_parsed_auth_data) =
        parse_attestation_object(&tampered_object).expect("tampered object still parses");
    assert_eq!(fmt, "none");

    // …but the attested key no longer matches the stored key: the T02 parser
    // rejects the point (it is off the curve), which is exactly the assertion
    // `create_happy_path_full_structure` makes when it compares the attested key
    // with the key derived from the stored PKCS#8.
    match parse_authenticator_data(&tampered_parsed_auth_data) {
        Err(CommandError::Validation(message)) => {
            assert_eq!(message, "COSE key point is not on the P-256 curve");
        }
        other => panic!("a flipped COSE coordinate must not yield a key, got {other:?}"),
    }

    // Sanity: the untampered authData of the same ceremony does parse and does
    // match the stored key, so the rejection above is caused by the flip.
    let parsed_original = parse_authenticator_data(&auth_data).expect("original authData parses");
    let loaded = load_vault(&target, PASSWORD, &manager).await?;
    let stored_der = stored_pkcs8(only_passkey(&loaded.vault));
    let stored_key = verifying_key_from_signing(&signing_key_from_pkcs8_der(&stored_der)?);
    assert_eq!(
        parsed_original
            .cose_key
            .expect("original cose key")
            .to_encoded_point(false),
        stored_key.to_encoded_point(false)
    );
    Ok(())
}

/// Negative control (b): flipping the attestation `fmt` makes the T02 parser
/// reject the object — the happy path's `parse_attestation_object` would fail.
#[tokio::test]
async fn negative_control_flipped_attestation_fmt_is_rejected() -> Result<(), CommandError> {
    let (_dir, path, manager) = seeded(Vec::new()).await;
    let target = local_ref(&path);
    let response = passkey_create_with(&target, PASSWORD, create_request(), &manager).await?;
    let (_fmt, _stmt, auth_data) = parsed_attestation(&response);

    let packed = Value::Map(vec![
        (
            Value::Text("fmt".to_string()),
            Value::Text("packed".to_string()),
        ),
        (Value::Text("attStmt".to_string()), Value::Map(Vec::new())),
        (
            Value::Text("authData".to_string()),
            Value::Bytes(auth_data.clone()),
        ),
    ]);
    let mut bytes = Vec::new();
    ciborium::ser::into_writer(&packed, &mut bytes).expect("encode");

    match parse_attestation_object(&bytes) {
        Err(CommandError::Validation(message)) => {
            assert_eq!(message, "Unsupported attestation format");
        }
        other => panic!("a non-none fmt must be rejected, got {other:?}"),
    }

    // Sanity: the unmodified object of the same ceremony parses.
    let (fmt, _stmt, _auth_data) = parsed_attestation(&response);
    assert_eq!(fmt, "none");
    Ok(())
}

/// Negative control (c): a credential id that differs from the response `id`
/// breaks the "attested credential id == response id" assertion.
#[tokio::test]
async fn negative_control_credential_id_mismatch_is_detectable() -> Result<(), CommandError> {
    let (_dir, path, manager) = seeded(Vec::new()).await;
    let target = local_ref(&path);
    let response = passkey_create_with(&target, PASSWORD, create_request(), &manager).await?;

    let (_fmt, _stmt, auth_data) = parsed_attestation(&response);
    let parsed = parse_authenticator_data(&auth_data).expect("authData parses");
    let attested_id = parsed.credential_id.expect("credential id");
    let response_id = decode_base64_urlsafe(&response.id).expect("b64url");

    // Same ceremony: they agree.
    assert_eq!(attested_id, response_id);

    // A one-byte flip is detectable, which is what makes the assertion bite.
    let mut flipped = attested_id.clone();
    flipped[0] ^= 0x01;
    assert_ne!(flipped, response_id);
    Ok(())
}
