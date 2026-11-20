//! Vault format version policy, end to end (T06, plan §2.8).
//!
//! Covers the read-path gate on both storage backends, the create/update write
//! policy, and the old-client failure mode. The pure helpers
//! ([`crate::vault::version`]) are unit-tested next to their definition; this
//! module is about the *call sites*.
//!
//! Negative controls (the suite must be able to go red):
//! - `read_vault_rejects_unsupported_version` / `read_cloud_vault_rejects_unsupported_version`
//!   fail if `check_version` is removed from the read path (the vault would open).
//! - `version_error_does_not_consume_rate_limit_attempts` fails if the check is
//!   moved *after* `rate_limit::check_attempts`/`record_failure` (the vault would
//!   start reporting "Too many failed attempts").
//! - `data_only_update_keeps_1_0` fails if the update path bumps unconditionally.
//! - `update_bumps_version_when_passkey_added` fails if the bump is dropped.
//! - `old_client_cannot_deserialize_passkey_vault` fails if the passkey variant
//!   were made transparent to old readers (e.g. `#[serde(other)]`-style drop).

#[cfg(test)]
mod tests {
    use crate::commands::errors::CommandError;
    use crate::models::{
        Argon2Params, EncryptedData, Entry, SecretPkcs8, Vault, VaultFile, VaultView,
    };
    use crate::storage::providers::CreateFileRequest;
    use crate::storage::{StorageConfig, StorageManager};
    use crate::vault::cloud_lifecycle::{read_cloud_vault_with, set_cloud_cache_path};
    use crate::vault::{lifecycle, rate_limit, version};
    use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
    use chrono::{DateTime, Utc};
    use serde::Deserialize;
    use std::sync::Arc;
    use tempfile::{tempdir, TempDir};
    use uuid::Uuid;

    const PASSWORD: &str = "version-test-password";
    const TEST_PKCS8_DER: [u8; 16] = [
        0x30, 0x0e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x04, 0x02, 0x03,
        0x04,
    ];
    const PASSKEY_ID: Uuid = Uuid::from_bytes([0x11; 16]);
    const GROUP_ID: Uuid = Uuid::from_bytes([0x33; 16]);
    const DATA_ID: Uuid = Uuid::from_bytes([0x22; 16]);

    fn fixed_time() -> DateTime<Utc> {
        DateTime::parse_from_rfc3339("2026-01-02T03:04:05Z")
            .expect("fixed timestamp parses")
            .with_timezone(&Utc)
    }

    fn data_entry() -> Entry {
        Entry::Data {
            id: DATA_ID,
            name: "Mail".to_string(),
            data_type: "login".to_string(),
            created_at: fixed_time(),
            updated_at: fixed_time(),
            fields: Vec::new(),
            tags: Vec::new(),
        }
    }

    fn passkey_entry() -> Entry {
        Entry::Passkey {
            id: PASSKEY_ID,
            name: "GitHub".to_string(),
            created_at: fixed_time(),
            updated_at: fixed_time(),
            tags: vec!["work".to_string()],
            rp_id: "github.com".to_string(),
            rp_name: "GitHub".to_string(),
            credential_id: vec![0xde, 0xad, 0xbe, 0xef],
            user_handle: vec![0x01, 0x02, 0x03, 0x04],
            user_name: "octocat".to_string(),
            user_display_name: "The Octocat".to_string(),
            private_key: SecretPkcs8::from_pkcs8_der(&TEST_PKCS8_DER),
            algorithm: -7,
            sign_count: 0,
            discoverable: true,
            transports: vec!["internal".to_string()],
            aaguid: Uuid::nil(),
        }
    }

    /// A vault with one data entry and no passkey.
    fn data_vault() -> Vault {
        Vault {
            updated_at: fixed_time(),
            hmac: String::new(),
            entries: vec![data_entry()],
        }
    }

    /// A vault holding one passkey inside a group.
    fn passkey_vault() -> Vault {
        Vault {
            updated_at: fixed_time(),
            hmac: String::new(),
            entries: vec![Entry::Group {
                id: GROUP_ID,
                name: "Root".to_string(),
                data_type: "group".to_string(),
                children: vec![passkey_entry()],
            }],
        }
    }

