//! Shared test-only helpers for hermetic storage tests.
//!
//! Two things must be pinned down for every test that exercises
//! `StorageConfig::save`/`load` with a Google Drive provider:
//!
//! * the **credential store** — `keychain::install_test_store()` swaps the
//!   real OS keychain (Secret Service on Linux) for keyring-core's in-memory
//!   mock, so tests neither pollute the developer's keychain nor require a
//!   running Secret Service in headless CI;
//! * the **config file path** — `isolate_storage_config()` points
//!   `StorageConfig::save`/`load` at a throwaway file in the system temp
//!   dir. Prefer `isolate_storage_config_for(name)` when the test owns a
//!   manager: it gives that test its **own** file for the duration of the
//!   test, so a concurrent test's `save()` (which rewrites the whole file
//!   from its own in-memory config) cannot drop the provider being asserted.

use super::{ProviderConfig, StorageConfig, StorageManager};
use crate::storage::providers::google_drive::GoogleDriveConfig;
use chrono::{Duration, Utc};
use std::path::PathBuf;

/// Unique-per-process suffix for temp dirs, so two test binaries (or two
/// invocations) running at once never share a config file.
fn process_dir_suffix() -> String {
    std::process::id().to_string()
}

/// Point `StorageConfig::save`/`load` at a throwaway file so tests never
/// touch the user's real configuration.
///
/// The path is *shared* by every test that calls this helper: `StorageConfig::save`
/// writes it atomically (temp file + rename, see `StorageConfig::save`), so a
/// concurrent reader never sees a half-written file — but it may see the
/// *other* test's providers instead of its own. Tests that assert on the
/// contents of their own config file must use [`isolate_storage_config_for`].
pub(crate) fn isolate_storage_config() -> PathBuf {
    let dir = std::env::temp_dir().join(format!(
        "monark-oauth-callback-tests-{}",
        process_dir_suffix()
    ));
    let _ = std::fs::create_dir_all(&dir);
    let path = dir.join("storage_config.json");
    crate::storage::set_storage_config_path(path.clone());
    path
}

/// Run `fut` with `StorageConfig::save`/`load` pointed at a file private to
/// `name`, for the duration of `fut` only.
///
/// This is the isolation primitive for tests that must read back the file
/// they just wrote: without it, the process-wide path is rewritten by every
/// other test's `save()`, which replaces the whole document — dropping this
/// test's provider between its own `save` and `load`.
///
/// `name` must be unique per test so two concurrent tests cannot collide on
/// the file path.
pub(crate) async fn with_isolated_storage_config_for<R>(
    name: &str,
    fut: impl std::future::Future<Output = R>,
) -> R {
    let dir = std::env::temp_dir().join(format!(
        "monark-oauth-callback-tests-{}-{}",
        process_dir_suffix(),
        name
    ));
    let _ = std::fs::create_dir_all(&dir);
    let path = dir.join("storage_config.json");
    crate::storage::with_storage_config_path(path, fut).await
}

/// A Google Drive config with (expired) test credentials — the shape the
/// OAuth/refresh tests rely on.
pub(crate) fn test_google_drive_config() -> GoogleDriveConfig {
    GoogleDriveConfig {
        client_id: "client_id".to_string(),
        client_secret: "client_secret".to_string(),
        redirect_uri: "http://localhost/callback".to_string(),
        access_token: Some("expired_access".to_string()),
        refresh_token: Some("refresh_token".to_string()),
        token_expires_at: Some(Utc::now() - Duration::minutes(10)),
    }
}

