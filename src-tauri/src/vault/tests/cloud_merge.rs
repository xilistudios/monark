//! Cloud parity for the write-path merge (T05, acceptance criterion 8).
//!
//! `update_existing_cloud_vault` must apply the *same* semantics as the local
//! `update_existing_vault`: passkey secrets are re-attached from the stored
//! file by entry id, a stale view cannot drop a passkey, and an unknown passkey
//! id fails closed without touching the stored file.
//!
//! The tests drive the real command against a hermetic **local** storage
//! provider (`StorageConfig::new_local` on a temp dir), so the whole chain runs:
//! provider read → `parse_vault_from_bytes` → master key unwrap → blob decrypt →
//! merge → re-encrypt → provider write. The cloud cache is redirected to a temp
//! dir so nothing leaks into the user's data directory.

#[cfg(test)]
mod tests {
    use crate::commands::errors::CommandError;
    use crate::models::{Entry, EntryView, SecretPkcs8, Vault, VaultFile, VaultView};
    use crate::storage::providers::CreateFileRequest;
    use crate::storage::{StorageConfig, StorageManager};
    use crate::vault::cloud_lifecycle::{
        read_cloud_vault_with, set_cloud_cache_path, write_cloud_vault_with,
    };
    use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
    use chrono::{DateTime, Utc};
    use std::sync::Arc;
    use tempfile::TempDir;
    use uuid::Uuid;

    const PASSWORD: &str = "cloud-test-password";
    const TEST_PKCS8_DER: [u8; 16] = [
        0x30, 0x0e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x04, 0x02, 0x03,
        0x04,
    ];
    const PASSKEY_ID: Uuid = Uuid::from_bytes([0x11; 16]);
    const GROUP_ID: Uuid = Uuid::from_bytes([0x33; 16]);

    fn fixed_time() -> DateTime<Utc> {
        DateTime::parse_from_rfc3339("2026-01-02T03:04:05Z")
            .expect("fixed timestamp parses")
            .with_timezone(&Utc)
    }

    fn disk_vault() -> Vault {
        Vault {
            updated_at: fixed_time(),
            hmac: "cloud-hmac".to_string(),
            entries: vec![Entry::Group {
                id: GROUP_ID,
                name: "Root".to_string(),
                data_type: "group".to_string(),
                children: vec![Entry::Passkey {
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
                }],
            }],
        }
    }

    /// A hermetic storage manager backed by a temp directory.
    async fn local_manager(base: &TempDir) -> Arc<StorageManager> {
        let config = StorageConfig::new_local(base.path().to_string_lossy().to_string());
        Arc::new(
            StorageManager::new(config)
                .await
                .expect("local storage manager builds"),
        )
    }