    /// Encrypts `vault` into the on-disk file layout with an explicit `version`,
    /// the way a client of that format generation would have written it.
    fn build_vault_file(version: &str, vault: &Vault) -> Result<VaultFile, CommandError> {
        use crate::crypto;

        let master_key: [u8; 32] = crypto::random::generate_key()?
            .try_into()
            .map_err(|_| CommandError::Crypto("Invalid generated master key length".to_string()))?;
        let salt = crypto::random::generate_salt()?;
        let argon2_params = Argon2Params {
            salt: URL_SAFE_NO_PAD.encode(&salt),
            memory_cost_kib: 65536,
            iterations: 3,
            parallelism: 4,
        };
        let kdf_key = crypto::argon2::derive_key_argon2id(
            PASSWORD.as_bytes(),
            &salt,
            argon2_params.memory_cost_kib,
            argon2_params.iterations,
            argon2_params.parallelism,
            32,
        )?;

        let mk_nonce = crypto::random::generate_nonce()?;
        let mk_ciphertext =
            crypto::chacha::encrypt_xchacha20poly1305(&kdf_key, &mk_nonce, &master_key)?;

        let vault_json = serde_json::to_vec(vault)?;
        let vault_nonce = crypto::random::generate_nonce()?;
        let vault_ciphertext =
            crypto::chacha::encrypt_xchacha20poly1305(&master_key, &vault_nonce, &vault_json)?;

        Ok(VaultFile {
            version: version.to_string(),
            argon2_params,
            credentials: EncryptedData {
                nonce: URL_SAFE_NO_PAD.encode(mk_nonce),
                ciphertext: URL_SAFE_NO_PAD.encode(mk_ciphertext),
            },
            vault: EncryptedData {
                nonce: URL_SAFE_NO_PAD.encode(vault_nonce),
                ciphertext: URL_SAFE_NO_PAD.encode(vault_ciphertext),
            },
        })
    }

    /// Writes `vault` to `file_path` stamped with `version`.
    fn seed_vault_file(file_path: &str, version: &str, vault: &Vault) -> Result<(), CommandError> {
        let vault_file = build_vault_file(version, vault)?;
        crate::io::vault::write_vault(file_path.to_string(), &vault_file)
    }

    /// The `version` string actually stored in the file (no decryption needed).
    fn stored_version(file_path: &str) -> Result<String, CommandError> {
        let vault_file = crate::io::vault::read_vault(file_path.to_string())?;
        Ok(vault_file.version)
    }

    fn vault_path(dir: &TempDir, name: &str) -> String {
        dir.path()
            .join(format!("{name}.monark"))
            .to_str()
            .expect("temp path is utf-8")
            .to_string()
    }

    /// Criterion 4: a brand-new vault is created as 1.1.
    #[test]
    fn create_writes_1_1() -> Result<(), CommandError> {
        let temp = tempdir().expect("temp dir");
        let file_path = vault_path(&temp, "created");

        lifecycle::write_vault(
            file_path.clone(),
            PASSWORD.to_string(),
            VaultView {
                updated_at: Utc::now(),
                hmac: String::new(),
                entries: Vec::new(),
            },
        )?;

        assert_eq!(stored_version(&file_path)?, "1.1");
        // And the file this build wrote is one it can read back.
        lifecycle::read_vault(file_path, PASSWORD.to_string())?;

        Ok(())
    }

    /// Criterion 1: a 1.0 vault opens unchanged and stays 1.0 after a
    /// data-only update.
    #[test]
    fn data_only_update_keeps_1_0() -> Result<(), CommandError> {
        let temp = tempdir().expect("temp dir");
        let file_path = vault_path(&temp, "legacy");
        seed_vault_file(&file_path, "1.0", &data_vault())?;

        let view = lifecycle::read_vault(file_path.clone(), PASSWORD.to_string())?;
        assert_eq!(view.entries.len(), 1, "the legacy vault must open");

        // A data-only edit, exactly what the frontend sends back.
        let mut edited = view.clone();
        edited.hmac = "edited".to_string();
        lifecycle::write_vault(file_path.clone(), PASSWORD.to_string(), edited)?;

        assert_eq!(
            stored_version(&file_path)?,
            "1.0",
            "a 1.0 vault without passkeys must stay 1.0 (old clients keep reading it)"
        );
        let reread = lifecycle::read_vault(file_path, PASSWORD.to_string())?;
        assert_eq!(reread.hmac, "edited");

        Ok(())
    }

