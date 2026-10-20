#[cfg(test)]
mod google_drive_auth_tests {
    use crate::storage::providers::google_drive::GoogleDriveConfig;
    use crate::storage::providers::GoogleDriveProvider;
    use crate::storage::{
        ProviderConfig, StorageConfig, StorageError, StorageManager, StorageProvider,
    };
    use chrono::{Duration, Utc};
    use mockito::Server;
    use std::sync::OnceLock;
    use std::time::Instant;
    use tempfile::TempDir;

    static OAUTH_ENV_LOCK: OnceLock<std::sync::Mutex<()>> = OnceLock::new();

    fn lock_oauth_env() -> std::sync::MutexGuard<'static, ()> {
        match OAUTH_ENV_LOCK
            .get_or_init(|| std::sync::Mutex::new(()))
            .lock()
        {
            Ok(guard) => guard,
            Err(poisoned) => poisoned.into_inner(),
        }
    }

    struct EnvVarGuard {
        key: &'static str,
        prev: Option<String>,
    }

    impl EnvVarGuard {
        fn set(key: &'static str, value: String) -> Self {
            let prev = std::env::var(key).ok();
            std::env::set_var(key, value);
            Self { key, prev }
        }
    }

    impl Drop for EnvVarGuard {
        fn drop(&mut self) {
            if let Some(prev) = &self.prev {
                std::env::set_var(self.key, prev);
            } else {
                std::env::remove_var(self.key);
            }
        }
    }

    fn expired_google_drive_config() -> GoogleDriveConfig {
        GoogleDriveConfig {
            client_id: "client_id".to_string(),
            client_secret: "client_secret".to_string(),
            redirect_uri: "http://localhost/callback".to_string(),
            access_token: Some("expired_access".to_string()),
            refresh_token: Some("refresh_token".to_string()),
            token_expires_at: Some(Utc::now() - Duration::minutes(10)),
        }
    }

    /// Hermetic setup for every test that builds a `StorageManager`: swap the
    /// real OS keychain for keyring-core's in-memory mock and point
    /// `StorageConfig::save`/`load` at a throwaway file, so tests never
    /// read/write the developer's keychain or config. Must run *before* any
    /// `add_provider`/`save`. See `crate::storage::test_support`.
    fn isolate_storage() {
        crate::storage::keychain::install_test_store();
        crate::storage::test_support::isolate_storage_config();
    }

    #[tokio::test]
    async fn google_drive_expired_token_triggers_automatic_refresh() {
        // Serialize because the provider uses a global env var for the token URL.
        let _guard = lock_oauth_env();

        let mut server = Server::new_async().await;
        let _env = EnvVarGuard::set(
            "MONARK_GOOGLE_OAUTH_TOKEN_URL",
            format!("{}/token", server.url()),
        );

        let _m = server
            .mock("POST", "/token")
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(
                serde_json::json!({
                    "access_token": "new_access",
                    "refresh_token": "refresh_token",
                    "expires_in": 3600,
                    "token_type": "Bearer"
                })
                .to_string(),
            )
            .expect(1)
            .create_async()
            .await;

        let temp_dir = TempDir::new().unwrap();
        let _xdg = EnvVarGuard::set(
            "XDG_CONFIG_HOME",
            temp_dir.path().to_string_lossy().to_string(),
        );
        isolate_storage();
        let config = StorageConfig::new_local(temp_dir.path().to_string_lossy().to_string());
        let manager = StorageManager::new(config).await.unwrap();

        manager
            .add_provider(
                "google_drive".to_string(),
                ProviderConfig::GoogleDrive {
                    config: expired_google_drive_config(),
                },
            )
            .await
            .unwrap();

        // Calls refresh flow and persists config.
        let updated_config = manager
            .ensure_google_drive_token_valid("google_drive")
            .await
            .unwrap();

        assert_eq!(updated_config.access_token.as_deref(), Some("new_access"));
        assert!(!updated_config.is_token_expired());

        // Sanity check persistence into StorageConfig.
        let cfg_after = manager.get_config().await;
        let ProviderConfig::GoogleDrive { config: persisted } = cfg_after
            .get_provider_config("google_drive")
            .expect("google_drive provider config should exist")
            .clone()
        else {
            panic!("Expected google_drive ProviderConfig");
        };
        assert_eq!(persisted.access_token.as_deref(), Some("new_access"));
    }

    #[tokio::test]
    async fn google_drive_refresh_retry_logic_fails_twice_then_succeeds_with_backoff() {
        // Serialize because the provider uses a global env var for the token URL.
        let _guard = lock_oauth_env();

        let mut server = Server::new_async().await;
        let _env = EnvVarGuard::set(
            "MONARK_GOOGLE_OAUTH_TOKEN_URL",
            format!("{}/token", server.url()),
        );

        // Create mocks in the same order as the expected sequence (fail, fail, succeed).
        let m_fail_1 = server
            .mock("POST", "/token")
            .with_status(500)
            .with_body("nope1")
            .expect(1)
            .create_async()
            .await;

        let m_fail_2 = server
            .mock("POST", "/token")
            .with_status(500)
            .with_body("nope2")
            .expect(1)
            .create_async()
            .await;

        let m_success = server
            .mock("POST", "/token")
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(
                serde_json::json!({
                    "access_token": "new_access_3",
                    "refresh_token": "refresh_token",
                    "expires_in": 3600,
                    "token_type": "Bearer"
                })
                .to_string(),
            )
            .expect(1)
            .create_async()
            .await;

        let temp_dir = TempDir::new().unwrap();
        let _xdg = EnvVarGuard::set(
            "XDG_CONFIG_HOME",
            temp_dir.path().to_string_lossy().to_string(),
        );
        isolate_storage();
        let config = StorageConfig::new_local(temp_dir.path().to_string_lossy().to_string());
        let manager = StorageManager::new(config).await.unwrap();

        manager
            .add_provider(
                "google_drive".to_string(),
                ProviderConfig::GoogleDrive {
                    config: expired_google_drive_config(),
                },
            )
            .await
            .unwrap();

        let start = Instant::now();
        let updated_config = manager
            .ensure_google_drive_token_valid("google_drive")
            .await
            .unwrap();
        let elapsed = start.elapsed();

        assert_eq!(updated_config.access_token.as_deref(), Some("new_access_3"));

        // Backoff is 1000ms then 2000ms => ~3000ms. Give slack for scheduling.
        assert!(
            elapsed.as_millis() >= 2500,
            "expected >= 2.5s elapsed due to exponential backoff, got {:?}",
            elapsed
        );
        assert!(
            elapsed.as_secs() < 10,
            "unexpectedly slow token refresh retry loop: {:?}",
            elapsed
        );

        m_fail_1.assert_async().await;
        m_fail_2.assert_async().await;
        m_success.assert_async().await;
    }

    #[tokio::test]
    async fn google_drive_refresh_failure_returns_authentication_error_after_retries() {
        // Serialize because the provider uses a global env var for the token URL.
        let _guard = lock_oauth_env();

        let mut server = Server::new_async().await;
        let _env = EnvVarGuard::set(
            "MONARK_GOOGLE_OAUTH_TOKEN_URL",
            format!("{}/token", server.url()),
        );

        // invalid_grant is non-retryable: expect exactly 1 request (no retries).
        let _m = server
            .mock("POST", "/token")
            .with_status(400)
            .with_body("invalid_grant")
            .expect(1)
            .create_async()
            .await;

        let temp_dir = TempDir::new().unwrap();
        let _xdg = EnvVarGuard::set(
            "XDG_CONFIG_HOME",
            temp_dir.path().to_string_lossy().to_string(),
        );
        isolate_storage();
        let config = StorageConfig::new_local(temp_dir.path().to_string_lossy().to_string());
        let manager = StorageManager::new(config).await.unwrap();

        manager
            .add_provider(
                "google_drive".to_string(),
                ProviderConfig::GoogleDrive {
                    config: expired_google_drive_config(),
                },
            )
            .await
            .unwrap();

        let err = manager
            .ensure_google_drive_token_valid("google_drive")
            .await
            .expect_err("refresh should fail");

        match err {
            StorageError::Authentication(_) => {}
            other => panic!("expected StorageError::Authentication, got: {other:?}"),
        }

        _m.assert_async().await;
    }

    /// Verify that when Google's token response omits the `refresh_token` field
    /// (which happens on subsequent token refreshes), the original refresh token
    /// from the existing config is preserved rather than wiped.
    #[tokio::test]
    async fn google_drive_refresh_preserves_existing_token_when_response_omits_it() {
        // Serialize because the provider uses a global env var for the token URL.
        let _guard = lock_oauth_env();

        let mut server = Server::new_async().await;
        let _env = EnvVarGuard::set(
            "MONARK_GOOGLE_OAUTH_TOKEN_URL",
            format!("{}/token", server.url()),
        );

        // Return a valid token response that does NOT include a refresh_token.
        // This mirrors real Google behavior: after the first authorization,
        // subsequent refresh responses omit the refresh token.
        let _m = server
            .mock("POST", "/token")
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(
                serde_json::json!({
                    "access_token": "new_access_no_rt",
                    "expires_in": 3600,
                    "token_type": "Bearer"
                })
                .to_string(),
            )
            .expect(1)
            .create_async()
            .await;

        let temp_dir = TempDir::new().unwrap();
        let _xdg = EnvVarGuard::set(
            "XDG_CONFIG_HOME",
            temp_dir.path().to_string_lossy().to_string(),
        );
        isolate_storage();
        let config = StorageConfig::new_local(temp_dir.path().to_string_lossy().to_string());
        let manager = StorageManager::new(config).await.unwrap();

        let original_refresh_token = "original_refresh_token_value";
        manager
            .add_provider(
                "google_drive".to_string(),
                ProviderConfig::GoogleDrive {
                    config: GoogleDriveConfig {
                        refresh_token: Some(original_refresh_token.to_string()),
                        ..expired_google_drive_config()
                    },
                },
            )
            .await
            .unwrap();

        let updated_config = manager
            .ensure_google_drive_token_valid("google_drive")
            .await
            .unwrap();

        // The access token should be updated.
        assert_eq!(
            updated_config.access_token.as_deref(),
            Some("new_access_no_rt")
        );
        // Crucially, the original refresh token must be preserved.
        assert_eq!(
            updated_config.refresh_token.as_deref(),
            Some(original_refresh_token),
            "refresh token should be preserved when Google response omits it"
        );

        // Verify persistence: the config saved to disk should also retain the refresh token.
        let cfg_after = manager.get_config().await;
        let ProviderConfig::GoogleDrive { config: persisted } = cfg_after
            .get_provider_config("google_drive")
            .expect("google_drive provider config should exist")
            .clone()
        else {
            panic!("Expected google_drive ProviderConfig");
        };
        assert_eq!(
            persisted.refresh_token.as_deref(),
            Some(original_refresh_token),
            "persisted config should retain the original refresh token"
        );
    }

    #[tokio::test]
    async fn google_drive_invalid_grant_returns_authentication_error_without_retries() {
        // Serialize because the provider uses a global env var for the token URL.
        let _guard = lock_oauth_env();

        let mut server = Server::new_async().await;
        let _env = EnvVarGuard::set(
            "MONARK_GOOGLE_OAUTH_TOKEN_URL",
            format!("{}/token", server.url()),
        );

        // invalid_grant should be recognized as non-retryable: exactly 1 request.
        let m = server
            .mock("POST", "/token")
            .with_status(400)
            .with_header("content-type", "application/json")
            .with_body(r#"{"error":"invalid_grant"}"#)
            .expect(1)
            .create_async()
            .await;

        let temp_dir = TempDir::new().unwrap();
        let _xdg = EnvVarGuard::set(
            "XDG_CONFIG_HOME",
            temp_dir.path().to_string_lossy().to_string(),
        );
        isolate_storage();
        let config = StorageConfig::new_local(temp_dir.path().to_string_lossy().to_string());
        let manager = StorageManager::new(config).await.unwrap();

        manager
            .add_provider(
                "google_drive".to_string(),
                ProviderConfig::GoogleDrive {
                    config: expired_google_drive_config(),
                },
            )
            .await
            .unwrap();

        let err = manager
            .ensure_google_drive_token_valid("google_drive")
            .await
            .expect_err("refresh should fail with authentication error");

        match err {
            StorageError::Authentication(_) => {}
            other => panic!("expected StorageError::Authentication, got: {other:?}"),
        }

        m.assert_async().await;
    }

    // ---------------------------------------------------------------------------
    // Auth-status semantics: `GoogleDriveConfig::has_usable_credentials`
    //
    // Regression tests for "Monark asks to re-authenticate Google Drive roughly
    // every hour on Linux". The ~1h access-token TTL made the status checkers
    // return `authenticated = false` even though a valid refresh token (which
    // allows a silent refresh) was present, so the UI demanded a full login.
    // ---------------------------------------------------------------------------

    /// Google Drive config with a fresh, non-expired access token.
    fn valid_google_drive_config() -> GoogleDriveConfig {
        GoogleDriveConfig {
            access_token: Some("fresh_access".to_string()),
            token_expires_at: Some(Utc::now() + Duration::hours(1)),
            ..expired_google_drive_config()
        }
    }

    /// Google Drive config with no credentials at all.
    fn empty_google_drive_config() -> GoogleDriveConfig {
        GoogleDriveConfig {
            access_token: None,
            refresh_token: None,
            token_expires_at: None,
            ..expired_google_drive_config()
        }
    }

    #[test]
    fn has_usable_credentials_with_valid_access_token_and_refresh_token() {
        let config = valid_google_drive_config();

        assert!(!config.is_token_expired());
        assert!(config.has_usable_credentials());
    }

    #[test]
    fn has_usable_credentials_with_expired_access_token_and_refresh_token() {
        let config = expired_google_drive_config();

        assert!(
            config.is_token_expired(),
            "precondition: the access token is past its TTL"
        );
        assert!(
            config.has_usable_credentials(),
            "an expired access token + refresh token can be renewed silently"
        );
    }

    #[test]
    fn has_usable_credentials_false_with_expired_access_token_and_no_refresh_token() {
        let config = GoogleDriveConfig {
            refresh_token: None,
            ..expired_google_drive_config()
        };

        assert!(config.is_token_expired());
        assert!(!config.has_usable_credentials());
    }

    #[test]
    fn has_usable_credentials_false_without_any_credentials() {
        let config = empty_google_drive_config();

        assert!(config.is_token_expired());
        assert!(!config.has_usable_credentials());
    }

    /// Only the long-lived refresh token survived: still authenticated, the
    /// refresh will mint a new access token.
    #[test]
    fn has_usable_credentials_with_only_refresh_token() {
        let config = GoogleDriveConfig {
            access_token: None,
            token_expires_at: None,
            ..expired_google_drive_config()
        };

        assert!(config.has_usable_credentials());
    }

    /// A token inside the 5-minute safety buffer counts as expired (so the
    /// refresh path still triggers) but not as "logged out".
    #[test]
    fn has_usable_credentials_with_token_inside_expiry_buffer() {
        let config = GoogleDriveConfig {
            access_token: Some("almost_expired".to_string()),
            token_expires_at: Some(Utc::now() + Duration::minutes(1)),
            ..expired_google_drive_config()
        };

        assert!(config.is_token_expired());
        assert!(config.has_usable_credentials());
    }

    /// A persisted-but-empty refresh token is not a credential: reporting
    /// "authenticated" from it made the UI skip the login while every refresh
    /// attempt failed with an authentication error.
    #[test]
    fn has_usable_credentials_false_with_blank_refresh_token_only() {
        let config = GoogleDriveConfig {
            access_token: None,
            token_expires_at: None,
            refresh_token: Some(String::new()),
            ..expired_google_drive_config()
        };

        assert!(config.is_token_expired());
        assert!(
            !config.has_usable_credentials(),
            "an empty refresh token cannot renew anything"
        );
    }

    /// Same with an expired access token alongside the blank refresh token.
    #[test]
    fn has_usable_credentials_false_with_expired_access_token_and_blank_refresh_token() {
        let config = GoogleDriveConfig {
            refresh_token: Some(String::new()),
            ..expired_google_drive_config()
        };

        assert!(config.is_token_expired());
        assert!(!config.has_usable_credentials());
    }

    /// `is_token_expired` only checks that the access token is *present* plus its
    /// expiry, so a blank access token with a future expiry would otherwise be
    /// accepted as a valid credential.
    #[test]
    fn has_usable_credentials_false_with_blank_access_token_and_no_refresh_token() {
        let config = GoogleDriveConfig {
            access_token: Some(String::new()),
            token_expires_at: Some(Utc::now() + Duration::hours(1)),
            refresh_token: None,
            ..expired_google_drive_config()
        };

        assert!(
            !config.is_token_expired(),
            "precondition: expiry alone does not catch an empty access token"
        );
        assert!(
            !config.has_usable_credentials(),
            "an empty access token is not a usable credential"
        );
    }

    /// A blank access token must not mask a valid refresh token: the refresh path
    /// is still available.
    #[test]
    fn has_usable_credentials_with_blank_access_token_and_valid_refresh_token() {
        let config = GoogleDriveConfig {
            access_token: Some(String::new()),
            token_expires_at: Some(Utc::now() + Duration::hours(1)),
            ..expired_google_drive_config()
        };

        assert!(config.has_usable_credentials());
    }

    /// `ensure_google_drive_token_valid` / `GoogleDriveProvider::ensure_valid_token`
    /// decide whether to refresh with `is_token_expired`; that rule must stay
    /// untouched by the auth-status change.
    ///
    /// The provider must *delegate* expiry to its config: flipping the config in
    /// place has to flip the provider's answer. (Comparing
    /// `provider.is_token_expired()` with a freshly built, identically configured
    /// `config.is_token_expired()` was tautological — with `is_token_expired`
    /// delegating to the config, that assertion could never fail.)
    #[test]
    fn is_token_expired_semantics_unchanged() {
        assert!(!valid_google_drive_config().is_token_expired());
        assert!(expired_google_drive_config().is_token_expired());
        assert!(empty_google_drive_config().is_token_expired());

        let mut provider = GoogleDriveProvider::new(expired_google_drive_config());
        assert!(
            provider.is_token_expired(),
            "an expired config must make the provider report an expired token"
        );

        // Mutating the config must be observable through the provider ⇒ it
        // delegates to the config instead of caching its own expiry rule.
        provider.update_config(valid_google_drive_config());
        assert!(
            !provider.is_token_expired(),
            "provider must delegate token expiry to its config"
        );
    }

    #[tokio::test]
    async fn provider_is_authenticated_with_expired_access_token_and_refresh_token() {
        let provider = GoogleDriveProvider::new(expired_google_drive_config());

        assert!(provider.is_token_expired());
        assert!(
            provider.is_authenticated().await,
            "provider must report authenticated when a silent refresh is possible"
        );
    }

    #[tokio::test]
    async fn provider_is_not_authenticated_without_credentials() {
        let provider = GoogleDriveProvider::new(empty_google_drive_config());

        assert!(!provider.is_authenticated().await);
    }

    #[tokio::test]
    async fn provider_is_not_authenticated_with_blank_credentials() {
        let provider = GoogleDriveProvider::new(GoogleDriveConfig {
            access_token: Some(String::new()),
            refresh_token: Some(String::new()),
            token_expires_at: Some(Utc::now() + Duration::hours(1)),
            ..expired_google_drive_config()
        });

        assert!(
            !provider.is_authenticated().await,
            "blank tokens are not usable credentials"
        );
    }

    // --------------------------- manager level ---------------------------
    // `StorageManager::get_provider_auth_info` backs the `get_provider_auth_info`
    // command; `check_provider_auth_status` applies the same helper (covered by
    // the unit tests in `commands/storage.rs`).

    #[tokio::test]
    async fn provider_auth_info_true_with_expired_access_token_and_refresh_token() {
        let temp_dir = TempDir::new().unwrap();
        isolate_storage();
        let config = StorageConfig::new_local(temp_dir.path().to_string_lossy().to_string())
            .with_google_drive(expired_google_drive_config());
        let manager = StorageManager::new(config).await.unwrap();

        let (authenticated, expires_at) = manager
            .get_provider_auth_info("google_drive")
            .await
            .unwrap();

        assert!(
            authenticated,
            "expired access token + refresh token must be reported as authenticated"
        );
        assert!(expires_at.is_some());
    }

    #[tokio::test]
    async fn provider_auth_info_false_without_credentials() {
        let temp_dir = TempDir::new().unwrap();
        isolate_storage();
        let config = StorageConfig::new_local(temp_dir.path().to_string_lossy().to_string())
            .with_google_drive(empty_google_drive_config());
        let manager = StorageManager::new(config).await.unwrap();

        let (authenticated, expires_at) = manager
            .get_provider_auth_info("google_drive")
            .await
            .unwrap();

        assert!(!authenticated);
        assert!(expires_at.is_none());
    }

    // ---------------------------------------------------------------------------
    // `refresh_provider_auth` command contract
    //
    // The command pipes `ensure_google_drive_token_valid` failures through
    // `commands::storage::classify_refresh_failure`. These tests exercise the real
    // refresh flow (mock token endpoint) and assert the *message* the frontend
    // receives, so a change in the provider wording cannot silently break the
    // classification.
    // ---------------------------------------------------------------------------

    /// Inner message the frontend keyword-matches on (the `Io` payload).
    fn observable_refresh_message(error: crate::commands::errors::CommandError) -> String {
        match error {
            crate::commands::errors::CommandError::Io(message) => message,
            other => other.to_string(),
        }
    }

    /// A revoked refresh token (`invalid_grant`) is terminal and must be
    /// classified as an *authentication* failure — never as a network problem,
    /// which the UI would retry forever.
    ///
    /// The env-var lock is deliberately held across this test's await points: it
    /// serializes the process-global `MONARK_GOOGLE_OAUTH_TOKEN_URL` override with
    /// the other refresh tests (same pattern as the tests above).
    #[allow(clippy::await_holding_lock)]
    #[tokio::test]
    async fn refresh_invalid_grant_is_classified_as_authentication_failure() {
        let _guard = lock_oauth_env();

        let mut server = Server::new_async().await;
        let _env = EnvVarGuard::set(
            "MONARK_GOOGLE_OAUTH_TOKEN_URL",
            format!("{}/token", server.url()),
        );

        let _m = server
            .mock("POST", "/token")
            .with_status(400)
            .with_header("content-type", "application/json")
            .with_body(r#"{"error":"invalid_grant","error_description":"Token has been expired or revoked."}"#)
            .expect(1)
            .create_async()
            .await;

        let temp_dir = TempDir::new().unwrap();
        let _xdg = EnvVarGuard::set(
            "XDG_CONFIG_HOME",
            temp_dir.path().to_string_lossy().to_string(),
        );
        isolate_storage();
        let config = StorageConfig::new_local(temp_dir.path().to_string_lossy().to_string());
        let manager = StorageManager::new(config).await.unwrap();
        manager
            .add_provider(
                "google_drive".to_string(),
                ProviderConfig::GoogleDrive {
                    config: expired_google_drive_config(),
                },
            )
            .await
            .unwrap();

        let err = manager
            .ensure_google_drive_token_valid("google_drive")
            .await
            .expect_err("refresh should be rejected");

        let message =
            observable_refresh_message(crate::commands::storage::classify_refresh_failure(err));

        assert!(
            message.contains("authentication"),
            "AUTH_REJECTION must map to AUTHENTICATION_FAILED, got: {message}"
        );
        assert!(
            !message.contains("network") && !message.contains("connection"),
            "a credential rejection must not look retryable, got: {message}"
        );

        _m.assert_async().await;
    }

    // ---------------------------------------------------------------------------
    // Producer round-trip tests (review finding M1).
    //
    // The tests above hand-write the error messages and pipe them through
    // `classify_refresh_failure`. These tests instead exercise the REAL producer:
    // `ensure_google_drive_token_valid` (→ `refresh_access_token_for_config`,
    // google_drive.rs) formats `"Failed to refresh access token (<status>
    // <reason>): <body>"`, which the command layer parses back with
    // `parse_refresh_error_status` / `strip_refresh_error_body` (see
    // `keep-in-sync` comments at both `format!` sites in google_drive.rs). A
    // producer rewording must make these tests red, not silently shift every 5xx
    // refresh failure from Transient to AuthRejection.
    // ---------------------------------------------------------------------------

    /// Run the real refresh flow against a failing mock and return the frontend
    /// message produced by `classify_refresh_failure`. Requires the caller to
    /// hold `lock_oauth_env()` and to have set `MONARK_GOOGLE_OAUTH_TOKEN_URL`.
    async fn classify_real_producer_refresh_failure(
        server: &mut Server,
        status: u16,
        body: &str,
        expected_requests: usize,
    ) -> String {
        let mock = server
            .mock("POST", "/token")
            .with_status(status as usize)
            .with_body(body)
            .expect(expected_requests)
            .create_async()
            .await;

        let temp_dir = TempDir::new().unwrap();
        let _xdg = EnvVarGuard::set(
            "XDG_CONFIG_HOME",
            temp_dir.path().to_string_lossy().to_string(),
        );
        isolate_storage();
        let config = StorageConfig::new_local(temp_dir.path().to_string_lossy().to_string());
        let manager = StorageManager::new(config).await.unwrap();
        manager
            .add_provider(
                "google_drive".to_string(),
                ProviderConfig::GoogleDrive {
                    config: expired_google_drive_config(),
                },
            )
            .await
            .unwrap();

        let err = manager
            .ensure_google_drive_token_valid("google_drive")
            .await
            .expect_err("refresh should fail");

        mock.assert_async().await;
        observable_refresh_message(crate::commands::storage::classify_refresh_failure(err))
    }

    /// A real 5xx from the provider (retries exhausted) must stay TRANSIENT →
    /// frontend `NetworkError`, and the observable message must be exactly the
    /// `(<status> <reason>)` prefix — the adversarial body must never reach the
    /// frontend (it could otherwise re-bucket the message).
    #[allow(clippy::await_holding_lock)]
    #[tokio::test]
    async fn producer_5xx_refresh_failure_is_transient_and_strips_body() {
        let _guard = lock_oauth_env();
        let mut server = Server::new_async().await;
        let _env = EnvVarGuard::set(
            "MONARK_GOOGLE_OAUTH_TOKEN_URL",
            format!("{}/token", server.url()),
        );

        // Adversarial body: it contains routing keywords (`authentication`,
        // `connection`) that must not survive into the classified message.
        let body = "<html>authentication proxy failed: connection reset</html>";
        // A 5xx is retried, so the provider hits the mock MAX_REFRESH_RETRIES=3
        // times (1s + 2s backoff); mirror `expect(3)`.
        let message = classify_real_producer_refresh_failure(&mut server, 503, body, 3).await;

        assert!(
            message.contains("network"),
            "TRANSIENT must map to NETWORK_ERROR, got: {message}"
        );
        assert!(
            !message.contains("authentication") && !message.contains("connection"),
            "the upstream body must be stripped before classification, got: {message}"
        );
        assert!(
            message.contains("Failed to refresh access token (503 Service Unavailable)"),
            "the producer's \"(<status> <reason>)\" prefix must survive verbatim, got: {message}"
        );
    }

    /// A real 500 from the provider (retries exhausted) must also stay TRANSIENT.
    /// Together with the 503 case this pins the whole `is_transient_status`
    /// window (408 | 429 | 500..600) against the real producer string.
    #[allow(clippy::await_holding_lock)]
    #[tokio::test]
    async fn producer_500_refresh_failure_is_transient() {
        let _guard = lock_oauth_env();
        let mut server = Server::new_async().await;
        let _env = EnvVarGuard::set(
            "MONARK_GOOGLE_OAUTH_TOKEN_URL",
            format!("{}/token", server.url()),
        );

        let body = "internal error: please retry later";
        let message = classify_real_producer_refresh_failure(&mut server, 500, body, 3).await;

        assert!(
            message.contains("network"),
            "a real 500 must stay TRANSIENT → NETWORK_ERROR, got: {message}"
        );
        assert!(
            !message.contains("authentication"),
            "the upstream body must be stripped, got: {message}"
        );
        assert!(
            message.contains("Failed to refresh access token (500 Internal Server Error)"),
            "the producer's \"(<status> <reason>)\" prefix must survive verbatim, got: {message}"
        );
    }

    /// A non-transient, non-`invalid_grant` failure (e.g. 400) must stay
    /// AUTH_REJECTION → frontend `AuthenticationFailed`, not be mis-bucketed as
    /// a transient error that would be retried forever.
    #[allow(clippy::await_holding_lock)]
    #[tokio::test]
    async fn producer_400_refresh_failure_is_auth_rejection() {
        let _guard = lock_oauth_env();
        let mut server = Server::new_async().await;
        let _env = EnvVarGuard::set(
            "MONARK_GOOGLE_OAUTH_TOKEN_URL",
            format!("{}/token", server.url()),
        );

        let body = "invalid_client: client not found";
        let message = classify_real_producer_refresh_failure(&mut server, 400, body, 3).await;

        assert!(
            message.contains("authentication"),
            "AUTH_REJECTION must map to AUTHENTICATION_FAILED, got: {message}"
        );
        assert!(
            !message.contains("network") && !message.contains("connection"),
            "a rejection must not look retryable, got: {message}"
        );
    }

    /// Bonus: the dedicated `invalid_grant` wording branch still produces its
    /// fixed message (no `(<status> <reason>)` round-trip needed) and classifies
    /// as `AuthRejection` — rewording either the branch or the template would be
    /// caught here.
    #[allow(clippy::await_holding_lock)]
    #[tokio::test]
    async fn producer_invalid_grant_branch_keeps_fixed_message_and_rejection() {
        let _guard = lock_oauth_env();
        let mut server = Server::new_async().await;
        let _env = EnvVarGuard::set(
            "MONARK_GOOGLE_OAUTH_TOKEN_URL",
            format!("{}/token", server.url()),
        );

        let body =
            r#"{"error":"invalid_grant","error_description":"Token has been expired or revoked."}"#;
        // `invalid_grant` is non-retryable: exactly one request.
        let message = classify_real_producer_refresh_failure(&mut server, 400, body, 1).await;

        assert!(
            message.contains("authentication"),
            "AUTH_REJECTION must map to AUTHENTICATION_FAILED, got: {message}"
        );
        assert!(
            message.contains("re-authenticate"),
            "the invalid_grant branch must keep its re-authenticate wording, got: {message}"
        );
    }
}
