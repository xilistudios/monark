use crate::crypto::error::CryptoError;
use crate::io::error::IoError;
use base64::DecodeError;
use serde::Serialize;
use thiserror::Error;
// Define Error types
#[derive(Error, Debug, Serialize)]
pub enum CommandError {
    #[error("IO Error: {0}")]
    Io(String),
    #[error("Crypto Error: {0}")]
    Crypto(String),
    #[error("Serialization Error: {0}")]
    Serialization(String),
    #[error("State Error: {0}")]
    State(String),
    #[error("Invalid Password or Corrupted Vault")]
    Authentication,
    #[error("Vault Locked")]
    VaultLocked,
    #[error("Vault Already Unlocked")]
    VaultAlreadyUnlocked,
    #[error("Unsupported Vault Version: {0}")]
    UnsupportedVersion(String),
    #[error("Not Found: {0}")]
    NotFound(String),
    #[error("Validation Error: {0}")]
    Validation(String),
    #[error("Base64 Decode Error: {0}")]
    Base64Decode(String),
    #[error("Invalid Group ID provided")]
    InvalidGroupId,
    #[error("Internal Error: {0}")]
    Internal(String),
}

// Implement conversions from underlying errors
impl From<IoError> for CommandError {
    fn from(_err: IoError) -> Self {
        CommandError::Io("IO operation failed".to_string())
    }
}

impl From<CryptoError> for CommandError {
    fn from(err: CryptoError) -> Self {
        CommandError::Crypto(err.to_string())
    }
}

impl From<serde_json::Error> for CommandError {
    fn from(_err: serde_json::Error) -> Self {
        CommandError::Serialization("Serialization failed".to_string())
    }
}

impl From<DecodeError> for CommandError {
    fn from(_err: DecodeError) -> Self {
        CommandError::Base64Decode("Base64 decode failed".to_string())
    }
}

// Result type alias for commands
pub type CommandResult<T> = Result<T, CommandError>;

/// Longest slice of an upstream error kept as the `cause` of a classified error.
const MAX_ERROR_CAUSE_LEN: usize = 240;

/// What replaces a routing keyword found in an upstream `cause`.
const REDACTION_PLACEHOLDER: &str = "[redacted]";

/// Every word that makes `CloudStorageCommands.handleError`
/// (`src/services/cloudStorage.ts`) divert a message to a `CloudStorageErrorType`
/// other than the one the message's [`AuthFailureClass`] stands for.
///
/// * `expired` and `configured` are listed on their own because the frontend
///   trips `TOKEN_EXPIRED` (`token` **and** `expired`) and
///   `PROVIDER_NOT_CONFIGURED` (`provider` **and** `configured`) on a *pair* of
///   words: redacting one half is enough to keep the pair inert, and the other
///   halves (`token`, `provider`) legitimately appear in the message templates of
///   this crate (`refreshing the Google Drive access token`, …).
/// * All entries are lowercase and are matched **case-insensitively**. The
///   frontend's own `includes` calls are case-sensitive, so redacting the
///   capitalised variants (`Storage`, `Permission denied`) as well makes the class
///   of a message independent of the casing of whatever upstream body produced it.
/// * `authentication`/`unauthorized` and `network`/`connection` are the keywords of
///   the two classified classes themselves; the remaining entries belong to the
///   frontend's *unclassified* buckets (`QUOTA_EXCEEDED`, `VAULT_NOT_FOUND`,
///   `PERMISSION_DENIED`, `PROVIDER_NOT_CONFIGURED`, `INVALID_CREDENTIALS`).
const ROUTING_KEYWORDS: &[&str] = &[
    "authentication",
    "unauthorized",
    "network",
    "connection",
    "quota",
    "storage",
    "not found",
    "permission",
    "denied",
    "credentials",
    "invalid",
    "expired",
    "configured",
];

