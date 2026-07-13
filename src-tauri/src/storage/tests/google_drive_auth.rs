#[cfg(test)]
mod google_drive_auth_tests {
    use crate::storage::providers::google_drive::GoogleDriveConfig;
    use crate::storage::{ProviderConfig, StorageConfig, StorageError, StorageManager};
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
}
