//! Provider authentication status and token-refresh commands.
//!
//! Used to live at the bottom of the monolithic `commands/storage.rs`; it is
//! still exposed as `commands::storage::*` because [`classify_refresh_failure`]
//! is part of the storage-provider contract (it decides the
//! [`AuthFailureClass`] the frontend routes on) and is referenced from
//! `crate::storage::error` and the Google Drive auth tests.

use super::error::is_transient_status;
use super::StorageState;
use crate::commands::errors::{AuthFailureClass, CommandError};
use crate::storage::StorageError;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use tauri::State;

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

/// Classify a token-refresh failure into the [`AuthFailureClass`] contract.
///
/// The refresh reaches Google through `ensure_google_drive_token_valid` →
/// `GoogleDriveProvider::refresh_access_token_for_config`, which now reports the
/// raw signals we need *with dedicated structure*:
/// * `StorageError::Authentication("...invalid or has been revoked. Please
///   re-authenticate.")` is produced for HTTP 400 + `invalid_grant` → the refresh
///   token was revoked → [`AuthFailureClass::AuthRejection`];
/// * `StorageError::HttpStatus { status, status_line, body }` carries any other
///   non-2xx response — including a 5xx after the retry budget is exhausted —
///   with its status *and* body attached as fields, so no message round-trip is
///   involved: 408/429/5xx → `Transient` (with the upstream `body` dropped so an
///   adversarial payload cannot re-classify the message), anything else →
///   `AuthRejection` (body kept);
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
        StorageError::Io(_) | StorageError::Keychain(_) | StorageError::Serialization(_) => {
            AuthFailureClass::Transient
                .into_command_error_local_storage(CONTEXT, &error.to_string())
        }
        StorageError::Network(_) => {
            AuthFailureClass::Transient.into_command_error(CONTEXT, &error.to_string())
        }

        StorageError::HttpStatus {
            status_line,
            body,
            status,
        } => {
            if is_transient_status(*status) {
                AuthFailureClass::Transient.into_command_error(
                    CONTEXT,
                    &format!("Failed to refresh access token ({status_line})"),
                )
            } else {
                AuthFailureClass::AuthRejection.into_command_error(
                    CONTEXT,
                    &format!("Failed to refresh access token ({status_line}): {body}"),
                )
            }
        }
        StorageError::Authentication(message) => {
            AuthFailureClass::AuthRejection.into_command_error(CONTEXT, message)
        }
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
