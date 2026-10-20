use crate::commands::errors::{AuthFailureClass, CommandError};
use crate::storage::providers::google_drive::GoogleDriveConfig;
use crate::storage::providers::{
    CreateFileRequest, CreateFolderRequest, StorageFile, UpdateFileRequest,
};
use crate::storage::{ProviderConfig, StorageConfig, StorageError, StorageManager};
use base64::Engine;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::{Arc, Mutex, OnceLock};
use std::time::Instant;
use tauri::State;

/// Upper bound on the slice of a token-endpoint response body that is embedded
/// in the human-readable error *cause*.
///
/// The body is an arbitrary upstream payload (a proxy/gateway HTML page, Google's
/// JSON error) and may be arbitrarily large; only its first
/// [`MAX_ERROR_BODY_CAUSE_CHARS`] characters are kept for the user, with `…`
/// appended when truncated. Classification always runs on the **full** body (see
/// [`exchange_google_drive_code`]): this bound only limits what reaches the
/// message, so a multi-MB 5xx body cannot blow up the IPC payload or the log.
const MAX_ERROR_BODY_CAUSE_CHARS: usize = 960;

// Global state for storage manager
pub struct StorageState {
    pub manager: Arc<StorageManager>,
}

/// Pending OAuth state entry for CSRF protection and PKCE.
struct OAuthPendingState {
    created_at: Instant,
    code_verifier: String,
}

/// In-memory store for pending OAuth states (state → pending entry).
///
/// Entries expire after [`OAUTH_STATE_EXPIRY`] and are single-use: they are
/// dropped once their flow reaches a terminal outcome. A retryable failure
/// ([`ClassifiedAuthError::keep_state`]) of the token exchange deliberately leaves
/// the entry in place so the frontend can retry the very same callback (see
/// [`complete_google_drive_oauth`]).
fn oauth_state_store() -> &'static Mutex<HashMap<String, OAuthPendingState>> {
    static STORE: OnceLock<Mutex<HashMap<String, OAuthPendingState>>> = OnceLock::new();
    STORE.get_or_init(|| Mutex::new(HashMap::new()))
}

/// Time-to-live of a pending OAuth state (CSRF/PKCE), in seconds.
///
/// The TTL is measured from the moment the state was minted
/// (`get_google_drive_oauth_url`) and is **not** extended by a retry.
const OAUTH_STATE_EXPIRY: std::time::Duration = std::time::Duration::from_secs(300);

/// Google's OAuth 2.0 token endpoint, used to exchange the authorization code.
const GOOGLE_DRIVE_TOKEN_ENDPOINT: &str = "https://oauth2.googleapis.com/token";

/// Read a pending OAuth state **without consuming it**.
///
/// Consumption is deferred to [`consume_oauth_state`] so a transient failure of
/// the token exchange does not burn the state:
/// * a missing or expired state is a terminal failure (reported as `Other`); an
///   expired entry is dropped eagerly;
/// * a valid entry is left in the store and only its PKCE `code_verifier` is
///   returned.
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

/// Terminal error for a state that cannot be used any more.
///
/// Classified as `Other` (terminal, no keyword): the request never reached
/// Google, so it is neither a credential rejection nor retryable.
fn oauth_state_terminal_error() -> ClassifiedAuthError {
    ClassifiedAuthError::new(
        AuthFailureClass::Other,
        "validating the OAuth state",
        "the OAuth state is unknown or has expired",
    )
}

/// Drop a pending OAuth state once its flow reached a terminal outcome.
fn consume_oauth_state(state: &str) {
    oauth_state_store().lock().unwrap().remove(state);
}

/// A [`CommandError`] paired with the [`AuthFailureClass`] it was built from and
/// with the OAuth-state lifecycle decision that goes with it.
///
/// The class is needed *inside* the OAuth flow, before the failure bubbles up as a
/// plain [`CommandError`], and so is the lifecycle decision — but they are **not**
/// the same thing, which is why they are stored separately:
///
/// | class           | message keywords (see [`AuthFailureClass`]) | `keep_state` | frontend `CloudStorageErrorType` | state lifecycle                                              |
/// |-----------------|---------------------------------------------|--------------|----------------------------------|--------------------------------------------------------------|
/// | `AuthRejection` | `authentication`                            | `false`      | `AUTHENTICATION_FAILED`          | terminal: the code was refused, retrying it cannot succeed    |
/// | `Transient`     | `network` / `connection`                    | `true`       | `NETWORK_ERROR`                  | retryable: the state survives so the callback can be replayed |
/// | `Other`         | none                                        | `false`      | `OPERATION_FAILED`               | terminal: conservative, plus the "tokens obtained but not saved" case |
///
/// `keep_state` defaults to the class' own lifecycle ([`Self::new`]) and can be
/// overridden with [`Self::terminal`] when a failure is terminal even though its
/// class looks retryable: the frontend can only ever retry the very same callback
/// on `NETWORK_ERROR` (see `src/services/deepLinkService.ts`), so a `Transient`
/// message that cannot be retried would make the UI offer a retry that the backend
/// cannot honour.
struct ClassifiedAuthError {
    class: AuthFailureClass,
    /// Whether the pending OAuth state must be kept for a retry of the very same
    /// callback.
    keep_state: bool,
    error: CommandError,
}

