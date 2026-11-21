//! End-to-end tests of `import_cxf` (T16).
//!
//! Every test drives the real command body ([`import_cxf_with`]) against a
//! **real vault**: a local `.monark` file in a temp dir, or a hermetic local
//! storage provider standing in for the cloud. No mocked crypto, no mocked
//! vault, no mocked CXF parser — the fixtures are the ones T15 pins.
//!
//! What makes the assertions meaningful:
//!
//! * the report is compared field by field (counts **and** the exact skip
//!   reasons, which is what the user sees);
//! * the stored entry is read back from disk through the `read_vault` command
//!   (the sanitized view) *and* through the store seam (the raw entry, key
//!   included), so both the IPC projection and the persisted key are checked;
//! * the vault **file bytes** are compared before/after whenever the import must
//!   not write, which is the only assertion that catches a regression that
//!   re-saves an unchanged vault (the counts would still match).
//!
//! The negative controls at the bottom mutate the implementation on purpose and
//! prove that the byte-comparison and the "validate before IO" assertions bite.

use super::*;
use crate::models::{EntryView, VaultView};
use crate::passkey::cxf::CxfSkipped;
use crate::passkey::es256::signing_key_from_pkcs8_der;
use crate::passkey::store::load_vault;
use crate::storage::{StorageConfig, StorageManager};
use crate::vault::rate_limit;
use std::path::{Path, PathBuf};
use tempfile::TempDir;
use zeroize::Zeroizing;

const PASSWORD: &str = "t16-import-password";

// ---------------------------------------------------------------------------
// Fixtures (same `include_str!` pattern as `passkey/cxf.rs`)
// ---------------------------------------------------------------------------

const FIXTURE_SPEC_APPENDIX_A: &str = include_str!("../../../fixtures/cxf/spec-appendix-a.json");
const FIXTURE_VALID_SINGLE: &str = include_str!("../../../fixtures/cxf/valid-single.json");
const FIXTURE_VALID_MULTI: &str = include_str!("../../../fixtures/cxf/valid-multi-account.json");
const FIXTURE_DUPLICATE: &str = include_str!("../../../fixtures/cxf/duplicate-credential.json");
const FIXTURE_BAD_BASE64: &str = include_str!("../../../fixtures/cxf/bad-base64.json");
const FIXTURE_WRONG_CURVE: &str = include_str!("../../../fixtures/cxf/wrong-curve-key.json");
const FIXTURE_BAD_RPID: &str = include_str!("../../../fixtures/cxf/bad-rpid.json");
const FIXTURE_MISSING_FIELDS: &str = include_str!("../../../fixtures/cxf/missing-fields.json");
const FIXTURE_WRONG_MAJOR: &str = include_str!("../../../fixtures/cxf/wrong-major-version.json");

/// The published CXF Appendix A example key (PKCS#8 DER, base64url) — the same
/// value `passkey/cxf.rs` pins. An example credential, **not** a secret.
const SPEC_KEY_B64URL: &str = "MIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQgARu_0sCt20EpgVxb4Puq3Ga5VVLpuTY75ngvZlyq3X6hRANCAASmdk1xLsK0oOlhxIPp0d1ZuS0sT9nf6BZtSelhqvLBW0fOL33l_bXgsr_STUHjCLn8l6gcRJwe7OQvbQubZ1dY";

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

/// Writes an empty (or `entries`-holding) vault straight to disk with a fresh
/// master key wrapped under [`PASSWORD`], the layout the lifecycles produce.
fn seed_vault(dir: &TempDir, name: &str, entries: Vec<Entry>) -> PathBuf {
    let path = dir.path().join(name);
    let vault = crate::models::Vault {
        updated_at: Utc::now(),
        hmac: String::new(),
        entries,
    };
    let (argon2_params, credentials, master_key) =
        crate::vault::keys::create_key_material(PASSWORD).expect("seed key material");
    let encrypted =
        crate::vault::keys::encrypt_vault_content(&master_key, &vault).expect("seed encrypt");
    let vault_file = crate::models::VaultFile {
        version: crate::vault::version::CURRENT_VAULT_VERSION.to_string(),
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

/// A seeded empty vault plus the manager that can open it.
async fn seeded_empty() -> (TempDir, PathBuf, Arc<StorageManager>) {
    let dir = TempDir::new().expect("temp dir");
    let path = seed_vault(&dir, "import.monark", Vec::new());
    let manager = local_manager(&dir).await;
    (dir, path, manager)
}

/// The exact bytes of the vault file (the atomicity evidence).
fn file_bytes(path: &Path) -> Vec<u8> {
    std::fs::read(path).expect("vault file is readable")
}

/// The stored version string of the vault file.
fn stored_version(path: &Path) -> String {
    crate::io::vault::read_vault(path.to_string_lossy().to_string())
        .expect("vault file parses")
        .version
}

/// The vault content as the frontend sees it (`read_vault`-shaped view).
fn view_of(path: &Path) -> VaultView {
    let vault_file = crate::io::vault::read_vault(path.to_string_lossy().to_string())
        .expect("vault file parses");
    let master_key = crate::vault::keys::derive_and_decrypt_master_key(PASSWORD, &vault_file)
        .expect("password unlocks the vault");
    let vault = crate::vault::keys::decrypt_vault_content(&master_key, &vault_file)
        .expect("vault decrypts");
    VaultView::from(&vault)
}

/// Every passkey of the view (recursive), in document order.
fn view_passkeys(view: &VaultView) -> Vec<&crate::models::PasskeyView> {
    fn walk<'a>(entries: &'a [EntryView], out: &mut Vec<&'a crate::models::PasskeyView>) {
        for entry in entries {
            match entry {
                EntryView::Passkey(passkey) => out.push(passkey),
                EntryView::Group { children, .. } => walk(children, out),
                EntryView::Data { .. } => {}
            }
        }
    }
    let mut out = Vec::new();
    walk(&view.entries, &mut out);
    out
}

/// Every passkey of the raw vault (recursive), in document order.
fn raw_passkeys(entries: &[Entry]) -> Vec<&Entry> {
    fn walk<'a>(entries: &'a [Entry], out: &mut Vec<&'a Entry>) {
        for entry in entries {
            match entry {
                Entry::Passkey { .. } => out.push(entry),
                Entry::Group { children, .. } => walk(children, out),
                Entry::Data { .. } => {}
            }
        }
    }
    let mut out = Vec::new();
    walk(entries, &mut out);
    out
}

