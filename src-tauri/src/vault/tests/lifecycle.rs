#[cfg(test)]
mod tests {
    use crate::vault::lifecycle;
    use crate::commands::errors::CommandError;
    use crate::io::fs::read_file;
    use std::path::PathBuf;
    use tempfile::tempdir;

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
}