    /// Criterion 2: a vault that gains a passkey is bumped to 1.1, and the
    /// bumped file reads back.
    #[test]
    fn update_bumps_version_when_passkey_added() -> Result<(), CommandError> {
        let temp = tempdir().expect("temp dir");
        let file_path = vault_path(&temp, "bump");

        // Start from a 1.0 vault with a data entry only.
        seed_vault_file(&file_path, "1.0", &data_vault())?;
        assert_eq!(stored_version(&file_path)?, "1.0");

        // The passkey is created backend-side (the write path cannot carry key
        // material), so seed the passkey-bearing blob as a 1.0 file — the state
        // a pre-T06 build would have left behind — and then re-write it through
        // the command, which must bump the version.
        seed_vault_file(&file_path, "1.0", &passkey_vault())?;
        let view = lifecycle::read_vault(file_path.clone(), PASSWORD.to_string())?;
        lifecycle::write_vault(file_path.clone(), PASSWORD.to_string(), view)?;

        assert_eq!(
            stored_version(&file_path)?,
            version::CURRENT_VAULT_VERSION,
            "a vault holding a passkey must be stamped 1.1"
        );
        let reread = lifecycle::read_vault(file_path, PASSWORD.to_string())?;
        assert_eq!(reread.entries.len(), 1);

        Ok(())
    }

    /// Criterion 3 (local): an unsupported version is rejected before any
    /// Argon2 work, and the error names the version.
    #[test]
    fn read_vault_rejects_unsupported_version() -> Result<(), CommandError> {
        let temp = tempdir().expect("temp dir");

        for (index, bad_version) in ["2.0", "1.2", "garbage"].iter().enumerate() {
            let file_path = vault_path(&temp, &format!("unsupported_{index}"));
            seed_vault_file(&file_path, bad_version, &data_vault())?;

            match lifecycle::read_vault(file_path.clone(), PASSWORD.to_string()) {
                Err(CommandError::UnsupportedVersion(reported)) => {
                    assert_eq!(&reported, bad_version);
                }
                other => panic!("expected UnsupportedVersion for {bad_version}, got {other:?}"),
            }

            // Negative control: the very same file opens once the version is
            // supported, so the rejection is about the version and nothing else.
            seed_vault_file(&file_path, "1.1", &data_vault())?;
            assert!(
                lifecycle::read_vault(file_path, PASSWORD.to_string()).is_ok(),
                "the same content must open when the version is supported"
            );
        }

        Ok(())
    }

    /// Criterion 3: a version error is not an authentication failure, so it must
    /// not touch the rate limiter (the check runs before the gate).
    ///
    /// Observed on the limiter itself rather than through a subsequent unlock:
    /// `record_failure` is only reachable *after* a successful
    /// `check_attempts`, so a "too many attempts" assertion would stay green
    /// even with the check moved after the gate (the gate refuses first, no
    /// failure is ever recorded). This test therefore pins the state the gate
    /// reads — the failure count for the vault path — which is exactly what
    /// changes when the check is misplaced.
    ///
    /// The limiter is process-global and keyed by the vault path, so a unique
    /// temp path keeps this test hermetic.
    #[test]
    fn version_error_does_not_consume_rate_limit_attempts() -> Result<(), CommandError> {
        let temp = tempdir().expect("temp dir");
        let file_path = vault_path(&temp, "rate_limit");
        seed_vault_file(&file_path, "9.9", &data_vault())?;

        // Far more attempts than the free-attempt budget.
        for _ in 0..10 {
            match lifecycle::read_vault(file_path.clone(), PASSWORD.to_string()) {
                Err(CommandError::UnsupportedVersion(_)) => {}
                other => panic!("expected UnsupportedVersion, got {other:?}"),
            }
        }

        let after_version_errors = rate_limit::failure_count(&file_path);
        assert_eq!(
            after_version_errors, 0,
            "a version error must not be recorded as a failed password attempt"
        );

        // A supported version on the same path still gets its full budget: the
        // first wrong-password attempt must fail on crypto, not on the limiter.
        seed_vault_file(&file_path, "1.0", &data_vault())?;
        match lifecycle::read_vault(file_path.clone(), "wrong-password".to_string()) {
            Err(CommandError::Crypto(_)) => {}
            other => {
                panic!("a version error must not have consumed rate-limit attempts, got {other:?}")
            }
        }

        // Negative control for the assertion above: a real failed attempt *is*
        // recorded on the same key, so `failure_count` is not vacuously zero.
        assert_eq!(
            rate_limit::failure_count(&file_path),
            1,
            "a wrong password must be recorded as one failed attempt"
        );

        Ok(())
    }