/// The stored PKCS#8 DER of a passkey entry.
fn stored_pkcs8(entry: &Entry) -> Zeroizing<Vec<u8>> {
    match entry {
        Entry::Passkey { private_key, .. } => private_key.to_pkcs8_der().expect("key decodes"),
        other => panic!("expected a passkey, got {other:?}"),
    }
}

/// The skip report as `(item title, credential type, reason)` tuples.
fn skips(report: &CxfImportReport) -> Vec<(String, String, String)> {
    report
        .skipped
        .iter()
        .map(|skip| {
            (
                skip.item_title.clone(),
                skip.credential_type.clone(),
                skip.reason.clone(),
            )
        })
        .collect()
}

/// A `CxfSkipped` built the way the command builds it (for exact comparisons).
fn skipped(title: &str, credential_type: &str, reason: &str) -> CxfSkipped {
    CxfSkipped {
        item_title: title.to_string(),
        credential_type: credential_type.to_string(),
        reason: reason.to_string(),
    }
}

// ---------------------------------------------------------------------------
// Criterion 1 — happy path: valid-single.json into an empty vault
// ---------------------------------------------------------------------------

#[tokio::test]
async fn import_single_into_empty_vault() -> Result<(), CommandError> {
    let (_dir, path, manager) = seeded_empty().await;
    let target = local_ref(&path);

    let report = import_cxf_with(&target, PASSWORD, FIXTURE_VALID_SINGLE, &manager).await?;

    assert_eq!(
        report,
        CxfImportReport {
            imported: 1,
            duplicates: 0,
            skipped: Vec::new(),
        },
        "a valid single-credential document imports exactly one passkey"
    );

    // --- The frontend view shows the passkey (no key material in it). ---
    let view = view_of(&path);
    let passkeys = view_passkeys(&view);
    assert_eq!(passkeys.len(), 1);
    let passkey = passkeys[0];
    assert_eq!(passkey.name, "WebAuthn.io");
    assert_eq!(passkey.rp_id, "webauthn.io");
    assert_eq!(passkey.rp_name, "webauthn.io", "rp_name is the rp_id (Q12)");
    assert_eq!(passkey.user_name, "johndoe");
    assert_eq!(passkey.user_display_name, "John Doe");
    assert_eq!(passkey.tags, vec!["work".to_string()]);
    assert_eq!(passkey.algorithm, -7);
    assert_eq!(passkey.sign_count, 0);
    assert!(passkey.discoverable);
    assert_eq!(passkey.transports, vec!["internal".to_string()]);
    assert_eq!(passkey.aaguid, Uuid::nil());
    // `credentialId` is the fixture's base64url value, decoded to bytes.
    assert_eq!(
        passkey.credential_id,
        crate::crypto::base64::decode_base64_urlsafe("Y3JlZGVudGlhbElkRXhhbXBsZQ")
            .expect("fixture credential id is b64url")
    );
    // The item timestamps are used when the item carries them.
    assert_eq!(passkey.created_at.timestamp(), 1_705_142_400);
    assert_eq!(passkey.updated_at.timestamp(), 1_705_228_800);

    // --- The stored key is byte-identical to the fixture key. ---
    let loaded = load_vault(&target, PASSWORD, &manager).await?;
    let raw = raw_passkeys(&loaded.vault.entries);
    assert_eq!(raw.len(), 1);
    let expected_key = crate::crypto::base64::decode_base64_urlsafe(SPEC_KEY_B64URL)
        .expect("fixture key is b64url");
    assert_eq!(
        stored_pkcs8(raw[0]).as_slice(),
        expected_key.as_slice(),
        "the imported key must be the fixture key, byte for byte"
    );
    // ...and it is a usable ES256 key (the same check the ceremony performs).
    signing_key_from_pkcs8_der(&stored_pkcs8(raw[0]))
        .expect("the stored key is a valid P-256 PKCS#8 key");

    // --- The version policy bumped the vault to 1.1 (Q9). ---
    assert_eq!(stored_version(&path), "1.1");
    Ok(())
}

// ---------------------------------------------------------------------------
// Criterion 2 — re-import: duplicates, and NO write (negative control)
// ---------------------------------------------------------------------------

