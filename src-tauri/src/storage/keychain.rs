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

/// Install keyring-core's in-memory mock store as the process-wide default
/// credential store, so tests never read or write the developer's real OS
/// keychain (and never require a running Secret Service in headless CI).
///
/// **Idempotent**: safe to call from every test helper; only the first call
/// does the work.
///
/// **Why the warm-up `Entry::new` must run BEFORE the mock is installed**:
/// `keyring::v1::Entry::new` (keyring 4.x) guards its one-time lazy platform
/// store initialization behind a `compare_exchange` on a process-wide flag
/// and, on the FIRST `Entry::new` in the process, overwrites the default
/// store with the platform store (Secret Service on Linux, Keychain on macOS,
/// …) — clobbering anything installed before it. Creating a throwaway entry
/// here first forces that lazy init to fire while the real store is still the
/// default; every later `Entry::new` call sees the flag already set and skips
/// `set_default_store`, so the mock installed afterwards sticks for the rest
/// of the process.
///
/// Note: the warm-up `Entry::new` DOES instantiate the platform store once
/// (a session-bus connection on Linux) before it is discarded — no secret is
/// ever read or written through it, so hermeticity holds.
#[cfg(test)]
pub fn install_test_store() {
    static INSTALL: Once = Once::new();
    INSTALL.call_once(|| {
        // 1. Warm-up: trigger the keyring v1 lazy platform-store init now, so
        //    it can no longer overwrite the mock below.
        let _ = Entry::new(SERVICE_NAME, "__monark_test_warmup__");
        // 2. Swap in the in-memory mock (process-local, no persistence).
        let store = keyring_core::mock::Store::new().expect("mock keychain store cannot fail");
        keyring_core::set_default_store(store);
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The keychain round-trip goes through the in-memory mock store installed
    /// by `install_test_store`, proving test isolation from the real OS keychain:
    /// no Secret Service connection is made, nothing persists after the process.
    #[test]
    fn test_secrets_round_trip_through_mock_store() {
        install_test_store();

        let key = "__monark_test_secret_round_trip__";

        // Nothing stored yet.
        assert_eq!(get_secret(key).unwrap(), None);

        // set → get.
        set_secret(key, "s3cret-value").unwrap();
        assert_eq!(get_secret(key).unwrap().as_deref(), Some("s3cret-value"));

        // Overwrite.
        set_secret(key, "rotated-value").unwrap();
        assert_eq!(get_secret(key).unwrap().as_deref(), Some("rotated-value"));

        // delete → gone, and deleting again is idempotent (NoEntry is Ok).
        delete_secret(key).unwrap();
        assert_eq!(get_secret(key).unwrap(), None);
        delete_secret(key).unwrap();
    }
}
