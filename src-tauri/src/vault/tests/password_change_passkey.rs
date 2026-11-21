//! End-to-end password change **with a passkey in the vault** (close review
//! MENOR-3, plan §7 step 8).
//!
//! `change_vault_password` re-wraps the master key and never re-encrypts the
//! vault blob (`lifecycle.rs`), which is what keeps every stored passkey
//! readable across a password change. Until this module that property was
//! pinned only *by construction*: `password_change.rs` exercises it on a
//! **data** vault (whose content is re-read through `read_vault`, i.e. the
//! sanitized view) and `keys.rs::rewrap_master_key_preserves_master_key_and_blob`
//! compares ciphertexts. Neither proves that the **private key** of a passkey is
//! still the same bytes after the re-wrap, which is the thing the user actually
//! loses if the blob were re-encrypted under a key derived differently.
//!
//! This test therefore drives the whole chain against a real vault file:
//!
//! 1. seed a vault with a passkey whose PKCS#8 key is a known vector;
//! 2. `change_vault_password(P1 → P2)`;
//! 3. unlock with **P2** through the passkey store seam;
//! 4. `export_cxf` (consented) and compare the exported `key` member against
//!    the original PKCS#8 DER **byte for byte**.
//!
//! Negative controls (the suite must be able to go red):
//! - **re-encrypting the blob under a *fresh* master key** on password change
//!   (the naive "change the password" implementation) makes step 3 fail to
//!   decrypt — or, if it re-wraps the new key correctly, makes the exported
//!   key differ — so the test fails. This is the mutation the close review
//!   asked for (MENOR-3) and it was executed: see the report.
//! - **skipping the re-wrap** makes step 3 fail with the *old* password and the
//!   export never happens.
//! - **re-encrypting the blob under the *same* master key** (a re-encryption
//!   that happens to keep the key) is *not* caught by the key comparison —
//!   the key is, after all, still the same bytes. It is caught by the second
//!   assertion block below, which pins that the ciphertext (and its nonce) is
//!   byte-identical across the password change: the invariant is "re-wrap,
//!   never re-encrypt", and a re-encryption is observable in the blob even
//!   when the plaintext survives.
//! - an export that re-encoded the key (decode → re-encode) would still pass
//!   the byte comparison, which is why the comparison is against the DER that
//!   was seeded, not against a second export.

#[cfg(test)]
mod tests {
    use crate::commands::errors::CommandError;
    use crate::commands::passkey_export::export_cxf_with;
    use crate::crypto::base64::{decode_base64_urlsafe, encode_base64_urlsafe};
    use crate::models::{Entry, SecretPkcs8, Vault, VaultFile};
    use crate::passkey::cxf::{parse_envelope, CxfHeader};
    use crate::passkey::es256::signing_key_from_pkcs8_der;
    use crate::passkey::store::{load_vault, VaultRef};
    use crate::storage::{StorageConfig, StorageManager};
    use crate::vault::{keys, lifecycle, version};
    use chrono::{DateTime, Utc};
    use std::sync::Arc;
    use tempfile::TempDir;
    use uuid::Uuid;

    const OLD_PASSWORD: &str = "t01-old-password";
    const NEW_PASSWORD: &str = "t01-new-password";
    const RP_ID: &str = "example.com";
    /// Published CXF Appendix A example key (PKCS#8 DER, base64url) — the same
    /// non-secret vector the CXF tests pin.
    const SPEC_KEY_B64URL: &str = "MIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQgARu_0sCt20EpgVxb4Puq3Ga5VVLpuTY75ngvZlyq3X6hRANCAASmdk1xLsK0oOlhxIPp0d1ZuS0sT9nf6BZtSelhqvLBW0fOL33l_bXgsr_STUHjCLn8l6gcRJwe7OQvbQubZ1dY";

    fn fixed_time() -> DateTime<Utc> {
        DateTime::parse_from_rfc3339("2026-01-02T03:04:05Z")
            .expect("fixed timestamp parses")
            .with_timezone(&Utc)
    }

    /// The PKCS#8 DER of the vector key (the bytes the export must reproduce).
    fn vector_key_der() -> Vec<u8> {
        decode_base64_urlsafe(SPEC_KEY_B64URL).expect("vector key is base64url")
    }

    /// A passkey entry carrying the vector key.
    fn passkey_entry() -> Entry {
        Entry::Passkey {
            id: Uuid::new_v4(),
            name: "GitHub".to_string(),
            created_at: fixed_time(),
            updated_at: fixed_time(),
            tags: vec!["work".to_string()],
            rp_id: RP_ID.to_string(),
            rp_name: "Example".to_string(),
            credential_id: vec![0xde, 0xad, 0xbe, 0xef],
            user_handle: vec![0x01, 0x02, 0x03, 0x04],
            user_name: "octocat".to_string(),
            user_display_name: "The Octocat".to_string(),
            private_key: SecretPkcs8::from_pkcs8_der(&vector_key_der()),
            algorithm: -7,
            sign_count: 0,
            discoverable: true,
            transports: vec!["internal".to_string()],
            aaguid: Uuid::nil(),
        }
    }

