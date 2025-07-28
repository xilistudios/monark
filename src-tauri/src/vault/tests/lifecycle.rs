#[cfg(test)]
mod tests {
    use crate::vault::lifecycle;
    use crate::commands::errors::CommandError;
    use tempfile::tempdir;
    use chrono::Utc;
    use crate::models::{Vault, Entry};
    use uuid::Uuid;

    #[test]
    fn test_create_vault_success() -> Result<(), CommandError> {
        let temp_dir = tempdir().expect("Failed to create temporary directory");
        let file_path = temp_dir.path().join("test_vault.vault").to_str().unwrap().to_string();
        let password = "test_password".to_string();

        assert!(!std::path::Path::new(&file_path).exists());

        let vault = Vault {
            updated_at: Utc::now(),
            hmac: String::new(),
            entries: Vec::new(),
        };

        lifecycle::write_vault(file_path.clone(), password, vault)?;

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
        let file_path = subdir.join("test_vault.vault").to_str().unwrap().to_string();
        let password = "test_password".to_string();

        // Ensure the directory and file do not exist before creation
        assert!(!subdir.exists());
        assert!(!std::path::Path::new(&file_path).exists());

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
        let file_path = temp_dir.path().join("existing_vault.vault").to_str().unwrap().to_string();
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
        let file_path = temp_dir.path().join("test_vault.vault").to_str().unwrap().to_string();
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
        let file_path = temp_dir.path().join("test_vault.vault").to_str().unwrap().to_string();
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
            Err(CommandError::Crypto(_)) => {}, // Expected
            _ => panic!("Expected CommandError::Crypto"),
        }

        Ok(())
    }

    #[test]
    fn test_open_vault_nonexistent_file() -> Result<(), CommandError> {
        let file_path = "/nonexistent/path/vault.vault".to_string();
        let password = "test_password".to_string();

        // Attempt to open a nonexistent vault
        let result = lifecycle::read_vault(file_path, password);

        // Should fail with an IO error
        assert!(result.is_err());
        match result {
            Err(CommandError::Io(_)) => {}, // Expected
            _ => panic!("Expected CommandError::Io"),
        }

        Ok(())
    }
    #[test]
    fn test_update_vault_success() -> Result<(), CommandError> {
        let temp_dir = tempdir().expect("Failed to create temporary directory");
        let file_path = temp_dir.path().join("test_vault.vault").to_str().unwrap().to_string();
        let password = "test_password".to_string();

        let vault = Vault {
            updated_at: Utc::now(),
            hmac: String::new(),
            entries: Vec::new(),
        };

        lifecycle::write_vault(file_path.clone(), password.clone(), vault)?;

        let mut vault = lifecycle::read_vault(file_path.clone(), password.clone())?;
        vault.hmac = "test_hmac".to_string();
        vault.entries.push(Entry::Data {
            id: Uuid::new_v4(),
            name: "Test Entry".to_string(),
            data_type: "note".to_string(),
            created_at: Utc::now(),
            updated_at: Utc::now(),
            fields: Vec::new(),
            tags: Vec::new(),
        });

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
        let file_path = temp_dir.path().join("test_vault.vault").to_str().unwrap().to_string();
        let password = "correct_password".to_string();
        let wrong_password = "wrong_password".to_string();

        let vault = Vault {
            updated_at: Utc::now(),
            hmac: String::new(),
            entries: Vec::new(),
        };

        lifecycle::write_vault(file_path.clone(), password.clone(), vault)?;
        let mut vault = lifecycle::read_vault(file_path.clone(), password.clone())?;
        vault.hmac = "new_hmac".to_string();

        let result = lifecycle::write_vault(file_path, wrong_password, vault);
        match result {
            Err(CommandError::Crypto(_)) => Ok(()),
            _ => panic!("Expected cryptographic error for wrong password"),
        }
    }

    #[test]
    fn test_update_vault_nonexistent_file() {
        let temp_dir = tempdir().expect("Failed to create temporary directory");
        let file_path = temp_dir.path().join("update_nonexistent.vault").to_str().unwrap().to_string();
        let password = "test_password".to_string();
        let vault = Vault {
            updated_at: Utc::now(),
            hmac: String::new(),
            entries: Vec::new(),
        };

        // Should succeed and create the file
        let result = lifecycle::write_vault(file_path.clone(), password.clone(), vault);
        assert!(result.is_ok(), "Expected Ok(()), got {:?}", result);
        assert!(std::path::Path::new(&file_path).exists(), "Vault file was not created");

        let open_result = lifecycle::read_vault(file_path, password);
        assert!(open_result.is_ok(), "Vault file could not be opened after creation");
    }
    #[test]
    fn test_delete_vault_success() -> Result<(), CommandError> {
        let temp_dir = tempdir().expect("Failed to create temporary directory");
        let file_path = temp_dir.path().join("delete_me.monark").to_str().unwrap().to_string();
        let password = "test_password".to_string();

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
        let file_path = temp_dir.path().join("invalid.txt").to_str().unwrap().to_string();

        // Create a dummy file with invalid extension
        std::fs::File::create(&file_path).expect("Failed to create dummy file");
        assert!(std::path::Path::new(&file_path).exists());

        let result = lifecycle::delete_vault(file_path.clone());
        match result {
            Err(CommandError::Io(msg)) => assert_eq!(msg, "Invalid vault file extension"),
            _ => panic!("Expected CommandError::Io with 'Invalid vault file extension'"),
        }
        // File should still exist
        assert!(std::path::Path::new(&file_path).exists());
    }

    #[test]
    fn test_delete_vault_nonexistent_file() {
        let file_path = "/nonexistent/path/does_not_exist.monark".to_string();
        let result = lifecycle::delete_vault(file_path);
        match result {
            Err(CommandError::Io(msg)) => assert_eq!(msg, "Vault file does not exist"),
            _ => panic!("Expected CommandError::Io with 'Vault file does not exist'"),
        }
    }
    #[test]
    fn test_write_vault_tmp_path() {
        use std::fs;
        use std::os::unix::fs::PermissionsExt;
        use crate::vault::lifecycle;
        use crate::commands::errors::CommandError;

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
        println!("file_content (first 32 bytes): {:?}", file_content.as_ref().map(|v| &v[..std::cmp::min(32, v.len())]));
        println!("read_result: {:?}", read_result);

        // 7. Assert for error reproduction
        if let Err(CommandError::Io(msg)) = &read_result {
            assert!(msg.contains("Failed to read vault file"), "Expected 'Failed to read vault file' error, got: {}", msg);
        }

        // 8. Assert file was created and has content
        assert!(file_exists, "Vault file was not created");
        assert!(file_len.unwrap_or(0) > 0, "Vault file is empty");
    }
}