#[tokio::test]
async fn reimport_counts_duplicates_and_leaves_file_bytes_identical() -> Result<(), CommandError> {
    let (_dir, path, manager) = seeded_empty().await;
    let target = local_ref(&path);

    let first = import_cxf_with(&target, PASSWORD, FIXTURE_VALID_SINGLE, &manager).await?;
    assert_eq!(first.imported, 1);

    let before = file_bytes(&path);

    let second = import_cxf_with(&target, PASSWORD, FIXTURE_VALID_SINGLE, &manager).await?;
    assert_eq!(
        second,
        CxfImportReport {
            imported: 0,
            duplicates: 1,
            skipped: Vec::new(),
        },
        "a re-import is one duplicate, not a skip and not an import"
    );

    // The vault file must be byte-identical: no re-encryption, no `updated_at`
    // stamp, no version bump. This is the assertion that bites — a regression
    // that saved unconditionally would keep both counts identical.
    let after = file_bytes(&path);
    assert_eq!(
        before, after,
        "imported == 0 must not write the vault file (bytes changed)"
    );

    // Still exactly one passkey on disk.
    let loaded = load_vault(&target, PASSWORD, &manager).await?;
    assert_eq!(raw_passkeys(&loaded.vault.entries).len(), 1);
    Ok(())
}

#[tokio::test]
async fn reimport_of_duplicate_fixture_keeps_one_entry() -> Result<(), CommandError> {
    // `duplicate-credential.json` holds the same credential twice (same RP) and
    // once more under a different RP: the pair is `(rp_id, credential_id)`, so
    // the second WebAuthn.io credential is a duplicate and the example.com one
    // is a distinct passkey (Q8).
    let (_dir, path, manager) = seeded_empty().await;
    let target = local_ref(&path);

    let report = import_cxf_with(&target, PASSWORD, FIXTURE_DUPLICATE, &manager).await?;
    assert_eq!(
        report.imported, 2,
        "two distinct (rp_id, credential_id) pairs"
    );
    assert_eq!(report.duplicates, 1, "the repeated pair is a duplicate");
    assert!(report.skipped.is_empty());

    let loaded = load_vault(&target, PASSWORD, &manager).await?;
    let stored = raw_passkeys(&loaded.vault.entries);
    assert_eq!(stored.len(), 2);
    let mut rp_ids: Vec<&str> = stored
        .iter()
        .map(|entry| match entry {
            Entry::Passkey { rp_id, .. } => rp_id.as_str(),
            other => panic!("expected a passkey, got {other:?}"),
        })
        .collect();
    rp_ids.sort_unstable();
    assert_eq!(rp_ids, vec!["example.com", "webauthn.io"]);
    Ok(())
}

// ---------------------------------------------------------------------------
// Criterion 3 — non-passkey credentials are skipped with their exact type
// ---------------------------------------------------------------------------

#[tokio::test]
async fn import_spec_appendix_a_skips_non_passkeys() -> Result<(), CommandError> {
    let (_dir, path, manager) = seeded_empty().await;
    let target = local_ref(&path);

    let report = import_cxf_with(&target, PASSWORD, FIXTURE_SPEC_APPENDIX_A, &manager).await?;

    assert_eq!(report.imported, 1);
    assert_eq!(report.duplicates, 0);
    assert_eq!(
        report.skipped,
        vec![
            skipped(
                "Example login",
                "basic-auth",
                "unsupported credential type: basic-auth"
            ),
            skipped("Example TOTP", "totp", "unsupported credential type: totp"),
        ],
        "non-passkey credentials are reported, never silently dropped"
    );

    // Only the passkey reached the vault.
    let loaded = load_vault(&target, PASSWORD, &manager).await?;
    assert_eq!(loaded.vault.entries.len(), 1);
    assert_eq!(raw_passkeys(&loaded.vault.entries).len(), 1);
    Ok(())
}

// ---------------------------------------------------------------------------
// Criterion 4 — malformed credentials are isolated per credential
// ---------------------------------------------------------------------------

#[tokio::test]
async fn malformed_credentials_are_skipped_with_reasons() -> Result<(), CommandError> {
    let (_dir, path, manager) = seeded_empty().await;
    let target = local_ref(&path);
    let before = file_bytes(&path);

    let report = import_cxf_with(&target, PASSWORD, FIXTURE_BAD_BASE64, &manager).await?;

    assert_eq!(
        report.imported, 0,
        "every credential of this fixture is bad"
    );
    assert_eq!(report.duplicates, 0);
    assert_eq!(
        skips(&report),
        vec![
            (
                "Padded credential id".to_string(),
                "passkey".to_string(),
                "credentialId is not valid base64url (URL_SAFE_NO_PAD)".to_string()
            ),
            (
                "Standard-alphabet user handle".to_string(),
                "passkey".to_string(),
                "userHandle is not valid base64url (URL_SAFE_NO_PAD)".to_string()
            ),
            (
                "Garbage key".to_string(),
                "passkey".to_string(),
                "key is not valid base64url (URL_SAFE_NO_PAD)".to_string()
            ),
        ]
    );

    // Nothing imported → nothing written.
    assert_eq!(
        before,
        file_bytes(&path),
        "a fully skipped import must not write"
    );
    Ok(())
}