/// Semantic class of an authentication failure surfaced to the frontend.
///
/// # Why a *class* and not just an enum variant
///
/// The Tauri command layer reports failures as [`CommandError`], but the
/// frontend does **not** switch on the variant: `CloudStorageCommands.handleError`
/// (`src/services/cloudStorage.ts`) classifies an error by keyword-matching its
/// *message string*. The observable contract of the Google Drive commands is
/// therefore the message text, and this type is the single place where that text
/// and the class it stands for are defined together, so they cannot drift apart.
///
/// | class           | message contains                     | frontend `CloudStorageErrorType` | semantics                                                             |
/// |-----------------|--------------------------------------|----------------------------------|-----------------------------------------------------------------------|
/// | `AuthRejection` | `authentication` (or `unauthorized`) | `AUTHENTICATION_FAILED`          | terminal: the credentials were refused, the user must re-login        |
/// | `Transient`     | `network` or `connection`            | `NETWORK_ERROR`                  | retryable: network/timeout/5xx/IO, the same request may be retried    |
/// | `Other`         | none of the [`ROUTING_KEYWORDS`]     | `OPERATION_FAILED`               | anything else (malformed JSON, broken invariants, misconfiguration); the frontend treats it as a conservative terminal failure |
///
/// The keywords are deliberately **lowercase**: the frontend match is
/// case-sensitive and only knows the lowercase forms. `AuthRejection` additionally
/// embeds `re-authenticate`, which the secondary classifier in
/// `src/services/vault.ts` (`isAuthRelatedCloudError`) keys on.
///
/// # The keyword invariant
///
/// [`message`](AuthFailureClass::message) renders a message that contains the
/// keywords of **its** class and of no other class:
///
/// * the message template always carries the class' own keyword (`authentication`
///   for `AuthRejection`, `network` for `Transient`, nothing for `Other`), and
/// * every routing keyword found in the `cause` that could divert the message out
///   of the class' bucket is redacted (see [`redact_routing_keywords`]), so an
///   arbitrary upstream body — a proxy/gateway HTML error page, Google's JSON
///   error — can neither steal the bucket of its own class nor push an `Other`
///   message into a classified one.
///
/// The invariant is therefore a property of *every* message this type produces,
/// whatever the upstream text was; it is verified against adversarial bodies by
/// `auth_failure_class_tests::adversarial_upstream_bodies_cannot_change_the_class`.
///
/// # Lifecycle
///
/// How long a pending OAuth `state` survives a failure is *not* derivable from
/// this class alone: `commands::storage::ClassifiedAuthError` pairs the class with
/// an explicit `keep_state` flag, because a failure can be terminal (`Other`) even
/// when the underlying problem looks retryable (tokens obtained but not persisted).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AuthFailureClass {
    /// Google refused the credentials: HTTP 400 with `invalid_grant`/`invalid_client`,
    /// HTTP 401/403, or an explicitly revoked refresh token. Terminal — retrying the
    /// very same request cannot succeed, the user has to authenticate again.
    AuthRejection,
    /// A retryable failure: request error without an HTTP response (DNS, connect,
    /// timeout), HTTP 408/429/5xx, or an IO/keychain failure while persisting the
    /// tokens of a *refresh*. The same request may be retried.
    Transient,
    /// Anything that is neither a rejection nor clearly transient: malformed JSON,
    /// broken invariants, misconfiguration, or a failure that is terminal for
    /// another reason (the tokens were obtained but could not be saved). Reported
    /// without any classification keyword so the frontend falls back to its
    /// conservative terminal bucket.
    Other,
}

impl AuthFailureClass {
    /// Render the user-visible message for this class.
    ///
    /// The message always carries the class keyword (except for [`Other`]), the
    /// human-readable `context` of the failing step, and the sanitized `cause`.
    ///
    /// [`Other`]: AuthFailureClass::Other
    pub fn message(self, context: &str, cause: &str) -> String {
        let cause = sanitize_error_cause(self, cause);
        match self {
            AuthFailureClass::AuthRejection => {
                format!("authentication failed while {context} (re-authenticate): {cause}")
            }
            AuthFailureClass::Transient => {
                format!("network error while {context}: {cause}")
            }
            AuthFailureClass::Other => {
                format!("unexpected failure while {context}: {cause}")
            }
        }
    }

