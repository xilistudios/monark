//! Tests for the Google Drive OAuth flow: the authorization-URL contract
//! (`build_google_drive_auth_url`) and the callback command
//! (`handle_google_drive_oauth_callback` / `refresh_provider_auth`).
//!
//! They assert the three things the frontend depends on:
//! * the **message contract** (`commands::errors::AuthFailureClass`),
//! * the **OAuth state lifecycle** (kept on a retryable failure, consumed on a
//!   terminal outcome — including terminal failures whose class looks retryable), and
//! * the **keyword isolation** of the messages: an arbitrary upstream body must not
//!   be able to re-classify a failure.
//!
//! Kept in a separate file so `oauth.rs` stays about the flow itself.

#[cfg(test)]
mod oauth_url_tests {
    use super::super::build_google_drive_auth_url;
    use crate::storage::providers::google_drive::GoogleDriveConfig;

    const OAUTH_STATE: &str = "0f6c1c1e-6f1a-4a2f-9d6d-6a1f9b0c2d33";
    const CODE_CHALLENGE: &str = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM";

    fn gd_config(refresh_token: Option<&str>) -> GoogleDriveConfig {
        GoogleDriveConfig {
            client_id: "357909773267-re2ck9696j6njt2dd70dboh0q072o52m.apps.googleusercontent.com"
                .to_string(),
            client_secret: "GOCSPX-not-a-real-secret".to_string(),
            redirect_uri: "https://monark-password-manager.web.app/cb?x=1".to_string(),
            access_token: None,
            refresh_token: refresh_token.map(str::to_string),
            token_expires_at: None,
        }
    }

    fn url(refresh_token: Option<&str>) -> String {
        build_google_drive_auth_url(&gd_config(refresh_token), OAUTH_STATE, CODE_CHALLENGE)
    }

    #[test]
    fn prompt_consent_is_requested_when_no_refresh_token_is_stored() {
        assert!(url(None).contains("&prompt=consent"));
    }

    /// Hazard pinned: with a (possibly dead) refresh token already stored, the
    /// request MUST still ask for consent, otherwise Google returns no new
    /// `refresh_token` and the callback re-persists the dead one.
    #[test]
    fn prompt_consent_is_requested_even_when_a_refresh_token_is_stored() {
        assert!(url(Some("1//stale-refresh-token")).contains("&prompt=consent"));
    }

    /// Guards against appending the parameter twice (once in the literal, once by
    /// a future caller), which Google answers with `invalid_request`.
    #[test]
    fn prompt_appears_exactly_once() {
        for refresh_token in [None, Some("1//stale-refresh-token")] {
            assert_eq!(url(refresh_token).matches("prompt=").count(), 1);
        }
    }

    #[test]
    fn access_type_offline_and_pkce_parameters_are_present() {
        let auth_url = url(None);
        assert!(auth_url.contains("&access_type=offline"));
        assert!(auth_url.contains("&response_type=code"));
        assert!(auth_url.contains("&code_challenge_method=S256"));
    }

    #[test]
    fn client_id_and_redirect_uri_are_percent_encoded() {
        let auth_url = url(None);
        assert!(auth_url
            .contains("redirect_uri=https%3A%2F%2Fmonark-password-manager.web.app%2Fcb%3Fx%3D1"));
        // The raw redirect URI must never leak into the query string.
        assert!(!auth_url.contains("web.app/cb"));
        assert!(auth_url.contains(
            "client_id=357909773267-re2ck9696j6njt2dd70dboh0q072o52m.apps.googleusercontent.com"
        ));
    }

    #[test]
    fn state_and_code_challenge_are_embedded_verbatim() {
        let auth_url = url(None);
        assert!(auth_url.contains(&format!("&state={OAUTH_STATE}")));
        assert!(auth_url.contains(&format!("&code_challenge={CODE_CHALLENGE}")));
    }
}