#[tokio::test]
async fn wrong_curve_and_bad_rp_id_are_skipped_with_reasons() -> Result<(), CommandError> {
    let (_dir, path, manager) = seeded_empty().await;
    let target = local_ref(&path);

    let curve = import_cxf_with(&target, PASSWORD, FIXTURE_WRONG_CURVE, &manager).await?;
    assert_eq!(curve.imported, 0);
    assert_eq!(
        skips(&curve),
        vec![
            (
                "Ed25519 key".to_string(),
                "passkey".to_string(),
                "private key is not a valid P-256 PKCS#8 key".to_string()
            ),
            (
                "P-384 key".to_string(),
                "passkey".to_string(),
                "private key is not a valid P-256 PKCS#8 key".to_string()
            ),
        ],
        "ES256-only: other curves are rejected with the key-format reason"
    );

    let rp_id = import_cxf_with(&target, PASSWORD, FIXTURE_BAD_RPID, &manager).await?;
    assert_eq!(rp_id.imported, 0);
    assert_eq!(rp_id.skipped.len(), 5);
    assert!(
        rp_id
            .skipped
            .iter()
            .all(|skip| skip.reason == "rpId is not a valid relying party identifier"),
        "every rpId rule failure carries the same user-facing reason: {:?}",
        rp_id.skipped
    );
    Ok(())
}

#[tokio::test]
async fn missing_fields_are_skipped_with_field_named_reasons() -> Result<(), CommandError> {
    let (_dir, path, manager) = seeded_empty().await;
    let target = local_ref(&path);

    let report = import_cxf_with(&target, PASSWORD, FIXTURE_MISSING_FIELDS, &manager).await?;

    assert_eq!(report.imported, 0);
    assert_eq!(
        skips(&report),
        vec![
            (
                "Missing rpId".to_string(),
                "passkey".to_string(),
                "missing or malformed field: rpId".to_string()
            ),
            (
                "Missing key".to_string(),
                "passkey".to_string(),
                "missing or malformed field: key".to_string()
            ),
            (
                "Missing credential type".to_string(),
                "(missing)".to_string(),
                "missing or malformed field: type".to_string()
            ),
            // A wrong JSON *type* is reported generically: serde's message would
            // quote the value, which must never reach a user-facing reason.
            (
                "Wrong JSON type for credentialId".to_string(),
                "passkey".to_string(),
                "missing or malformed field: credential".to_string()
            ),
            (
                "Credential is not an object".to_string(),
                "(missing)".to_string(),
                "missing or malformed field: type".to_string()
            ),
        ]
    );
    Ok(())
}

#[tokio::test]
async fn valid_credentials_import_while_others_are_skipped() -> Result<(), CommandError> {
    // Per-credential isolation: a document that mixes valid and invalid
    // credentials imports the valid ones and reports the rest.
    let (_dir, path, manager) = seeded_empty().await;
    let target = local_ref(&path);

    let mut document: serde_json::Value =
        serde_json::from_str(FIXTURE_VALID_MULTI).expect("fixture is JSON");
    document["accounts"][0]["items"]
        .as_array_mut()
        .expect("items array")
        .push(serde_json::json!({
            "id": "broken-item",
            "title": "Broken key",
            "credentials": [{
                "type": "passkey",
                "credentialId": "YnJva2VuLWNyZWRlbnRpYWw",
                "rpId": "webauthn.io",
                "username": "johndoe",
                "userDisplayName": "John Doe",
                "userHandle": "YnJva2VuLXVzZXI",
                "key": "not base64 at all!!!"
            }]
        }));

    let report = import_cxf_with(&target, PASSWORD, &document.to_string(), &manager).await?;

    assert_eq!(report.imported, 3, "the three valid passkeys still import");
    assert_eq!(report.duplicates, 0);
    // The fixture's third item carries `fido2Extensions`, so it is imported
    // *and* reported; the broken credential is only skipped.
    assert_eq!(
        skips(&report),
        vec![
            (
                "Broken key".to_string(),
                "passkey".to_string(),
                "key is not valid base64url (URL_SAFE_NO_PAD)".to_string()
            ),
            (
                "Third item".to_string(),
                "passkey".to_string(),
                crate::passkey::cxf::EXTENSIONS_IGNORED_NOTE.to_string()
            ),
        ]
    );
    Ok(())
}

#[tokio::test]
async fn import_multi_account_maps_timestamps_and_extensions() -> Result<(), CommandError> {
    let (_dir, path, manager) = seeded_empty().await;
    let target = local_ref(&path);

    let report = import_cxf_with(&target, PASSWORD, FIXTURE_VALID_MULTI, &manager).await?;

    assert_eq!(report.imported, 3);
    assert_eq!(report.duplicates, 0);
    // The third item carries `fido2Extensions`: imported, and reported (Q11).
    assert_eq!(
        report.skipped,
        vec![skipped(
            "Third item",
            "passkey",
            crate::passkey::cxf::EXTENSIONS_IGNORED_NOTE
        )],
        "ignored extension data is reported, not silently dropped"
    );

    let view = view_of(&path);
    let passkeys = view_passkeys(&view);
    assert_eq!(passkeys.len(), 3);

    // Item 1: timestamps from the item.
    assert_eq!(passkeys[0].name, "WebAuthn.io");
    assert_eq!(passkeys[0].created_at.timestamp(), 1_705_142_400);
    assert_eq!(passkeys[0].updated_at.timestamp(), 1_705_228_800);
    assert_eq!(passkeys[0].tags, vec!["work".to_string()]);

    // Item 2: no timestamps on the wire → `now` for both, and no tags.
    assert_eq!(passkeys[1].name, "Second item, no timestamps");
    assert!(passkeys[1].tags.is_empty());
    assert_eq!(
        passkeys[1].created_at, passkeys[1].updated_at,
        "both timestamps come from the same `now`"
    );
    assert!(
        (Utc::now() - passkeys[1].created_at).num_seconds().abs() < 300,
        "a missing creationAt falls back to now"
    );

    // Item 3: tags from the item, extensions ignored.
    assert_eq!(passkeys[2].name, "Third item");
    assert_eq!(passkeys[2].tags, vec!["personal".to_string()]);
    assert_eq!(passkeys[2].user_name, "janedoe");
    Ok(())
}

