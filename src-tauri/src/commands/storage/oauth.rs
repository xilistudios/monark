use super::error::{bounded_error_body, ClassifiedAuthError};
use super::StorageState;
use crate::commands::errors::{AuthFailureClass, CommandError};
use crate::storage::providers::google_drive::GoogleDriveConfig;
use crate::storage::{ProviderConfig, StorageError, StorageManager};
use base64::Engine;
use chrono::Utc;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};
use std::time::Instant;
use tauri::State;

struct OAuthPendingState {
    created_at: Instant,
    code_verifier: String,
}

fn oauth_state_store() -> &'static Mutex<HashMap<String, OAuthPendingState>> {
    static STORE: OnceLock<Mutex<HashMap<String, OAuthPendingState>>> = OnceLock::new();
    STORE.get_or_init(|| Mutex::new(HashMap::new()))
}

const OAUTH_STATE_EXPIRY: std::time::Duration = std::time::Duration::from_secs(300);

const GOOGLE_DRIVE_TOKEN_ENDPOINT: &str = "https://oauth2.googleapis.com/token";

fn peek_oauth_state(state: &str) -> Result<String, ClassifiedAuthError> {
    let mut store = oauth_state_store().lock().unwrap();
    let pending = store
        .get(state)
        .map(|entry| (entry.code_verifier.clone(), entry.created_at.elapsed()));

    match pending {
        Some((code_verifier, elapsed)) if elapsed <= OAUTH_STATE_EXPIRY => Ok(code_verifier),
        Some(_) => {
            store.remove(state);
            Err(oauth_state_terminal_error())
        }
        None => Err(oauth_state_terminal_error()),
    }
}

fn oauth_state_terminal_error() -> ClassifiedAuthError {
    ClassifiedAuthError::new(
        AuthFailureClass::Other,
        "validating the OAuth state",
        "the OAuth state is unknown or has expired",
    )
}

fn consume_oauth_state(state: &str) {
    oauth_state_store().lock().unwrap().remove(state);
}

fn generate_pkce_pair() -> (String, String) {
    use rand::RngCore;
    use sha2::{Digest, Sha256};

    let mut verifier_bytes = [0u8; 32];
    rand::rngs::OsRng.fill_bytes(&mut verifier_bytes);
    let code_verifier = base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(verifier_bytes);

    let mut hasher = Sha256::new();
    hasher.update(code_verifier.as_bytes());
    let challenge_bytes = hasher.finalize();
    let code_challenge = base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(challenge_bytes);

    (code_verifier, code_challenge)
}

fn effective_google_drive_redirect_uri(config: &GoogleDriveConfig) -> String {
    config.redirect_uri.clone()
}

#[derive(Debug, Serialize, Deserialize)]
pub struct OAuthUrlResponse {
    pub url: String,
    pub state: String,
}

#[tauri::command]
pub async fn get_google_drive_oauth_url(
    provider_name: String,
    state: State<'_, StorageState>,
) -> Result<OAuthUrlResponse, CommandError> {
    let resolved_name = state.manager.resolve_provider_key(&provider_name).await;

    // Get the provider config
    let config = state.manager.get_config().await;
    let provider_config = config
        .get_provider_config(&resolved_name)
        .ok_or_else(|| CommandError::Io("Provider not found".to_string()))?;

    match provider_config {
        ProviderConfig::GoogleDrive { config: gd_config } => {
            let oauth_state = format!("{}", uuid::Uuid::new_v4());

            let (code_verifier, code_challenge) = generate_pkce_pair();

            {
                let mut store = oauth_state_store().lock().unwrap();
                store.insert(
                    oauth_state.clone(),
                    OAuthPendingState {
                        created_at: Instant::now(),
                        code_verifier,
                    },
                );
            }

            // Build OAuth URL
            let auth_url = build_google_drive_auth_url(gd_config, &oauth_state, &code_challenge);

            Ok(OAuthUrlResponse {
                url: auth_url,
                state: oauth_state,
            })
        }
        _ => Err(CommandError::Io("Provider is not Google Drive".to_string())),
    }
}