#[cfg(test)]
mod oauth_callback_tests {
    use super::super::super::auth_status::classify_refresh_failure;
    use super::super::super::error::MAX_ERROR_BODY_CAUSE_CHARS;
    use super::super::{
        apply_failed_oauth_state_lifecycle, complete_google_drive_oauth, oauth_state_store,
        peek_oauth_state, token_persistence_failure, ClassifiedAuthError, OAuthCallbackRequest,
        OAuthPendingState, OAUTH_STATE_EXPIRY,
    };
    use crate::commands::errors::contract_fixture::{bucket_of, FrontendBucket};
    use crate::commands::errors::{AuthFailureClass, CommandError, MAX_ERROR_CAUSE_LEN};
    use crate::storage::test_support;
    use crate::storage::{ProviderConfig, StorageError, StorageManager};
    use mockito::Server;
    use std::sync::OnceLock;
    use std::time::Instant;

    /// Serialize these tests: they share the process-global OAuth state store, the
    /// on-disk config path and the OS keychain. An async mutex is used so holding
    /// the guard across the tests' await points is intentional and lint-clean.
    static TEST_LOCK: OnceLock<tokio::sync::Mutex<()>> = OnceLock::new();

    async fn test_lock() -> tokio::sync::MutexGuard<'static, ()> {
        TEST_LOCK
            .get_or_init(|| tokio::sync::Mutex::new(()))
            .lock()
            .await
    }

    async fn manager_with_google_drive() -> StorageManager {
        test_support::manager_with_google_drive().await
    }

    fn callback_request(state: &str) -> OAuthCallbackRequest {
        OAuthCallbackRequest {
            provider_name: "google_drive".to_string(),
            code: "authorization-code".to_string(),
            state: state.to_string(),
        }
    }

    fn insert_pending_state(state: &str, code_verifier: &str) {
        oauth_state_store().lock().unwrap().insert(
            state.to_string(),
            OAuthPendingState {
                created_at: Instant::now(),
                code_verifier: code_verifier.to_string(),
            },
        );
    }

    fn state_is_pending(state: &str) -> bool {
        oauth_state_store().lock().unwrap().contains_key(state)
    }

    fn drop_pending_state(state: &str) {
        oauth_state_store().lock().unwrap().remove(state);
    }

    /// Inner message the frontend keyword-matches on: the `Io` payload appears
    /// verbatim in the serialized `CommandError` the UI receives.
    fn observable_message(error: CommandError) -> String {
        match error {
            CommandError::Io(message) => message,
            other => other.to_string(),
        }
    }

    /// Assert the message lands in the frontend's conservative terminal bucket and
    /// carries no classification keyword at all.
    fn assert_other_message(message: &str) {
        assert_eq!(
            bucket_of(message),
            FrontendBucket::OperationFailed,
            "an `Other` message must stay in OPERATION_FAILED, got: {message}"
        );
        for keyword in ["authentication", "unauthorized", "network", "connection"] {
            assert!(
                !message.contains(keyword),
                "OTHER must stay keyword-free but contains {keyword:?}: {message}"
            );
        }
        assert!(
            !(message.contains("token") && message.contains("expired")),
            "OTHER must not trip the frontend TOKEN_EXPIRED rule: {message}"
        );
    }

    /// URL on a loopback port nothing listens on ⇒ `reqwest` fails to connect,
    /// which is precisely the "network failure" the classifier must detect.
    fn dead_loopback_url() -> String {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        drop(listener);
        format!("http://127.0.0.1:{port}/token")
    }

    // ------------------------------------------------------------------
    // OAuth state lifecycle
    // ------------------------------------------------------------------

    /// A DNS/connect/timeout failure of the token POST must be transient AND must
    /// not burn the state: the frontend releases its reservation to retry, so the
    /// backend has to keep the state for the retry.
    #[tokio::test]
    async fn network_failure_is_transient_and_keeps_the_state_for_a_retry() {
        let _guard = test_lock().await;
        let manager = manager_with_google_drive().await;

        let state = "transient-network-state";
        insert_pending_state(state, "code-verifier");

        let error =
            complete_google_drive_oauth(&manager, &callback_request(state), &dead_loopback_url())
                .await
                .expect_err("a dead token endpoint must fail");

        let message = observable_message(error);
        assert_eq!(
            bucket_of(&message),
            FrontendBucket::NetworkError,
            "TRANSIENT must map to NETWORK_ERROR, got: {message}"
        );
        assert!(
            state_is_pending(state),
            "a transient failure must keep the state usable for a retry"
        );

        drop_pending_state(state);
    }

    /// HTTP 500 is a transient server-side failure: retryable, state kept.
    #[tokio::test]
    async fn server_error_is_transient_and_keeps_the_state_for_a_retry() {
        let _guard = test_lock().await;
        let mut server = Server::new_async().await;
        let mock = server
            .mock("POST", "/token")
            .with_status(500)
            .with_body("upstream exploded")
            .create_async()
            .await;

        let manager = manager_with_google_drive().await;
        let state = "transient-5xx-state";
        insert_pending_state(state, "code-verifier");

        let error = complete_google_drive_oauth(
            &manager,
            &callback_request(state),
            &format!("{}/token", server.url()),
        )
        .await
        .expect_err("a 5xx token endpoint must fail");

        let message = observable_message(error);
        assert_eq!(
            bucket_of(&message),
            FrontendBucket::NetworkError,
            "a 5xx is TRANSIENT, got: {message}"
        );
        assert!(
            state_is_pending(state),
            "a 5xx must keep the state usable for a retry"
        );

        drop_pending_state(state);
        mock.assert_async().await;
    }

    /// `invalid_grant` (HTTP 400) is terminal: the code was refused, retrying is
    /// pointless, so the single-use state is consumed.
    #[tokio::test]
    async fn invalid_grant_is_authentication_failure_and_consumes_the_state() {
        let _guard = test_lock().await;
        let mut server = Server::new_async().await;
        let mock = server
            .mock("POST", "/token")
            .with_status(400)
            .with_header("content-type", "application/json")
            .with_body(r#"{"error":"invalid_grant"}"#)
            .create_async()
            .await;

        let manager = manager_with_google_drive().await;
        let state = "auth-rejection-400-state";
        insert_pending_state(state, "code-verifier");

        let error = complete_google_drive_oauth(
            &manager,
            &callback_request(state),
            &format!("{}/token", server.url()),
        )
        .await
        .expect_err("invalid_grant must fail");

        let message = observable_message(error);
        assert_eq!(
            bucket_of(&message),
            FrontendBucket::AuthenticationFailed,
            "AUTH_REJECTION must map to AUTHENTICATION_FAILED, got: {message}"
        );
        assert!(
            !message.contains("network") && !message.contains("connection"),
            "a rejection must not look retryable, got: {message}"
        );
        assert!(
            !state_is_pending(state),
            "a rejection must consume the single-use state"
        );

        mock.assert_async().await;
    }

    /// 401/403 are credential rejections as well.
    #[tokio::test]
    async fn unauthorized_and_forbidden_are_authentication_failures() {
        let _guard = test_lock().await;
        let mut server = Server::new_async().await;

        for (path, status) in [("/unauthorized", 401), ("/forbidden", 403)] {
            let mock = server
                .mock("POST", path)
                .with_status(status)
                .create_async()
                .await;

            let manager = manager_with_google_drive().await;
            let state = format!("auth-rejection-{status}-state");
            insert_pending_state(&state, "code-verifier");

            let error = complete_google_drive_oauth(
                &manager,
                &callback_request(&state),
                &format!("{}{path}", server.url()),
            )
            .await
            .expect_err("a credential rejection must fail");

            let message = observable_message(error);
            assert_eq!(
                bucket_of(&message),
                FrontendBucket::AuthenticationFailed,
                "HTTP {status} must be AUTH_REJECTION, got: {message}"
            );
            assert!(
                !state_is_pending(&state),
                "HTTP {status} must consume the single-use state"
            );

            mock.assert_async().await;
        }
    }

    /// A successful exchange persists the tokens and consumes the state.
    #[tokio::test]
    async fn success_consumes_the_state_and_persists_the_tokens() {
        let _guard = test_lock().await;
        let mut server = Server::new_async().await;
        let mock = server
            .mock("POST", "/token")
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(
                serde_json::json!({
                    "access_token": "fresh_access",
                    "refresh_token": "fresh_refresh",
                    "expires_in": 3600,
                    "token_type": "Bearer"
                })
                .to_string(),
            )
            .create_async()
            .await;

        let manager = manager_with_google_drive().await;
        let state = "success-state";
        insert_pending_state(state, "code-verifier");

        complete_google_drive_oauth(
            &manager,
            &callback_request(state),
            &format!("{}/token", server.url()),
        )
        .await
        .expect("a successful exchange must return Ok");

        assert!(
            !state_is_pending(state),
            "success must consume the single-use state"
        );

        let stored = manager.get_config().await;
        let ProviderConfig::GoogleDrive { config } = stored
            .get_provider_config("google_drive")
            .expect("the provider config must still exist")
            .clone()
        else {
            panic!("expected a Google Drive provider config");
        };
        assert_eq!(config.access_token.as_deref(), Some("fresh_access"));
        assert_eq!(config.refresh_token.as_deref(), Some("fresh_refresh"));

        mock.assert_async().await;
    }

    /// The callback must resolve an alias of the provider name: the stored key is
    /// `"google_drive"` while the frontend sends the display name `"Google Drive"`,
    /// and a raw-name lookup dropped the tokens after Google had spent the code.
    #[tokio::test]
    async fn an_alias_provider_name_resolves_to_the_stored_key_and_persists_the_tokens() {
        let _guard = test_lock().await;
        let mut server = Server::new_async().await;
        let mock = server
            .mock("POST", "/token")
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(
                serde_json::json!({
                    "access_token": "alias_access",
                    "refresh_token": "new-refresh-token",
                    "expires_in": 3600,
                    "token_type": "Bearer"
                })
                .to_string(),
            )
            .create_async()
            .await;

        let manager = manager_with_google_drive().await;
        let state = "alias-provider-state";
        insert_pending_state(state, "code-verifier");

        let request = OAuthCallbackRequest {
            provider_name: "Google Drive".to_string(),
            code: "authorization-code".to_string(),
            state: state.to_string(),
        };

        complete_google_drive_oauth(&manager, &request, &format!("{}/token", server.url()))
            .await
            .expect("an alias provider name must resolve to the stored key");

        assert!(
            !state_is_pending(state),
            "success must consume the single-use state"
        );

        let stored = manager.get_config().await;
        let ProviderConfig::GoogleDrive { config } = stored
            .get_provider_config("google_drive")
            .expect("the tokens must land on the stored key")
            .clone()
        else {
            panic!("expected a Google Drive provider config");
        };
        assert_eq!(config.access_token.as_deref(), Some("alias_access"));
        assert_eq!(config.refresh_token.as_deref(), Some("new-refresh-token"));

        mock.assert_async().await;
    }

    /// A malformed 2xx body is a bug, not a rejection nor a network problem: it is
    /// reported as `Other` (keyword-free) and is terminal, so the state is dropped.
    #[tokio::test]
    async fn malformed_token_response_is_other_and_consumes_the_state() {
        let _guard = test_lock().await;
        let mut server = Server::new_async().await;
        let mock = server
            .mock("POST", "/token")
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body("this is definitely not json")
            .create_async()
            .await;

        let manager = manager_with_google_drive().await;
        let state = "malformed-json-state";
        insert_pending_state(state, "code-verifier");

        let error = complete_google_drive_oauth(
            &manager,
            &callback_request(state),
            &format!("{}/token", server.url()),
        )
        .await
        .expect_err("a malformed body must fail");

        let message = observable_message(error);
        assert_other_message(&message);
        assert!(
            !state_is_pending(state),
            "a terminal failure must consume the state"
        );

        mock.assert_async().await;
    }

    /// An unknown state must be rejected before any network call. The dead token
    /// URL makes the test falsifiable: were the state check bypassed, the failure
    /// would be a network one (keyword present) instead.
    #[tokio::test]
    async fn unknown_state_is_other_and_never_reaches_google() {
        let _guard = test_lock().await;
        let manager = manager_with_google_drive().await;

        let error = complete_google_drive_oauth(
            &manager,
            &callback_request("state-that-was-never-inserted"),
            &dead_loopback_url(),
        )
        .await
        .expect_err("an unknown state must be rejected");

        assert_other_message(&observable_message(error));
    }

    /// An expired state is terminal and dropped eagerly (it must not linger until
    /// the process exits).
    #[tokio::test]
    async fn expired_state_is_rejected_and_dropped() {
        let _guard = test_lock().await;
        let state = "expired-state";
        oauth_state_store().lock().unwrap().insert(
            state.to_string(),
            OAuthPendingState {
                created_at: Instant::now() - OAUTH_STATE_EXPIRY - std::time::Duration::from_secs(1),
                code_verifier: "code-verifier".to_string(),
            },
        );

        let error = peek_oauth_state(state).expect_err("an expired state must be rejected");

        assert_other_message(&observable_message(error.into()));
        assert!(
            !state_is_pending(state),
            "an expired state must be dropped eagerly"
        );
    }

    // ------------------------------------------------------------------
    // Keyword isolation of upstream bodies (MAJOR-1)
    // ------------------------------------------------------------------

    /// A `5xx` whose body *looks* like a credential rejection (a proxy/gateway HTML
    /// error page, for instance) must stay a retryable `NETWORK_ERROR`: were the
    /// body embedded as-is, the frontend would read `AUTHENTICATION_FAILED`
    /// (terminal), clear its OAuth state and kill the retry that the backend keeps
    /// the state for.
    #[tokio::test]
    async fn transient_body_with_auth_keywords_cannot_make_the_failure_terminal() {
        let _guard = test_lock().await;
        let mut server = Server::new_async().await;
        let mock = server
            .mock("POST", "/token")
            .with_status(502)
            .with_header("content-type", "text/html")
            .with_body(
                "<html><body><h1>502 Bad Gateway</h1>\
                 <p>authentication required, the token expired and unauthorized access was denied</p>\
                 </body></html>",
            )
            .create_async()
            .await;

        let manager = manager_with_google_drive().await;
        let state = "adversarial-502-state";
        insert_pending_state(state, "code-verifier");

        let error = complete_google_drive_oauth(
            &manager,
            &callback_request(state),
            &format!("{}/token", server.url()),
        )
        .await
        .expect_err("a 502 must fail");

        let message = observable_message(error);
        assert_eq!(
            bucket_of(&message),
            FrontendBucket::NetworkError,
            "a 502 with an adversarial body must stay NETWORK_ERROR, got: {message}"
        );
        assert!(
            state_is_pending(state),
            "a retryable failure must keep the state even with an adversarial body"
        );

        drop_pending_state(state);
        mock.assert_async().await;
    }

    /// The mirror case: a rejection whose body talks about connections must stay a
    /// terminal `AUTHENTICATION_FAILED` and must not look retryable.
    #[tokio::test]
    async fn rejection_body_with_a_network_keyword_stays_a_rejection() {
        let _guard = test_lock().await;
        let mut server = Server::new_async().await;
        let mock = server
            .mock("POST", "/token")
            .with_status(401)
            .with_body("connection refused by the authentication proxy")
            .create_async()
            .await;

        let manager = manager_with_google_drive().await;
        let state = "adversarial-401-state";
        insert_pending_state(state, "code-verifier");

        let error = complete_google_drive_oauth(
            &manager,
            &callback_request(state),
            &format!("{}/token", server.url()),
        )
        .await
        .expect_err("a 401 must fail");

        let message = observable_message(error);
        assert_eq!(
            bucket_of(&message),
            FrontendBucket::AuthenticationFailed,
            "a 401 must stay AUTHENTICATION_FAILED, got: {message}"
        );
        assert!(
            !message.contains("network") && !message.contains("connection"),
            "a rejection must not look retryable, got: {message}"
        );
        assert!(
            !state_is_pending(state),
            "a rejection must consume the single-use state"
        );

        mock.assert_async().await;
    }

    /// An unrecognised status (terminal `Other`) must stay keyword-free even when
    /// its body is full of auth keywords; only the status is reported.
    #[tokio::test]
    async fn other_body_with_auth_keywords_stays_keyword_free() {
        let _guard = test_lock().await;
        let mut server = Server::new_async().await;
        let mock = server
            .mock("POST", "/token")
            .with_status(400)
            .with_body(r#"{"error":"invalid_request","detail":"authentication unauthorized"}"#)
            .create_async()
            .await;

        let manager = manager_with_google_drive().await;
        let state = "adversarial-400-state";
        insert_pending_state(state, "code-verifier");

        let error = complete_google_drive_oauth(
            &manager,
            &callback_request(state),
            &format!("{}/token", server.url()),
        )
        .await
        .expect_err("a 400 without an OAuth error code must fail");

        assert_other_message(&observable_message(error));
        assert!(
            !state_is_pending(state),
            "a terminal failure must consume the state"
        );

        mock.assert_async().await;
    }

    // ------------------------------------------------------------------
    // Lifecycle is decoupled from the class (MAJOR-2)
    // ------------------------------------------------------------------

    /// The tokens were obtained but could not be saved: the authorization code is
    /// already spent, so the failure must be a keyword-free `Other` **and** must not
    /// promise a retry (`keep_state == false`), even though the underlying cause is a
    /// local IO/keychain problem.
    #[test]
    fn tokens_obtained_but_not_persisted_is_terminal_other_and_keyword_free() {
        for cause in [
            StorageError::keychain("the secret service is not available"),
            StorageError::Io(std::io::Error::other("read-only config directory")),
            StorageError::invalid_configuration("Provider is not Google Drive"),
        ] {
            let failure = token_persistence_failure(&cause);

            assert_eq!(
                failure.class,
                AuthFailureClass::Other,
                "a spent authorization code cannot be retried as {:?} ({cause})",
                failure.class
            );
            assert!(
                !failure.keep_state,
                "the single-use code is consumed, so the state must not survive ({cause})"
            );

            let message = observable_message(failure.error);
            assert_other_message(&message);
            assert!(
                message.contains("sign in again"),
                "the message must tell the user what to do, got: {message}"
            );
        }
    }

    /// The state lifecycle follows `keep_state`, not the class: a failure that looks
    /// retryable (`Transient`) but is flagged terminal must burn the single-use
    /// state, and a retryable one must keep it.
    #[tokio::test]
    async fn state_lifecycle_follows_keep_state_and_not_the_class() {
        let _guard = test_lock().await;

        let retryable = ClassifiedAuthError::new(
            AuthFailureClass::Transient,
            "exchanging the Google Drive authorization code",
            "connection reset",
        );
        let terminal_transient = ClassifiedAuthError::terminal(
            AuthFailureClass::Transient,
            "exchanging the Google Drive authorization code",
            "connection reset",
        );

        for (state, failure, expected_pending) in [
            ("kept-state", &retryable, true),
            ("burned-state", &terminal_transient, false),
        ] {
            insert_pending_state(state, "code-verifier");
            apply_failed_oauth_state_lifecycle(state, failure);

            assert_eq!(
                state_is_pending(state),
                expected_pending,
                "{state} must be {}",
                if expected_pending { "kept" } else { "consumed" }
            );
            drop_pending_state(state);
        }
    }

    // ------------------------------------------------------------------
    // Error taxonomy unit tests
    // ------------------------------------------------------------------

    #[test]
    fn token_endpoint_status_taxonomy() {
        use super::super::classify_token_endpoint_status as classify;
        use reqwest::StatusCode;

        assert_eq!(
            classify(StatusCode::BAD_REQUEST, r#"{"error":"invalid_grant"}"#),
            crate::commands::errors::AuthFailureClass::AuthRejection
        );
        assert_eq!(
            classify(StatusCode::BAD_REQUEST, r#"{"error":"invalid_client"}"#),
            crate::commands::errors::AuthFailureClass::AuthRejection
        );
        assert_eq!(
            classify(StatusCode::UNAUTHORIZED, ""),
            crate::commands::errors::AuthFailureClass::AuthRejection
        );
        assert_eq!(
            classify(StatusCode::FORBIDDEN, ""),
            crate::commands::errors::AuthFailureClass::AuthRejection
        );
        assert_eq!(
            classify(StatusCode::REQUEST_TIMEOUT, ""),
            crate::commands::errors::AuthFailureClass::Transient
        );
        assert_eq!(
            classify(StatusCode::TOO_MANY_REQUESTS, ""),
            crate::commands::errors::AuthFailureClass::Transient
        );
        assert_eq!(
            classify(StatusCode::INTERNAL_SERVER_ERROR, ""),
            crate::commands::errors::AuthFailureClass::Transient
        );
        assert_eq!(
            classify(StatusCode::BAD_GATEWAY, ""),
            crate::commands::errors::AuthFailureClass::Transient
        );
        // A 400 without a recognized OAuth error code is not a known rejection.
        assert_eq!(
            classify(StatusCode::BAD_REQUEST, r#"{"error":"invalid_request"}"#),
            crate::commands::errors::AuthFailureClass::Other
        );
        assert_eq!(
            classify(StatusCode::NOT_FOUND, ""),
            crate::commands::errors::AuthFailureClass::Other
        );
    }

    /// `StorageError::HttpStatus` carries the status structurally (issue #28, D3):
    /// a transient status drops the upstream body, a rejection keeps it, and both
    /// render the exact `Failed to refresh access token (…)` cause the frontend
    /// contract pins — no message parsing involved.
    #[test]
    fn http_status_failure_carries_its_status_structurally() {
        use tauri_plugin_http::reqwest::StatusCode;

        // Transient (5xx): body dropped, cause is exactly the "(<status> <reason>)" prefix.
        let transient = observable_message(classify_refresh_failure(StorageError::http_status(
            StatusCode::SERVICE_UNAVAILABLE,
            "connection reset, authentication required",
        )));
        assert_eq!(
            bucket_of(&transient),
            FrontendBucket::NetworkError,
            "a 5xx must be TRANSIENT whatever its body says, got: {transient}"
        );
        assert_eq!(
            transient,
            "network error while refreshing the Google Drive access token: \
             Failed to refresh access token (503 Service Unavailable)",
            "the transient cause must be byte-exactly the \"(<status> <reason>)\" prefix \
             (the upstream body dropped)"
        );

        // Rejection (400): body kept verbatim, class stays terminal.
        let rejection = observable_message(classify_refresh_failure(StorageError::http_status(
            StatusCode::BAD_REQUEST,
            "invalid_client: client not found",
        )));
        assert_eq!(
            bucket_of(&rejection),
            FrontendBucket::AuthenticationFailed,
            "a 400 must be AUTH_REJECTION, got: {rejection}"
        );
        assert_eq!(
            rejection,
            "authentication failed while refreshing the Google Drive access token \
             (re-authenticate): Failed to refresh access token (400 Bad Request): \
             invalid_client: client not found",
            "a rejection must keep the upstream body verbatim, byte for byte"
        );
    }

    /// `refresh_provider_auth` must expose the same three classes as the callback.
    #[test]
    fn refresh_failure_taxonomy_matches_the_command_contract() {
        // AUTH_REJECTION: the exact wording the provider emits for invalid_grant.
        let rejection = observable_message(classify_refresh_failure(StorageError::authentication(
            "Google Drive refresh token is invalid or has been revoked. Please re-authenticate.",
        )));
        assert_eq!(
            bucket_of(&rejection),
            FrontendBucket::AuthenticationFailed,
            "invalid_grant must be AUTH_REJECTION, got: {rejection}"
        );
        assert!(
            !rejection.contains("network") && !rejection.contains("connection"),
            "a rejection must not look retryable, got: {rejection}"
        );

        // TRANSIENT: a request error, reported as StorageError::Network.
        let network = observable_message(classify_refresh_failure(StorageError::network(
            "Network error during token refresh: error sending request",
        )));
        assert_eq!(
            bucket_of(&network),
            FrontendBucket::NetworkError,
            "{network}"
        );

        // TRANSIENT: a 5xx carried structurally as `StorageError::HttpStatus`,
        // with an adversarial body that talks about authentication/connection.
        let server_error = observable_message(classify_refresh_failure(StorageError::http_status(
            tauri_plugin_http::reqwest::StatusCode::SERVICE_UNAVAILABLE,
            "connection reset, authentication required",
        )));
        assert_eq!(
            bucket_of(&server_error),
            FrontendBucket::NetworkError,
            "a 5xx must be TRANSIENT whatever its body says, got: {server_error}"
        );

        // TRANSIENT: persisting the refreshed tokens failed (IO/keychain) — this one
        // really is retryable, unlike the token *exchange* whose code is single-use.
        // The wording names the *local* cause (review finding m4) while keeping the
        // `network` keyword the frontend routes on.
        let keychain = observable_message(classify_refresh_failure(StorageError::keychain(
            "Failed to set keychain secret",
        )));
        assert_eq!(
            bucket_of(&keychain),
            FrontendBucket::NetworkError,
            "a local-storage failure must stay in the transient bucket, got: {keychain}"
        );
        assert!(
            keychain.contains("network or local storage error"),
            "a keychain failure must be named as a local-storage error, got: {keychain}"
        );
        assert!(
            keychain.contains("Failed to set keychain secret"),
            "the cause must survive verbatim, got: {keychain}"
        );

        // OTHER: misconfiguration, no keyword.
        let other = observable_message(classify_refresh_failure(
            StorageError::provider_not_supported("nope"),
        ));
        assert_other_message(&other);
        // The conservative default: a non-transient status the classifier does
        // not recognise (here 404) stays terminal rather than being reported as
        // retryable — the `HttpStatus` arm defaults any non-transient status to
        // `AuthRejection` (which `bucket_of` maps to the conservative terminal
        // bucket).
        let unrecognised_status =
            observable_message(classify_refresh_failure(StorageError::http_status(
                tauri_plugin_http::reqwest::StatusCode::NOT_FOUND,
                "no such resource",
            )));
        assert_eq!(
            bucket_of(&unrecognised_status),
            FrontendBucket::AuthenticationFailed,
            "an unknown status defaults to the conservative terminal bucket, got: {unrecognised_status}"
        );
    }

    /// m1: an unbounded upstream response body must not reach the error cause.
    /// Classification still runs on the FULL body (the `invalid_grant` keyword
    /// can sit anywhere in it), but the message keeps only a bounded slice.
    #[tokio::test]
    async fn huge_token_endpoint_body_is_classified_in_full_and_the_ipc_message_stays_bounded() {
        let _guard = test_lock().await;
        let mut server = Server::new_async().await;

        // `invalid_grant` sits PAST the cause bound, so the class must come from
        // the full body, not from the truncated slice.
        let padding = "a".repeat(MAX_ERROR_BODY_CAUSE_CHARS + 500);
        let body = format!("{padding}invalid_grant");
        let mock = server
            .mock("POST", "/token")
            .with_status(400)
            .with_body(body)
            .create_async()
            .await;

        let manager = manager_with_google_drive().await;
        let state = "huge-body-400-state";
        insert_pending_state(state, "code-verifier");

        let error = complete_google_drive_oauth(
            &manager,
            &callback_request(state),
            &format!("{}/token", server.url()),
        )
        .await
        .expect_err("a 400 must fail");

        let message = observable_message(error);
        assert_eq!(
            bucket_of(&message),
            FrontendBucket::AuthenticationFailed,
            "the classification must see the full body (invalid_grant past the \
             cause bound), got: {}",
            message.chars().take(120).collect::<String>()
        );
        // The observable IPC message is bounded by `sanitize_error_cause`
        // (MAX_ERROR_CAUSE_LEN chars + the trailing `…`), plus the fixed
        // template prefix and at most one placeholder expansion. This does NOT
        // pin `bounded_error_body` (sanitisation would bound the message even
        // without it) — the intermediate cause bound is pinned by the
        // `bounded_error_body_*` unit tests below.
        let template_prefix = format!(
            "authentication failed while exchanging the Google Drive \
             authorization code (re-authenticate): "
        );
        assert!(
            message.chars().count() <= template_prefix.chars().count() + MAX_ERROR_CAUSE_LEN + 1,
            "the observable message must stay within the sanitised bound ({} chars)",
            message.chars().count()
        );

        drop_pending_state(state);
        mock.assert_async().await;
    }
}
