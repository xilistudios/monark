//! End-to-end tests of the authentication ceremony, the RP listing and the
//! explicit deletion (T10).
//!
//! Every test drives the real command bodies ([`passkey_assert_with`],
//! [`passkey_list_for_rp_with`], [`passkey_delete_with`]) against a **real local
//! vault file** in a temp dir, and the passkeys those tests sign with are
//! created by the real registration ceremony ([`passkey_create_with`], T09) —
//! no mocked crypto, no hand-built entries.
//!
//! The central assertion is criterion 1: the DER signature returned by
//! `passkey_assert` is verified with an **independent** `VerifyingKey` derived
//! from the private key that is actually stored on disk, over the signature
//! input reconstructed from the response fields. The negative controls at the
//! bottom mutate the challenge, the authenticator data and the signature and
//! prove that this verification fails when it should.

use super::*;
use crate::crypto::base64::{decode_base64_urlsafe, encode_base64_urlsafe};
use crate::models::{EntryView, Vault, VaultView};
use crate::passkey::es256::{signing_key_from_pkcs8_der, verify_es256, verifying_key_from_signing};
use crate::passkey::store::load_vault;
use crate::passkey::types::{
    AuthenticatorSelection, PasskeyAssertRequest, PubKeyCredParam, PublicKeyCredentialDescriptor,
    RpEntity, UserEntity,
};
use crate::passkey::webauthn::{
    assertion_signature_input, parse_authenticator_data, rp_id_hash, ClientData,
};
use crate::storage::{StorageConfig, StorageManager};
use crate::vault::lifecycle;
use chrono::{DateTime, Utc};
use p256::ecdsa::VerifyingKey;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tempfile::TempDir;

const PASSWORD: &str = "t10-assertion-password";
const RP_ID: &str = "example.com";
const RP_NAME: &str = "Example";
const ORIGIN: &str = "https://example.com";
/// Fixed 32-byte challenge (0x11 repeated) in base64url.
const CHALLENGE_B64: &str = "ERERERERERERERERERERERERERERERERERERERERERE";
/// A second, distinct challenge (0x22 repeated) for tampering tests.
const OTHER_CHALLENGE_B64: &str = "IiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiI";
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

