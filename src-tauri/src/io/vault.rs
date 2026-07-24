use crate::commands::errors::CommandError;
use crate::io;
use crate::models::VaultFile;
use base64::Engine;

pub fn read_vault(file_path: String) -> Result<VaultFile, CommandError> {
    // 1. Read the vault file
    let signed_content = io::fs::read_file(&file_path)
        .map_err(|_e| CommandError::Io("Failed to read vault file".to_string()))?;

    // 2. Validate the signature first
    // The signature is appended to the content, so we pass the entire file content to the validation function.
    if !io::signature::is_valid_signature(&signed_content) {
        return Err(CommandError::Io("Invalid vault file signature".to_string()));
    }

    // 3. Parse the signed content
    let parsed_content = io::signature::parse_content(&signed_content);

    // 4. Base64 decode the content
    let decoded_content = base64::engine::general_purpose::URL_SAFE_NO_PAD
        .decode(&parsed_content.content)
        .map_err(|_e| CommandError::Crypto("Failed to decode vault content".to_string()))?;

    // 5. Deserialize into VaultFile
    let vault_file: VaultFile = serde_json::from_slice(&decoded_content)
        .map_err(|_e| CommandError::Io("Failed to deserialize vault file".to_string()))?;

    // 6. Return the VaultFile
    Ok(vault_file)
}

pub fn write_vault(file_path: String, vault_file: &VaultFile) -> Result<(), CommandError> {
    use std::fs;
    use std::path::Path;

    let path = Path::new(&file_path);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|_e| CommandError::Io("Failed to create parent directories".to_string()))?;
    }

    let signed_vault = io::signature::sign_vault(&vault_file);
    io::fs::write_file(&file_path, &signed_vault)
        .map_err(|_e| CommandError::Io("Failed to write vault file".to_string()))?;

    Ok(())
}