/// Build a `StorageManager` with a `google_drive` provider registered.
///
/// Hermetic by construction: installs the mock keychain store and redirects
/// the config file to the shared temp location before `add_provider` (which
/// persists immediately) can touch either the real keychain or the real
/// config file.
pub(crate) async fn manager_with_google_drive() -> StorageManager {
    crate::storage::keychain::install_test_store();
    isolate_storage_config();
    let config = StorageConfig::new_local(std::env::temp_dir().to_string_lossy().to_string());
    let manager = StorageManager::new(config).await.unwrap();
    manager
        .add_provider(
            "google_drive".to_string(),
            ProviderConfig::GoogleDrive {
                config: test_google_drive_config(),
            },
        )
        .await
        .unwrap();
    manager
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::storage::ProviderConfig;

    /// Full `add_provider(<unique name>, …)` + `save`/`load` round-trip through
    /// the mock keychain store: secrets must be persisted in the keychain,
    /// stripped from the JSON file, and merged back on load.
    ///
    /// This test deliberately uses its **own** provider name (instead of the
    /// well-known `"google_drive"` shared with the refresh tests) so the
    /// keychain keys it reads (`monark_secret::<own name>::*`) cannot be
    /// overwritten mid-test by a concurrently running refresh test that
    /// persists a fresh access token under `monark_secret::google_drive::*`.
    /// The unique name also pins the per-provider key scheme: the keys are
    /// derived from the provider name, so the assertions below are only
    /// satisfiable if `StorageConfig::save` scopes every secret by provider.
    ///
    /// It also gives the test a **private** config file (via
    /// [`with_isolated_storage_config_for`]): the process-wide shared path is
    /// written by every other test's `save()`, which would replace the whole
    /// file — dropping this test's provider — between its own `save` and `load`.
    #[tokio::test]
    async fn google_drive_secrets_round_trip_via_mock_keychain_and_config_file() {
        const PROVIDER: &str = "google_drive_roundtrip_test";
        const KEY_PREFIX: &str = "monark_secret::google_drive_roundtrip_test";

        crate::storage::keychain::install_test_store();
        with_isolated_storage_config_for(PROVIDER, async {
            let path = StorageConfig::config_file_path_for_test();

            let config =
                StorageConfig::new_local(std::env::temp_dir().to_string_lossy().to_string());
            let manager = StorageManager::new(config).await.unwrap();
            manager
                .add_provider(
                    PROVIDER.to_string(),
                    ProviderConfig::GoogleDrive {
                        config: test_google_drive_config(),
                    },
                )
                .await
                .unwrap();

            // `add_provider` persisted immediately: the secrets live in the mock
            // keychain under the provider-scoped keys…
            assert_eq!(
                crate::storage::keychain::get_secret(&format!("{KEY_PREFIX}::client_secret"))
                    .unwrap()
                    .as_deref(),
                Some("client_secret")
            );
            assert_eq!(
                crate::storage::keychain::get_secret(&format!("{KEY_PREFIX}::access_token"))
                    .unwrap()
                    .as_deref(),
                Some("expired_access")
            );

            // …and are stripped from the JSON file on disk. The fixture values
            // (`"client_secret"`, `"refresh_token"`) are identical to their key
            // names, so a bare substring check can never distinguish them; assert
            // on the *stripped shape* instead: the `client_secret` value must be
            // empty and the tokens must be `null`, never the fixture values.
            let raw = std::fs::read_to_string(&path).expect("config file must exist after save");
            assert!(
                raw.contains("\"client_secret\": \"\""),
                "client_secret must be stripped to an empty string on disk, got: {raw}"
            );
            assert!(
                raw.contains("\"access_token\": null") && raw.contains("\"refresh_token\": null"),
                "access_token/refresh_token must be stripped to null on disk, got: {raw}"
            );
            // No secret *value* may leak: the unambiguous values (`expired_access`,
            // and the refresh token as a JSON value `"refresh_token": "refresh_token"`)
            // must never appear.
            assert!(
                !raw.contains("expired_access")
                    && !raw.contains("\"refresh_token\": \"refresh_token\""),
                "secret values must not be written to the config file, got: {raw}"
            );

            // A fresh load merges the keychain secrets back into the config.
            let loaded = StorageConfig::load().unwrap();
            let ProviderConfig::GoogleDrive { config } = loaded
                .get_provider_config(PROVIDER)
                .expect("the round-trip provider must be persisted")
                .clone()
            else {
                panic!("expected a Google Drive provider config");
            };
            assert_eq!(config.client_secret, "client_secret");
            assert_eq!(config.access_token.as_deref(), Some("expired_access"));
            assert_eq!(config.refresh_token.as_deref(), Some("refresh_token"));
        })
        .await;
    }
}
