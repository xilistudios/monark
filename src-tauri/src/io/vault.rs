use crate::io;
use crate::models::VaultFile;
use crate::commands::errors::CommandError;
use base64::Engine;

pub fn read_vault(file_path: String) -> Result<VaultFile, CommandError> {
    // 1. Read the vault file
    let signed_content = io::fs::read_file(&file_path)
        .map_err(|e| CommandError::Io(format!("Failed to read vault file: {}", e)))?;

    // 2. Parse the signed content
    let parsed_content = io::signature::parse_content(&signed_content);

    // 3. Validate the signature
    if !io::signature::is_valid_signature(&parsed_content.signature) {
        return Err(CommandError::Io("Invalid vault file signature".to_string()));
    }

    // 4. Base64 decode the content
    let decoded_content = base64::engine::general_purpose::URL_SAFE_NO_PAD
        .decode(&parsed_content.content)
        .map_err(|e| CommandError::Crypto(format!("Failed to base64 decode vault content: {}", e)))?;

    // 5. Deserialize into VaultFile
    let vault_file: VaultFile = serde_json::from_slice(&decoded_content)
        .map_err(|e| CommandError::Io(format!("Failed to deserialize vault file: {}", e)))?;

    // 6. Return the VaultFile
    Ok(vault_file)
}

pub fn write_vault(file_path: String, vault_file: &VaultFile) -> Result<(), CommandError> {
    let signed_vault = io::signature::sign_vault(&vault_file);
    io::fs::write_file(&file_path, &signed_vault)
        .map_err(|e| CommandError::Io(format!("Failed to write vault file: {}", e)))?;

    Ok(())
}