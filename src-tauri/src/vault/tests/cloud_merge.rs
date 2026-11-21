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
    use crate::commands::passkey::passkey_delete_with;
    use crate::models::{Entry, EntryView, Field, SecretPkcs8, Vault, VaultFile, VaultView};
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
    /// MAYOR-1 end-to-end: the sync → push composition across two devices.
    ///
    /// Device A deletes a passkey (real `passkey_delete_with`, which writes the
    /// cloud file). Device B still holds the stale view and pushes a full-vault
    /// write that (1) names the deleted passkey and (2) carries a legitimate
    /// Data edit of its own.
    ///
    /// Step 4 is the **negative control** for the whole fail-closed contract: the
    /// stale write must be rejected with the exact `Validation` message the
    /// front-end classifier keys on (`PASSKEY_NO_KEY_MATERIAL_SIGNATURE`), and
    /// the stored file must be left byte-identical — a rejected write is atomic,
    /// so B's Data edit does not land either. Step 5 then writes the view the
    /// front end's `reconcilePasskeysToCloud` produces (same tree minus the
    /// cloud-absent passkey) and must succeed, with the Data edit present, the
    /// passkey absent and the version still `1.1`.
    ///
    /// If a future change relaxes `restore_passkey` to accept an unknown id,
    /// step 4 goes red — which is exactly the invariant MAYOR-1 must not break.
    #[tokio::test]
    async fn sync_push_after_remote_delete_fails_closed_then_reconciled_write_succeeds(
    ) -> Result<(), CommandError> {
        use crate::passkey::store::VaultRef;

        let temp = TempDir::new().expect("temp dir");
        isolate_cloud_cache(&temp);
        let manager = local_manager(&temp).await;

        // 1. Device A's cloud file: a group holding one passkey.
        let disk = disk_vault();
        let file_id = seed_cloud_vault(&manager, &disk).await?;

        // 2. Device B reads the sanitized view (no key material, invariant 1).
        let view =
            read_cloud_vault_with(file_id.clone(), PASSWORD.to_string(), None, &manager).await?;
        // Borrowed walk: `EntryView` implements `Drop` (zeroize), so the tree
        // cannot be moved out of.
        fn view_has_passkey(entries: &[EntryView], id: Uuid) -> bool {
            entries.iter().any(|entry| match entry {
                EntryView::Passkey(passkey) => passkey.id == id,
                EntryView::Group { children, .. } => view_has_passkey(children, id),
                _ => false,
            })
        }
        assert!(
            view_has_passkey(&view.entries, PASSKEY_ID),
            "anti-vacuity: the read view must contain the passkey before the delete"
        );
        let serialized = serde_json::to_string(&view).expect("view serializes");
        assert!(
            !serialized.contains("private_key"),
            "invariant 1: the IPC view must never carry key material"
        );

        // 3. Device A deletes the passkey through the real command.
        passkey_delete_with(
            &VaultRef::Cloud {
                vault_id: file_id.clone(),
                provider_name: None,
            },
            PASSWORD,
            &PASSKEY_ID.to_string(),
            &manager,
        )
        .await?;

        let after_delete = read_stored_vault(&manager, &file_id).await?;
        assert!(
            !contains_passkey(&after_delete.entries, PASSKEY_ID),
            "the delete must have removed the passkey from the cloud file"
        );

        // 4. Device B pushes its stale view + a legitimate Data edit → fails
        //    closed, and the file is untouched (negative control).
        let data_edit_id = Uuid::from_bytes([0x44; 16]);
        let mut stale_view = view.clone();
        stale_view.entries.push(EntryView::Data {
            id: data_edit_id,
            name: "Edited on B".to_string(),
            data_type: "password".to_string(),
            created_at: fixed_time(),
            updated_at: fixed_time(),
            fields: vec![Field {
                title: "user".to_string(),
                property: "text".to_string(),
                value: "octocat".to_string(),
                secret: false,
            }],
            tags: Vec::new(),
        });

        let before_stale_write = manager
            .read_file(file_id.clone(), None)
            .await
            .map_err(|_e| CommandError::Io("Failed to read vault file".to_string()))?;

        let stale_result = write_cloud_vault_with(
            "cloud".to_string(),
            PASSWORD.to_string(),
            stale_view.clone(),
            None,
            None,
            Some(file_id.clone()),
            &manager,
        )
        .await;

        match stale_result {
            Err(CommandError::Validation(msg)) => {
                // Two-sided pin: the message must be EXACTLY the one the TS
                // classifier keys on (`PASSKEY_NO_KEY_MATERIAL_SIGNATURE` in
                // `src/services/cloudStorageErrors.ts`, pinned by T7). An exact
                // comparison, not `contains`: a reworded backend message must
                // break this test, because it would silently disable the
                // front-end self-heal.
                assert_eq!(
                    msg, "Passkey entry has no stored key material; create or import it first",
                    "the fail-closed message is pinned on both sides of the IPC boundary"
                );
            }
            other => panic!("expected CommandError::Validation, got {other:?}"),
        }

        let after_stale_write = manager
            .read_file(file_id.clone(), None)
            .await
            .map_err(|_e| CommandError::Io("Failed to read vault file".to_string()))?;
        assert_eq!(
            before_stale_write, after_stale_write,
            "a rejected cloud write must be atomic: B's Data edit must not land either"
        );

        // 5. Device B retries with the reconciled view (stale view minus the
        //    cloud-absent passkey) — exactly what `reconcilePasskeysToCloud`
        //    emits — and the write succeeds.
        let mut reconciled_view = stale_view;
        // `VaultView`/`EntryView` implement `Drop` (zeroize), so nothing can be
        // moved out of them — edit the tree in place instead of rebuilding it.
        for entry in reconciled_view.entries.iter_mut() {
            if let EntryView::Group { children, .. } = entry {
                children.retain(|child| match child {
                    EntryView::Passkey(passkey) => passkey.id != PASSKEY_ID,
                    _ => true,
                });
            }
        }

        write_cloud_vault_with(
            "cloud".to_string(),
            PASSWORD.to_string(),
            reconciled_view,
            None,
            None,
            Some(file_id.clone()),
            &manager,
        )
        .await?;

        let stored = read_stored_vault(&manager, &file_id).await?;
        assert!(
            !contains_passkey(&stored.entries, PASSKEY_ID),
            "the reconciled write must not resurrect the deleted passkey"
        );
        assert!(
            contains_data_entry(&stored.entries, data_edit_id),
            "the reconciled write must carry B's Data edit"
        );

        // The version policy is "keep the stored version unless the merged
        // content holds a passkey" (`version_for_content`): the seeded file is
        // 1.0 and the reconciled write leaves no passkey behind, so it stays
        // 1.0 — deleting the last passkey neither downgrades nor upgrades.
        let stored_bytes = manager
            .read_file(file_id, None)
            .await
            .map_err(|_e| CommandError::Io("Failed to read vault file".to_string()))?;
        let parsed = crate::vault::cloud_lifecycle::parse_vault_from_bytes(&stored_bytes)?;
        assert_eq!(
            parsed.version, "1.0",
            "the stored version must be preserved when no passkey remains"
        );

        Ok(())
    }

    /// True when `id` names a passkey anywhere in the tree.
    fn contains_passkey(entries: &[Entry], id: Uuid) -> bool {
        entries.iter().any(|entry| match entry {
            Entry::Passkey { id: passkey_id, .. } => *passkey_id == id,
            Entry::Group { children, .. } => contains_passkey(children, id),
            _ => false,
        })
    }

    /// True when `id` names a Data entry anywhere in the tree.
    fn contains_data_entry(entries: &[Entry], id: Uuid) -> bool {
        entries.iter().any(|entry| match entry {
            Entry::Data { id: entry_id, .. } => *entry_id == id,
            Entry::Group { children, .. } => contains_data_entry(children, id),
            _ => false,
        })
    }
}