    /// Convenience wrapper producing the [`CommandError`] sent over the IPC boundary.
    pub fn into_command_error(self, context: &str, cause: &str) -> CommandError {
        CommandError::Io(self.message(context, cause))
    }

    /// Whether a routing keyword found inside a `cause` has to be redacted.
    ///
    /// The decision is not "keep my own keywords" but "keep the rendered message
    /// inside my frontend bucket", and the frontend evaluates its rules in order:
    ///
    /// * [`AuthRejection`] owns the frontend's *first* rule, so no upstream body
    ///   can steal its bucket. Only the retryable keywords are stripped: a message
    ///   that *looks* retryable would mislead the keyword-based secondary
    ///   classifiers (`vault.ts::isNetworkError`,
    ///   `deepLinkService.classifyOAuthFailure`) that run whenever the
    ///   `CloudStorageError.type` is not available.
    /// * [`Transient`] is only reached when **no earlier** rule matched, and every
    ///   later rule would win over it as well: all keywords except its own divert
    ///   the message, so all of them go.
    /// * [`Other`] maps to `OPERATION_FAILED`, the frontend's fallback, which
    ///   requires that nothing matches at all.
    ///
    /// [`AuthRejection`]: AuthFailureClass::AuthRejection
    /// [`Transient`]: AuthFailureClass::Transient
    /// [`Other`]: AuthFailureClass::Other
    fn must_redact(self, keyword: &str) -> bool {
        match self {
            AuthFailureClass::AuthRejection => matches!(keyword, "network" | "connection"),
            AuthFailureClass::Transient => !matches!(keyword, "network" | "connection"),
            AuthFailureClass::Other => true,
        }
    }
}

/// Replace every [`ROUTING_KEYWORDS`] entry that must not survive in a message of
/// `class` with [`REDACTION_PLACEHOLDER`], ignoring case.
///
/// Scanning is done character by character (not by byte slicing) so multi-byte
/// upstream text cannot be split in the middle of a code point, and multi-word
/// entries (`not found`) are matched like any other keyword.
fn redact_routing_keywords(class: AuthFailureClass, text: &str) -> String {
    let characters: Vec<char> = text.chars().collect();
    let mut redacted = String::with_capacity(text.len());
    let mut index = 0;

    'scan: while index < characters.len() {
        for keyword in ROUTING_KEYWORDS {
            if !class.must_redact(keyword) {
                continue;
            }
            let keyword_chars: Vec<char> = keyword.chars().collect();
            let end = index + keyword_chars.len();
            let matches = end <= characters.len()
                && characters[index..end]
                    .iter()
                    .zip(&keyword_chars)
                    .all(|(found, expected)| found.eq_ignore_ascii_case(expected));

            if matches {
                redacted.push_str(REDACTION_PLACEHOLDER);
                index = end;
                continue 'scan;
            }
        }

        redacted.push(characters[index]);
        index += 1;
    }

    redacted
}

/// Normalise an upstream error `cause` before embedding it in a class message.
///
/// 1. **Collapse** whitespace (error bodies are often multi-line JSON). A keyword
///    that upstream split across lines (`authen\ntication`) is re-joined as two
///    words and can then no longer match — which is safe, because the frontend
///    evaluates the very same collapsed text.
/// 2. **Redact** the routing keywords that do not belong to `class`, so the
///    frontend cannot re-classify the message from an upstream body.
/// 3. **Truncate** to [`MAX_ERROR_CAUSE_LEN`] characters, appending `…` when
///    truncated (after redaction, so a placeholder is never cut in half).
///
/// Callers must only pass upstream/provider error text. Request-side secrets
/// (authorization code, access/refresh tokens, client secret) are never handed to
/// this function and must never be included in a message.
fn sanitize_error_cause(class: AuthFailureClass, cause: &str) -> String {
    let collapsed = cause.split_whitespace().collect::<Vec<_>>().join(" ");
    let redacted = redact_routing_keywords(class, &collapsed);

    if redacted.chars().count() <= MAX_ERROR_CAUSE_LEN {
        redacted
    } else {
        let truncated: String = redacted.chars().take(MAX_ERROR_CAUSE_LEN).collect();
        format!("{truncated}…")
    }
}

