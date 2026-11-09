pub mod config;
pub mod error;
pub mod keychain;
pub mod manager;
pub mod providers;
pub mod token_store;

#[cfg(test)]
mod tests;

#[cfg(test)]
pub(crate) mod test_support;

pub use config::reset_storage_config_path;
pub use config::set_storage_config_path;
#[cfg(test)]
pub(crate) use config::with_storage_config_path;
pub use config::{
    google_drive_config_from_env, ProviderConfig, StorageConfig, MONARK_DEFAULT_PROVIDER_NAME,
};
pub use error::{StorageError, StorageResult};
pub use manager::StorageManager;
pub use providers::{StorageProvider, StorageProviderType};
pub use token_store::{set_token_store_path, TokenStore};

use std::sync::Arc;

/// Persist OAuth tokens recovered from the legacy on-disk config into the token
/// store, **refusing to write when the existing store cannot be read**.
///
/// Why the refusal is load-bearing (Linux): `TokenStore::load` goes through the OS
/// keychain (Secret Service → KWallet / gnome-keyring). At session start that read
/// can legitimately fail — the daemon is still starting, D-Bus is not ready yet, or
/// the collection is locked. The previous `TokenStore::load().unwrap_or_default()`
/// turned such a failure into an EMPTY store, and the following `save()` then
/// overwrote the real keychain entry, permanently destroying the user's Google
/// Drive tokens (after which every launch asks for a full re-authentication — the
/// "the tokens are not being saved" report). An unreadable store is not an empty
/// store: leaving it untouched is the only safe behaviour.
///
/// `Err` means "nothing was migrated": the caller must then keep the plaintext
/// copy in `storage_config.json` (see `init_storage_manager`), otherwise the only
/// surviving copy of the tokens is destroyed.
///
/// An entry already present in the store always wins over this older plaintext copy.
fn migrate_google_drive_tokens_from_disk(
    gd_config: &providers::google_drive::GoogleDriveConfig,
) -> Result<(), String> {
    let mut token_store = TokenStore::load()
        .map_err(|e| format!("the existing token store could not be read ({e})"))?;
    if token_store.get_monark_tokens().is_some() {
        return Ok(());
    }
    token_store.set_monark_tokens(gd_config.into());
    token_store
        .save()
        .map_err(|e| format!("the token store could not be written ({e})"))
}

/// Initialize the storage manager with default configuration
pub async fn init_storage_manager() -> StorageResult<Arc<StorageManager>> {
    // One-time migration: move any plaintext secrets from disk files to OS keychain
    if let Err(e) = crate::storage::TokenStore::migrate_from_disk() {
        println!("[Storage] Warning: token store migration failed: {}", e);
    }
    if let Err(e) = crate::storage::StorageConfig::migrate_secrets_from_disk() {
        println!("[Storage] Warning: config secrets migration failed: {}", e);
    }

    // Try to load config from disk, fallback to default if not found
    let mut config = StorageConfig::load().unwrap_or_default();

    // Migration: Rename old "Monark" provider to "Google Drive" if it exists
    if let Some(provider) = config.providers.remove("Monark") {
        config
            .providers
            .insert(MONARK_DEFAULT_PROVIDER_NAME.to_string(), provider);
        println!(
            "[Storage] Renamed provider 'Monark' to '{}'",
            MONARK_DEFAULT_PROVIDER_NAME
        );
    }

    // Migration: Extract tokens from the built-in Google Drive provider in storage_config.json
    // and move them to the separate token store before removing the provider.
    //
    // `pending_legacy_tokens`: never erase the plaintext copy when the keychain failed.
    let mut pending_legacy_tokens = None;
    if let Some(ProviderConfig::GoogleDrive { config: gd_config }) =
        config.providers.get(MONARK_DEFAULT_PROVIDER_NAME)
    {
        if gd_config.access_token.is_some() || gd_config.refresh_token.is_some() {
            println!(
                "[Storage] Migrating Google Drive tokens from storage_config.json to provider_tokens.json"
            );
            if let Err(e) = migrate_google_drive_tokens_from_disk(gd_config) {
                println!(
                    "[Storage] Refusing to migrate Google Drive tokens: {}. The existing keychain entry was left untouched.",
                    e
                );
                // Cloned out of the borrow: `save()` must re-write this copy verbatim.
                pending_legacy_tokens = Some(gd_config.clone());
            }
        }
    }
    let kept_plaintext_copy = pending_legacy_tokens.is_some();
    config.set_pending_legacy_google_drive_tokens(pending_legacy_tokens);

    // Migration: Remove any persisted built-in Google Drive provider from disk config.
    // Its credentials are embedded in the binary and must never live on disk.
    if kept_plaintext_copy {
        println!(
            "[Storage] Keeping the plaintext {} entry in storage_config.json because the token store could not be read or written; the migration is retried on the next launch.",
            MONARK_DEFAULT_PROVIDER_NAME
        );
    } else if config
        .providers
        .remove(MONARK_DEFAULT_PROVIDER_NAME)
        .is_some()
    {
        println!(
            "[Storage] Removed persisted {} provider from config (credentials are built-in)",
            MONARK_DEFAULT_PROVIDER_NAME
        );
        let _ = config.save();
    }

    // Ensure the default Google Drive provider exists in memory if
    // env vars are set. save() filters it out so there is no need to persist here.
    config.ensure_monark_provider();

    // Load and merge stored OAuth tokens for the Google Drive provider.
    // The credentials (client_id, client_secret, redirect_uri) come from env vars
    // via ensure_monark_provider(), while the tokens live in provider_tokens.json.
    match TokenStore::load() {
        Ok(token_store) => {
            if let Some(stored_tokens) = token_store.get_monark_tokens() {
                if let Some(ProviderConfig::GoogleDrive { config: gd_config }) =
                    config.providers.get_mut(MONARK_DEFAULT_PROVIDER_NAME)
                {
                    stored_tokens.merge_into(gd_config);
                    println!("[Storage] Loaded OAuth tokens for Monark provider");
                }
            }
        }
        // On Linux the Secret Service (KWallet/gnome-keyring) may not be ready when
        // the app starts, or the collection may still be locked: `TokenStore::load`
        // then fails. Swallowing that error made the app look "logged out" and ask
        // for a full re-authentication although the tokens were safely stored — so
        // say it out loud instead of hiding it (nothing is written here either).
        Err(e) => println!(
            "[Storage] Warning: OAuth tokens could not be read from the OS keychain ({}). Google Drive will look unauthenticated for this session; the stored tokens are left untouched.",
            e
        ),
    }

    // One-time migration: Remove duplicate "Monark" provider with no tokens
    // if another Google Drive provider with the same client_id has valid tokens.
    // This cleans up the state created by the old bug where `ensure_monark_provider`
    // would always create a "Monark" entry even when the user had already authenticated
    // under a different provider name.
    {
        let (has_empty_monark, monark_client_id) =
            match config.providers.get(MONARK_DEFAULT_PROVIDER_NAME) {
                Some(ProviderConfig::GoogleDrive { config: mc })
                    if mc.access_token.is_none() && mc.refresh_token.is_none() =>
                {
                    (true, mc.client_id.clone())
                }
                _ => (false, String::new()),
            };

        if has_empty_monark {
            let existing_name = config.providers.iter().find_map(|(name, provider)| {
                if name == MONARK_DEFAULT_PROVIDER_NAME {
                    return None;
                }
                match provider {
                    ProviderConfig::GoogleDrive { config: gd_config }
                        if gd_config.client_id == monark_client_id
                            && gd_config.access_token.is_some() =>
                    {
                        Some(name.clone())
                    }
                    _ => None,
                }
            });

            if let Some(existing_name) = existing_name {
                println!(
                    "[Storage] Removing duplicate Monark provider (no tokens) — existing '{}' provider has valid tokens",
                    existing_name
                );
                config.providers.remove(MONARK_DEFAULT_PROVIDER_NAME);
                let _ = config.save();
            }
        }
    }

    Ok(Arc::new(StorageManager::new(config).await?))
}

