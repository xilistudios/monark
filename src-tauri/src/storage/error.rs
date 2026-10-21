use tauri_plugin_http::reqwest;
use thiserror::Error;

#[derive(Error, Debug)]
pub enum StorageError {
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),

    #[error("Serialization error: {0}")]
    Serialization(#[from] serde_json::Error),

    #[error("Authentication error: {0}")]
    Authentication(String),

    #[error("Network error: {0}")]
    Network(String),

    #[error("File not found: {0}")]
    FileNotFound(String),

    #[error("Permission denied: {0}")]
    PermissionDenied(String),

    #[error("Quota exceeded: {0}")]
    QuotaExceeded(String),

    #[error("Invalid configuration: {0}")]
    InvalidConfiguration(String),

    #[error("Provider not supported: {0}")]
    ProviderNotSupported(String),

    #[error("Operation failed: {0}")]
    OperationFailed(String),

    #[error("Keychain error: {0}")]
    Keychain(String),

    /// Non-2xx token-endpoint response, carried structurally: the command layer
    /// must never parse the status back out of a message again (issue #28, D3).
    ///
    /// `status_line` is [`reqwest::StatusCode`]'s `Display` (e.g.
    /// `"503 Service Unavailable"`); it and `status` are both filled from the
    /// same `StatusCode` by [`StorageError::http_status`] so they cannot
    /// disagree. `body` is the raw upstream payload, kept verbatim (including
    /// any adversarial keyword) so the command layer can decide per-status
    /// whether to drop it — that decision belongs to classification, not to
    /// message surgery.
    ///
    /// `StorageError`'s [`std::fmt::Display`] is log-only (no `impl
    /// From<StorageError>` exists, and every storage command discards the error
    /// before it reaches IPC), so this variant must never be interpolated into
    /// a classified message: [`crate::commands::storage::classify_refresh_failure`]
    /// renders the observable wording itself.
    #[error("HTTP status error: {status_line}: {body}")]
    HttpStatus {
        status: u16,
        status_line: String,
        body: String,
    },
}

impl StorageError {
    pub fn authentication(msg: impl Into<String>) -> Self {
        Self::Authentication(msg.into())
    }

    pub fn network(msg: impl Into<String>) -> Self {
        Self::Network(msg.into())
    }

    pub fn file_not_found(path: impl Into<String>) -> Self {
        Self::FileNotFound(path.into())
    }

    pub fn permission_denied(msg: impl Into<String>) -> Self {
        Self::PermissionDenied(msg.into())
    }

    pub fn quota_exceeded(msg: impl Into<String>) -> Self {
        Self::QuotaExceeded(msg.into())
    }

    pub fn invalid_configuration(msg: impl Into<String>) -> Self {
        Self::InvalidConfiguration(msg.into())
    }

    pub fn provider_not_supported(provider: impl Into<String>) -> Self {
        Self::ProviderNotSupported(provider.into())
    }

    pub fn operation_failed(msg: impl Into<String>) -> Self {
        Self::OperationFailed(msg.into())
    }

    pub fn keychain(msg: impl Into<String>) -> Self {
        Self::Keychain(msg.into())
    }

    /// Build a [`StorageError::HttpStatus`] from the single `reqwest::StatusCode`
    /// of a non-2xx response, so `status` and `status_line` can never disagree
    /// (issue #28, D3).
    ///
    /// `status_line` is [`reqwest::StatusCode`]'s `Display` (e.g.
    /// `"503 Service Unavailable"`); `body` is the raw upstream payload.
    ///
    /// Takes the **`tauri_plugin_http` re-export (reqwest 0.12)** `StatusCode`
    /// on purpose: the only producers (`providers/google_drive.rs`) speak 0.12.
    /// The crate's direct `reqwest` is 0.11 and its `StatusCode` is a different
    /// type (it would not compile at those call sites).
    pub fn http_status(status: reqwest::StatusCode, body: impl Into<String>) -> Self {
        Self::HttpStatus {
            status: status.as_u16(),
            status_line: status.to_string(),
            body: body.into(),
        }
    }

    /// Whether the error is an offline/credential-class failure for which the
    /// cloud-vault read path falls back to its local cached copy
    /// (`vault/cloud_lifecycle.rs`).
    ///
    /// Kept exhaustive (no wildcard arm) on purpose: adding a variant to
    /// [`StorageError`] forces the author to decide here whether the cache
    /// fallback applies (issue #28 review MAJOR-1 — the typed `HttpStatus`
    /// silently dropped out of the old `matches!` and disabled the fallback).
    pub fn is_offline_or_auth_like(&self) -> bool {
        match self {
            Self::Network(_) | Self::Authentication(_) | Self::HttpStatus { .. } => true,
            Self::Io(_)
            | Self::Serialization(_)
            | Self::FileNotFound(_)
            | Self::PermissionDenied(_)
            | Self::QuotaExceeded(_)
            | Self::InvalidConfiguration(_)
            | Self::ProviderNotSupported(_)
            | Self::OperationFailed(_)
            | Self::Keychain(_) => false,
        }
    }
}

pub type StorageResult<T> = Result<T, StorageError>;

#[cfg(test)]
mod tests {
    use super::*;

    /// The cloud-vault cache fallback (`vault/cloud_lifecycle.rs`) keys off this
    /// predicate: every refresh-failure shape must stay eligible for the cached
    /// copy, exactly as before the typed signal existed (issue #28 review
    /// MAJOR-1 — `HttpStatus` must not silently drop out of the fallback).
    #[test]
    fn offline_or_auth_like_covers_every_refresh_failure_shape() {
        assert!(StorageError::Network("connect timeout".into()).is_offline_or_auth_like());
        assert!(StorageError::Authentication("invalid_grant".into()).is_offline_or_auth_like());
        assert!(
            StorageError::http_status(reqwest::StatusCode::SERVICE_UNAVAILABLE, "body")
                .is_offline_or_auth_like(),
            "a transient token-endpoint failure must fall back to the cached vault"
        );
        assert!(
            StorageError::http_status(reqwest::StatusCode::BAD_REQUEST, "invalid_client")
                .is_offline_or_auth_like(),
            "a token-endpoint rejection must fall back to the cached vault"
        );
        assert!(!StorageError::Keychain("locked".into()).is_offline_or_auth_like());
        assert!(!StorageError::OperationFailed("nope".into()).is_offline_or_auth_like());
    }
}