/// Keyword replica of `CloudStorageCommands.handleError` for contract tests.
///
/// Compiled only for tests. It lives next to the contract it verifies and is
/// shared with the tests of `commands::storage`, so the replica cannot drift
/// between modules.
#[cfg(test)]
pub(crate) mod contract_fixture {
    /// `CloudStorageErrorType` bucket a message ends up in.
    #[derive(Debug, Clone, Copy, PartialEq, Eq)]
    pub(crate) enum FrontendBucket {
        AuthenticationFailed,
        TokenExpired,
        NetworkError,
        QuotaExceeded,
        VaultNotFound,
        PermissionDenied,
        ProviderNotConfigured,
        InvalidCredentials,
        OperationFailed,
    }

    /// Faithful replica of the precedence-ordered rules of
    /// `CloudStorageCommands.handleError` (`src/services/cloudStorage.ts`):
    /// first match wins, all matches are case-sensitive substrings.
    pub(crate) fn bucket_of(message: &str) -> FrontendBucket {
        if message.contains("authentication") || message.contains("unauthorized") {
            FrontendBucket::AuthenticationFailed
        } else if message.contains("token") && message.contains("expired") {
            FrontendBucket::TokenExpired
        } else if message.contains("network") || message.contains("connection") {
            FrontendBucket::NetworkError
        } else if message.contains("quota") || message.contains("storage") {
            FrontendBucket::QuotaExceeded
        } else if message.contains("not found") {
            FrontendBucket::VaultNotFound
        } else if message.contains("permission") || message.contains("denied") {
            FrontendBucket::PermissionDenied
        } else if message.contains("provider") && message.contains("configured") {
            FrontendBucket::ProviderNotConfigured
        } else if message.contains("credentials") || message.contains("invalid") {
            FrontendBucket::InvalidCredentials
        } else {
            FrontendBucket::OperationFailed
        }
    }
}

#[cfg(test)]
mod auth_failure_class_tests {
    use super::contract_fixture::{bucket_of, FrontendBucket};
    use super::{
        redact_routing_keywords, sanitize_error_cause, AuthFailureClass, CommandError,
        MAX_ERROR_CAUSE_LEN, REDACTION_PLACEHOLDER, ROUTING_KEYWORDS,
    };
    use crate::storage::StorageError;

    /// Context used by the tests: it carries the word `token` on purpose, so the
    /// composite `token … expired` rule of the frontend is exercised.
    const CONTEXT: &str = "refreshing the Google Drive access token";

    /// The message the frontend actually keys on: the inner string of the
    /// serialized `CommandError` (the frontend matches substring against the
    /// JSON-serialized error, where the `Io` payload appears verbatim).
    fn observable_message(error: &CommandError) -> String {
        match error {
            CommandError::Io(message) => message.clone(),
            other => other.to_string(),
        }
    }

    /// Render the message of `class`, as the Google Drive commands do.
    fn message(class: AuthFailureClass, cause: &str) -> String {
        observable_message(&class.into_command_error(CONTEXT, cause))
    }

    /// Bucket every class must keep, whatever the upstream body says.
    fn expected_bucket(class: AuthFailureClass) -> FrontendBucket {
        match class {
            AuthFailureClass::AuthRejection => FrontendBucket::AuthenticationFailed,
            AuthFailureClass::Transient => FrontendBucket::NetworkError,
            AuthFailureClass::Other => FrontendBucket::OperationFailed,
        }
    }

