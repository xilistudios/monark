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

        // Ensure the file does not exist before creation
        assert!(!std::path::Path::new(&file_path).exists());

        // Create the vault
        lifecycle::create_vault(file_path.clone(), password)?;

        // Verify the file was created
        assert!(std::path::Path::new(&file_path).exists());

        // TODO: Add more assertions to verify the content of the created vault file
        // This would involve reading the file, deserializing it, and checking its structure and some basic properties.
        // This requires implementing the logic to read and decrypt the vault file, which is outside the scope of this specific test for `create_vault`.

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

        // Attempt to create the vault again
        let result = lifecycle::create_vault(file_path.clone(), password);

        // Verify that the function returns an error indicating the file already exists
        match result {
            Err(CommandError::Io(msg)) => assert_eq!(msg, "Vault file already exists"),
            _ => panic!("Expected CommandError::Io with 'Vault file already exists'"),
        }

        Ok(())
    }

    #[test]
    fn test_create_and_open_vault_success() -> Result<(), CommandError> {
        let temp_dir = tempdir().expect("Failed to create temporary directory");
        let file_path = temp_dir.path().join("test_vault.vault").to_str().unwrap().to_string();
        let password = "test_password".to_string();

        // Create the vault
        lifecycle::create_vault(file_path.clone(), password.clone())?;

        // Verify the file was created
        assert!(std::path::Path::new(&file_path).exists());

        // Open the vault with correct password
        let vault = lifecycle::open_vault(file_path.clone(), password)?;

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

        // Create the vault with correct password
        lifecycle::create_vault(file_path.clone(), password)?;

        // Attempt to open with wrong password
        let result = lifecycle::open_vault(file_path, wrong_password);

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
        let result = lifecycle::open_vault(file_path, password);

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

        // Create initial vault
        lifecycle::create_vault(file_path.clone(), password.clone())?;
        
        // Open and modify vault
        let mut vault = lifecycle::open_vault(file_path.clone(), password.clone())?;
        vault.hmac = "test_hmac".to_string();
        vault.entries.push(Entry::Data {
            id: Uuid::new_v4(),
            name: "Test Entry".to_string(),
            data_type: "note".to_string(),
            created_at: Utc::now(),
            updated_at: Utc::now(),
            fields: Vec::new(),
            tags: Vec::new(),
            parent_id: None,
        });

        let prev_updated_at = vault.updated_at;

        // Perform update
        lifecycle::update_vault(file_path.clone(), password.clone(), vault)?;

        // Verify changes
        let updated_vault = lifecycle::open_vault(file_path, password)?;
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

        lifecycle::create_vault(file_path.clone(), password.clone())?;
        let mut vault = lifecycle::open_vault(file_path.clone(), password.clone())?;
        vault.hmac = "new_hmac".to_string();

        let result = lifecycle::update_vault(file_path, wrong_password, vault);
        match result {
            Err(CommandError::Crypto(_)) => Ok(()),
            _ => panic!("Expected cryptographic error for wrong password"),
        }
    }

    #[test]
    fn test_update_vault_nonexistent_file() {
        let file_path = "/nonexistent/path/vault.vault".to_string();
        let password = "test_password".to_string();
        let vault = Vault {
            updated_at: Utc::now(),
            hmac: String::new(),
            entries: Vec::new(),
        };

        let result = lifecycle::update_vault(file_path, password, vault);
        assert!(matches!(result, Err(CommandError::Io(_))));
    }
}