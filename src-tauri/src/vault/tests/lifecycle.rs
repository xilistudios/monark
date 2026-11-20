#[cfg(test)]
mod tests {
    use crate::commands::errors::CommandError;
    use crate::models::{Entry, EntryView, SecretPkcs8, Vault, VaultView};
    use crate::vault::lifecycle;
    use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
    use chrono::{DateTime, Utc};
    use tempfile::tempdir;
    use uuid::Uuid;

    /// Published-example grade PKCS#8 DER blob (test-only, NOT a real credential).
    const TEST_PKCS8_DER: [u8; 16] = [
        0x30, 0x0e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x04, 0x02, 0x03,
        0x04,
    ];

    fn fixed_time() -> DateTime<Utc> {
        DateTime::parse_from_rfc3339("2026-01-02T03:04:05Z")
            .expect("fixed timestamp parses")
            .with_timezone(&Utc)
    }

    /// A disk vault holding one passkey (with key material) inside a group.
    fn vault_with_passkey() -> Vault {
        Vault {
            updated_at: fixed_time(),
            hmac: "hmac-value".to_string(),
            entries: vec![Entry::Group {
                id: Uuid::from_bytes([0x33; 16]),
                name: "Root".to_string(),
                data_type: "group".to_string(),
                children: vec![Entry::Passkey {
                    id: Uuid::from_bytes([0x11; 16]),
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

    fn key_b64() -> String {
        URL_SAFE_NO_PAD.encode(TEST_PKCS8_DER)
    }

    /// Writes `vault` (passkey key material included) straight to disk, the way
    /// a backend-side `passkey_create` would.
    ///
    /// The command write path cannot do this: it only receives sanitized views,
    /// so a passkey in a payload fails closed. The test therefore builds the
    /// encrypted file itself (fresh master key + KDF key, same layout as
    /// `lifecycle::create_new_vault`).
    fn seed_disk_vault(file_path: &str, password: &str, vault: &Vault) -> Result<(), CommandError> {
        use crate::crypto;
        use crate::models::{Argon2Params, EncryptedData, VaultFile};

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
            password.as_bytes(),
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

        crate::io::vault::write_vault(file_path.to_string(), &vault_file)
    }

    /// Acceptance criterion 2: `read_vault` returns a sanitized view end-to-end.
    #[test]
    fn read_vault_returns_sanitized_view() -> Result<(), CommandError> {
        let temp_dir = tempdir().expect("Failed to create temporary directory");
        let file_path = temp_dir
            .path()
            .join("passkey_vault.monark")
            .to_str()
            .unwrap()
            .to_string();
        let password = "test_password".to_string();

        // A passkey cannot be created through the write path (there is no key
        // material to restore, so it fails closed). Seed the file with the disk
        // vault directly, then exercise the read path.
        seed_disk_vault(&file_path, &password, &vault_with_passkey())?;

        let view: VaultView = lifecycle::read_vault(file_path.clone(), password.clone())?;
        let json = serde_json::to_string(&view).expect("view serializes");

        assert!(
            !json.contains("private_key"),
            "read_vault must never return a private_key field: {json}"
        );
        assert!(
            !json.contains(&key_b64()),
            "read_vault must never return the key material: {json}"
        );
        assert!(json.contains(r#""entry_type":"passkey""#));
        assert_eq!(view.hmac, "hmac-value");
        // The seeded file carries the fixed timestamp; the read path must hand
        // it through unchanged (the write path is what stamps `Utc::now()`).
        assert_eq!(
            view.updated_at,
            fixed_time(),
            "the view must carry the stored vault timestamp"
        );

        let EntryView::Group { children, .. } = &view.entries[0] else {
            panic!("expected a group view at the root");
        };
        let EntryView::Passkey(passkey) = &children[0] else {
            panic!("expected a passkey view inside the group");
        };
        assert_eq!(passkey.rp_id, "github.com");
        assert_eq!(passkey.credential_id, vec![0xde, 0xad, 0xbe, 0xef]);

        // Negative control: the *disk* blob still carries the key (it is
        // encrypted, but present), so the assertions above are meaningful.
        let disk_bytes = std::fs::read(&file_path).expect("vault file is readable");
        let disk_str = String::from_utf8(disk_bytes).expect("vault file is utf-8");
        assert!(
            !disk_str.contains(&key_b64()),
            "the key is encrypted at rest, never plaintext on disk"
        );
        let disk_vault = decrypt_disk_vault(&file_path, &password)?;
        let disk_json = serde_json::to_string(&disk_vault).expect("disk vault serializes");
        assert!(
            disk_json.contains("private_key") && disk_json.contains(&key_b64()),
            "negative control: the decrypted disk vault does contain the key"
        );

        Ok(())
    }

    /// Acceptance criterion 2 (parity): a vault without passkeys reads back
    /// with the same Data/Group JSON the frontend already knows.
    #[test]
    fn read_vault_view_data_entries_unchanged() -> Result<(), CommandError> {
        let temp_dir = tempdir().expect("Failed to create temporary directory");
        let file_path = temp_dir
            .path()
            .join("data_vault.monark")
            .to_str()
            .unwrap()
            .to_string();
        let password = "test_password".to_string();

        let vault = Vault {
            updated_at: fixed_time(),
            hmac: String::new(),
            entries: vec![Entry::Data {
                id: Uuid::from_bytes([0x22; 16]),
                name: "Mail".to_string(),
                data_type: "login".to_string(),
                created_at: fixed_time(),
                updated_at: fixed_time(),
                fields: Vec::new(),
                tags: vec!["personal".to_string()],
            }],
        };
        let expected_entries_json =
            serde_json::to_string(&vault.entries).expect("entries serialize");

        lifecycle::write_vault(file_path.clone(), password.clone(), VaultView::from(&vault))?;
        let view = lifecycle::read_vault(file_path, password)?;

        assert_eq!(
            serde_json::to_string(&view.entries).expect("view entries serialize"),
            expected_entries_json,
            "EntryView::Data must serialize byte-identically to Entry::Data"
        );

        Ok(())
    }

    /// Re-reads the on-disk (encrypted) vault as the raw `Vault` struct, used
    /// only as a negative control for the sanitization assertions.
    ///
    /// Mirrors the decrypt chain of `lifecycle::read_vault` (KDF → master key →
    /// vault blob), stopping before the view conversion.
    fn decrypt_disk_vault(file_path: &str, password: &str) -> Result<Vault, CommandError> {
        use crate::crypto;
        use zeroize::Zeroize;

        let vault_file = crate::io::vault::read_vault(file_path.to_string())?;

        let salt = URL_SAFE_NO_PAD
            .decode(&vault_file.argon2_params.salt)
            .map_err(|_e| CommandError::Crypto("Failed to decode salt".to_string()))?;
        let mut kdf_key = crypto::argon2::derive_key_argon2id(
            password.as_bytes(),
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
        kdf_key.zeroize();

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

    #[test]
    fn test_create_vault_success() -> Result<(), CommandError> {
        let temp_dir = tempdir().expect("Failed to create temporary directory");
        let file_path = temp_dir
            .path()
            .join("test_vault.monark")
            .to_str()
            .unwrap()
            .to_string();
        let password = "test_password".to_string();

        assert!(!std::path::Path::new(&file_path).exists());

        let vault = Vault {
            updated_at: Utc::now(),
            hmac: String::new(),
            entries: Vec::new(),
        };

        let _ = lifecycle::write_vault(file_path.clone(), password, VaultView::from(&vault));

        assert!(std::path::Path::new(&file_path).exists());

        // TODO: Add more assertions to verify the content of the created vault file
        // This would involve reading the file, deserializing it, and checking its structure and some basic properties.
        // This requires implementing the logic to read and decrypt the vault file, which is outside the scope of this specific test for `create_vault`.

        Ok(())
    }
    #[test]
    fn test_create_vault_in_new_subdirectory() -> Result<(), CommandError> {
        let temp_dir = tempdir().expect("Failed to create temporary directory");
        let subdir = temp_dir.path().join("nested_dir");
        let file_path = subdir
            .join("test_vault.monark")
            .to_str()
            .unwrap()
            .to_string();
        let password = "test_password".to_string();

        // Ensure the directory and file do not exist before creation
        assert!(!subdir.exists());
        assert!(!std::path::Path::new(&file_path).exists());

        // Create the parent directory so validation can canonicalize it
        std::fs::create_dir_all(&subdir).expect("Failed to create subdirectory");

        let vault = Vault {
            updated_at: Utc::now(),
            hmac: String::new(),
            entries: Vec::new(),
        };

        lifecycle::write_vault(file_path.clone(), password, VaultView::from(&vault))?;

        assert!(subdir.exists());
        assert!(std::path::Path::new(&file_path).exists());

        Ok(())
    }

    #[test]
    fn test_create_vault_file_exists() -> Result<(), CommandError> {
        let temp_dir = tempdir().expect("Failed to create temporary directory");
        let file_path = temp_dir
            .path()
            .join("existing_vault.monark")
            .to_str()
            .unwrap()
            .to_string();
        let password = "test_password".to_string();

        // Create a dummy file to simulate an existing vault file
        std::fs::File::create(&file_path).expect("Failed to create dummy file");
        assert!(std::path::Path::new(&file_path).exists());

        let vault = Vault {
            updated_at: Utc::now(),
            hmac: String::new(),
            entries: Vec::new(),
        };

        let result = lifecycle::write_vault(file_path.clone(), password, VaultView::from(&vault));

        match result {
            Err(CommandError::Io(msg)) => assert_eq!(msg, "Invalid vault file signature"),
            _ => panic!("Expected CommandError::Io with 'Invalid vault file signature'"),
        }

        Ok(())
    }

    #[test]
    fn test_create_and_open_vault_success() -> Result<(), CommandError> {
        let temp_dir = tempdir().expect("Failed to create temporary directory");
        let file_path = temp_dir
            .path()
            .join("test_vault.monark")
            .to_str()
            .unwrap()
            .to_string();
        let password = "test_password".to_string();

        let vault = Vault {
            updated_at: Utc::now(),
            hmac: String::new(),
            entries: Vec::new(),
        };

        lifecycle::write_vault(file_path.clone(), password.clone(), VaultView::from(&vault))?;

        assert!(std::path::Path::new(&file_path).exists());

        // Open the vault with correct password
        let vault = lifecycle::read_vault(file_path.clone(), password)?;

        // Verify the vault structure
        assert!(vault.entries.is_empty()); // Should be empty for a new vault
        assert_eq!(vault.hmac, String::new()); // HMAC is initially empty in create_vault

        Ok(())
    }

    #[test]
    fn test_open_vault_wrong_password() -> Result<(), CommandError> {
        let temp_dir = tempdir().expect("Failed to create temporary directory");
        let file_path = temp_dir
            .path()
            .join("test_vault.monark")
            .to_str()
            .unwrap()
            .to_string();
        let password = "correct_password".to_string();
        let wrong_password = "wrong_password".to_string();

        let vault = Vault {
            updated_at: Utc::now(),
            hmac: String::new(),
            entries: Vec::new(),
        };

        lifecycle::write_vault(file_path.clone(), password, VaultView::from(&vault))?;

        // Attempt to open with wrong password
        let result = lifecycle::read_vault(file_path, wrong_password);

        // Should fail with a crypto error (decryption failure)
        assert!(result.is_err());
        match result {
            Err(CommandError::Crypto(_)) => {} // Expected
            _ => panic!("Expected CommandError::Crypto"),
        }

        Ok(())
    }

    #[test]
    fn test_open_vault_nonexistent_file() -> Result<(), CommandError> {
        let temp_dir = tempdir().expect("Failed to create temporary directory");
        let file_path = temp_dir
            .path()
            .join("nonexistent_vault.monark")
            .to_str()
            .unwrap()
            .to_string();
        let password = "test_password".to_string();

        // Attempt to open a nonexistent vault
        let result = lifecycle::read_vault(file_path, password);

        // Should fail with a validation or IO error
        assert!(result.is_err());
        match result {
            Err(CommandError::Validation(_)) | Err(CommandError::Io(_)) => {} // Expected
            other => panic!(
                "Expected CommandError::Validation or CommandError::Io, got {:?}",
                other
            ),
        }

        Ok(())
    }
    #[test]
    fn test_update_vault_success() -> Result<(), CommandError> {
        let temp_dir = tempdir().expect("Failed to create temporary directory");
        let file_path = temp_dir
            .path()
            .join("test_vault.monark")
            .to_str()
            .unwrap()
            .to_string();
        let password = "test_password".to_string();

        let vault = Vault {
            updated_at: Utc::now(),
            hmac: String::new(),
            entries: Vec::new(),
        };

        lifecycle::write_vault(file_path.clone(), password.clone(), VaultView::from(&vault))?;

        // The write path now takes the sanitized view: build the edit as a view
        // (exactly what the frontend would send back after `read_vault`).
        let prev_updated_at =
            lifecycle::read_vault(file_path.clone(), password.clone())?.updated_at;
        let vault = Vault {
            updated_at: prev_updated_at,
            hmac: "test_hmac".to_string(),
            entries: vec![Entry::Data {
                id: Uuid::new_v4(),
                name: "Test Entry".to_string(),
                data_type: "note".to_string(),
                created_at: Utc::now(),
                updated_at: Utc::now(),
                fields: Vec::new(),
                tags: Vec::new(),
            }],
        };

        lifecycle::write_vault(file_path.clone(), password.clone(), VaultView::from(&vault))?;

        let updated_vault = lifecycle::read_vault(file_path, password)?;
        assert_eq!(updated_vault.hmac, "test_hmac");
        assert_eq!(updated_vault.entries.len(), 1);
        assert!(updated_vault.updated_at > prev_updated_at);

        Ok(())
    }

    #[test]
    fn test_update_vault_wrong_password() -> Result<(), CommandError> {
        let temp_dir = tempdir().expect("Failed to create temporary directory");
        let file_path = temp_dir
            .path()
            .join("test_vault.monark")
            .to_str()
            .unwrap()
            .to_string();
        let password = "correct_password".to_string();
        let wrong_password = "wrong_password".to_string();

        let vault = Vault {
            updated_at: Utc::now(),
            hmac: String::new(),
            entries: Vec::new(),
        };

        lifecycle::write_vault(file_path.clone(), password.clone(), VaultView::from(&vault))?;
        // The re-write carries the view the frontend holds (empty here) and the
        // wrong password: the master key cannot be unwrapped, so the write fails.
        let vault = Vault {
            updated_at: Utc::now(),
            hmac: "new_hmac".to_string(),
            entries: Vec::new(),
        };

        let result = lifecycle::write_vault(file_path, wrong_password, VaultView::from(&vault));
        match result {
            Err(CommandError::Crypto(_)) => Ok(()),
            _ => panic!("Expected cryptographic error for wrong password"),
        }
    }

    #[test]
    fn test_update_vault_nonexistent_file() {
        let temp_dir = tempdir().expect("Failed to create temporary directory");
        let file_path = temp_dir
            .path()
            .join("update_nonexistent.monark")
            .to_str()
            .unwrap()
            .to_string();
        let password = "test_password".to_string();
        let vault = Vault {
            updated_at: Utc::now(),
            hmac: String::new(),
            entries: Vec::new(),
        };

        // Should succeed and create the file
        let result =
            lifecycle::write_vault(file_path.clone(), password.clone(), VaultView::from(&vault));
        assert!(result.is_ok(), "Expected Ok(()), got {:?}", result);
        assert!(
            std::path::Path::new(&file_path).exists(),
            "Vault file was not created"
        );

        let open_result = lifecycle::read_vault(file_path, password);
        assert!(
            open_result.is_ok(),
            "Vault file could not be opened after creation"
        );
    }
    #[test]
    fn test_delete_vault_success() -> Result<(), CommandError> {
        let temp_dir = tempdir().expect("Failed to create temporary directory");
        let file_path = temp_dir
            .path()
            .join("delete_me.monark")
            .to_str()
            .unwrap()
            .to_string();

        // Create the vault file
        std::fs::File::create(&file_path).expect("Failed to create dummy .monark file");
        assert!(std::path::Path::new(&file_path).exists());

        // Delete the vault file
        lifecycle::delete_vault(file_path.clone())?;
        assert!(!std::path::Path::new(&file_path).exists());

        Ok(())
    }

    #[test]
    fn test_delete_vault_invalid_extension() {
        let temp_dir = tempdir().expect("Failed to create temporary directory");
        let file_path = temp_dir
            .path()
            .join("invalid.txt")
            .to_str()
            .unwrap()
            .to_string();

        // Create a dummy file with invalid extension
        std::fs::File::create(&file_path).expect("Failed to create dummy file");
        assert!(std::path::Path::new(&file_path).exists());

        let result = lifecycle::delete_vault(file_path.clone());
        match result {
            Err(CommandError::Validation(msg)) => {
                assert!(
                    msg.contains(".monark"),
                    "Expected validation error about .monark extension, got: {}",
                    msg
                );
            }
            _ => panic!("Expected CommandError::Validation about .monark extension"),
        }
        // File should still exist
        assert!(std::path::Path::new(&file_path).exists());
    }

    #[test]
    fn test_delete_vault_nonexistent_file() {
        let temp_dir = tempdir().expect("Failed to create temporary directory");
        let file_path = temp_dir
            .path()
            .join("does_not_exist.monark")
            .to_str()
            .unwrap()
            .to_string();
        let result = lifecycle::delete_vault(file_path);
        match result {
            Err(CommandError::NotFound(msg)) => {
                assert!(
                    msg.contains("does not exist"),
                    "Expected 'does not exist' error, got: {}",
                    msg
                );
            }
            other => panic!("Expected CommandError::NotFound, got {:?}", other),
        }
    }
    #[test]
    fn test_write_vault_tmp_path() {
        use crate::commands::errors::CommandError;
        use crate::vault::lifecycle;
        use std::fs;
        use std::os::unix::fs::PermissionsExt;

        let file_path = "/tmp/test_vault.monark".to_string();
        let password = "test123".to_string();

        // Clean up before test
        let _ = fs::remove_file(&file_path);

        let vault = Vault {
            updated_at: Utc::now(),
            hmac: String::new(),
            entries: Vec::new(),
        };

        let write_result =
            lifecycle::write_vault(file_path.clone(), password.clone(), VaultView::from(&vault));

        // 2. Check file existence
        let file_exists = std::path::Path::new(&file_path).exists();

        // 3. Check permissions and contents
        let (permissions, file_len, file_content) = if file_exists {
            let meta = fs::metadata(&file_path).expect("metadata");
            let perms = meta.permissions().mode();
            let len = meta.len();
            let content = fs::read(&file_path).unwrap_or_default();
            (Some(perms), Some(len), Some(content))
        } else {
            (None, None, None)
        };

        // 4. Try to open with read_vault
        let read_result = lifecycle::read_vault(file_path.clone(), password.clone());

        // 5. Clean up after test
        let _ = fs::remove_file(&file_path);

        // 6. Report
        println!("write_result: {:?}", write_result);
        println!("file_exists: {:?}", file_exists);
        println!("permissions: {:?}", permissions);
        println!("file_len: {:?}", file_len);
        println!(
            "file_content (first 32 bytes): {:?}",
            file_content
                .as_ref()
                .map(|v| &v[..std::cmp::min(32, v.len())])
        );
        println!("read_result: {:?}", read_result);

        // 7. Assert for error reproduction
        if let Err(CommandError::Io(msg)) = &read_result {
            assert!(
                msg.contains("Failed to read vault file"),
                "Expected 'Failed to read vault file' error, got: {}",
                msg
            );
        }

        // 8. Assert file was created and has content
        assert!(file_exists, "Vault file was not created");
        assert!(file_len.unwrap_or(0) > 0, "Vault file is empty");
    }

    // -----------------------------------------------------------------
    // T05 — write path merge, end to end through the commands
    // -----------------------------------------------------------------

    /// Criterion 1 (end to end): a view round-trip through `write_vault`
    /// re-attaches the passkey key from disk, byte for byte.
    #[test]
    fn write_vault_roundtrip_restores_passkey_key() -> Result<(), CommandError> {
        let temp_dir = tempdir().expect("Failed to create temporary directory");
        let file_path = temp_dir
            .path()
            .join("roundtrip.monark")
            .to_str()
            .unwrap()
            .to_string();
        let password = "test_password".to_string();

        let disk = vault_with_passkey();
        seed_disk_vault(&file_path, &password, &disk)?;

        // Exactly what the frontend does: read the view, write it back.
        let view = lifecycle::read_vault(file_path.clone(), password.clone())?;
        lifecycle::write_vault(file_path.clone(), password.clone(), view)?;

        let stored = decrypt_disk_vault(&file_path, &password)?;
        assert_eq!(
            stored.entries, disk.entries,
            "the passkey (key material included) must survive the round-trip"
        );

        Ok(())
    }

    /// Criterion 2 (end to end): metadata edits apply, the immutable core and
    /// the key material come from disk.
    #[test]
    fn write_vault_applies_metadata_edits_only() -> Result<(), CommandError> {
        let temp_dir = tempdir().expect("Failed to create temporary directory");
        let file_path = temp_dir
            .path()
            .join("metadata_edit.monark")
            .to_str()
            .unwrap()
            .to_string();
        let password = "test_password".to_string();

        seed_disk_vault(&file_path, &password, &vault_with_passkey())?;

        let mut view = lifecycle::read_vault(file_path.clone(), password.clone())?;
        let EntryView::Group { children, .. } = &mut view.entries[0] else {
            panic!("expected a group view at the root");
        };
        let EntryView::Passkey(passkey) = &mut children[0] else {
            panic!("expected a passkey view inside the group");
        };
        passkey.name = "GitHub (renamed)".to_string();
        passkey.user_name = "octocat2".to_string();
        passkey.rp_id = "evil.example".to_string();
        passkey.credential_id = vec![0x00, 0x01];

        lifecycle::write_vault(file_path.clone(), password.clone(), view)?;

        let stored = decrypt_disk_vault(&file_path, &password)?;
        let Entry::Group { children, .. } = &stored.entries[0] else {
            panic!("expected the group on disk");
        };
        let Entry::Passkey {
            name,
            user_name,
            rp_id,
            credential_id,
            private_key,
            ..
        } = &children[0]
        else {
            panic!("expected the passkey on disk");
        };
        assert_eq!(name, "GitHub (renamed)");
        assert_eq!(user_name, "octocat2");
        assert_eq!(rp_id, "github.com", "rp_id must come from disk");
        assert_eq!(credential_id, &vec![0xde, 0xad, 0xbe, 0xef]);
        assert_eq!(private_key.to_pkcs8_der()?, TEST_PKCS8_DER.to_vec());

        Ok(())
    }

    /// Criterion 3 (end to end): a stale view that never saw the passkey must
    /// not delete it.
    #[test]
    fn write_vault_stale_view_preserves_passkey() -> Result<(), CommandError> {
        let temp_dir = tempdir().expect("Failed to create temporary directory");
        let file_path = temp_dir
            .path()
            .join("stale_write.monark")
            .to_str()
            .unwrap()
            .to_string();
        let password = "test_password".to_string();

        seed_disk_vault(&file_path, &password, &vault_with_passkey())?;

        // A view captured before the passkey existed: the group is there, the
        // passkey is not.
        let stale_view = VaultView {
            updated_at: fixed_time(),
            hmac: String::new(),
            entries: vec![EntryView::Group {
                id: Uuid::from_bytes([0x33; 16]),
                name: "Root".to_string(),
                data_type: "group".to_string(),
                children: Vec::new(),
            }],
        };
        lifecycle::write_vault(file_path.clone(), password.clone(), stale_view)?;

        let stored = decrypt_disk_vault(&file_path, &password)?;
        assert_eq!(
            stored.entries,
            vault_with_passkey().entries,
            "the stale write must leave the passkey exactly as it was"
        );

        Ok(())
    }

    /// Criterion 4 (end to end): an unknown passkey id is rejected and the file
    /// on disk is left untouched.
    #[test]
    fn write_vault_unknown_passkey_id_fails_closed_and_writes_nothing() -> Result<(), CommandError>
    {
        let temp_dir = tempdir().expect("Failed to create temporary directory");
        let file_path = temp_dir
            .path()
            .join("unknown_passkey.monark")
            .to_str()
            .unwrap()
            .to_string();
        let password = "test_password".to_string();

        seed_disk_vault(&file_path, &password, &vault_with_passkey())?;
        let before = std::fs::read(&file_path).expect("vault file is readable");

        let mut view = lifecycle::read_vault(file_path.clone(), password.clone())?;
        let EntryView::Group { children, .. } = &mut view.entries[0] else {
            panic!("expected a group view at the root");
        };
        let EntryView::Passkey(passkey) = &mut children[0] else {
            panic!("expected a passkey view inside the group");
        };
        passkey.id = Uuid::from_bytes([0x77; 16]);

        match lifecycle::write_vault(file_path.clone(), password, view) {
            Err(CommandError::Validation(msg)) => {
                assert!(msg.contains("no stored key material"), "unexpected: {msg}");
            }
            other => panic!("expected CommandError::Validation, got {other:?}"),
        }

        let after = std::fs::read(&file_path).expect("vault file is readable");
        assert_eq!(before, after, "a rejected write must not touch the file");

        Ok(())
    }

    /// Criterion 6 (end to end): data entries keep round-tripping exactly as
    /// before the view-based write path.
    #[test]
    fn write_vault_data_entries_roundtrip_unchanged() -> Result<(), CommandError> {
        let temp_dir = tempdir().expect("Failed to create temporary directory");
        let file_path = temp_dir
            .path()
            .join("data_roundtrip.monark")
            .to_str()
            .unwrap()
            .to_string();
        let password = "test_password".to_string();

        let vault = Vault {
            updated_at: fixed_time(),
            hmac: String::new(),
            entries: vec![Entry::Data {
                id: Uuid::from_bytes([0x22; 16]),
                name: "Mail".to_string(),
                data_type: "login".to_string(),
                created_at: fixed_time(),
                updated_at: fixed_time(),
                fields: vec![crate::models::Field {
                    title: "Password".to_string(),
                    property: "password".to_string(),
                    value: "s3cr3t".to_string(),
                    secret: true,
                }],
                tags: vec!["personal".to_string()],
            }],
        };

        lifecycle::write_vault(file_path.clone(), password.clone(), VaultView::from(&vault))?;
        let view = lifecycle::read_vault(file_path.clone(), password.clone())?;
        lifecycle::write_vault(file_path.clone(), password.clone(), view)?;

        let stored = decrypt_disk_vault(&file_path, &password)?;
        assert_eq!(stored.entries, vault.entries);

        Ok(())
    }

    /// Criterion 7: a creation payload cannot smuggle in a passkey, and an
    /// empty payload still creates a vault.
    #[test]
    fn create_vault_with_passkey_fails_closed() -> Result<(), CommandError> {
        let temp_dir = tempdir().expect("Failed to create temporary directory");
        let file_path = temp_dir
            .path()
            .join("create_with_passkey.monark")
            .to_str()
            .unwrap()
            .to_string();
        let password = "test_password".to_string();

        let view = VaultView::from(&vault_with_passkey());
        match lifecycle::write_vault(file_path.clone(), password.clone(), view) {
            Err(CommandError::Validation(msg)) => {
                assert!(msg.contains("no stored key material"), "unexpected: {msg}");
            }
            other => panic!("expected CommandError::Validation, got {other:?}"),
        }
        assert!(
            !std::path::Path::new(&file_path).exists(),
            "a rejected creation must not create the file"
        );

        // The empty payload the UI actually sends still works.
        lifecycle::write_vault(
            file_path.clone(),
            password.clone(),
            VaultView {
                updated_at: Utc::now(),
                hmac: String::new(),
                entries: Vec::new(),
            },
        )?;
        assert!(std::path::Path::new(&file_path).exists());

        Ok(())
    }

    /// Review finding E14b: the write path must not re-encrypt a format this
    /// build cannot read. A vault claiming version "9.9" is refused with the
    /// same `UnsupportedVersion` the read path raises, and the file is left
    /// byte-identical (nothing written).
    #[test]
    fn update_rejects_unsupported_version_without_writing() -> Result<(), CommandError> {
        let temp_dir = tempdir().expect("Failed to create temporary directory");
        let file_path = temp_dir
            .path()
            .join("future_version.monark")
            .to_str()
            .ok_or_else(|| CommandError::Validation("Invalid temp path".to_string()))?
            .to_string();
        let password = "test_password".to_string();

        // Seed through the command create path (empty payload: a passkey cannot
        // be created through it, see `create_vault_with_passkey_fails_closed`).
        lifecycle::write_vault(
            file_path.clone(),
            password.clone(),
            VaultView {
                updated_at: Utc::now(),
                hmac: String::new(),
                entries: Vec::new(),
            },
        )?;

        // Rewrite the envelope with a future version, keeping the crypto intact.
        let mut vault_file = crate::io::vault::read_vault(file_path.clone())?;
        vault_file.version = "9.9".to_string();
        crate::io::vault::write_vault(file_path.clone(), &vault_file)?;
        let before = std::fs::read(&file_path)
            .map_err(|_e| CommandError::Io("Failed to read vault file".to_string()))?;

        let result = lifecycle::write_vault(
            file_path.clone(),
            password,
            VaultView {
                updated_at: Utc::now(),
                hmac: String::new(),
                entries: Vec::new(),
            },
        );
        match result {
            Err(CommandError::UnsupportedVersion(version)) => assert_eq!(version, "9.9"),
            other => panic!("expected UnsupportedVersion, got {other:?}"),
        }

        let after = std::fs::read(&file_path)
            .map_err(|_e| CommandError::Io("Failed to read vault file".to_string()))?;
        assert_eq!(
            before, after,
            "a rejected update must not rewrite the file (negative control)"
        );

        Ok(())
    }
}