/// A one-account, one-item, one-passkey CXF document with the given item
/// members, built from the committed `valid-single.json` fixture so the
/// credential itself stays the real, validated one.
///
/// `item_members` is a list **in document order** and the members are spliced
/// into the raw JSON as text: `serde_json::Map` is a `BTreeMap` by default, so
/// going through `Value` would sort the keys and reorder `creationAt` /
/// `modifiedAt`. Order is what the CXF spec pins, and a test that silently
/// reordered the members would not be testing the document a real exporter
/// writes.
fn single_item_document(item_members: &[(&str, &str)]) -> String {
    let mut document: serde_json::Value =
        serde_json::from_str(FIXTURE_VALID_SINGLE).expect("fixture is JSON");
    let item = document["accounts"][0]["items"][0]
        .as_object_mut()
        .expect("the fixture has one item object");
    // Drop the fixture's own timestamps/title so each test states exactly which
    // members the item carries.
    for member in ["creationAt", "modifiedAt", "title"] {
        item.remove(member);
    }

    let rendered = item_members
        .iter()
        .map(|(member, value)| {
            format!(
                "{}:{value}",
                serde_json::Value::String((*member).to_string())
            )
        })
        .collect::<Vec<_>>()
        .join(",");

    // Splice the members in at the start of the item object, keeping the order.
    let serialized = document.to_string();
    let needle = "\"items\":[{";
    let at = serialized
        .find(needle)
        .expect("the fixture has an items array")
        + needle.len();
    let mut out = String::with_capacity(serialized.len() + rendered.len() + 1);
    out.push_str(&serialized[..at]);
    out.push_str(&rendered);
    out.push(',');
    out.push_str(&serialized[at..]);

    // A helper that produced something the parser rejects would make every
    // test below fail for the wrong reason, so the document is checked here.
    let parsed: serde_json::Value =
        serde_json::from_str(&out).expect("the generated document is valid JSON");
    let item = parsed["accounts"][0]["items"][0]
        .as_object()
        .expect("the generated item is an object");
    for (member, _) in item_members {
        assert!(
            item.contains_key(*member),
            "the generated item must carry `{member}`: {out}"
        );
    }
    out
}

/// The single passkey of the view (panics with a readable message otherwise).
fn only_passkey(view: &VaultView) -> crate::models::PasskeyView {
    let mut passkeys = view_passkeys(view);
    assert_eq!(passkeys.len(), 1, "expected exactly one passkey");
    passkeys.remove(0).clone()
}

// ---------------------------------------------------------------------------
// MENOR-3 — one-sided item timestamps keep the value the file carries
// ---------------------------------------------------------------------------

#[tokio::test]
async fn modified_at_only_item_keeps_its_timestamp() -> Result<(), CommandError> {
    // `creationAt` and `modifiedAt` are both optional in CXF, and a
    // `modifiedAt`-only item is a legal (and for hand-rolled exporters common)
    // shape. The fallback applies to the *missing* member: `created_at` must be
    // derived from `modifiedAt`, not from `now`, and the clamp must not rewrite
    // the genuine timestamp.
    let (_dir, path, manager) = seeded_empty().await;
    let target = local_ref(&path);
    let document =
        single_item_document(&[("title", "\"Modified only\""), ("modifiedAt", "1705228800")]);

    let report = import_cxf_with(&target, PASSWORD, &document, &manager).await?;
    assert_eq!(report.imported, 1);

    let passkey = only_passkey(&view_of(&path));
    assert_eq!(passkey.name, "Modified only");
    assert_eq!(
        passkey.created_at.timestamp(),
        1_705_228_800,
        "a missing creationAt falls back to the item's modifiedAt"
    );
    assert_eq!(
        passkey.updated_at.timestamp(),
        1_705_228_800,
        "the genuine modifiedAt must survive (not be rewritten to `now`)"
    );
    Ok(())
}

#[tokio::test]
async fn creation_at_only_item_uses_it_for_both_timestamps() -> Result<(), CommandError> {
    // The mirror case: with no `modifiedAt`, the entry has never been modified
    // since it was created, so `updated_at == created_at` — and neither is `now`.
    let (_dir, path, manager) = seeded_empty().await;
    let target = local_ref(&path);
    let document =
        single_item_document(&[("title", "\"Created only\""), ("creationAt", "1705142400")]);

    let before = Utc::now();
    let report = import_cxf_with(&target, PASSWORD, &document, &manager).await?;
    let after = Utc::now();
    assert_eq!(report.imported, 1);

    let passkey = only_passkey(&view_of(&path));
    assert_eq!(passkey.name, "Created only");
    assert_eq!(
        passkey.created_at.timestamp(),
        1_705_142_400,
        "the item's creationAt is kept"
    );
    // With no `modifiedAt` the entry is stamped `now` and then clamped up to
    // `created_at`, so it never claims to have been modified before it existed.
    // (A `creationAt` in the past therefore yields `updated_at == now`, not
    // `updated_at == created_at`; the invariant is `updated_at >= created_at`.)
    assert!(
        passkey.updated_at >= before && passkey.updated_at <= after,
        "a missing modifiedAt falls back to `now`: {} not in [{before}, {after}]",
        passkey.updated_at
    );
    assert!(
        passkey.updated_at >= passkey.created_at,
        "the entry must never be modified before it was created"
    );
    Ok(())
}

