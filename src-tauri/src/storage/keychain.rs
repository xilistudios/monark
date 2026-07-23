use keyring::Entry;
use std::sync::Once;

const SERVICE_NAME: &str = "monark";

#[allow(dead_code)] // Used on Android; no-op codepath on other platforms
static INIT: Once = Once::new();

#[cfg(target_os = "android")]
fn init_keychain() {
    INIT.call_once(|| match android_native_keyring_store::Store::new() {
        Ok(store) => {
            keyring_core::set_default_store(store);
        }
        Err(e) => {
            eprintln!("Failed to initialize Android keychain store: {:?}", e);
        }
    });
}

#[cfg(not(target_os = "android"))]
fn init_keychain() {
    // No-op: keyring v1 module handles macOS, Windows, Linux automatically
}

/// Store a secret in the OS keychain under a given key.
pub fn set_secret(key: &str, value: &str) -> Result<(), String> {
    init_keychain();
    let entry = Entry::new(SERVICE_NAME, key)
        .map_err(|e| format!("Failed to create keychain entry: {}", e))?;
    entry
        .set_password(value)
        .map_err(|e| format!("Failed to set keychain secret: {}", e))
}

/// Retrieve a secret from the OS keychain. Returns Ok(None) if not found.
pub fn get_secret(key: &str) -> Result<Option<String>, String> {
    init_keychain();
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
    init_keychain();
    let entry = Entry::new(SERVICE_NAME, key)
        .map_err(|e| format!("Failed to create keychain entry: {}", e))?;
    match entry.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(format!("Failed to delete keychain secret: {}", e)),
    }
}