fn build_google_drive_auth_url(
    gd_config: &GoogleDriveConfig,
    oauth_state: &str,
    code_challenge: &str,
) -> String {
    let scopes = "https://www.googleapis.com/auth/drive.file";

    format!(
        "https://accounts.google.com/o/oauth2/v2/auth?client_id={}&redirect_uri={}&response_type=code&scope={}&access_type=offline&state={}&code_challenge={}&code_challenge_method=S256&prompt=consent",
        urlencoding::encode(&gd_config.client_id),
        urlencoding::encode(&gd_config.redirect_uri),
        urlencoding::encode(scopes),
        oauth_state,
        code_challenge,
    )
}

#[derive(Debug, Serialize, Deserialize)]
pub struct OAuthCallbackRequest {
    pub provider_name: String,
    pub code: String,
    pub state: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
struct GoogleDriveTokens {
    access_token: String,
    refresh_token: Option<String>,
    expires_in: u64,
}

fn classify_token_endpoint_status(status: reqwest::StatusCode, body: &str) -> AuthFailureClass {
    if status == reqwest::StatusCode::BAD_REQUEST
        && (body.contains("invalid_grant") || body.contains("invalid_client"))
    {
        return AuthFailureClass::AuthRejection;
    }
    if status == reqwest::StatusCode::UNAUTHORIZED || status == reqwest::StatusCode::FORBIDDEN {
        return AuthFailureClass::AuthRejection;
    }
    if status == reqwest::StatusCode::REQUEST_TIMEOUT
        || status == reqwest::StatusCode::TOO_MANY_REQUESTS
        || status.is_server_error()
    {
        return AuthFailureClass::Transient;
    }
    AuthFailureClass::Other
}

async fn exchange_google_drive_code(
    client: &reqwest::Client,
    token_url: &str,
    gd_config: &GoogleDriveConfig,
    redirect_uri: &str,
    code: &str,
    code_verifier: &str,
) -> Result<GoogleDriveTokens, ClassifiedAuthError> {
    const CONTEXT: &str = "exchanging the Google Drive authorization code";

    let params = [
        ("client_id", gd_config.client_id.as_str()),
        ("client_secret", gd_config.client_secret.as_str()),
        ("code", code),
        ("redirect_uri", redirect_uri),
        ("grant_type", "authorization_code"),
        ("code_verifier", code_verifier),
    ];

    let response = client
        .post(token_url)
        .form(&params)
        .send()
        .await
        .map_err(|e| {
            ClassifiedAuthError::new(AuthFailureClass::Transient, CONTEXT, &e.to_string())
        })?;

    let status = response.status();

    if !status.is_success() {
        let body = response
            .text()
            .await
            .unwrap_or_else(|_| "unreadable response body".to_string());
        let class = classify_token_endpoint_status(status, &body);
        let cause = if class == AuthFailureClass::AuthRejection {
            format!(
                "the token endpoint returned HTTP status {status}: {}",
                bounded_error_body(&body)
            )
        } else {
            format!("the token endpoint returned HTTP status {status}")
        };
        return Err(ClassifiedAuthError::new(class, CONTEXT, &cause));
    }

    response.json().await.map_err(|e| {
        ClassifiedAuthError::new(
            AuthFailureClass::Other,
            "parsing the Google Drive token response",
            &e.to_string(),
        )
    })
}

async fn run_google_drive_oauth(
    manager: &StorageManager,
    request: &OAuthCallbackRequest,
    token_url: &str,
) -> Result<(), ClassifiedAuthError> {
    let code_verifier = peek_oauth_state(&request.state)?;

    // Resolve BEFORE the config snapshot: the URL was minted for the resolved key.
    let resolved_name = manager.resolve_provider_key(&request.provider_name).await;

    let config = manager.get_config().await;
    let provider_config = config.get_provider_config(&resolved_name).ok_or_else(|| {
        ClassifiedAuthError::new(
            AuthFailureClass::Other,
            "loading the Google Drive provider configuration",
            "the provider has no stored configuration",
        )
    })?;

    let gd_config = match provider_config {
        ProviderConfig::GoogleDrive { config } => config.clone(),
        _ => {
            return Err(ClassifiedAuthError::new(
                AuthFailureClass::Other,
                "loading the Google Drive provider configuration",
                "the provider is not a Google Drive provider",
            ));
        }
    };

    let redirect_uri = effective_google_drive_redirect_uri(&gd_config);
    let client = reqwest::Client::new();

    let tokens = exchange_google_drive_code(
        &client,
        token_url,
        &gd_config,
        &redirect_uri,
        &request.code,
        &code_verifier,
    )
    .await?;

    // Blank == absent (see `GoogleDriveConfig::has_usable_credentials`).
    let exchanged_refresh_token = tokens.refresh_token.filter(|token| !token.is_empty());
    let stored_refresh_token = gd_config.refresh_token.filter(|token| !token.is_empty());
    if exchanged_refresh_token.is_none() && stored_refresh_token.is_some() {
        println!(
            "[Google Drive] OAuth exchange returned no refresh_token; keeping the previously stored one (it may be stale or revoked). Consent is forced (prompt=consent), so this should not happen."
        );
    }

    // No refresh token at all: the code is already spent, so fail loudly.
    if exchanged_refresh_token.is_none() && stored_refresh_token.is_none() {
        return Err(ClassifiedAuthError::terminal(
            AuthFailureClass::Other,
            "completing the Google Drive sign-in",
            "Google issued no long-lived token, so this sign-in would stop working shortly; please try again",
        ));
    }

    let new_config = GoogleDriveConfig {
        client_id: gd_config.client_id,
        client_secret: gd_config.client_secret,
        redirect_uri,
        access_token: Some(tokens.access_token),
        refresh_token: exchanged_refresh_token.or(stored_refresh_token),
        token_expires_at: Some(Utc::now() + chrono::Duration::seconds(tokens.expires_in as i64)),
    };

    manager
        .update_google_drive_config(&resolved_name, new_config)
        .await
        .map_err(|e| token_persistence_failure(&e))?;

    Ok(())
}

fn token_persistence_failure(error: &StorageError) -> ClassifiedAuthError {
    ClassifiedAuthError::terminal(
        AuthFailureClass::Other,
        "saving the Google Drive tokens that Google already issued",
        &format!(
            "the tokens were obtained but could not be persisted; please sign in again ({error})"
        ),
    )
}

fn apply_failed_oauth_state_lifecycle(state: &str, failure: &ClassifiedAuthError) {
    if !failure.keep_state {
        consume_oauth_state(state);
    }
}

#[tauri::command]
pub async fn handle_google_drive_oauth_callback(
    request: OAuthCallbackRequest,
    state: State<'_, StorageState>,
) -> Result<(), CommandError> {
    complete_google_drive_oauth(&state.manager, &request, GOOGLE_DRIVE_TOKEN_ENDPOINT).await
}

async fn complete_google_drive_oauth(
    manager: &StorageManager,
    request: &OAuthCallbackRequest,
    token_url: &str,
) -> Result<(), CommandError> {
    println!(
        "OAuth callback received for provider: {}",
        request.provider_name
    );

    match run_google_drive_oauth(manager, request, token_url).await {
        Ok(()) => {
            consume_oauth_state(&request.state);
            Ok(())
        }
        Err(failure) => {
            println!(
                "OAuth callback failed for provider {}: class {:?}, keep_state {}",
                request.provider_name, failure.class, failure.keep_state
            );
            apply_failed_oauth_state_lifecycle(&request.state, &failure);
            Err(failure.into())
        }
    }
}

#[cfg(test)]
mod tests;