#[tokio::test]
async fn future_creation_at_clamps_updated_at_up_to_it() -> Result<(), CommandError> {
    // The clamp's own case, now reachable through the one-sided shape: a
    // `creationAt` in the future with no `modifiedAt` gives `updated_at == now`
    // which is *before* `created_at`, so it is clamped up. The entry must never
    // claim to have been modified before it was created.
    let (_dir, path, manager) = seeded_empty().await;
    let target = local_ref(&path);
    let future = (Utc::now() + chrono::Duration::days(1)).timestamp() as u64;
    let document = single_item_document(&[
        ("title", "\"Future only\""),
        ("creationAt", &future.to_string()),
    ]);

    let report = import_cxf_with(&target, PASSWORD, &document, &manager).await?;
    assert_eq!(report.imported, 1);

    let passkey = only_passkey(&view_of(&path));
    assert_eq!(passkey.created_at.timestamp(), future as i64);
    assert_eq!(
        passkey.updated_at, passkey.created_at,
        "updated_at is clamped up to a future created_at"
    );
    Ok(())
}

// ---------------------------------------------------------------------------
// MENOR-4 — `name` falls back to `username@rpId` when the title is blank
// ---------------------------------------------------------------------------

#[tokio::test]
async fn blank_title_falls_back_to_username_at_rp_id() -> Result<(), CommandError> {
    // `CxfItem.title` is a required string with no non-empty rule (T15
    // validates credentials, never the title), so `"title": ""` reaches the
    // mapping. An entry with an empty name is invisible in every list UI.
    for title in ["", "   ", "\t\n"] {
        let (_dir, path, manager) = seeded_empty().await;
        let target = local_ref(&path);
        let quoted = serde_json::Value::String(title.to_string()).to_string();
        let document = single_item_document(&[("title", quoted.as_str())]);

        let report = import_cxf_with(&target, PASSWORD, &document, &manager).await?;
        assert_eq!(
            report.imported, 1,
            "a blank title must not block the import"
        );

        let passkey = only_passkey(&view_of(&path));
        assert_eq!(
            passkey.name, "johndoe@webauthn.io",
            "a blank title ({title:?}) falls back to username@rpId"
        );
        // The rest of the mapping is unaffected by the fallback.
        assert_eq!(passkey.rp_id, "webauthn.io");
        assert_eq!(passkey.user_name, "johndoe");
    }
    Ok(())
}

#[tokio::test]
async fn non_blank_title_is_used_verbatim() -> Result<(), CommandError> {
    // The fallback must not fire for a real title (including one with inner
    // whitespace): the file's title is what the user named the item.
    let (_dir, path, manager) = seeded_empty().await;
    let target = local_ref(&path);
    let document = single_item_document(&[("title", "\"  My login  \"")]);

    let report = import_cxf_with(&target, PASSWORD, &document, &manager).await?;
    assert_eq!(report.imported, 1);

    let passkey = only_passkey(&view_of(&path));
    assert_eq!(
        passkey.name, "  My login  ",
        "a non-blank title is stored verbatim (no trimming on import)"
    );
    Ok(())
}

#[tokio::test]
async fn import_places_passkeys_at_the_root() -> Result<(), CommandError> {
    // Ruling Q12: imported passkeys go to the vault root, never into a group.
    let dir = TempDir::new().expect("temp dir");
    let group = Entry::Group {
        id: Uuid::new_v4(),
        name: "Existing group".to_string(),
        data_type: "group".to_string(),
        children: Vec::new(),
    };
    let path = seed_vault(&dir, "rooted.monark", vec![group]);
    let manager = local_manager(&dir).await;
    let target = local_ref(&path);

    let report = import_cxf_with(&target, PASSWORD, FIXTURE_VALID_SINGLE, &manager).await?;
    assert_eq!(report.imported, 1);

    let loaded = load_vault(&target, PASSWORD, &manager).await?;
    assert_eq!(loaded.vault.entries.len(), 2, "group + passkey at the root");
    assert!(matches!(loaded.vault.entries[0], Entry::Group { .. }));
    assert!(matches!(loaded.vault.entries[1], Entry::Passkey { .. }));
    Ok(())
}

#[tokio::test]
async fn import_dedups_against_passkeys_nested_in_groups() -> Result<(), CommandError> {
    // The dedup index is recursive: a passkey inside a group still counts, so a
    // document cannot re-import it at the root.
    let dir = TempDir::new().expect("temp dir");
    let manager = local_manager(&dir).await;

    // Import once to obtain a real passkey entry, then move it into a group.
    let path = seed_vault(&dir, "nested.monark", Vec::new());
    let target = local_ref(&path);
    let first = import_cxf_with(&target, PASSWORD, FIXTURE_VALID_SINGLE, &manager).await?;
    assert_eq!(first.imported, 1);

    let mut loaded = load_vault(&target, PASSWORD, &manager).await?;
    let passkey = loaded.vault.entries.remove(0);
    loaded.vault.entries.push(Entry::Group {
        id: Uuid::new_v4(),
        name: "Nested".to_string(),
        data_type: "group".to_string(),
        children: vec![passkey],
    });
    store::save_vault(&target, &mut loaded, &manager).await?;

    let second = import_cxf_with(&target, PASSWORD, FIXTURE_VALID_SINGLE, &manager).await?;
    assert_eq!(
        second,
        CxfImportReport {
            imported: 0,
            duplicates: 1,
            skipped: Vec::new(),
        },
        "a passkey nested in a group is still a duplicate"
    );

    let reloaded = load_vault(&target, PASSWORD, &manager).await?;
    assert_eq!(reloaded.vault.entries.len(), 1, "nothing new at the root");
    Ok(())
}