    /// Criterion 5: a pre-passkey client cannot deserialize a passkey-bearing
    /// vault, and fails loudly instead of dropping the entry.
    ///
    /// The old client is simulated with a *local replica* of the pre-passkey
    /// `Entry` enum (no `Passkey` variant), which is exactly what an old build
    /// compiled. The vault JSON is produced by the real serializer, so this pins
    /// the on-disk shape, not a hand-written fixture.
    #[test]
    fn old_client_cannot_deserialize_passkey_vault() -> Result<(), CommandError> {
        /// Pre-passkey `Entry` (1.0 format): `group` and `entry` only.
        ///
        /// The fields are never read: the point of the replica is that
        /// *deserialization* is what an old client does with the file, so the
        /// payload only has to type-check against the old shape.
        #[derive(Debug, Deserialize)]
        #[serde(tag = "entry_type", rename_all = "snake_case")]
        #[allow(dead_code)]
        enum LegacyEntry {
            Group {
                id: Uuid,
                name: String,
                data_type: String,
                children: Vec<LegacyEntry>,
            },
            #[serde(rename = "entry")]
            Data {
                id: Uuid,
                name: String,
                data_type: String,
                created_at: DateTime<Utc>,
                updated_at: DateTime<Utc>,
                fields: Vec<LegacyField>,
                tags: Vec<String>,
            },
        }

        #[derive(Debug, Deserialize)]
        #[serde(rename_all = "snake_case")]
        #[allow(dead_code)]
        struct LegacyField {
            title: String,
            property: String,
            value: String,
            secret: bool,
        }

        #[derive(Debug, Deserialize)]
        #[serde(rename_all = "snake_case")]
        #[allow(dead_code)]
        struct LegacyVault {
            updated_at: DateTime<Utc>,
            hmac: String,
            entries: Vec<LegacyEntry>,
        }

        // Sanity: the replica really is the old client — it reads a 1.0 vault
        // with data entries fine.
        let legacy_json = serde_json::to_string(&data_vault()).expect("data vault serializes");
        let legacy: LegacyVault =
            serde_json::from_str(&legacy_json).expect("an old client reads a data-only vault");
        assert_eq!(legacy.entries.len(), 1);

        // The passkey vault (the exact bytes the new build stores) must fail.
        let passkey_json = serde_json::to_string(&passkey_vault()).expect("vault serializes");
        let error = serde_json::from_str::<LegacyVault>(&passkey_json)
            .expect_err("an old client must refuse a passkey-bearing vault");
        let message = error.to_string();
        assert!(
            message.contains("passkey"),
            "the failure must name the unknown variant (no silent drop): {message}"
        );

        // And the new build reads the very same JSON: the failure is the old
        // client's, not a broken payload.
        let current: Vault =
            serde_json::from_str(&passkey_json).expect("the current build reads it");
        assert_eq!(current.entries.len(), 1);

        Ok(())
    }

    // -----------------------------------------------------------------
    // Cloud parity
    // -----------------------------------------------------------------

    /// A hermetic storage manager backed by a temp directory.
    async fn local_manager(base: &TempDir) -> Arc<StorageManager> {
        let config = StorageConfig::new_local(base.path().to_string_lossy().to_string());
        Arc::new(
            StorageManager::new(config)
                .await
                .expect("local storage manager builds"),
        )
    }

    /// Stores `vault` (stamped with `version`) through the provider, returning
    /// the file id.
    async fn seed_cloud_vault(
        manager: &Arc<StorageManager>,
        version: &str,
        vault: &Vault,
    ) -> Result<String, CommandError> {
        let vault_file = build_vault_file(version, vault)?;
        let bytes = crate::io::signature::sign_vault(&vault_file).into_bytes();
        let created = manager
            .create_file(
                CreateFileRequest {
                    name: "cloud.monark".to_string(),
                    path: "/Monark/cloud.monark".to_string(),
                    content: bytes,
                    parent_id: None,
                    mime_type: Some("application/octet-stream".to_string()),
                    metadata: None,
                },
                None,
            )
            .await
            .map_err(|_e| CommandError::Io("Failed to create vault file".to_string()))?;
        Ok(created.id)
    }