    /// Encrypts `vault` into the on-provider file format (same layout as
    /// `create_new_cloud_vault`) and stores it, returning the file id.
    async fn seed_cloud_vault(
        manager: &Arc<StorageManager>,
        vault: &Vault,
    ) -> Result<String, CommandError> {
        use crate::crypto;
        use crate::models::{Argon2Params, EncryptedData};

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

        let vault_file = VaultFile {
            version: "1.0".to_string(),
            argon2_params,
            credentials: EncryptedData {
                nonce: URL_SAFE_NO_PAD.encode(mk_nonce),
                ciphertext: URL_SAFE_NO_PAD.encode(mk_ciphertext),
            },
            vault: EncryptedData {
                nonce: URL_SAFE_NO_PAD.encode(vault_nonce),
                ciphertext: URL_SAFE_NO_PAD.encode(vault_ciphertext),
            },
        };

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

    /// Reads the stored file back and decrypts it into the disk [`Vault`].
    async fn read_stored_vault(
        manager: &Arc<StorageManager>,
        file_id: &str,
    ) -> Result<Vault, CommandError> {
        use crate::crypto;

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

        let salt = URL_SAFE_NO_PAD
            .decode(&vault_file.argon2_params.salt)
            .map_err(|_e| CommandError::Crypto("Failed to decode salt".to_string()))?;
        let kdf_key = crypto::argon2::derive_key_argon2id(
            PASSWORD.as_bytes(),
            &salt,
            vault_file.argon2_params.memory_cost_kib,
            vault_file.argon2_params.iterations,
            vault_file.argon2_params.parallelism,
            32,
        )?;
        let mk_nonce = URL_SAFE_NO_PAD
            .decode(&vault_file.credentials.nonce)
            .map_err(|_e| CommandError::Crypto("Failed to decode master key nonce".to_string()))?;
        let mk_ciphertext = URL_SAFE_NO_PAD
            .decode(&vault_file.credentials.ciphertext)
            .map_err(|_e| {
                CommandError::Crypto("Failed to decode master key ciphertext".to_string())
            })?;
        let master_key =
            crypto::chacha::decrypt_xchacha20poly1305(&kdf_key, &mk_nonce, &mk_ciphertext)?;

        let vault_nonce = URL_SAFE_NO_PAD
            .decode(&vault_file.vault.nonce)
            .map_err(|_e| CommandError::Crypto("Failed to decode vault nonce".to_string()))?;
        let vault_ciphertext = URL_SAFE_NO_PAD
            .decode(&vault_file.vault.ciphertext)
            .map_err(|_e| CommandError::Crypto("Failed to decode vault ciphertext".to_string()))?;
        let vault_json = crypto::chacha::decrypt_xchacha20poly1305(
            &master_key,
            &vault_nonce,
            &vault_ciphertext,
        )?;

        serde_json::from_slice(&vault_json)
            .map_err(|_e| CommandError::Io("Failed to deserialize vault".to_string()))
    }

    /// Points the cloud cache at a throwaway directory (process-wide, once).
    fn isolate_cloud_cache(base: &TempDir) {
        set_cloud_cache_path(base.path().join("cloud_cache"));
    }

    /// Criterion 8: the cloud update path re-attaches the passkey key.
    #[tokio::test]
    async fn update_cloud_vault_roundtrip_restores_passkey_key() -> Result<(), CommandError> {
        let temp = TempDir::new().expect("temp dir");
        isolate_cloud_cache(&temp);
        let manager = local_manager(&temp).await;
        let disk = disk_vault();
        let file_id = seed_cloud_vault(&manager, &disk).await?;

        let view =
            read_cloud_vault_with(file_id.clone(), PASSWORD.to_string(), None, &manager).await?;

        write_cloud_vault_with(
            "cloud".to_string(),
            PASSWORD.to_string(),
            view,
            None,
            None,
            Some(file_id.clone()),
            &manager,
        )
        .await?;

        let stored = read_stored_vault(&manager, &file_id).await?;
        assert_eq!(
            stored.entries, disk.entries,
            "the passkey (key material included) must survive the cloud round-trip"
        );

        Ok(())
    }

    /// Criterion 8: a stale cloud view cannot delete a passkey.
    #[tokio::test]
    async fn update_cloud_vault_stale_view_preserves_passkey() -> Result<(), CommandError> {
        let temp = TempDir::new().expect("temp dir");
        isolate_cloud_cache(&temp);
        let manager = local_manager(&temp).await;
        let disk = disk_vault();
        let file_id = seed_cloud_vault(&manager, &disk).await?;

        let stale_view = VaultView {
            updated_at: fixed_time(),
            hmac: String::new(),
            entries: vec![EntryView::Group {
                id: GROUP_ID,
                name: "Root".to_string(),
                data_type: "group".to_string(),
                children: Vec::new(),
            }],
        };

        write_cloud_vault_with(
            "cloud".to_string(),
            PASSWORD.to_string(),
            stale_view,
            None,
            None,
            Some(file_id.clone()),
            &manager,
        )
        .await?;

        let stored = read_stored_vault(&manager, &file_id).await?;
        assert_eq!(
            stored.entries, disk.entries,
            "the stale cloud write must leave the passkey exactly as it was"
        );

        Ok(())
    }

    /// Criterion 8: an unknown passkey id fails closed on the cloud path too.
    #[tokio::test]
    async fn update_cloud_vault_unknown_passkey_id_fails_closed() -> Result<(), CommandError> {
        let temp = TempDir::new().expect("temp dir");
        isolate_cloud_cache(&temp);
        let manager = local_manager(&temp).await;
        let disk = disk_vault();
        let file_id = seed_cloud_vault(&manager, &disk).await?;

        let mut view = VaultView::from(&disk);
        let EntryView::Group { children, .. } = &mut view.entries[0] else {
            panic!("expected a group view at the root");
        };
        let EntryView::Passkey(passkey) = &mut children[0] else {
            panic!("expected a passkey view inside the group");
        };
        passkey.id = Uuid::from_bytes([0x77; 16]);

        let result = write_cloud_vault_with(
            "cloud".to_string(),
            PASSWORD.to_string(),
            view,
            None,
            None,
            Some(file_id.clone()),
            &manager,
        )
        .await;

        match result {
            Err(CommandError::Validation(msg)) => {
                assert!(msg.contains("no stored key material"), "unexpected: {msg}");
            }
            other => panic!("expected CommandError::Validation, got {other:?}"),
        }

        let stored = read_stored_vault(&manager, &file_id).await?;
        assert_eq!(
            stored.entries, disk.entries,
            "a rejected cloud write must not touch the stored file"
        );

        Ok(())
    }

    /// Criterion 7 (cloud parity): a creation payload cannot carry a passkey.
    #[tokio::test]
    async fn create_cloud_vault_with_passkey_fails_closed() -> Result<(), CommandError> {
        let temp = TempDir::new().expect("temp dir");
        isolate_cloud_cache(&temp);
        let manager = local_manager(&temp).await;

        let result = write_cloud_vault_with(
            "cloud".to_string(),
            PASSWORD.to_string(),
            VaultView::from(&disk_vault()),
            None,
            None,
            None,
            &manager,
        )
        .await;

        match result {
            Err(CommandError::Validation(msg)) => {
                assert!(msg.contains("no stored key material"), "unexpected: {msg}");
            }
            other => panic!("expected CommandError::Validation, got {other:?}"),
        }

        let vaults = manager
            .list_vaults(None)
            .await
            .map_err(|_e| CommandError::Io("Failed to list vaults".to_string()))?;
        assert!(
            vaults.is_empty(),
            "a rejected creation must not store a vault file"
        );

        Ok(())
    }

    /// Review finding E14c: `change_cloud_vault_password` must reject an empty
    /// new password, exactly like the local command does (the guard now lives in
    /// `keys::rewrap_master_key`, the single home both commands share).
    #[tokio::test]
    async fn change_cloud_vault_password_rejects_empty_new() -> Result<(), CommandError> {
        let temp = TempDir::new().expect("temp dir");
        isolate_cloud_cache(&temp);
        let manager = local_manager(&temp).await;
        let file_id = seed_cloud_vault(&manager, &disk_vault()).await?;

        let before = manager
            .read_file(file_id.clone(), None)
            .await
            .map_err(|_e| CommandError::Io("Failed to read vault file".to_string()))?;

        // The command wrapper needs a `tauri::State`, so the shared helper is
        // exercised directly through the same entry point the command uses.
        let vault_data = manager
            .read_file(file_id.clone(), None)
            .await
            .map_err(|_e| CommandError::Io("Failed to read existing vault".to_string()))?;
        let mut vault_file = crate::vault::cloud_lifecycle::parse_vault_from_bytes(&vault_data)?;
        let result = crate::vault::keys::rewrap_master_key(PASSWORD, "", &mut vault_file);
        match result {
            Err(CommandError::Validation(msg)) => {
                assert!(msg.contains("New password is required"), "got: {msg}");
            }
            other => panic!("expected Validation, got {other:?}"),
        }

        let after = manager
            .read_file(file_id, None)
            .await
            .map_err(|_e| CommandError::Io("Failed to read vault file".to_string()))?;
        assert_eq!(
            before, after,
            "a rejected password change must not rewrite the stored file"
        );

        Ok(())
    }

    /// Review finding E14b (cloud parity): the cloud update path must not
    /// re-encrypt a format this build cannot read. The stored file is left
    /// byte-identical.
    #[tokio::test]
    async fn update_cloud_vault_rejects_unsupported_version_without_writing(
    ) -> Result<(), CommandError> {
        let temp = TempDir::new().expect("temp dir");
        isolate_cloud_cache(&temp);
        let manager = local_manager(&temp).await;
        let file_id = seed_cloud_vault(&manager, &disk_vault()).await?;

        // Rewrite the stored envelope with a future version, crypto untouched.
        let bytes = manager
            .read_file(file_id.clone(), None)
            .await
            .map_err(|_e| CommandError::Io("Failed to read vault file".to_string()))?;
        let text = String::from_utf8(bytes)
            .map_err(|_e| CommandError::Io("Failed to convert vault data".to_string()))?;
        let parsed = crate::io::signature::parse_content(&text);
        let decoded = URL_SAFE_NO_PAD
            .decode(&parsed.content)
            .map_err(|_e| CommandError::Crypto("Failed to decode vault content".to_string()))?;
        let mut vault_file: VaultFile = serde_json::from_slice(&decoded)
            .map_err(|_e| CommandError::Io("Failed to deserialize vault file".to_string()))?;
        vault_file.version = "9.9".to_string();
        let future_bytes = crate::io::signature::sign_vault(&vault_file).into_bytes();
        manager
            .update_file(
                crate::storage::providers::UpdateFileRequest {
                    id: file_id.clone(),
                    content: future_bytes.clone(),
                    metadata: None,
                },
                None,
            )
            .await
            .map_err(|_e| CommandError::Io("Failed to update vault file".to_string()))?;

        let result = write_cloud_vault_with(
            "cloud".to_string(),
            PASSWORD.to_string(),
            VaultView {
                updated_at: fixed_time(),
                hmac: String::new(),
                entries: Vec::new(),
            },
            None,
            None,
            Some(file_id.clone()),
            &manager,
        )
        .await;

        match result {
            Err(CommandError::UnsupportedVersion(version)) => assert_eq!(version, "9.9"),
            other => panic!("expected UnsupportedVersion, got {other:?}"),
        }

        let after = manager
            .read_file(file_id, None)
            .await
            .map_err(|_e| CommandError::Io("Failed to read vault file".to_string()))?;
        assert_eq!(
            after, future_bytes,
            "a rejected cloud update must not rewrite the stored file (negative control)"
        );

        Ok(())
    }
}