// ---------------------------------------------------------------------------
// Criterion 5 — envelope failure happens before any IO (negative control)
// ---------------------------------------------------------------------------

#[tokio::test]
async fn envelope_failure_leaves_vault_untouched_and_costs_no_attempt() -> Result<(), CommandError>
{
    let (_dir, path, manager) = seeded_empty().await;
    let target = local_ref(&path);
    let canonical = path
        .canonicalize()
        .expect("canonical path")
        .to_string_lossy()
        .to_string();
    rate_limit::reset_attempts(&canonical);
    let before = file_bytes(&path);

    // Wrong major version, invalid JSON, oversized document: all envelope-level.
    let oversized = format!(
        "{{\"padding\":\"{}\"}}",
        "x".repeat(crate::passkey::cxf::MAX_ENVELOPE_BYTES)
    );
    for (content, expected) in [
        (FIXTURE_WRONG_MAJOR, "Unsupported CXF major version"),
        ("{not json", "CXF document is not valid JSON"),
        (oversized.as_str(), "CXF document exceeds the 10 MiB limit"),
    ] {
        match import_cxf_with(&target, PASSWORD, content, &manager).await {
            Err(CommandError::Validation(message)) => assert_eq!(message, expected),
            other => panic!("expected a Validation error, got {other:?}"),
        }
    }

    // No write, no rate-limit slot, no password derivation.
    assert_eq!(
        before,
        file_bytes(&path),
        "an envelope-level failure must not touch the vault"
    );
    // NOTE: with a *correct* password this counter is 0 wherever
    // `parse_envelope` sits (`load_vault` resets it on success), so this
    // assertion is blind to the ordering — it only pins "no attempt was
    // recorded". The ordering itself is pinned by
    // `envelope_failure_wins_over_a_wrong_password`, where the password is
    // wrong and a parse-after-load regression would burn an attempt.
    assert_eq!(
        rate_limit::failure_count(&canonical),
        0,
        "an envelope-level failure must not count as a password attempt"
    );
    Ok(())
}