impl ClassifiedAuthError {
    /// Failure of `class`, with the lifecycle that class implies: only a retryable
    /// (`Transient`) failure keeps the state.
    fn new(class: AuthFailureClass, context: &str, cause: &str) -> Self {
        Self::with_lifecycle(class, class == AuthFailureClass::Transient, context, cause)
    }

    /// Terminal failure of `class`, whatever that class' usual lifecycle is: the
    /// single-use state is dropped because replaying this callback cannot succeed.
    fn terminal(class: AuthFailureClass, context: &str, cause: &str) -> Self {
        Self::with_lifecycle(class, false, context, cause)
    }

    fn with_lifecycle(
        class: AuthFailureClass,
        keep_state: bool,
        context: &str,
        cause: &str,
    ) -> Self {
        Self {
            class,
            keep_state,
            error: class.into_command_error(context, cause),
        }
    }
}

impl From<ClassifiedAuthError> for CommandError {
    fn from(failure: ClassifiedAuthError) -> Self {
        failure.error
    }
}

/// Generate a PKCE (code_verifier, code_challenge) pair using S256.
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

#[derive(Debug, Serialize, Deserialize)]
pub struct ProviderInfo {
    pub name: String,
    pub provider_type: String,
    pub is_default: bool,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct AddProviderRequest {
    pub name: String,
    pub config: ProviderConfig,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct CreateFileRequestDto {
    pub name: String,
    pub path: String,
    pub content: Vec<u8>,
    pub parent_id: Option<String>,
    pub mime_type: Option<String>,
    pub metadata: Option<std::collections::HashMap<String, String>>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct UpdateFileRequestDto {
    pub id: String,
    pub content: Vec<u8>,
    pub metadata: Option<std::collections::HashMap<String, String>>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct CreateFolderRequestDto {
    pub name: String,
    pub path: String,
    pub parent_id: Option<String>,
    pub metadata: Option<std::collections::HashMap<String, String>>,
}

fn effective_google_drive_redirect_uri(config: &GoogleDriveConfig) -> String {
    config.redirect_uri.clone()
}

impl From<CreateFileRequestDto> for CreateFileRequest {
    fn from(dto: CreateFileRequestDto) -> Self {
        Self {
            name: dto.name,
            path: dto.path,
            content: dto.content,
            parent_id: dto.parent_id,
            mime_type: dto.mime_type,
            metadata: dto.metadata,
        }
    }
}

impl From<UpdateFileRequestDto> for UpdateFileRequest {
    fn from(dto: UpdateFileRequestDto) -> Self {
        Self {
            id: dto.id,
            content: dto.content,
            metadata: dto.metadata,
        }
    }
}

impl From<CreateFolderRequestDto> for CreateFolderRequest {
    fn from(dto: CreateFolderRequestDto) -> Self {
        Self {
            name: dto.name,
            path: dto.path,
            parent_id: dto.parent_id,
            metadata: dto.metadata,
        }
    }
}

// Initialize storage manager
pub async fn init_storage_manager() -> Arc<StorageManager> {
    let config = StorageConfig::default();
    Arc::new(
        StorageManager::new(config)
            .await
            .expect("Failed to initialize storage manager"),
    )
}

#[tauri::command]
pub async fn list_providers(
    state: State<'_, StorageState>,
) -> Result<Vec<ProviderInfo>, CommandError> {
    let providers = state.manager.list_providers().await;
    let default_provider = state.manager.get_default_provider().await;

    let mut provider_infos = Vec::new();
    for provider_name in providers {
        let config = state.manager.get_config().await;
        if let Some(provider_config) = config.get_provider_config(&provider_name) {
            let provider_type = match provider_config {
                ProviderConfig::Local { .. } => "local".to_string(),
                ProviderConfig::GoogleDrive { .. } => "google_drive".to_string(),
                ProviderConfig::WebDav { .. } => "webdav".to_string(),
            };

            provider_infos.push(ProviderInfo {
                name: provider_name.clone(),
                provider_type,
                is_default: provider_name == default_provider,
            });
        }
    }

    Ok(provider_infos)
}

#[tauri::command]
pub async fn add_provider(
    request: AddProviderRequest,
    state: State<'_, StorageState>,
) -> Result<(), CommandError> {
    state
        .manager
        .add_provider(request.name, request.config)
        .await
        .map_err(|_e| CommandError::Io("Failed to add provider".to_string()))?;
    Ok(())
}

#[tauri::command]
pub async fn remove_provider(
    name: String,
    state: State<'_, StorageState>,
) -> Result<(), CommandError> {
    if name == "local" {
        return Err(CommandError::Io(
            "Cannot remove the local provider".to_string(),
        ));
    }

    if name == crate::storage::MONARK_DEFAULT_PROVIDER_NAME {
        return Err(CommandError::Io(
            "Cannot remove the default Monark provider".to_string(),
        ));
    }

    state
        .manager
        .remove_provider(&name)
        .await
        .map_err(|_e| CommandError::Io("Failed to remove provider".to_string()))?;
    Ok(())
}

#[tauri::command]
pub async fn set_default_provider(
    name: String,
    state: State<'_, StorageState>,
) -> Result<(), CommandError> {
    state
        .manager
        .set_default_provider(name)
        .await
        .map_err(|_e| CommandError::Io("Failed to set default provider".to_string()))?;
    Ok(())
}

#[tauri::command]
pub async fn authenticate_provider(
    provider_name: Option<String>,
    state: State<'_, StorageState>,
) -> Result<(), CommandError> {
    state
        .manager
        .authenticate(provider_name)
        .await
        .map_err(|_e| CommandError::Io("Failed to authenticate provider".to_string()))?;
    Ok(())
}

/// Pure "is this provider authenticated?" decision for a stored provider config.
///
/// Kept free of Tauri state so it can be unit tested directly (the command itself
/// only needs a `State<StorageState>`).
///
/// Google Drive is considered authenticated when its credentials are still usable,
/// i.e. either the access token is valid *or* a refresh token exists — an expired
/// access token can be renewed silently by `ensure_google_drive_token_valid`.
/// Treating a merely expired access token as "not authenticated" is the bug that
/// made the UI ask for a full Google login every ~1h on Linux.
fn provider_config_is_authenticated(provider_config: &ProviderConfig) -> bool {
    match provider_config {
        ProviderConfig::GoogleDrive { config } => config.has_usable_credentials(),
        ProviderConfig::WebDav { config } => {
            // WebDAV uses Basic auth — authenticated if credentials are present
            !config.username.is_empty() && !config.password.is_empty()
        }
        // Local provider doesn't need authentication
        ProviderConfig::Local { .. } => true,
    }
}

#[tauri::command]
pub async fn check_provider_auth_status(
    provider_name: String,
    state: State<'_, StorageState>,
) -> Result<bool, CommandError> {
    let config = state.manager.get_config().await;

    Ok(config
        .get_provider_config(&provider_name)
        .map(provider_config_is_authenticated)
        .unwrap_or(false))
}

#[tauri::command]
pub async fn list_files(
    folder_id: Option<String>,
    provider_name: Option<String>,
    state: State<'_, StorageState>,
) -> Result<Vec<StorageFile>, CommandError> {
    state
        .manager
        .list_files(folder_id, provider_name)
        .await
        .map_err(|_e| CommandError::Io("Failed to list files".to_string()))
}

#[tauri::command]
pub async fn create_file(
    request: CreateFileRequestDto,
    provider_name: Option<String>,
    state: State<'_, StorageState>,
) -> Result<StorageFile, CommandError> {
    let create_request = CreateFileRequest::from(request);
    state
        .manager
        .create_file(create_request, provider_name)
        .await
        .map_err(|_e| CommandError::Io("Failed to create file".to_string()))
}

#[tauri::command]
pub async fn read_file(
    file_id: String,
    provider_name: Option<String>,
    state: State<'_, StorageState>,
) -> Result<Vec<u8>, CommandError> {
    state
        .manager
        .read_file(file_id, provider_name)
        .await
        .map_err(|_e| CommandError::Io("Failed to read file".to_string()))
}

#[tauri::command]
pub async fn delete_file(
    file_id: String,
    provider_name: Option<String>,
    state: State<'_, StorageState>,
) -> Result<(), CommandError> {
    state
        .manager
        .delete_file(file_id, provider_name)
        .await
        .map_err(|_e| CommandError::Io("Failed to delete file".to_string()))?;
    Ok(())
}

#[tauri::command]
pub async fn update_file(
    request: UpdateFileRequestDto,
    provider_name: Option<String>,
    state: State<'_, StorageState>,
) -> Result<StorageFile, CommandError> {
    let update_request = UpdateFileRequest::from(request);
    state
        .manager
        .update_file(update_request, provider_name)
        .await
        .map_err(|_e| CommandError::Io("Failed to update file".to_string()))
}

#[tauri::command]
pub async fn create_folder(
    request: CreateFolderRequestDto,
    provider_name: Option<String>,
    state: State<'_, StorageState>,
) -> Result<StorageFile, CommandError> {
    let create_request = CreateFolderRequest::from(request);
    state
        .manager
        .create_folder(create_request, provider_name)
        .await
        .map_err(|_e| CommandError::Io("Failed to create folder".to_string()))
}

#[tauri::command]
pub async fn delete_folder(
    folder_id: String,
    provider_name: Option<String>,
    state: State<'_, StorageState>,
) -> Result<(), CommandError> {
    state
        .manager
        .delete_folder(folder_id, provider_name)
        .await
        .map_err(|_e| CommandError::Io("Failed to delete folder".to_string()))?;
    Ok(())
}

#[tauri::command]
pub async fn get_file_info(
    file_id: String,
    provider_name: Option<String>,
    state: State<'_, StorageState>,
) -> Result<StorageFile, CommandError> {
    state
        .manager
        .get_file_info(file_id, provider_name)
        .await
        .map_err(|_e| CommandError::Io("Failed to get file info".to_string()))
}

#[tauri::command]
pub async fn search_files(
    query: String,
    provider_name: Option<String>,
    state: State<'_, StorageState>,
) -> Result<Vec<StorageFile>, CommandError> {
    state
        .manager
        .search_files(query, provider_name)
        .await
        .map_err(|_e| CommandError::Io("Failed to search files".to_string()))
}

#[tauri::command]
pub async fn list_vaults(
    provider_name: Option<String>,
    state: State<'_, StorageState>,
) -> Result<Vec<StorageFile>, CommandError> {
    state
        .manager
        .list_vaults(provider_name)
        .await
        .map_err(|_e| CommandError::Io("Failed to list vaults".to_string()))
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
    // Get the provider config
    let config = state.manager.get_config().await;
    let provider_config = config
        .get_provider_config(&provider_name)
        .ok_or_else(|| CommandError::Io("Provider not found".to_string()))?;

    match provider_config {
        ProviderConfig::GoogleDrive { config: gd_config } => {
            // Generate a random state for CSRF protection
            let oauth_state = format!("{}", uuid::Uuid::new_v4());

            // Generate PKCE pair
            let (code_verifier, code_challenge) = generate_pkce_pair();

            // Store state with code_verifier for later validation (5-min expiry)
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
            let scopes = "https://www.googleapis.com/auth/drive.file";
            // Only force consent prompt when we don't already have a refresh token,
            // so re-auth doesn't discard the existing one.
            let prompt_param = if gd_config.refresh_token.is_none() {
                "&prompt=consent"
            } else {
                ""
            };

            let auth_url = format!(
                "https://accounts.google.com/o/oauth2/v2/auth?client_id={}&redirect_uri={}&response_type=code&scope={}&access_type=offline&state={}&code_challenge={}&code_challenge_method=S256{}",
                urlencoding::encode(&gd_config.client_id),
                urlencoding::encode(&gd_config.redirect_uri),
                urlencoding::encode(scopes),
                oauth_state,
                code_challenge,
                prompt_param,
            );

            Ok(OAuthUrlResponse {
                url: auth_url,
                state: oauth_state,
            })
        }
        _ => Err(CommandError::Io("Provider is not Google Drive".to_string())),
    }
}

#[derive(Debug, Serialize, Deserialize)]
pub struct OAuthCallbackRequest {
    pub provider_name: String,
    pub code: String,
    pub state: String,
}

/// Tokens returned by Google's OAuth token endpoint.
#[derive(Debug, Clone, PartialEq, Eq)]
struct GoogleDriveTokens {
    access_token: String,
    refresh_token: Option<String>,
    expires_in: u64,
}

/// Map a non-2xx token-endpoint response to an [`AuthFailureClass`].
///
/// Google signals the class through the HTTP status and the error body, so both
/// are used:
/// * `400` with `invalid_grant`/`invalid_client` → [`AuthFailureClass::AuthRejection`]:
///   the authorization code (or client) was refused and retrying cannot help;
/// * `401`/`403` → [`AuthFailureClass::AuthRejection`]: credentials refused;
/// * `408`/`429`/`5xx` → [`AuthFailureClass::Transient`]: timeout, rate limit or a
///   server-side hiccup, safe to retry;
/// * anything else → [`AuthFailureClass::Other`]: an unrecognised status that we
///   neither know to be retryable nor to be a credential rejection.
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

/// Exchange an authorization code for tokens (PKCE).
///
/// Errors are classified per the [`AuthFailureClass`] contract:
/// * a request error without an HTTP response (DNS, connect, timeout) and
///   `408`/`429`/`5xx` → `Transient`;
/// * `400` + `invalid_grant`/`invalid_client` and `401`/`403` → `AuthRejection`;
/// * other non-2xx statuses and a malformed 2xx body → `Other`.
///
/// The Google error body is appended (sanitized) as the *cause* only for
/// `AuthRejection`, where it is genuinely useful (`invalid_grant`/`invalid_client`)
/// and where the frontend rule it feeds has the highest precedence. For `Transient`
/// and `Other` only the status code is kept: an arbitrary upstream body — an HTML
/// error page from a proxy/gateway, a `text/html` 5xx — could otherwise smuggle an
/// `authentication`/`unauthorized` keyword into a message the frontend reads as
/// `AUTHENTICATION_FAILED` (terminal) and burn the pending OAuth state, killing the
/// retry this class promises (review finding MAJOR-1). [`AuthFailureClass::message`]
/// redacts such keywords anyway; keeping the body out is the belt to that brace.
///
/// The request-side secrets (`code`, `code_verifier`, `client_secret`) are never
/// echoed into the message.
async fn exchange_google_drive_code(
    client: &reqwest::Client,
    token_url: &str,
    gd_config: &GoogleDriveConfig,
    redirect_uri: &str,
    code: &str,
    code_verifier: &str,
) -> Result<GoogleDriveTokens, ClassifiedAuthError> {
    #[derive(Deserialize)]
    struct TokenResponse {
        access_token: String,
        refresh_token: Option<String>,
        expires_in: u64,
    }

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
        // Classification always sees the FULL body (`invalid_grant` could sit
        // anywhere in it); only the human-readable cause is bounded (review
        // finding m1: an unbounded upstream body used to be embedded verbatim).
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

    let token_response: TokenResponse = response.json().await.map_err(|e| {
        ClassifiedAuthError::new(
            AuthFailureClass::Other,
            "parsing the Google Drive token response",
            &e.to_string(),
        )
    })?;

    Ok(GoogleDriveTokens {
        access_token: token_response.access_token,
        refresh_token: token_response.refresh_token,
        expires_in: token_response.expires_in,
    })
}

/// Inner OAuth flow: validate the state, exchange the code, persist the tokens.
///
/// Returns the classified failure so the caller can apply the state lifecycle.
async fn run_google_drive_oauth(
    manager: &StorageManager,
    request: &OAuthCallbackRequest,
    token_url: &str,
) -> Result<(), ClassifiedAuthError> {
    // Validate the state up-front but *without* consuming it (see
    // `complete_google_drive_oauth` for the lifecycle).
    let code_verifier = peek_oauth_state(&request.state)?;

    // Resolve the provider config. A missing/foreign provider is a precondition
    // failure, not a credential rejection: report it as `Other` (terminal).
    let config = manager.get_config().await;
    let provider_config = config
        .get_provider_config(&request.provider_name)
        .ok_or_else(|| {
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

    // Persist the new tokens.
    let new_config = GoogleDriveConfig {
        client_id: gd_config.client_id,
        client_secret: gd_config.client_secret,
        redirect_uri,
        access_token: Some(tokens.access_token),
        refresh_token: tokens.refresh_token.or(gd_config.refresh_token),
        token_expires_at: Some(Utc::now() + chrono::Duration::seconds(tokens.expires_in as i64)),
    };

    manager
        .update_google_drive_config(&request.provider_name, new_config)
        .await
        .map_err(|e| token_persistence_failure(&e))?;

    Ok(())
}

/// Classify a failure to persist the tokens of a **successful** exchange.
///
/// The exchange already happened, so Google consumed the single-use authorization
/// code: replaying the same callback can only be refused with `invalid_grant`. The
/// failure is thus **terminal for the state** (`keep_state == false`) even though
/// the underlying problem (config write, OS keychain) is a local, retryable-looking
/// IO failure — which is why the lifecycle cannot be derived from the class alone
/// (review finding MAJOR-2).
///
/// * class: `Other` — the credentials were *accepted*, so this is neither an
///   `AuthRejection` (the frontend would claim "authentication failed" for something
///   that succeeded) nor a `Transient` (the frontend would offer "check your
///   connection and retry" for a retry that is guaranteed to fail).
/// * message: keyword-free by construction (`OPERATION_FAILED`, a terminal bucket
///   in `src/services/deepLinkService.ts`) and honest about the remediation — the
///   tokens are lost, so the user has to sign in again.
///
/// `authentication` was deliberately *not* embedded: it would map the failure to
/// `AUTHENTICATION_FAILED`, whose re-login wording the message already carries,
/// while breaking the one-keyword-per-class invariant of
/// [`AuthFailureClass`] for no behavioural gain (`deepLinkService` and
/// `AddVaultForm.classifyRefreshFailure` treat every terminal bucket alike).
fn token_persistence_failure(error: &StorageError) -> ClassifiedAuthError {
    ClassifiedAuthError::terminal(
        AuthFailureClass::Other,
        "saving the Google Drive tokens that Google already issued",
        &format!(
            "the tokens were obtained but could not be persisted; please sign in again ({error})"
        ),
    )
}

/// Apply the OAuth-state lifecycle of a failed callback attempt.
///
/// Only a failure flagged [`ClassifiedAuthError::keep_state`] leaves the
/// single-use state in place for a retry.
fn apply_failed_oauth_state_lifecycle(state: &str, failure: &ClassifiedAuthError) {
    if !failure.keep_state {
        consume_oauth_state(state);
    }
}

/// Complete the Google Drive OAuth callback (CSRF/PKCE protected).
///
/// # OAuth state lifecycle
///
/// The pending state is validated but **not consumed** up-front; it is dropped
/// only once the flow reaches a terminal outcome, which is decided by
/// [`ClassifiedAuthError::keep_state`] and *not* by the class alone:
/// * **success** → consumed (the state is single-use);
/// * a failure with `keep_state == false` → consumed. That covers
///   `AuthRejection` (retrying the same code is pointless: Google already refused
///   it), `Other` (terminal, conservative) and the *terminal-but-transient-looking*
///   "tokens obtained but not persisted" failure ([`token_persistence_failure`]);
/// * a failure with `keep_state == true` (a plain `Transient` one) → **kept**, so
///   the frontend can retry the very same callback — e.g. after a DNS/timeout
///   failure of the token POST — without receiving "Invalid or expired OAuth
///   state".
///
/// The entry's original [`OAUTH_STATE_EXPIRY`] window is *not* extended by a
/// retry: a retried callback must still arrive before the original deadline.
///
/// # Failure *after* a successful exchange
///
/// If Google accepted the code and minted tokens but persisting them fails
/// (config write / OS keychain), the flow is reported by
/// [`token_persistence_failure`]: class `Other` (keyword-free ⇒ the frontend's
/// terminal `OPERATION_FAILED` bucket) and terminal for the state. Offering the
/// retry the `Transient` class implies would be a lie — the authorization code is
/// single-use, so the retry is refused by Google with `invalid_grant` — hence the
/// explicit `keep_state == false` instead of deriving the lifecycle from the class.
#[tauri::command]
pub async fn handle_google_drive_oauth_callback(
    request: OAuthCallbackRequest,
    state: State<'_, StorageState>,
) -> Result<(), CommandError> {
    complete_google_drive_oauth(&state.manager, &request, GOOGLE_DRIVE_TOKEN_ENDPOINT).await
}

/// Core of [`handle_google_drive_oauth_callback`], split out of the Tauri command
/// so it can be exercised without a `State<StorageState>`.
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

#[derive(Debug, Serialize, Deserialize)]
pub struct ProviderAuthInfo {
    pub authenticated: bool,
    pub token_expires_at: Option<DateTime<Utc>>,
}

#[tauri::command]
pub async fn get_provider_auth_info(
    provider_name: String,
    state: State<'_, StorageState>,
) -> Result<ProviderAuthInfo, CommandError> {
    let (authenticated, token_expires_at) = state
        .manager
        .get_provider_auth_info(&provider_name)
        .await
        .map_err(|_e| CommandError::Io("Failed to get provider auth info".to_string()))?;

    Ok(ProviderAuthInfo {
        authenticated,
        token_expires_at,
    })
}

/// Extract the HTTP status embedded in a token-refresh error message.
///
/// `GoogleDriveProvider::refresh_access_token{,_for_config}` reports a non-2xx
/// response as `"Failed to refresh access token (<status> <reason>): <body>"`, so
/// the failure's status survives *inside* the message even though the
/// [`StorageError`] variant is collapsed to `Authentication` for every
/// non-`invalid_grant` case. Returns `None` when the message carries no status
/// (e.g. Google's dedicated `invalid_grant` wording, or "No refresh token
/// available").
fn parse_refresh_error_status(message: &str) -> Option<u16> {
    let rest = &message[message.find('(')? + 1..];
    let digits: String = rest.chars().take_while(char::is_ascii_digit).collect();
    if digits.len() == 3 {
        digits.parse().ok()
    } else {
        None
    }
}

/// Whether an HTTP status is a transient (retryable) condition.
fn is_transient_status(status: u16) -> bool {
    matches!(status, 408 | 429) || (500..600).contains(&status)
}

/// Drop the upstream error *body* from a provider refresh message.
///
/// `GoogleDriveProvider::refresh_access_token{,_for_config}` formats a non-2xx
/// response as `"Failed to refresh access token (<status> <reason>): <body>"`;
/// only the `(<status> <reason>)` prefix is kept. The body is an arbitrary upstream
/// payload (a proxy/gateway HTML page, for instance) which must not reach a message
/// the frontend classifies by keyword (review finding MAJOR-1). Returns the input
/// unchanged when it carries no `(...)` part.
fn strip_refresh_error_body(message: &str) -> &str {
    match message.find(')') {
        Some(end) => &message[..=end],
        None => message,
    }
}

/// Bound an upstream response body before embedding it in an error cause.
///
/// Returns the body unchanged when it already fits in
/// [`MAX_ERROR_BODY_CAUSE_CHARS`] characters; otherwise its first
/// `MAX_ERROR_BODY_CAUSE_CHARS` characters plus a `…`. The truncation is done on
/// `char`s (not bytes) so a multi-byte code point is never split.
///
/// This bounds the INTERMEDIATE cause string that is formatted into
/// `ClassifiedAuthError`/`StorageError::Authentication` (and copied by error
/// logging): defence in depth so a multi-MB proxy page is never copied or
/// scanned wholesale on the error path. It is NOT the final IPC bound — the
/// observable message is bounded separately by `sanitize_error_cause`
/// (`MAX_ERROR_CAUSE_LEN`), which runs before redaction. The intermediate bound
/// is pinned directly by the `bounded_error_body_*` unit tests (it is not
/// observable through the classified message, because sanitisation runs first).
fn bounded_error_body(body: &str) -> String {
    if body.chars().count() <= MAX_ERROR_BODY_CAUSE_CHARS {
        return body.to_string();
    }
    let head: String = body.chars().take(MAX_ERROR_BODY_CAUSE_CHARS).collect();
    format!("{head}…")
}

/// Pins the INTERMEDIATE cause bound (see [`bounded_error_body`]'s doc: this
/// bound is not observable through the classified message, because
/// `sanitize_error_cause` truncates first — so it needs its own tests).
#[cfg(test)]
mod bounded_error_body_tests {
    use super::{bounded_error_body, MAX_ERROR_BODY_CAUSE_CHARS};

    #[test]
    fn short_input_is_returned_unchanged() {
        assert_eq!(bounded_error_body(""), "");
        assert_eq!(bounded_error_body("small body"), "small body");
    }

    #[test]
    fn input_exactly_at_the_bound_is_returned_unchanged() {
        let body = "x".repeat(MAX_ERROR_BODY_CAUSE_CHARS);
        assert_eq!(bounded_error_body(&body), body);
    }

    #[test]
    fn longer_input_is_truncated_to_the_bound_plus_ellipsis() {
        let body = "x".repeat(MAX_ERROR_BODY_CAUSE_CHARS + 500);
        let bounded = bounded_error_body(&body);
        assert_eq!(bounded.chars().count(), MAX_ERROR_BODY_CAUSE_CHARS + 1);
        assert!(bounded.ends_with('…'));
    }

    #[test]
    fn a_multi_byte_char_at_the_cut_point_is_never_split() {
        // `é` is 2 bytes but 1 char: the cut lands right after it, and the
        // char-based slice must keep it whole (no byte split, no U+FFFD).
        let prefix = "e".repeat(MAX_ERROR_BODY_CAUSE_CHARS - 1);
        let body = format!("{prefix}ééé tail");
        let bounded = bounded_error_body(&body);
        assert_eq!(bounded.chars().count(), MAX_ERROR_BODY_CAUSE_CHARS + 1);
        assert!(bounded.ends_with('…'));
        assert!(bounded.contains('é'));
        assert!(!bounded.contains('\u{FFFD}'));
    }
}

/// Classify a token-refresh failure into the [`AuthFailureClass`] contract.
///
/// The refresh reaches Google through `ensure_google_drive_token_valid` →
/// `GoogleDriveProvider::refresh_access_token_for_config`, which already
/// distinguishes the raw signals we need, but *not* with a dedicated variant:
/// * `StorageError::Authentication("...invalid or has been revoked. Please
///   re-authenticate.")` is produced for HTTP 400 + `invalid_grant` → the refresh
///   token was revoked → [`AuthFailureClass::AuthRejection`];
/// * the provider collapses **every other** non-2xx failure to
///   `StorageError::Authentication("Failed to refresh access token (<status> ...)")`
///   — including a 5xx after the retry budget is exhausted — so the variant alone
///   cannot tell a rejection from a transient server error. The embedded status
///   is parsed back out of the message by [`parse_refresh_error_status`]:
///   408/429/5xx → `Transient` (with the upstream body dropped by
///   [`strip_refresh_error_body`]), anything else → `AuthRejection`;
/// * `StorageError::Network(_)` (request error / unparseable 2xx body),
///   `StorageError::Io`/`Keychain`/`Serialization` (persisting the refreshed
///   tokens) → `Transient`;
/// * anything else (provider not configured, unsupported provider, …) → `Other`.
///
/// Whatever cannot be positively identified as transient defaults to
/// `AuthRejection` — the conservative choice for the user (rather re-login than
/// loop on an error that will never resolve).
///
/// A *refresh* that fails while persisting the freshly rotated tokens stays
/// `Transient`, unlike the token *exchange* path: the refresh token is unchanged
/// (or was already replaced with a still-valid one), so the next refresh attempt is
/// legitimate, whereas an authorization code is single-use.
pub(crate) fn classify_refresh_failure(error: StorageError) -> CommandError {
    const CONTEXT: &str = "refreshing the Google Drive access token";

    match &error {
        // Persisting the refreshed tokens failed: retryable IO/keychain problem.
        // The wording must name the real cause (a *local* storage failure, not a
        // network one) while keeping the `network` keyword the frontend routes
        // on — `network or local storage error while …` still maps to
        // `NETWORK_ERROR`/`transient` (review finding m4).
        StorageError::Io(_) | StorageError::Keychain(_) | StorageError::Serialization(_) => {
            AuthFailureClass::Transient
                .into_command_error_local_storage(CONTEXT, &error.to_string())
        }
        // Request-level failure (DNS/connect/timeout) or unparseable token body.
        StorageError::Network(_) => {
            AuthFailureClass::Transient.into_command_error(CONTEXT, &error.to_string())
        }
        StorageError::Authentication(message) => match parse_refresh_error_status(message) {
            Some(status) if is_transient_status(status) => AuthFailureClass::Transient
                .into_command_error(CONTEXT, strip_refresh_error_body(message)),
            // `invalid_grant`, an unknown-but-statusful rejection, or a local
            // "No refresh token available": all terminal, all need a re-login.
            _ => AuthFailureClass::AuthRejection.into_command_error(CONTEXT, message),
        },
        // Misconfiguration / broken invariant: terminal without any keyword.
        _ => AuthFailureClass::Other.into_command_error(CONTEXT, &error.to_string()),
    }
}

#[tauri::command]
pub async fn refresh_provider_auth(
    provider_name: String,
    state: State<'_, StorageState>,
) -> Result<ProviderAuthInfo, CommandError> {
    // Ensure token is valid (will refresh if needed)
    let updated_config = state
        .manager
        .ensure_google_drive_token_valid(&provider_name)
        .await
        .map_err(classify_refresh_failure)?;

    Ok(ProviderAuthInfo {
        authenticated: true,
        token_expires_at: updated_config.token_expires_at,
    })
}

#[tauri::command]
pub async fn test_webdav_connection(
    server_url: String,
    username: String,
    password: String,
    base_path: String,
) -> Result<bool, CommandError> {
    use crate::storage::providers::webdav::{WebDavConfig, WebDavProvider};
    use crate::storage::StorageProvider;
    let config = WebDavConfig {
        server_url,
        username,
        password,
        base_path,
    };
    let mut provider = WebDavProvider::new(config);
    match provider.authenticate().await {
        Ok(()) => Ok(true),
        Err(_e) => Err(CommandError::Io("WebDAV connection failed".to_string())),
    }
}
#[cfg(test)]
mod auth_status_tests {
    use super::provider_config_is_authenticated;
    use crate::storage::providers::google_drive::GoogleDriveConfig;
    use crate::storage::providers::webdav::WebDavConfig;
    use crate::storage::ProviderConfig;
    use chrono::{Duration, Utc};

    fn google_drive_config(
        access_token: Option<&str>,
        refresh_token: Option<&str>,
    ) -> GoogleDriveConfig {
        GoogleDriveConfig {
            client_id: "client_id".to_string(),
            client_secret: "client_secret".to_string(),
            redirect_uri: "http://localhost/callback".to_string(),
            access_token: access_token.map(str::to_string),
            refresh_token: refresh_token.map(str::to_string),
            // Always already expired: the point of these tests is that the
            // access token TTL must not decide the auth status.
            token_expires_at: Some(Utc::now() - Duration::minutes(10)),
        }
    }

    fn webdav_config(username: &str, password: &str) -> WebDavConfig {
        WebDavConfig {
            server_url: "https://example.com".to_string(),
            username: username.to_string(),
            password: password.to_string(),
            base_path: "/".to_string(),
        }
    }

    #[test]
    fn google_drive_with_expired_access_token_and_refresh_token_is_authenticated() {
        let provider_config = ProviderConfig::GoogleDrive {
            config: google_drive_config(Some("expired_access"), Some("refresh_token")),
        };

        assert!(
            provider_config_is_authenticated(&provider_config),
            "an expired access token with a refresh token only needs a silent refresh"
        );
    }

    #[test]
    fn google_drive_with_only_refresh_token_is_authenticated() {
        let provider_config = ProviderConfig::GoogleDrive {
            config: google_drive_config(None, Some("refresh_token")),
        };

        assert!(provider_config_is_authenticated(&provider_config));
    }

    #[test]
    fn google_drive_without_any_credentials_is_not_authenticated() {
        let provider_config = ProviderConfig::GoogleDrive {
            config: google_drive_config(None, None),
        };

        assert!(!provider_config_is_authenticated(&provider_config));
    }

    #[test]
    fn google_drive_with_expired_access_token_and_no_refresh_token_is_not_authenticated() {
        let provider_config = ProviderConfig::GoogleDrive {
            config: google_drive_config(Some("expired_access"), None),
        };

        assert!(!provider_config_is_authenticated(&provider_config));
    }

    #[test]
    fn webdav_requires_both_username_and_password() {
        assert!(provider_config_is_authenticated(&ProviderConfig::WebDav {
            config: webdav_config("user", "pass"),
        }));
        assert!(!provider_config_is_authenticated(&ProviderConfig::WebDav {
            config: webdav_config("user", ""),
        }));
    }

    #[test]
    fn local_provider_is_always_authenticated() {
        assert!(provider_config_is_authenticated(&ProviderConfig::Local {
            base_path: "/tmp".to_string(),
        }));
    }
}
/// Tests for the Google Drive OAuth callback command
/// (`handle_google_drive_oauth_callback` / `refresh_provider_auth`).
///
/// They assert the three things the frontend depends on:
/// * the **message contract** (`commands::errors::AuthFailureClass`),
/// * the **OAuth state lifecycle** (kept on a retryable failure, consumed on a
///   terminal outcome — including terminal failures whose class looks retryable), and
/// * the **keyword isolation** of the messages: an arbitrary upstream body must not
///   be able to re-classify a failure.
#[cfg(test)]
mod oauth_callback_tests {
    use super::MAX_ERROR_BODY_CAUSE_CHARS;
    use super::{
        apply_failed_oauth_state_lifecycle, classify_refresh_failure, complete_google_drive_oauth,
        oauth_state_store, parse_refresh_error_status, peek_oauth_state, strip_refresh_error_body,
        token_persistence_failure, ClassifiedAuthError, OAuthCallbackRequest, OAuthPendingState,
        OAUTH_STATE_EXPIRY,
    };
    use crate::commands::errors::contract_fixture::{bucket_of, FrontendBucket};
    use crate::commands::errors::{AuthFailureClass, CommandError, MAX_ERROR_CAUSE_LEN};
    use crate::storage::providers::google_drive::GoogleDriveConfig;
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
        use super::classify_token_endpoint_status as classify;
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

    #[test]
    fn parse_refresh_error_status_extracts_the_embedded_http_status() {
        assert_eq!(
            parse_refresh_error_status(
                "Failed to refresh access token (500 Internal Server Error): boom"
            ),
            Some(500)
        );
        assert_eq!(
            parse_refresh_error_status("Failed to refresh access token (429 Too Many Requests)"),
            Some(429)
        );
        // Google's dedicated invalid_grant wording carries no status.
        assert_eq!(
            parse_refresh_error_status(
                "Google Drive refresh token is invalid or has been revoked. Please re-authenticate."
            ),
            None
        );
        assert_eq!(
            parse_refresh_error_status("No refresh token available"),
            None
        );
        // Not a three-digit status.
        assert_eq!(
            parse_refresh_error_status("Failed to refresh access token (9999 weird)"),
            None
        );
    }

    /// The refresh path must not embed the upstream body of a non-2xx response
    /// either: only the `(<status> <reason>)` prefix survives (MAJOR-1).
    #[test]
    fn strip_refresh_error_body_keeps_only_the_status_and_reason() {
        assert_eq!(
            strip_refresh_error_body(
                "Failed to refresh access token (503 Service Unavailable): <html>authentication proxy</html>"
            ),
            "Failed to refresh access token (503 Service Unavailable)"
        );
        // No `(...)` part: the message is returned unchanged.
        assert_eq!(
            strip_refresh_error_body("No refresh token available"),
            "No refresh token available"
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

        // TRANSIENT: a 5xx the provider collapsed to StorageError::Authentication,
        // with an adversarial body that talking about authentication/connection.
        let server_error =
            observable_message(classify_refresh_failure(StorageError::authentication(
                "Failed to refresh access token (503 Service Unavailable): \
                 connection reset, authentication required",
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
        // OTHER: a rejection whose message carries an unparseable status stays
        // terminal rather than being reported as retryable.
        let unparseable_status = observable_message(classify_refresh_failure(
            StorageError::authentication("Failed to refresh access token (9999 weird): boom"),
        ));
        assert_eq!(
            bucket_of(&unparseable_status),
            FrontendBucket::AuthenticationFailed,
            "an unknown status defaults to the conservative terminal bucket, got: {unparseable_status}"
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
            message.chars().count()
                <= template_prefix.chars().count() + MAX_ERROR_CAUSE_LEN + 1,
            "the observable message must stay within the sanitised bound ({} chars)",
            message.chars().count()
        );

        drop_pending_state(state);
        mock.assert_async().await;
    }
}