/// A valid registration request for `rp_id` / `origin` / `user_name`.
fn create_request_for(rp_id: &str, origin: &str, user_name: &str) -> PasskeyCreateRequest {
    PasskeyCreateRequest {
        rp: RpEntity {
            id: rp_id.to_string(),
            name: RP_NAME.to_string(),
        },
        user: UserEntity {
            id: USER_HANDLE_B64.to_string(),
            name: user_name.to_string(),
            display_name: format!("{user_name} Display"),
        },
        challenge: CHALLENGE_B64.to_string(),
        origin: origin.to_string(),
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

fn create_request() -> PasskeyCreateRequest {
    create_request_for(RP_ID, ORIGIN, "alice")
}

/// A valid authentication request for `rp_id` / `origin`.
fn assert_request_for(rp_id: &str, origin: &str) -> PasskeyAssertRequest {
    PasskeyAssertRequest {
        rp_id: rp_id.to_string(),
        challenge: CHALLENGE_B64.to_string(),
        origin: origin.to_string(),
        allow_credentials: None,
        credential_id: None,
        user_verification: Some("required".to_string()),
    }
}

fn assert_request() -> PasskeyAssertRequest {
    assert_request_for(RP_ID, ORIGIN)
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

/// Writes a vault straight to disk, the way the app creates one.
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

async fn local_manager(base: &TempDir) -> Arc<StorageManager> {
    let config = StorageConfig::new_local(base.path().to_string_lossy().to_string());
    Arc::new(
        StorageManager::new(config)
            .await
            .expect("local storage manager builds"),
    )
}

async fn seeded(entries: Vec<Entry>) -> (TempDir, PathBuf, Arc<StorageManager>) {
    let dir = TempDir::new().expect("temp dir");
    let path = seed_vault(&dir, "assertion.monark", entries);
    let manager = local_manager(&dir).await;
    (dir, path, manager)
}

/// Registers a passkey through the real T09 ceremony and returns its response.
async fn register(
    target: &VaultRef,
    manager: &Arc<StorageManager>,
    request: PasskeyCreateRequest,
) -> PasskeyCreateResponse {
    passkey_create_with(target, PASSWORD, request, manager)
        .await
        .expect("registration succeeds")
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

/// The stored PKCS#8 DER of a passkey entry.
fn stored_pkcs8(entry: &Entry) -> Zeroizing<Vec<u8>> {
    match entry {
        Entry::Passkey { private_key, .. } => private_key.to_pkcs8_der().expect("key decodes"),
        other => panic!("expected a passkey, got {other:?}"),
    }
}

/// The independent verification key of the passkey stored on disk.
fn stored_verifying_key(entry: &Entry) -> VerifyingKey {
    let der = stored_pkcs8(entry);
    verifying_key_from_signing(&signing_key_from_pkcs8_der(&der).expect("stored key parses"))
}

/// The parsed `clientDataJSON` of an assertion response.
fn parsed_client_data(response: &PasskeyAssertResponse) -> ClientData {
    let bytes = decode_base64_urlsafe(&response.response.client_data_json).expect("b64url");
    serde_json::from_slice(&bytes).expect("client data parses")
}

/// The raw `authenticatorData` of an assertion response.
fn raw_auth_data(response: &PasskeyAssertResponse) -> Vec<u8> {
    decode_base64_urlsafe(&response.response.authenticator_data).expect("b64url")
}

/// The raw DER signature of an assertion response.
fn raw_signature(response: &PasskeyAssertResponse) -> Vec<u8> {
    decode_base64_urlsafe(&response.response.signature).expect("b64url")
}

/// Rebuilds the WebAuthn signature input from the response fields alone, the
/// way a relying party does, and verifies it with `key`.
fn verify_response_with(key: &VerifyingKey, response: &PasskeyAssertResponse) -> bool {
    let auth_data = raw_auth_data(response);
    let client_data_json =
        decode_base64_urlsafe(&response.response.client_data_json).expect("b64url");
    let message = assertion_signature_input(&auth_data, &client_data_json);
    verify_es256(key, &message, &raw_signature(response)).is_ok()
}

// ---------------------------------------------------------------------------
// Criterion 1 + 2 + 3 — signature verifies, authData layout, clientDataJSON
// ---------------------------------------------------------------------------

#[tokio::test]
async fn assert_signature_verifies() -> Result<(), CommandError> {
    let (_dir, path, manager) = seeded(Vec::new()).await;
    let target = local_ref(&path);
    let created = register(&target, &manager, create_request()).await;

    let response = passkey_assert_with(&target, PASSWORD, assert_request(), &manager).await?;

    // --- Envelope. ---
    assert_eq!(response.type_, "public-key");
    assert_eq!(response.authenticator_attachment, "platform");
    assert_eq!(response.client_extension_results, serde_json::json!({}));
    assert_eq!(response.entry_id, created.entry_id);
    assert_eq!(response.id, created.id, "the same credential signs");
    assert_eq!(response.id, response.raw_id);
    assert_eq!(
        response.response.user_handle.as_deref(),
        Some(USER_HANDLE_B64),
        "a discoverable credential must echo the stored user handle"
    );

    // --- Criterion 3: clientDataJSON is the exact echo. ---
    let client_data = parsed_client_data(&response);
    assert_eq!(client_data.type_, "webauthn.get");
    assert_eq!(client_data.challenge, CHALLENGE_B64);
    assert_eq!(client_data.origin, ORIGIN);

    // --- Criterion 1: the signature verifies with an INDEPENDENT key, the one
    //     derived from the private key stored on disk. ---
    let loaded = load_vault(&target, PASSWORD, &manager).await?;
    let stored_key = stored_verifying_key(only_passkey(&loaded.vault));
    assert!(
        verify_response_with(&stored_key, &response),
        "the assertion must verify against the stored private key's public key"
    );
    Ok(())
}

#[tokio::test]
async fn assert_authdata_layout() -> Result<(), CommandError> {
    let (_dir, path, manager) = seeded(Vec::new()).await;
    let target = local_ref(&path);
    register(&target, &manager, create_request()).await;

    let response = passkey_assert_with(&target, PASSWORD, assert_request(), &manager).await?;
    let auth_data = raw_auth_data(&response);

    // Criterion 2: 37 bytes — rpIdHash(32) || flags(1) || counter(4), no
    // attested credential data.
    assert_eq!(
        auth_data.len(),
        37,
        "an assertion has no attested cred data"
    );
    assert_eq!(&auth_data[..32], &rp_id_hash(RP_ID));
    assert_eq!(auth_data[32], 0x05, "UP|UV, AT clear");
    assert_eq!(&auth_data[33..37], &[0x00, 0x00, 0x00, 0x00], "counter 0");

    // The T02 parser agrees and reports no attested credential.
    let parsed = parse_authenticator_data(&auth_data).expect("authData parses");
    assert_eq!(parsed.flags, 0x05);
    assert_eq!(parsed.sign_count, 0);
    assert!(parsed.user_present());
    assert!(parsed.user_verified());
    assert!(!parsed.has_attested_credential());
    assert_eq!(parsed.rp_id_hash, rp_id_hash(RP_ID));
    Ok(())
}

/// The `UV` flag is set even when the RP asks for `"discouraged"` (ruling Q14):
/// Monark is the authenticator and the vault password has just been verified.
#[tokio::test]
async fn assert_sets_uv_even_when_discouraged() -> Result<(), CommandError> {
    let (_dir, path, manager) = seeded(Vec::new()).await;
    let target = local_ref(&path);
    register(&target, &manager, create_request()).await;

    let mut request = assert_request();
    request.user_verification = Some("discouraged".to_string());
    let response = passkey_assert_with(&target, PASSWORD, request, &manager).await?;

    let parsed = parse_authenticator_data(&raw_auth_data(&response)).expect("authData parses");
    assert!(parsed.user_verified(), "UV is always set (ruling Q14)");
    assert!(parsed.user_present());
    Ok(())
}

// ---------------------------------------------------------------------------
// Criterion 5 — the ceremony is read-only
// ---------------------------------------------------------------------------

#[tokio::test]
async fn assert_readonly() -> Result<(), CommandError> {
    let (_dir, path, manager) = seeded(Vec::new()).await;
    let target = local_ref(&path);
    register(&target, &manager, create_request()).await;

    let before = std::fs::read(&path).expect("vault readable");
    let stored_before = load_vault(&target, PASSWORD, &manager).await?.vault;

    let response = passkey_assert_with(&target, PASSWORD, assert_request(), &manager).await?;
    assert!(!response.response.signature.is_empty());

    // Criterion 5: the file is byte-identical — not even `updated_at` moved.
    let after = std::fs::read(&path).expect("vault readable");
    assert_eq!(
        before, after,
        "an assertion must not write to the vault file"
    );

    // Ruling Q15: the stored counter is still 0 and the entry is untouched.
    let stored_after = load_vault(&target, PASSWORD, &manager).await?.vault;
    assert_eq!(stored_before.entries, stored_after.entries);
    match only_passkey(&stored_after) {
        Entry::Passkey { sign_count, .. } => assert_eq!(*sign_count, 0),
        other => panic!("expected a passkey, got {other:?}"),
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Criterion 4 — selection
// ---------------------------------------------------------------------------

#[tokio::test]
async fn assert_selection_exact_rp_match() -> Result<(), CommandError> {
    let (_dir, path, manager) = seeded(Vec::new()).await;
    let target = local_ref(&path);
    register(&target, &manager, create_request()).await;

    // A suffix of the stored RP is NOT a match (ruling Q6, F0).
    match passkey_assert_with(
        &target,
        PASSWORD,
        assert_request_for("login.example.com", "https://login.example.com"),
        &manager,
    )
    .await
    {
        Err(CommandError::NotFound(message)) => {
            assert_eq!(message, "No passkey for this relying party")
        }
        other => panic!("a suffix RP must not match in F0, got {other:?}"),
    }

    // A super-domain is not a match either.
    match passkey_assert_with(
        &target,
        PASSWORD,
        assert_request_for("example", "https://example.com"),
        &manager,
    )
    .await
    {
        Err(CommandError::NotFound(_)) => {}
        other => panic!("a super-domain must not match, got {other:?}"),
    }

    // The exact RP does match.
    passkey_assert_with(&target, PASSWORD, assert_request(), &manager).await?;
    Ok(())
}

#[tokio::test]
async fn assert_selection_allow_credentials_intersection() -> Result<(), CommandError> {
    let (_dir, path, manager) = seeded(Vec::new()).await;
    let target = local_ref(&path);
    let created = register(&target, &manager, create_request()).await;

    // The allowed id matches → the ceremony runs.
    let mut request = assert_request();
    request.allow_credentials = Some(vec![PublicKeyCredentialDescriptor {
        type_: PUBLIC_KEY_TYPE.to_string(),
        id: created.id.clone(),
    }]);
    let response = passkey_assert_with(&target, PASSWORD, request, &manager).await?;
    assert_eq!(response.id, created.id);

    // An allow list that does not contain our credential → NotFound.
    let mut request = assert_request();
    request.allow_credentials = Some(vec![PublicKeyCredentialDescriptor {
        type_: PUBLIC_KEY_TYPE.to_string(),
        id: encode_base64_urlsafe(&[0x77u8; 32]),
    }]);
    match passkey_assert_with(&target, PASSWORD, request, &manager).await {
        Err(CommandError::NotFound(message)) => {
            assert_eq!(message, "No passkey for this relying party")
        }
        other => panic!("a non-matching allow list must not sign, got {other:?}"),
    }

    // An empty allow list means "no restriction" in WebAuthn.
    let mut request = assert_request();
    request.allow_credentials = Some(Vec::new());
    passkey_assert_with(&target, PASSWORD, request, &manager).await?;
    Ok(())
}

#[tokio::test]
async fn assert_selection_explicit_credential_id() -> Result<(), CommandError> {
    let (_dir, path, manager) = seeded(Vec::new()).await;
    let target = local_ref(&path);
    let first = register(&target, &manager, create_request()).await;
    let second = register(&target, &manager, create_request_for(RP_ID, ORIGIN, "bob")).await;

    // Two credentials for the same RP: the explicit id disambiguates.
    let mut request = assert_request();
    request.credential_id = Some(second.id.clone());
    let response = passkey_assert_with(&target, PASSWORD, request, &manager).await?;
    assert_eq!(response.id, second.id);
    assert_eq!(response.entry_id, second.entry_id);

    let mut request = assert_request();
    request.credential_id = Some(first.id.clone());
    let response = passkey_assert_with(&target, PASSWORD, request, &manager).await?;
    assert_eq!(response.id, first.id);

    // An explicit id that is not in the candidate set → NotFound.
    let mut request = assert_request();
    request.credential_id = Some(encode_base64_urlsafe(&[0x55u8; 32]));
    match passkey_assert_with(&target, PASSWORD, request, &manager).await {
        Err(CommandError::NotFound(_)) => {}
        other => panic!("an unknown credential id must not sign, got {other:?}"),
    }
    Ok(())
}

#[tokio::test]
async fn assert_selection_multiple_without_disambiguation_fails_closed() -> Result<(), CommandError>
{
    let (_dir, path, manager) = seeded(Vec::new()).await;
    let target = local_ref(&path);
    register(&target, &manager, create_request()).await;
    register(&target, &manager, create_request_for(RP_ID, ORIGIN, "bob")).await;

    // Ruling Q5: two candidates and no `credentialId` → refuse, never guess.
    match passkey_assert_with(&target, PASSWORD, assert_request(), &manager).await {
        Err(CommandError::Validation(message)) => {
            assert_eq!(message, "Multiple passkeys match; specify credential_id")
        }
        other => panic!("an ambiguous request must fail closed, got {other:?}"),
    }

    // Narrowing with an allow list of one resolves the ambiguity.
    let loaded = load_vault(&target, PASSWORD, &manager).await?;
    let ids: Vec<String> = loaded
        .vault
        .entries
        .iter()
        .filter_map(|entry| match entry {
            Entry::Passkey { credential_id, .. } => Some(encode_base64_urlsafe(credential_id)),
            _ => None,
        })
        .collect();
    assert_eq!(ids.len(), 2);
    let mut request = assert_request();
    request.allow_credentials = Some(vec![PublicKeyCredentialDescriptor {
        type_: PUBLIC_KEY_TYPE.to_string(),
        id: ids[0].clone(),
    }]);
    let response = passkey_assert_with(&target, PASSWORD, request, &manager).await?;
    assert_eq!(response.id, ids[0]);
    Ok(())
}

#[tokio::test]
async fn assert_selection_none_is_not_found() -> Result<(), CommandError> {
    let (_dir, path, manager) = seeded(Vec::new()).await;
    let target = local_ref(&path);

    // An empty vault has no passkey for anyone.
    match passkey_assert_with(&target, PASSWORD, assert_request(), &manager).await {
        Err(CommandError::NotFound(message)) => {
            assert_eq!(message, "No passkey for this relying party")
        }
        other => panic!("an empty vault must not sign, got {other:?}"),
    }

    // A passkey for another RP does not help.
    register(
        &target,
        &manager,
        create_request_for("other.example", "https://other.example", "alice"),
    )
    .await;
    match passkey_assert_with(&target, PASSWORD, assert_request(), &manager).await {
        Err(CommandError::NotFound(_)) => Ok(()),
        other => panic!("a passkey of another RP must not sign, got {other:?}"),
    }
}

/// A passkey nested inside a group is found and signs.
#[tokio::test]
async fn assert_selection_sees_nested_passkeys() -> Result<(), CommandError> {
    let (_dir, path, manager) = seeded(Vec::new()).await;
    let target = local_ref(&path);
    let created = register(&target, &manager, create_request()).await;

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

    let response = passkey_assert_with(&target, PASSWORD, assert_request(), &manager).await?;
    assert_eq!(response.id, created.id);

    // The listing sees it too.
    let summaries = passkey_list_for_rp_with(&target, PASSWORD, RP_ID, &manager).await?;
    assert_eq!(summaries.len(), 1);
    assert_eq!(summaries[0].entry_id, created.entry_id);
    Ok(())
}

// ---------------------------------------------------------------------------
// Criterion 7 — wrong password on all three commands
// ---------------------------------------------------------------------------

#[tokio::test]
async fn assert_wrong_password_rate_limited() -> Result<(), CommandError> {
    let (_dir, path, manager) = seeded(Vec::new()).await;
    let target = local_ref(&path);
    register(&target, &manager, create_request()).await;

    let canonical = path
        .canonicalize()
        .expect("canonical path")
        .to_string_lossy()
        .to_string();
    crate::vault::rate_limit::reset_attempts(&canonical);

    for attempt in 1..=crate::vault::rate_limit::MAX_FREE_ATTEMPTS {
        let assert_err = passkey_assert_with(&target, "wrong-password", assert_request(), &manager)
            .await
            .expect_err("a wrong password must never sign");
        assert!(
            !matches!(assert_err, CommandError::Validation(_)),
            "a wrong password is not a request validation error: {assert_err:?}"
        );
        assert_eq!(
            crate::vault::rate_limit::failure_count(&canonical),
            attempt,
            "attempt {attempt} must be counted exactly once"
        );
    }

    // The other two commands go through the same seam, so a wrong password can
    // never succeed there either. Which failure they report depends on the
    // limiter's clock (the gate's delay may already have elapsed, in which case
    // the attempt reaches the real derivation and fails on the ciphertext), so
    // the assertion is the invariant that matters: never a success, and never a
    // *request* validation error (the rate-limit gate is the only acceptable
    // `Validation`).
    let list_err = passkey_list_for_rp_with(&target, "wrong-password", RP_ID, &manager)
        .await
        .expect_err("a wrong password must never list");
    assert_not_a_request_error(&list_err);
    let delete_err = passkey_delete_with(
        &target,
        "wrong-password",
        &Uuid::new_v4().to_string(),
        &manager,
    )
    .await
    .expect_err("a wrong password must never delete");
    assert_not_a_request_error(&delete_err);

    // The passkey is still there. The budget is reset first: the gate also
    // guards the correct password, and this read is about the vault content.
    crate::vault::rate_limit::reset_attempts(&canonical);
    let loaded = load_vault(&target, PASSWORD, &manager).await?;
    assert!(matches!(only_passkey(&loaded.vault), Entry::Passkey { .. }));
    Ok(())
}

/// Asserts that `err` is a password failure, not a request validation error.
///
/// The rate-limit gate is the only `Validation` a wrong password may produce
/// (it fires before any derivation once the budget is spent).
fn assert_not_a_request_error(err: &CommandError) {
    if let CommandError::Validation(message) = err {
        assert!(
            message.contains("Too many failed attempts"),
            "the only acceptable Validation here is the rate-limit gate, got: {message}"
        );
    }
}

// ---------------------------------------------------------------------------
// Criterion 6 — listing
// ---------------------------------------------------------------------------

#[tokio::test]
async fn list_for_rp_filters() -> Result<(), CommandError> {
    let (_dir, path, manager) = seeded(vec![data_entry("Mail")]).await;
    let target = local_ref(&path);

    let alice = register(&target, &manager, create_request()).await;
    let bob = register(&target, &manager, create_request_for(RP_ID, ORIGIN, "bob")).await;
    let other = register(
        &target,
        &manager,
        create_request_for("other.example", "https://other.example", "carol"),
    )
    .await;

    let summaries = passkey_list_for_rp_with(&target, PASSWORD, RP_ID, &manager).await?;
    assert_eq!(summaries.len(), 2, "only the two example.com passkeys");
    let mut ids: Vec<&str> = summaries
        .iter()
        .map(|summary| summary.credential_id.as_str())
        .collect();
    ids.sort_unstable();
    let mut expected = vec![alice.id.as_str(), bob.id.as_str()];
    expected.sort_unstable();
    assert_eq!(ids, expected);
    assert!(
        !ids.contains(&other.id.as_str()),
        "a passkey of another RP must not be listed"
    );

    for summary in &summaries {
        assert_eq!(summary.rp_id, RP_ID);
        assert_eq!(summary.transports, vec!["internal".to_string()]);
        assert!(!summary.created_at.is_empty());
        assert!(!summary.user_name.is_empty());
        assert!(!summary.user_display_name.is_empty());
    }
    // The user metadata is the stored one, not a placeholder.
    let bob_summary = summaries
        .iter()
        .find(|summary| summary.credential_id == bob.id)
        .expect("bob's summary");
    assert_eq!(bob_summary.user_name, "bob");
    assert_eq!(bob_summary.user_display_name, "bob Display");
    assert_eq!(bob_summary.entry_id, bob.entry_id);

    // Criterion 6: no secret material in the IPC payload.
    let json = serde_json::to_string(&summaries).expect("summaries serialize");
    assert!(!json.contains("private_key"), "no key field: {json}");
    assert!(!json.contains("userHandle"), "no user handle: {json}");
    assert!(!json.contains("user_handle"), "no user handle: {json}");

    // An RP nobody registered for yields an empty list, not an error.
    let none = passkey_list_for_rp_with(&target, PASSWORD, "nobody.example", &manager).await?;
    assert!(none.is_empty());

    // A malformed RP id is a caller bug, not an empty result.
    match passkey_list_for_rp_with(&target, PASSWORD, "https://example.com", &manager).await {
        Err(CommandError::Validation(message)) => {
            assert_eq!(message, "RP ID must be a bare host name")
        }
        other => panic!("a malformed RP id must be rejected, got {other:?}"),
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Criterion 6 — deletion
// ---------------------------------------------------------------------------

#[tokio::test]
async fn delete_removes_and_stays_deleted() -> Result<(), CommandError> {
    let (_dir, path, manager) = seeded(Vec::new()).await;
    let target = local_ref(&path);
    let path_str = path.to_string_lossy().to_string();
    let created = register(&target, &manager, create_request()).await;

    passkey_delete_with(&target, PASSWORD, &created.entry_id, &manager).await?;

    // The IPC read path no longer shows it…
    let view: VaultView = lifecycle::read_vault(path_str.clone(), PASSWORD.to_string())?;
    assert!(view.entries.is_empty(), "the entry must be gone: {view:?}");
    // …and neither does the disk vault.
    let loaded = load_vault(&target, PASSWORD, &manager).await?;
    assert!(loaded.vault.entries.is_empty());

    // Criterion 6, the important half: a full-vault write that omits the
    // passkey does NOT resurrect it. The preservation pass only preserves what
    // is on disk, and it is not on disk any more.
    let stale_view = VaultView {
        updated_at: fixed_time(),
        hmac: String::new(),
        entries: vec![EntryView::Data {
            id: Uuid::new_v4(),
            name: "Mail".to_string(),
            data_type: "login".to_string(),
            created_at: fixed_time(),
            updated_at: fixed_time(),
            fields: Vec::new(),
            tags: Vec::new(),
        }],
    };
    lifecycle::write_vault(path_str.clone(), PASSWORD.to_string(), stale_view)?;

    let after_write = load_vault(&target, PASSWORD, &manager).await?;
    assert_eq!(after_write.vault.entries.len(), 1);
    assert!(
        matches!(after_write.vault.entries[0], Entry::Data { .. }),
        "only the data entry survives: {:?}",
        after_write.vault.entries
    );
    assert!(
        !after_write
            .vault
            .entries
            .iter()
            .any(|entry| matches!(entry, Entry::Passkey { .. })),
        "a deleted passkey must not be resurrected by a stale write"
    );

    // And the assertion ceremony now reports NotFound.
    match passkey_assert_with(&target, PASSWORD, assert_request(), &manager).await {
        Err(CommandError::NotFound(_)) => Ok(()),
        other => panic!("a deleted passkey must not sign, got {other:?}"),
    }
}

/// Deleting a passkey nested in a group removes it from the group.
#[tokio::test]
async fn delete_removes_nested_passkey() -> Result<(), CommandError> {
    let (_dir, path, manager) = seeded(Vec::new()).await;
    let target = local_ref(&path);
    let created = register(&target, &manager, create_request()).await;

    let mut loaded = load_vault(&target, PASSWORD, &manager).await?;
    let passkey = loaded.vault.entries.remove(0);
    loaded.vault.entries.push(Entry::Group {
        id: Uuid::new_v4(),
        name: "Work".to_string(),
        data_type: "group".to_string(),
        children: vec![passkey, data_entry("Mail")],
    });
    store::save_vault(&target, &mut loaded, &manager).await?;

    passkey_delete_with(&target, PASSWORD, &created.entry_id, &manager).await?;

    let loaded = load_vault(&target, PASSWORD, &manager).await?;
    assert_eq!(loaded.vault.entries.len(), 1, "the group stays");
    match &loaded.vault.entries[0] {
        Entry::Group { children, .. } => {
            assert_eq!(children.len(), 1);
            assert!(matches!(children[0], Entry::Data { .. }));
        }
        other => panic!("expected the group, got {other:?}"),
    }
    Ok(())
}

#[tokio::test]
async fn delete_rejects_data_entry() -> Result<(), CommandError> {
    let data = data_entry("Mail");
    let data_id = match &data {
        Entry::Data { id, .. } => *id,
        other => panic!("expected a data entry, got {other:?}"),
    };
    let (_dir, path, manager) = seeded(vec![data]).await;
    let target = local_ref(&path);
    let before = std::fs::read(&path).expect("vault readable");

    match passkey_delete_with(&target, PASSWORD, &data_id.to_string(), &manager).await {
        Err(CommandError::Validation(message)) => {
            assert_eq!(message, "Only passkey entries can be deleted here")
        }
        other => panic!("a data entry must not be deletable here, got {other:?}"),
    }

    // Nothing was written.
    let after = std::fs::read(&path).expect("vault readable");
    assert_eq!(before, after, "a rejected delete must not touch the vault");

    // A group is refused too.
    let group = Entry::Group {
        id: Uuid::new_v4(),
        name: "Work".to_string(),
        data_type: "group".to_string(),
        children: Vec::new(),
    };
    let group_id = match &group {
        Entry::Group { id, .. } => *id,
        other => panic!("expected a group, got {other:?}"),
    };
    let (_dir2, path2, manager2) = seeded(vec![group]).await;
    match passkey_delete_with(
        &local_ref(&path2),
        PASSWORD,
        &group_id.to_string(),
        &manager2,
    )
    .await
    {
        Err(CommandError::Validation(_)) => Ok(()),
        other => panic!("a group must not be deletable here, got {other:?}"),
    }
}

#[tokio::test]
async fn delete_not_found() -> Result<(), CommandError> {
    let (_dir, path, manager) = seeded(Vec::new()).await;
    let target = local_ref(&path);

    // An id that is not in the vault.
    match passkey_delete_with(&target, PASSWORD, &Uuid::new_v4().to_string(), &manager).await {
        Err(CommandError::NotFound(message)) => assert_eq!(message, "Passkey not found"),
        other => panic!("an unknown id must be NotFound, got {other:?}"),
    }

    // A malformed id is a validation error, not a NotFound.
    match passkey_delete_with(&target, PASSWORD, "not-a-uuid", &manager).await {
        Err(CommandError::Validation(message)) => {
            assert_eq!(message, "Entry id is not a valid identifier")
        }
        other => panic!("a malformed id must be rejected, got {other:?}"),
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Request validation
// ---------------------------------------------------------------------------

/// Asserts that `request` is refused with a `Validation` error and that the
/// vault file was **not** modified.
async fn assert_rejected(request: PasskeyAssertRequest, expected: &str) {
    let (_dir, path, manager) = seeded(Vec::new()).await;
    let target = local_ref(&path);
    register(&target, &manager, create_request()).await;
    let before = std::fs::read(&path).expect("vault readable");

    match passkey_assert_with(&target, PASSWORD, request, &manager).await {
        Err(CommandError::Validation(message)) => {
            assert_eq!(message, expected, "unexpected validation message")
        }
        Err(other) => panic!("expected a validation error, got {other:?}"),
        Ok(_) => panic!("the request must be rejected"),
    }

    let after = std::fs::read(&path).expect("vault readable");
    assert_eq!(before, after, "a rejected request must not touch the vault");
}

#[tokio::test]
async fn assert_rejects_bad_rp_id() {
    let mut request = assert_request();
    request.rp_id = "https://example.com".to_string();
    assert_rejected(request, "RP ID must be a bare host name").await;

    let mut request = assert_request();
    request.rp_id = String::new();
    assert_rejected(request, "RP ID is empty").await;
}

#[tokio::test]
async fn assert_rejects_bad_challenge() {
    let mut request = assert_request();
    request.challenge = encode_base64_urlsafe(&[0u8; MIN_CHALLENGE_LEN - 1]);
    assert_rejected(request, "Challenge length is out of range").await;

    let mut request = assert_request();
    request.challenge = encode_base64_urlsafe(&[0u8; MAX_CHALLENGE_LEN + 1]);
    assert_rejected(request, "Challenge length is out of range").await;

    let mut request = assert_request();
    request.challenge = "not base64!!".to_string();
    assert_rejected(request, "Challenge is not valid base64url").await;
}

#[tokio::test]
async fn assert_rejects_bad_origin() {
    let mut request = assert_request();
    request.origin = "https://example.com/login".to_string();
    assert_rejected(request, "Origin must not carry a path").await;

    let mut request = assert_request();
    request.origin = "ftp://example.com".to_string();
    assert_rejected(request, "Origin must use http or https").await;
}

#[tokio::test]
async fn assert_rejects_bad_allow_credentials() {
    let mut request = assert_request();
    request.allow_credentials = Some(vec![PublicKeyCredentialDescriptor {
        type_: "other".to_string(),
        id: CHALLENGE_B64.to_string(),
    }]);
    assert_rejected(request, "Allowed credential type is not public-key").await;

    let mut request = assert_request();
    request.allow_credentials = Some(vec![PublicKeyCredentialDescriptor {
        type_: PUBLIC_KEY_TYPE.to_string(),
        id: "not base64!!".to_string(),
    }]);
    assert_rejected(request, "Allowed credential id is not valid base64url").await;

    let mut request = assert_request();
    request.credential_id = Some("not base64!!".to_string());
    assert_rejected(request, "Credential id is not valid base64url").await;
}

// ---------------------------------------------------------------------------
// Negative controls — these prove the criterion-1 assertions can fail
// ---------------------------------------------------------------------------

/// Negative control (a): a tampered challenge breaks the signature.
///
/// The signature covers `SHA-256(clientDataJSON)`, and `clientDataJSON` carries
/// the challenge, so re-verifying the same signature against a client data
/// built from a different challenge must fail — which is exactly what a relying
/// party does when the challenge does not match the one it issued.
#[tokio::test]
async fn negative_control_tampered_challenge_fails() -> Result<(), CommandError> {
    let (_dir, path, manager) = seeded(Vec::new()).await;
    let target = local_ref(&path);
    register(&target, &manager, create_request()).await;
    let response = passkey_assert_with(&target, PASSWORD, assert_request(), &manager).await?;

    let loaded = load_vault(&target, PASSWORD, &manager).await?;
    let stored_key = stored_verifying_key(only_passkey(&loaded.vault));
    assert!(verify_response_with(&stored_key, &response), "sanity");

    // Rebuild the signature input with a DIFFERENT challenge.
    let tampered_client_data =
        build_client_data_json(CLIENT_DATA_TYPE_GET, OTHER_CHALLENGE_B64, ORIGIN)?;
    let message = assertion_signature_input(&raw_auth_data(&response), &tampered_client_data);
    assert!(
        verify_es256(&stored_key, &message, &raw_signature(&response)).is_err(),
        "a tampered challenge must break verification"
    );
    Ok(())
}

/// Negative control (b): a tampered `authenticatorData` breaks verification.
#[tokio::test]
async fn negative_control_tampered_auth_data_fails() -> Result<(), CommandError> {
    let (_dir, path, manager) = seeded(Vec::new()).await;
    let target = local_ref(&path);
    register(&target, &manager, create_request()).await;
    let response = passkey_assert_with(&target, PASSWORD, assert_request(), &manager).await?;

    let loaded = load_vault(&target, PASSWORD, &manager).await?;
    let stored_key = stored_verifying_key(only_passkey(&loaded.vault));
    let client_data_json = decode_base64_urlsafe(&response.response.client_data_json)?;

    // Flip one byte of the rpIdHash (a different RP would be a different
    // signature input) and of the flags byte.
    for index in [0usize, 32] {
        let mut tampered = raw_auth_data(&response);
        tampered[index] ^= 0x01;
        let message = assertion_signature_input(&tampered, &client_data_json);
        assert!(
            verify_es256(&stored_key, &message, &raw_signature(&response)).is_err(),
            "a flipped authData byte at {index} must break verification"
        );
    }
    Ok(())
}

/// Negative control (c): a tampered signature breaks verification.
#[tokio::test]
async fn negative_control_tampered_signature_fails() -> Result<(), CommandError> {
    let (_dir, path, manager) = seeded(Vec::new()).await;
    let target = local_ref(&path);
    register(&target, &manager, create_request()).await;
    let response = passkey_assert_with(&target, PASSWORD, assert_request(), &manager).await?;

    let loaded = load_vault(&target, PASSWORD, &manager).await?;
    let stored_key = stored_verifying_key(only_passkey(&loaded.vault));
    let message = assertion_signature_input(
        &raw_auth_data(&response),
        &decode_base64_urlsafe(&response.response.client_data_json)?,
    );

    // Flip the last byte of the DER signature.
    let mut signature = raw_signature(&response);
    let last = signature.len() - 1;
    signature[last] ^= 0x01;
    assert!(
        verify_es256(&stored_key, &message, &signature).is_err(),
        "a flipped signature byte must not verify"
    );

    // A signature from a DIFFERENT key must not verify either.
    let other_key = verifying_key_from_signing(&generate_signing_key()?);
    assert!(
        verify_es256(&other_key, &message, &raw_signature(&response)).is_err(),
        "a signature must only verify under its own key"
    );
    Ok(())
}

/// Negative control (d): the read-only assertion bites — a save between two
/// assertions changes the file, so `assert_readonly`'s byte comparison is a
/// real assertion and not a tautology.
#[tokio::test]
async fn negative_control_readonly_comparison_is_meaningful() -> Result<(), CommandError> {
    let (_dir, path, manager) = seeded(Vec::new()).await;
    let target = local_ref(&path);
    register(&target, &manager, create_request()).await;

    let before = std::fs::read(&path).expect("vault readable");
    // A write path (not the assert command) does change the file.
    let mut loaded = load_vault(&target, PASSWORD, &manager).await?;
    store::save_vault(&target, &mut loaded, &manager).await?;
    let after = std::fs::read(&path).expect("vault readable");
    assert_ne!(
        before, after,
        "a save must change the file, otherwise the read-only check is vacuous"
    );
    Ok(())
}