#[tokio::test]
async fn envelope_failure_wins_over_a_wrong_password() -> Result<(), CommandError> {
    // Ordering proof: the document is validated first, so a malformed document
    // reports the document error even when the password is also wrong.
    let (_dir, path, manager) = seeded_empty().await;
    let target = local_ref(&path);
    let canonical = path
        .canonicalize()
        .expect("canonical path")
        .to_string_lossy()
        .to_string();
    rate_limit::reset_attempts(&canonical);

    // The counter is read *before* the error is inspected: under the NC-2
    // mutation (parse after load) the call returns the password error, and a
    // `panic!` on that branch would abort the test before the counter assertion
    // ever ran — the test would still be red, but for the wrong reason.
    let outcome = import_cxf_with(&target, "wrong-password", FIXTURE_WRONG_MAJOR, &manager).await;
    let failures = rate_limit::failure_count(&canonical);

    // The assertion that actually bites: with a WRONG password, a
    // `parse_envelope` moved after `load_vault` tries the password first, fails,
    // records the attempt, and only then rejects the document — leaving
    // `failure_count == 1` here. The document must be rejected before the
    // password is even tried.
    assert_eq!(
        failures, 0,
        "the document must be rejected before the password is even tried"
    );
    match outcome {
        Err(CommandError::Validation(message)) => {
            assert_eq!(message, "Unsupported CXF major version")
        }
        other => panic!("expected the envelope error first, got {other:?}"),
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Criterion 6 — wrong password: rate-limited, vault untouched
// ---------------------------------------------------------------------------

#[tokio::test]
async fn wrong_password_is_rate_limited_and_leaves_vault_untouched() -> Result<(), CommandError> {
    let (_dir, path, manager) = seeded_empty().await;
    let target = local_ref(&path);
    let canonical = path
        .canonicalize()
        .expect("canonical path")
        .to_string_lossy()
        .to_string();
    rate_limit::reset_attempts(&canonical);
    let before = file_bytes(&path);

    for attempt in 1..=rate_limit::MAX_FREE_ATTEMPTS {
        match import_cxf_with(&target, "wrong-password", FIXTURE_VALID_SINGLE, &manager).await {
            Err(CommandError::Validation(message)) => panic!(
                "a wrong password must not be reported as a document validation error: {message}"
            ),
            Err(_) => {}
            Ok(_) => panic!("a wrong password must never import anything"),
        }
        assert_eq!(
            rate_limit::failure_count(&canonical),
            attempt,
            "attempt {attempt} must be counted exactly once"
        );
    }

    assert_eq!(
        before,
        file_bytes(&path),
        "a wrong password must not touch the vault"
    );
    Ok(())
}

// ---------------------------------------------------------------------------
// Criterion 7 — cloud branch through the same seam
// ---------------------------------------------------------------------------

#[tokio::test]
async fn import_into_cloud_vault_roundtrip() -> Result<(), CommandError> {
    // The cloud branch is the same code path with a different transport: a
    // local provider stands in for the remote one (no network), exactly like
    // `passkey::store::tests::cloud_load_save_roundtrip`.
    //
    // NOTE (NIT-1): `set_cloud_cache_path` writes a process-global `OnceLock`
    // that is *first-wins*, and several tests in this binary set it. Whichever
    // runs first owns the cache directory for the whole test binary; this test
    // therefore only gets the directory below when it happens to win the race.
    // That is harmless here because nothing asserted below depends on the cache
    // directory: the cloud path always reads the provider (ruling R9, no
    // cache fallback), so the round-trip is exercised either way. Making the
    // cache directory injectable is a T08 follow-up, not a T16 concern.
    let dir = TempDir::new().expect("temp dir");
    crate::vault::cloud_lifecycle::set_cloud_cache_path(dir.path().join("cloud_cache"));
    let manager = local_manager(&dir).await;

    let file_id = crate::vault::cloud_lifecycle::write_cloud_vault_with(
        "import".to_string(),
        PASSWORD.to_string(),
        VaultView::from(&crate::models::Vault {
            updated_at: Utc::now(),
            hmac: String::new(),
            entries: Vec::new(),
        }),
        None,
        None,
        None,
        &manager,
    )
    .await?;

    let target = VaultRef::Cloud {
        vault_id: file_id.clone(),
        provider_name: None,
    };

    let report = import_cxf_with(&target, PASSWORD, FIXTURE_VALID_SINGLE, &manager).await?;
    assert_eq!(report.imported, 1);
    assert_eq!(report.duplicates, 0);

    // The provider file holds the encrypted envelope only.
    let raw = manager
        .read_file(file_id.clone(), None)
        .await
        .map_err(|_e| CommandError::Io("Failed to read vault file".to_string()))?;
    let raw_text = String::from_utf8_lossy(&raw);
    assert!(
        !raw_text.contains("WebAuthn.io") && !raw_text.contains("webauthn.io"),
        "the provider file must never contain plaintext vault content"
    );

    // The re-import is a duplicate and leaves the provider bytes identical.
    let bytes_before = raw.clone();
    let again = import_cxf_with(&target, PASSWORD, FIXTURE_VALID_SINGLE, &manager).await?;
    assert_eq!(again.imported, 0);
    assert_eq!(again.duplicates, 1);
    let bytes_after = manager
        .read_file(file_id, None)
        .await
        .map_err(|_e| CommandError::Io("Failed to read vault file".to_string()))?;
    assert_eq!(
        bytes_before, bytes_after,
        "imported == 0 must not update the cloud file"
    );

    // And the passkey is really there.
    let loaded = load_vault(&target, PASSWORD, &manager).await?;
    assert_eq!(raw_passkeys(&loaded.vault.entries).len(), 1);
    Ok(())
}

// ---------------------------------------------------------------------------
// G-CONTRACT — serde shape pinned (Rust side of the TS mirror)
// ---------------------------------------------------------------------------

#[test]
fn import_report_serde_shape_is_camel_case() {
    // Pinned so `src/interfaces/passkey.interface.ts` cannot drift: the TS
    // mirror is `{ imported, duplicates, skipped: [{ itemTitle, credentialType,
    // reason }] }`.
    let report = CxfImportReport {
        imported: 2,
        duplicates: 1,
        skipped: vec![skipped("Example login", "basic-auth", "unsupported")],
    };
    let value = serde_json::to_value(&report).expect("report serializes");
    assert_eq!(
        value,
        serde_json::json!({
            "imported": 2,
            "duplicates": 1,
            "skipped": [{
                "itemTitle": "Example login",
                "credentialType": "basic-auth",
                "reason": "unsupported"
            }]
        })
    );
    // ...and it deserializes back (the frontend may round-trip it).
    let back: CxfImportReport = serde_json::from_value(value).expect("report deserializes");
    assert_eq!(back, report);
}

#[test]
fn unix_to_datetime_handles_out_of_range_values() {
    // A hostile timestamp cannot panic the import: it clamps to the epoch.
    assert_eq!(unix_to_datetime(0).timestamp(), 0);
    assert_eq!(unix_to_datetime(1_705_228_800).timestamp(), 1_705_228_800);
    assert_eq!(unix_to_datetime(u64::MAX).timestamp(), 0);
}

// ---------------------------------------------------------------------------
// Negative controls (executed manually, documented in the report)
// ---------------------------------------------------------------------------
//
// NC-1 (byte-identical file when imported == 0): replace the
//      `if report.imported > 0` guard in `import_cxf_with` with an unconditional
//      `store::save_vault(...)` → `reimport_counts_duplicates_and_leaves_file_bytes_identical`,
//      `malformed_credentials_are_skipped_with_reasons` and
//      `import_into_cloud_vault_roundtrip` fail on the byte comparison (local
//      file, local file, provider bytes) while the counts still match.
//
// NC-2 (envelope failure before any IO): move `cxf::parse_envelope(content)?` to
//      *after* `store::load_vault(...)` → `envelope_failure_wins_over_a_wrong_password`
//      fails on the rate-limit counter: the wrong password is tried first, the
//      attempt is recorded, and `failure_count` is 1 instead of 0.
//      `envelope_failure_leaves_vault_untouched_and_costs_no_attempt` does NOT
//      fail under this mutation and cannot: it uses the correct password, and
//      `load_vault` resets the counter on success either way. Its
//      `failure_count == 0` assertion only pins "no attempt recorded", not the
//      ordering.
//
// NC-3 (dedup is by `(rp_id, credential_id)`, not by credential id alone):
//      key the index on `credential_id` only → `reimport_of_duplicate_fixture_keeps_one_entry`
//      reports `imported: 1` instead of `2`.
//
// NC-4 (extensions are reported): drop the `extensions_present` branch →
//      `import_multi_account_maps_timestamps_and_extensions` sees an empty skip
//      list.