    /// The `version` string stored in the provider file.
    async fn stored_cloud_version(
        manager: &Arc<StorageManager>,
        file_id: &str,
    ) -> Result<String, CommandError> {
        let bytes = manager
            .read_file(file_id.to_string(), None)
            .await
            .map_err(|_e| CommandError::Io("Failed to read vault file".to_string()))?;
        let text = String::from_utf8(bytes)
            .map_err(|_e| CommandError::Io("Failed to convert vault data".to_string()))?;
        let parsed = crate::io::signature::parse_content(&text);
        let decoded = URL_SAFE_NO_PAD
            .decode(&parsed.content)
            .map_err(|_e| CommandError::Crypto("Failed to decode vault content".to_string()))?;
        let vault_file: VaultFile = serde_json::from_slice(&decoded)
            .map_err(|_e| CommandError::Io("Failed to deserialize vault file".to_string()))?;
        Ok(vault_file.version)
    }

    /// Points the cloud cache at a throwaway directory (process-wide, once).
    fn isolate_cloud_cache(base: &TempDir) {
        set_cloud_cache_path(base.path().join("cloud_cache"));
    }

    /// Criterion 3 (cloud): the cloud read path rejects unsupported versions.
    #[tokio::test]
    async fn read_cloud_vault_rejects_unsupported_version() -> Result<(), CommandError> {
        let temp = TempDir::new().expect("temp dir");
        isolate_cloud_cache(&temp);
        let manager = local_manager(&temp).await;

        let file_id = seed_cloud_vault(&manager, "2.0", &data_vault()).await?;
        match read_cloud_vault_with(file_id.clone(), PASSWORD.to_string(), None, &manager).await {
            Err(CommandError::UnsupportedVersion(reported)) => assert_eq!(reported, "2.0"),
            other => panic!("expected UnsupportedVersion, got {other:?}"),
        }

        Ok(())
    }

    /// Criterion 1/2 (cloud): a data-only cloud update keeps 1.0, a passkey
    /// bump reaches 1.1.
    #[tokio::test]
    async fn cloud_update_keeps_1_0_and_bumps_with_passkey() -> Result<(), CommandError> {
        use crate::vault::cloud_lifecycle::write_cloud_vault_with;

        let temp = TempDir::new().expect("temp dir");
        isolate_cloud_cache(&temp);
        let manager = local_manager(&temp).await;

        // Data-only 1.0 vault: an update must not bump it.
        let data_id = seed_cloud_vault(&manager, "1.0", &data_vault()).await?;
        let view =
            read_cloud_vault_with(data_id.clone(), PASSWORD.to_string(), None, &manager).await?;
        write_cloud_vault_with(
            "cloud".to_string(),
            PASSWORD.to_string(),
            view,
            None,
            None,
            Some(data_id.clone()),
            &manager,
        )
        .await?;
        assert_eq!(
            stored_cloud_version(&manager, &data_id).await?,
            "1.0",
            "a data-only cloud update must keep the 1.0 version"
        );

        // Passkey-bearing vault: the update bumps it to 1.1.
        let passkey_id = seed_cloud_vault(&manager, "1.0", &passkey_vault()).await?;
        let view =
            read_cloud_vault_with(passkey_id.clone(), PASSWORD.to_string(), None, &manager).await?;
        write_cloud_vault_with(
            "cloud".to_string(),
            PASSWORD.to_string(),
            view,
            None,
            None,
            Some(passkey_id.clone()),
            &manager,
        )
        .await?;
        assert_eq!(
            stored_cloud_version(&manager, &passkey_id).await?,
            version::CURRENT_VAULT_VERSION,
            "a cloud vault holding a passkey must be stamped 1.1"
        );

        Ok(())
    }

    /// Criterion 4 (cloud): a brand-new cloud vault is created as 1.1.
    #[tokio::test]
    async fn cloud_create_writes_1_1() -> Result<(), CommandError> {
        use crate::vault::cloud_lifecycle::write_cloud_vault_with;

        let temp = TempDir::new().expect("temp dir");
        isolate_cloud_cache(&temp);
        let manager = local_manager(&temp).await;

        let file_id = write_cloud_vault_with(
            "cloud".to_string(),
            PASSWORD.to_string(),
            VaultView {
                updated_at: Utc::now(),
                hmac: String::new(),
                entries: Vec::new(),
            },
            None,
            None,
            None,
            &manager,
        )
        .await?;

        assert_eq!(
            stored_cloud_version(&manager, &file_id).await?,
            "1.1",
            "a new cloud vault must be created as 1.1"
        );

        Ok(())
    }
}
