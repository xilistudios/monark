use keyring::Entry;

const SERVICE_NAME: &str = "monark";

/// Store a secret in the OS keychain under a given key.
pub fn set_secret(key: &str, value: &str) -> Result<(), String> {
    let entry = Entry::new(SERVICE_NAME, key)
        .map_err(|e| format!("Failed to create keychain entry: {}", e))?;
    entry
        .set_password(value)
        .map_err(|e| format!("Failed to set keychain secret: {}", e))
}

/// Retrieve a secret from the OS keychain. Returns Ok(None) if not found.
pub fn get_secret(key: &str) -> Result<Option<String>, String> {
    let entry = Entry::new(SERVICE_NAME, key)
        .map_err(|e| format!("Failed to create keychain entry: {}", e))?;
    match entry.get_password() {
        Ok(val) => Ok(Some(val)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(format!("Failed to get keychain secret: {}", e)),
    }
}

/// Delete a secret from the OS keychain. Returns Ok(()) if not found (idempotent).
pub fn delete_secret(key: &str) -> Result<(), String> {
    let entry = Entry::new(SERVICE_NAME, key)
        .map_err(|e| format!("Failed to create keychain entry: {}", e))?;
    match entry.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(format!("Failed to delete keychain secret: {}", e)),
    }
}