/// Pins the "never clobber an unreadable token store" invariant.
///
/// Both tests own the well-known keychain key, so they take the crate-wide
/// [`test_support::lock_token_store_key`] guard: the mock keychain store is
/// process-wide and another suite (the `update_google_drive_config` built-in
/// provider case) writes the very same key.
#[cfg(test)]
mod token_store_migration_tests {
    use super::migrate_google_drive_tokens_from_disk;
    use crate::storage::keychain;
    use crate::storage::providers::google_drive::GoogleDriveConfig;
    use crate::storage::test_support::lock_token_store_key;
    use crate::storage::TokenStore;

    /// `KEYCHAIN_KEY` of `storage::token_store`.
    const KEY: &str = "monark_token_store";

    fn gd_config() -> GoogleDriveConfig {
        GoogleDriveConfig {
            client_id: "legacy-client-id".to_string(),
            client_secret: "legacy-client-secret".to_string(),
            redirect_uri: "http://localhost/callback".to_string(),
            access_token: Some("legacy-access".to_string()),
            refresh_token: Some("legacy-refresh".to_string()),
            token_expires_at: None,
        }
    }

    /// Hazard pinned: an unreadable store must NEVER be overwritten with an empty
    /// one. On Linux the keychain read fails while the Secret Service is starting
    /// or the collection is locked, and the old `unwrap_or_default()` + `save()`
    /// destroyed the stored tokens.
    #[tokio::test]
    async fn an_unreadable_token_store_is_never_overwritten() {
        let _guard = lock_token_store_key().await;
        keychain::install_test_store();

        let corrupt = "{ this is not valid json";
        keychain::set_secret(KEY, corrupt).expect("the mock keychain must accept writes");

        let error = migrate_google_drive_tokens_from_disk(&gd_config())
            .expect_err("an unreadable token store must not be treated as empty");
        assert!(
            error.contains("could not be read"),
            "unexpected error message: {error}"
        );

        // Nothing was clobbered: the unreadable payload is still there.
        assert_eq!(
            keychain::get_secret(KEY)
                .expect("the mock keychain must answer")
                .as_deref(),
            Some(corrupt)
        );

        keychain::delete_secret(KEY).expect("cleanup must succeed");
    }

    #[tokio::test]
    async fn a_readable_token_store_receives_the_migrated_tokens() {
        let _guard = lock_token_store_key().await;
        keychain::install_test_store();
        keychain::delete_secret(KEY).expect("a missing entry is not an error");

        migrate_google_drive_tokens_from_disk(&gd_config()).expect("migration must succeed");

        let store = TokenStore::load().expect("the store must be readable again");
        let stored = store.get_monark_tokens().expect("tokens must be present");
        assert_eq!(stored.access_token.as_deref(), Some("legacy-access"));
        assert_eq!(stored.refresh_token.as_deref(), Some("legacy-refresh"));

        keychain::delete_secret(KEY).expect("cleanup must succeed");
    }
}