    /// The exact contract consumed by `CloudStorageCommands.handleError`.
    ///
    /// Adversarial upstream bodies (a proxy/gateway HTML page, an OAuth error
    /// JSON, Google's wording) must not change the class: `Transient` has to stay
    /// retryable — the pending OAuth state is only kept for it — and `Other` has to
    /// stay keyword-free.
    #[test]
    fn adversarial_upstream_bodies_cannot_change_the_class() {
        let bodies = [
            r#"{"error":"authentication"}"#,
            r#"{"error":"unauthorized"}"#,
            r#"{"error":"token expired"}"#,
            r#"{"error":"authentication failed: unauthorized, token expired"}"#,
            "<html><body><h1>502 Bad Gateway</h1><p>authentication required</p></body></html>",
            "Unauthorized: token expired, please re-authenticate",
            "File not found: storage quota exceeded for the authenticated user",
            r#"{"error":"invalid_grant"}"#,
            "connection reset by peer through an authentication proxy",
        ];
        let classes = [
            AuthFailureClass::AuthRejection,
            AuthFailureClass::Transient,
            AuthFailureClass::Other,
        ];

        for body in bodies {
            for class in classes {
                let rendered = message(class, body);
                assert_eq!(
                    bucket_of(&rendered),
                    expected_bucket(class),
                    "{class:?} must keep its bucket for the body {body:?}, got: {rendered}"
                );

                match class {
                    // The auth rule is the frontend's first one, so the message may
                    // keep any upstream word except the retryable keywords.
                    AuthFailureClass::AuthRejection => {
                        assert!(
                            rendered.contains("authentication"),
                            "AUTH_REJECTION must map to AUTHENTICATION_FAILED, got: {rendered}"
                        );
                        assert!(
                            !rendered.contains("network") && !rendered.contains("connection"),
                            "AUTH_REJECTION must not look retryable, got: {rendered}"
                        );
                    }
                    // `NETWORK_ERROR` is only reached when nothing else matched.
                    AuthFailureClass::Transient => {
                        assert!(
                            rendered.contains("network"),
                            "TRANSIENT must map to NETWORK_ERROR, got: {rendered}"
                        );
                        assert!(
                            !rendered.contains("authentication")
                                && !rendered.contains("unauthorized"),
                            "TRANSIENT must not look terminal, got: {rendered}"
                        );
                    }
                    // `OPERATION_FAILED` is the fallback: no keyword at all, not even
                    // the halves of the frontend's composite rules.
                    AuthFailureClass::Other => {
                        let lowered = rendered.to_lowercase();
                        for keyword in ROUTING_KEYWORDS {
                            assert!(
                                !lowered.contains(keyword),
                                "OTHER must stay keyword-free but contains {keyword:?}: {rendered}"
                            );
                        }
                    }
                }
            }
        }
    }

    #[test]
    fn auth_rejection_message_carries_the_authentication_keyword() {
        let rendered = observable_message(
            &AuthFailureClass::AuthRejection.into_command_error("refreshing", "invalid_grant"),
        );

        assert!(
            rendered.contains("authentication"),
            "AUTH_REJECTION must map to AUTHENTICATION_FAILED, got: {rendered}"
        );
        assert!(
            rendered.contains("re-authenticate"),
            "AUTH_REJECTION should also satisfy vault.ts's isAuthRelatedCloudError, got: {rendered}"
        );
        // The raw Google error code stays readable for the user.
        assert!(
            rendered.contains("invalid_grant"),
            "the rejection cause must survive verbatim, got: {rendered}"
        );
    }

    #[test]
    fn transient_message_carries_the_network_keyword() {
        let rendered = observable_message(
            &AuthFailureClass::Transient.into_command_error("exchanging", "connection reset"),
        );

        assert!(
            rendered.contains("network") || rendered.contains("connection"),
            "TRANSIENT must map to NETWORK_ERROR, got: {rendered}"
        );
    }

    #[test]
    fn other_message_carries_no_classification_keyword() {
        let rendered = observable_message(
            &AuthFailureClass::Other.into_command_error("parsing", "expected value at column 1"),
        );

        for keyword in ["authentication", "unauthorized", "network", "connection"] {
            assert!(
                !rendered.contains(keyword),
                "OTHER must stay keyword-free but contains {keyword:?}: {rendered}"
            );
        }
        // `token` + `expired` would be routed to TOKEN_EXPIRED by the frontend.
        assert!(
            !(rendered.contains("token") && rendered.contains("expired")),
            "OTHER must not trip the TOKEN_EXPIRED rule: {rendered}"
        );
        assert_eq!(bucket_of(&rendered), FrontendBucket::OperationFailed);
    }

