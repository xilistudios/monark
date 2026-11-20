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

        lifecycle::write_vault(file_path.clone(), password.clone(), vault_with_passkey())?;

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
        // `write_vault` stamps `updated_at` with `Utc::now()`; the view must
        // carry that stamp through unchanged.
        assert!(
            view.updated_at > fixed_time(),
            "the view must carry the write timestamp, got {}",
            view.updated_at
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

        lifecycle::write_vault(file_path.clone(), password.clone(), vault)?;
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

        let _ = lifecycle::write_vault(file_path.clone(), password, vault);

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

        lifecycle::write_vault(file_path.clone(), password, vault)?;

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

        let result = lifecycle::write_vault(file_path.clone(), password, vault);

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

        lifecycle::write_vault(file_path.clone(), password.clone(), vault)?;

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

        lifecycle::write_vault(file_path.clone(), password, vault)?;

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

        lifecycle::write_vault(file_path.clone(), password.clone(), vault)?;

        // T04 interim: writes still take a `Vault` (T05 switches them to views),
        // and a view cannot be converted back to a `Vault` for passkeys. These
        // tests only use Data entries, so the mutation is applied to the
        // original `Vault` and the read result (a `VaultView`) is asserted on.
        let vault = Vault {
            updated_at: lifecycle::read_vault(file_path.clone(), password.clone())?.updated_at,
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

        let prev_updated_at = vault.updated_at;

        lifecycle::write_vault(file_path.clone(), password.clone(), vault)?;

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

        lifecycle::write_vault(file_path.clone(), password.clone(), vault)?;
        // T04 interim: the read returns a sanitized view; the write path still
        // takes a `Vault`, so the re-write uses a fresh `Vault` value.
        let vault = Vault {
            updated_at: Utc::now(),
            hmac: "new_hmac".to_string(),
            entries: Vec::new(),
        };

        let result = lifecycle::write_vault(file_path, wrong_password, vault);
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
        let result = lifecycle::write_vault(file_path.clone(), password.clone(), vault);
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

        let write_result = lifecycle::write_vault(file_path.clone(), password.clone(), vault);

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
}