    /// Writes a vault holding one passkey straight to disk, the layout the
    /// lifecycles produce (format `1.1`, since the content holds a passkey).
    fn seed_vault_with_passkey(dir: &TempDir) -> std::path::PathBuf {
        let path = dir.path().join("password_change_passkey.monark");
        let vault = Vault {
            updated_at: fixed_time(),
            hmac: String::new(),
            entries: vec![passkey_entry()],
        };
        let (argon2_params, credentials, master_key) =
            keys::create_key_material(OLD_PASSWORD).expect("seed key material");
        let encrypted = keys::encrypt_vault_content(&master_key, &vault).expect("seed encrypt");
        let vault_file = VaultFile {
            version: version::CURRENT_VAULT_VERSION.to_string(),
            argon2_params,
            credentials,
            vault: encrypted,
        };
        crate::io::vault::write_vault(path.to_string_lossy().to_string(), &vault_file)
            .expect("seed vault");
        path
    }

    fn local_ref(path: &std::path::Path) -> VaultRef {
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

    /// The `key` member of the first credential of the first item, decoded.
    fn exported_key_der(header: &CxfHeader) -> Vec<u8> {
        let credential = header.accounts[0].items[0].credentials[0]
            .as_object()
            .expect("the credential is a JSON object");
        let key = credential
            .get("key")
            .and_then(|value| value.as_str())
            .expect("the exported credential carries a `key` string");
        decode_base64_urlsafe(key).expect("the exported key is base64url")
    }

    /// The end-to-end invariant: a password change keeps the passkey's private
    /// key byte-identical, as observed through a consented CXF export.
    #[tokio::test]
    async fn password_change_keeps_passkey_private_key_byte_identical() -> Result<(), CommandError>
    {
        let dir = TempDir::new().expect("temp dir");
        let path = seed_vault_with_passkey(&dir);
        let manager = local_manager(&dir).await;
        let target = local_ref(&path);

        // Baseline: the seeded key exports as the vector, so the comparison
        // below cannot be vacuously true for a wrong seed.
        let before_export = export_cxf_with(&target, OLD_PASSWORD, true, &manager).await?;
        let before_header = parse_envelope(&before_export)?;
        assert_eq!(
            exported_key_der(&before_header),
            vector_key_der(),
            "the seeded passkey must export its PKCS#8 key verbatim"
        );

        // The password change under test (re-wrap, no re-encryption).
        let blob_before = crate::io::vault::read_vault(path.to_string_lossy().to_string())?.vault;
        lifecycle::change_vault_password(
            path.to_string_lossy().to_string(),
            OLD_PASSWORD.to_string(),
            NEW_PASSWORD.to_string(),
        )?;
        // The invariant is "re-wrap the master key, never re-encrypt the blob":
        // the ciphertext (and its nonce) must be byte-identical. A
        // re-encryption under the *same* master key keeps the plaintext — and
        // therefore every private key — intact, so this is the assertion that
        // catches it (the key comparison below cannot).
        let blob_after = crate::io::vault::read_vault(path.to_string_lossy().to_string())?.vault;
        assert_eq!(
            blob_before, blob_after,
            "the encrypted vault blob must not be re-encrypted by a password change"
        );

        // The new password unlocks the vault through the passkey seam…
        let loaded = load_vault(&target, NEW_PASSWORD, &manager).await?;
        assert_eq!(
            loaded.vault.entries.len(),
            1,
            "the passkey entry must survive the re-wrap"
        );

        // …and a consented export still yields the very same private key.
        let after_export = export_cxf_with(&target, NEW_PASSWORD, true, &manager).await?;
        let after_header = parse_envelope(&after_export)?;
        let exported_der = exported_key_der(&after_header);
        assert_eq!(
            exported_der,
            vector_key_der(),
            "the private key must be byte-identical after the password change"
        );
        // The bytes are also a usable P-256 key (the ceremony's own check), so
        // the comparison is not just "two identical broken blobs".
        signing_key_from_pkcs8_der(&exported_der)
            .expect("the exported key is a valid P-256 PKCS#8 key");

        // The old password no longer unlocks (the re-wrap really happened).
        assert!(
            load_vault(&target, OLD_PASSWORD, &manager).await.is_err(),
            "the old password must stop working after the re-wrap"
        );

        // The exported key is also what is stored on disk, read through the
        // decryption seam rather than through the export itself.
        let stored = match &loaded.vault.entries[0] {
            Entry::Passkey { private_key, .. } => private_key.to_pkcs8_der().expect("key decodes"),
            other => panic!("expected a passkey, got {other:?}"),
        };
        assert_eq!(
            stored.as_slice(),
            vector_key_der().as_slice(),
            "the stored PKCS#8 DER must be unchanged by the re-wrap"
        );
        Ok(())
    }

    /// The exported `key` member is the base64url of the stored DER (no
    /// re-encoding round trip that could silently normalise the bytes).
    #[tokio::test]
    async fn password_change_export_key_matches_stored_der_encoding() -> Result<(), CommandError> {
        let dir = TempDir::new().expect("temp dir");
        let path = seed_vault_with_passkey(&dir);
        let manager = local_manager(&dir).await;
        let target = local_ref(&path);

        lifecycle::change_vault_password(
            path.to_string_lossy().to_string(),
            OLD_PASSWORD.to_string(),
            NEW_PASSWORD.to_string(),
        )?;

        let document = export_cxf_with(&target, NEW_PASSWORD, true, &manager).await?;
        let header = parse_envelope(&document)?;
        let credential = header.accounts[0].items[0].credentials[0]
            .as_object()
            .expect("the credential is a JSON object");
        assert_eq!(
            credential.get("key").and_then(|value| value.as_str()),
            Some(encode_base64_urlsafe(&vector_key_der()).as_str()),
            "the exported `key` must be the base64url of the stored DER"
        );
        Ok(())
    }
}