    /// The `Other` row of the contract table must hold for the message text this
    /// crate really produces, not only for hand-written causes: a `StorageError`
    /// (`"File not found: …"`, `"Permission denied: …"`) used to leak into the
    /// frontend's `VAULT_NOT_FOUND` / `PERMISSION_DENIED` buckets while the
    /// documented class said `OPERATION_FAILED` (review finding MINOR-4).
    #[test]
    fn other_row_holds_for_real_storage_error_messages() {
        let causes = [
            StorageError::invalid_configuration("Provider is not Google Drive").to_string(),
            StorageError::file_not_found("/tmp/vault.bin").to_string(),
            StorageError::permission_denied("the keychain is locked").to_string(),
            StorageError::quota_exceeded("daily quota reached").to_string(),
            StorageError::provider_not_supported("webdav").to_string(),
            StorageError::operation_failed("boom").to_string(),
            StorageError::Io(std::io::Error::other("disk on fire")).to_string(),
        ];

        for cause in causes {
            let rendered = message(AuthFailureClass::Other, &cause);
            assert_eq!(
                bucket_of(&rendered),
                FrontendBucket::OperationFailed,
                "an `Other` message built from {cause:?} must stay in OPERATION_FAILED, got: {rendered}"
            );
        }
    }

    #[test]
    fn redaction_is_class_aware_and_case_insensitive() {
        // `Transient` keeps only its own keywords, whatever the casing.
        let transient = redact_routing_keywords(
            AuthFailureClass::Transient,
            "Authentication failed on the connection: File not found, Storage quota exceeded, invalid request",
        );
        assert!(transient.contains("connection"), "{transient}");
        for keyword in ["authentication", "storage", "quota", "not found", "invalid"] {
            assert!(
                !transient.to_lowercase().contains(keyword),
                "{keyword:?} must be redacted: {transient}"
            );
        }

        // `AuthRejection` only drops the retryable keywords, so Google's raw error
        // code survives for the user and for `vault.ts::isAuthRelatedCloudError`.
        assert_eq!(
            redact_routing_keywords(AuthFailureClass::AuthRejection, "invalid_grant"),
            "invalid_grant"
        );
        assert_eq!(
            redact_routing_keywords(AuthFailureClass::AuthRejection, "Connection refused"),
            format!("{REDACTION_PLACEHOLDER} refused")
        );

        // `Other` drops everything, including the words that only matter paired.
        assert_eq!(
            redact_routing_keywords(AuthFailureClass::Other, "permission denied: token expired"),
            format!(
                "{REDACTION_PLACEHOLDER} {REDACTION_PLACEHOLDER}: token {REDACTION_PLACEHOLDER}"
            )
        );

        // Multi-byte text is never split in the middle of a code point.
        assert_eq!(
            redact_routing_keywords(AuthFailureClass::Other, "“网络”"),
            "“网络”"
        );
    }

    #[test]
    fn sanitize_collapses_whitespace_and_truncates_long_causes() {
        assert_eq!(
            sanitize_error_cause(AuthFailureClass::AuthRejection, "  a\n b\tc "),
            "a b c"
        );
        // A keyword split by upstream whitespace collapses into two words, so it
        // cannot match the frontend either (the frontend sees this same text).
        let split = sanitize_error_cause(AuthFailureClass::Other, "authen\ntication pending");
        assert_eq!(split, "authen tication pending");
        assert_eq!(bucket_of(&split), FrontendBucket::OperationFailed);

        let long = "x".repeat(MAX_ERROR_CAUSE_LEN + 50);
        let sanitized = sanitize_error_cause(AuthFailureClass::Transient, &long);
        assert_eq!(sanitized.chars().count(), MAX_ERROR_CAUSE_LEN + 1); // + the ellipsis
        assert!(sanitized.ends_with('…'));

        // Exactly at the limit: untouched, no ellipsis.
        let exact = "y".repeat(MAX_ERROR_CAUSE_LEN);
        assert_eq!(
            sanitize_error_cause(AuthFailureClass::Transient, &exact),
            exact
        );
    }
}
