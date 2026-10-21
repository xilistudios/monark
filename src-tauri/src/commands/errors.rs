use crate::crypto::error::CryptoError;
use crate::io::error::IoError;
use base64::DecodeError;
use serde::Serialize;
use std::sync::OnceLock;
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
pub(crate) const MAX_ERROR_CAUSE_LEN: usize = 240;

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
    /// Both `context` and `cause` go through the routing-keyword redaction of
    /// [`redact_routing_keywords`]: the class invariant ("the message carries the
    /// keywords of its own class and of no other") must hold for *every*
    /// interpolated fragment, not only for the upstream `cause`. A context added
    /// later that happens to contain a routing keyword (e.g.
    /// `"checking whether the token expired"`) would otherwise silently push an
    /// `Other` message into the frontend's `TOKEN_EXPIRED` bucket. All context
    /// strings currently used by this crate are keyword-free (see
    /// `auth_failure_class_tests::every_context_string_used_by_the_crate_is_keyword_free`),
    /// so this defense-in-depth changes no observable message today.
    ///
    /// [`Other`]: AuthFailureClass::Other
    pub fn message(self, context: &str, cause: &str) -> String {
        let context = redact_routing_keywords(self, context);
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

    /// Same as [`into_command_error`](AuthFailureClass::into_command_error) but
    /// naming the *local* nature of the failure in the wording.
    ///
    /// Used by the token-refresh path for failures that are transient and
    /// retryable (`Transient`, so the frontend keeps routing on the `network`
    /// keyword) but that are **not** a network problem: persisting the freshly
    /// rotated tokens can fail on the OS keychain, the config file, or
    /// (de)serialization. The template renders `network or local storage error`
    /// instead of `network error`, so the user is told where to look while the
    /// frontend keyword contract (`network` → `NETWORK_ERROR` / `transient`)
    /// stays intact. The `context` goes through the same keyword redaction as
    /// [`message`](AuthFailureClass::message) (both interpolations must obey the
    /// class invariant).
    pub fn into_command_error_local_storage(self, context: &str, cause: &str) -> CommandError {
        debug_assert_eq!(
            self,
            AuthFailureClass::Transient,
            "the local-storage wording is only defined for Transient"
        );
        let context = redact_routing_keywords(self, context);
        let cause = sanitize_error_cause(self, cause);
        CommandError::Io(format!(
            "network or local storage error while {context}: {cause}"
        ))
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
///
/// The `Vec<char>` of each keyword is materialised **once** per process (in a
/// [`OnceLock`]) instead of once per keyword *per scan position*: with the old
/// per-position allocation a multi-MB body cost tens of millions of allocations
/// (O(len × keywords) `Vec`s), which dominated the sanitizer's runtime (review
/// finding m1).
fn keyword_char_vectors() -> &'static [Vec<char>] {
    static KEYWORD_CHARS: OnceLock<Vec<Vec<char>>> = OnceLock::new();
    KEYWORD_CHARS.get_or_init(|| {
        ROUTING_KEYWORDS
            .iter()
            .map(|keyword| keyword.chars().collect())
            .collect()
    })
}

fn redact_routing_keywords(class: AuthFailureClass, text: &str) -> String {
    let characters: Vec<char> = text.chars().collect();
    let mut redacted = String::with_capacity(text.len());
    let mut index = 0;

    'scan: while index < characters.len() {
        for (keyword, keyword_chars) in ROUTING_KEYWORDS.iter().zip(keyword_char_vectors()) {
            if !class.must_redact(keyword) {
                continue;
            }
            let end = index + keyword_chars.len();
            let matches = end <= characters.len()
                && characters[index..end]
                    .iter()
                    .zip(keyword_chars)
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
/// 2. **Truncate** the collapsed text to [`MAX_ERROR_CAUSE_LEN`] characters
///    (appending `…` when truncated) **before** the redaction scan, so the scan
///    itself is O(`MAX_ERROR_CAUSE_LEN`) regardless of how large the upstream
///    body was (review finding m1: a multi-MB body used to be scanned in full).
///    A routing keyword cut in half by the truncation cannot match — the same
///    argument the whitespace collapse above already makes for `authen\ntication` —
///    so a truncated cause can never smuggle a *whole* keyword to the frontend.
/// 3. **Redact** the routing keywords that do not belong to `class`, so the
///    frontend cannot re-classify the message from an upstream body.
///
/// Because **no truncation happens after step 3**, a [`REDACTION_PLACEHOLDER`]
/// can never be cut in half (review finding m2: the old order truncated *after*
/// redaction and the doc claimed the opposite). The honest bound of the result is
/// therefore `MAX_ERROR_CAUSE_LEN` plus a bounded placeholder expansion: each
/// occurrence of a keyword is replaced by a fixed-length placeholder, so the
/// growth is bounded by the worst case where the whole bounded text is one
/// keyword repeated (`denied`, the shortest at 5 chars, → `[redacted]` at 10
/// chars, i.e. a growth factor of 2.0×); in practice the growth is proportional
/// to the number of keywords found, not to the length of the input.
///
/// Callers must only pass upstream/provider error text. Request-side secrets
/// (authorization code, access/refresh tokens, client secret) are never handed to
/// this function and must never be included in a message.
fn sanitize_error_cause(class: AuthFailureClass, cause: &str) -> String {
    let collapsed = cause.split_whitespace().collect::<Vec<_>>().join(" ");

    let truncated: String = if collapsed.chars().count() <= MAX_ERROR_CAUSE_LEN {
        collapsed
    } else {
        let head: String = collapsed.chars().take(MAX_ERROR_CAUSE_LEN).collect();
        format!("{head}…")
    };

    redact_routing_keywords(class, &truncated)
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

    /// m1: the redaction scan runs over the *bounded* text, so a multi-MB cause
    /// costs O(`MAX_ERROR_CAUSE_LEN`) work, and a keyword that the truncation cut
    /// in half cannot match — the truncation happens *before* the scan.
    ///
    /// **Pins only**: the *bound* of the sanitized output (exactly
    /// `MAX_ERROR_CAUSE_LEN` plus the ellipsis) and the frontend bucket for a
    /// truncated cause. It does **not** pin the truncate-before-redact *order*:
    /// the old truncate-after-redact implementation is also green here (a half
    /// keyword is inert either way). The order itself is pinned by
    /// [`sanitize_never_cuts_a_redaction_placeholder_in_half`].
    #[test]
    fn sanitize_preserves_the_input_bound_when_keywords_straddle_the_cut() {
        // The keyword `denied` straddles the truncation boundary (it starts 2 chars
        // before it), so the pre-truncation cuts it in half. A half keyword is
        // inert: the redaction scan cannot match it, and neither can the frontend
        // (which sees the same truncated text).
        let padding = "a".repeat(MAX_ERROR_CAUSE_LEN - 2);
        let cause = format!("{padding}denied and more text");
        let sanitized = sanitize_error_cause(AuthFailureClass::Transient, &cause);

        assert_eq!(
            sanitized.chars().count(),
            MAX_ERROR_CAUSE_LEN + 1,
            "the truncated cause must be exactly the bound plus the ellipsis: {sanitized}"
        );
        assert!(
            sanitized.ends_with('…'),
            "a truncated cause must end with the ellipsis: {sanitized}"
        );
        assert!(
            !sanitized.contains(REDACTION_PLACEHOLDER),
            "a keyword cut in half must not match the redaction scan: {sanitized}"
        );
        assert_eq!(
            bucket_of(&format!("network error while x: {sanitized}")),
            FrontendBucket::NetworkError,
            "the frontend sees the same truncated text, so the bucket must hold: {sanitized}"
        );
    }

    /// m2: no truncation happens AFTER redaction, so a placeholder can never be
    /// cut in half — the old order (redact first, truncate after) would have
    /// sliced the placeholder of a keyword sitting right at the bound.
    #[test]
    fn sanitize_never_cuts_a_redaction_placeholder_in_half() {
        // `denied` (5 chars) sits FULLY inside the bound, so it is replaced by a
        // whole placeholder (10 chars): under the old order the final truncate
        // would have produced a sliced `[reda…`.
        let would_be_cut = format!("{}denied", "b".repeat(MAX_ERROR_CAUSE_LEN - "denied".len()));
        let sanitized = sanitize_error_cause(AuthFailureClass::Transient, &would_be_cut);

        assert!(
            sanitized.contains(REDACTION_PLACEHOLDER),
            "the keyword must be replaced by a whole placeholder: {sanitized}"
        );
        assert!(
            sanitized.ends_with(REDACTION_PLACEHOLDER),
            "the placeholder must never be cut in half: {sanitized}"
        );
    }

    /// m1: the scan must never grow the text beyond the bound plus a placeholder
    /// expansion factor bounded by the shortest keyword (`denied`, 5 chars →
    /// `[redacted]`, 10 chars, i.e. 2.0×). A pathological cause made only of
    /// keywords must not explode into an unbounded message.
    ///
    /// **Pins only**: the *upper bound* of the sanitized output for a
    /// keyword-only cause. The exact truncate-before-redact *order* is not
    /// pinned here (the old implementation also stayed within the bound); it is
    /// pinned by [`sanitize_never_cuts_a_redaction_placeholder_in_half`].
    #[test]
    fn sanitize_bounds_a_pathological_keyword_only_cause_stays_within_the_documented_bound() {
        let cause = "denied ".repeat(MAX_ERROR_CAUSE_LEN);
        let sanitized = sanitize_error_cause(AuthFailureClass::Transient, &cause);
        let bound = REDACTION_PLACEHOLDER.len() * MAX_ERROR_CAUSE_LEN;

        assert!(
            sanitized.chars().count() <= bound + 1, // + the ellipsis
            "a keyword-only cause must stay within the placeholder-expanded bound, \
             got {} chars: {sanitized}",
            sanitized.chars().count()
        );

        // The growth is a placeholder expansion of the *bounded* text, never of
        // the (unbounded) input: the input here is ~1920 chars, the output must
        // be within a few multiples of the bound, not of the input.
        assert!(
            sanitized.chars().count() < 10 * MAX_ERROR_CAUSE_LEN,
            "the growth must be bounded by the placeholder expansion of the bound, \
             not by the input length, got {} chars",
            sanitized.chars().count()
        );
    }

    /// m3: the context is interpolated into the message, so it must obey the same
    /// class invariant as the cause: a context carrying a routing keyword must be
    /// redacted, not rendered verbatim.
    #[test]
    fn context_with_a_routing_keyword_is_redacted_and_keeps_the_class() {
        // A future context that talks about an *expired* token would trip the
        // frontend's composite `token` + `expired` rule and steal the `Other`
        // bucket for `TOKEN_EXPIRED`.
        let other = observable_message(&AuthFailureClass::Other.into_command_error(
            "checking whether the token expired",
            "expected value at column 1",
        ));
        let lowered = other.to_lowercase();
        for keyword in ROUTING_KEYWORDS {
            assert!(
                !lowered.contains(keyword),
                "OTHER must stay keyword-free even when its context carries a \
                 keyword, got: {other}"
            );
        }
        assert_eq!(bucket_of(&other), FrontendBucket::OperationFailed);

        // The same holds for the local-storage template (m4).
        let local = observable_message(
            &AuthFailureClass::Transient.into_command_error_local_storage(
                "checking whether the token expired",
                "the secret service is not available",
            ),
        );
        assert!(
            !local.to_lowercase().contains("expired"),
            "the local-storage template must redact the context as well, got: {local}"
        );
        assert_eq!(
            bucket_of(&local),
            FrontendBucket::NetworkError,
            "the local-storage message must keep the transient bucket: {local}"
        );
    }

    /// m3: every context string this crate interpolates into a message must be
    /// keyword-free, so the defense-in-depth redaction of the context is a no-op
    /// for the messages the frontend contract fixtures pin. If a new context with
    /// a routing keyword is ever added, it must be added to the shared fixture
    /// too (it would be silently redacted, changing the observable message).
    ///
    /// The context list is no longer hand-maintained: it is read from the shared
    /// fixture (`fixtures/auth-failure-contract.json`), which is the single
    /// source of truth for the 6 context strings (the fixture itself pins them
    /// byte-for-byte against `commands/storage.rs` in
    /// [`shared_fixture_pins_templates_contexts_and_classes`]).
    #[test]
    fn every_context_string_used_by_the_crate_is_keyword_free() {
        for context in load_shared_fixture().contexts.values() {
            assert!(
                !context.trim().is_empty(),
                "the fixture context {context:?} must not be empty (an empty string \
                 would pass every keyword check below)"
            );
            for class in [
                AuthFailureClass::AuthRejection,
                AuthFailureClass::Transient,
                AuthFailureClass::Other,
            ] {
                assert_eq!(
                    redact_routing_keywords(class, context),
                    context,
                    "the context {context:?} must be keyword-free for {class:?}, \
                     otherwise the observable message changes"
                );
            }
        }
    }

    /// m4: the local-storage template names the real cause while keeping the
    /// `network` keyword the frontend routes on.
    #[test]
    fn local_storage_template_names_the_real_cause_and_keeps_the_transient_bucket() {
        let rendered = observable_message(
            &AuthFailureClass::Transient.into_command_error_local_storage(
                "refreshing the Google Drive access token",
                "Failed to set keychain secret",
            ),
        );

        assert!(
            rendered.contains("network or local storage error"),
            "the local-storage template must name the real cause, got: {rendered}"
        );
        assert!(
            rendered.contains("refreshing the Google Drive access token"),
            "the context must survive verbatim: {rendered}"
        );
        assert_eq!(
            bucket_of(&rendered),
            FrontendBucket::NetworkError,
            "the frontend must keep routing on `network`: {rendered}"
        );
    }

    // ------------------------------------------------------------------
    // Shared fixture contract (`fixtures/auth-failure-contract.json`, issue #28
    // D4/T11): the Rust `include_str!` consumer. The fixture is the single
    // cross-language source of truth for the message templates, the context
    // strings, and the curated `cases` the frontend classifies with
    // `classifyCloudFailure` (`src/services/cloudStorageErrors.ts`).
    // ------------------------------------------------------------------

    /// Mirror of the fixture's `templates` object: the 4 `AuthFailureClass`
    /// message templates, keyed by template name.
    ///
    /// The field names mirror the fixture's JSON keys exactly (hence the
    /// `non_snake_case` allowance): `serde` maps each key by name, so any
    /// renaming here would silently desync from the fixture.
    #[derive(serde::Deserialize)]
    #[serde(deny_unknown_fields)]
    #[allow(non_snake_case)]
    struct FixtureTemplates {
        AuthRejection: String,
        Transient: String,
        Other: String,
        /// `into_command_error_local_storage`'s distinct 4th template (m4).
        TransientLocalStorage: String,
    }

    /// Mirror of the fixture's `contexts` object: the 6 Google Drive context
    /// strings, keyed by context name (see [`FixtureTemplates`] for why the
    /// field names are left in the fixture's own casing).
    #[derive(serde::Deserialize)]
    #[serde(deny_unknown_fields)]
    #[allow(non_snake_case)]
    struct FixtureContexts {
        refresh: String,
        codeExchange: String,
        tokenParse: String,
        oauthState: String,
        loadConfig: String,
        tokenPersistence: String,
    }

    impl FixtureContexts {
        /// The context string for `key` (`refresh`, `codeExchange`, …), or
        /// `None` when `key` is not one of the 6 known context names.
        fn value_of(&self, key: &str) -> Option<&str> {
            let context = match key {
                "refresh" => &self.refresh,
                "codeExchange" => &self.codeExchange,
                "tokenParse" => &self.tokenParse,
                "oauthState" => &self.oauthState,
                "loadConfig" => &self.loadConfig,
                "tokenPersistence" => &self.tokenPersistence,
                _ => return None,
            };
            Some(context.as_str())
        }

        /// Every context string, in a stable order.
        fn values(&self) -> [&str; 6] {
            [
                &self.refresh,
                &self.codeExchange,
                &self.tokenParse,
                &self.oauthState,
                &self.loadConfig,
                &self.tokenPersistence,
            ]
        }
    }

    /// Mirror of the fixture's `frontend` object: the classification the
    /// frontend must derive from the pinned `message` (see
    /// [`FixtureTemplates`] for why the field names are left in the fixture's
    /// own casing).
    #[derive(serde::Deserialize)]
    #[serde(deny_unknown_fields)]
    #[allow(non_snake_case)]
    struct FixtureFrontend {
        /// A `CloudStorageErrorType` name, validated against the 9-variant
        /// mapping in [`frontend_bucket_of_error_type`].
        errorType: String,
        /// `"transient"` or `"terminal"`: the fixture's retry class. Asserted
        /// against the frontend's derivation rule (exactly `NETWORK_ERROR` is
        /// retryable) in [`shared_fixture_pins_templates_contexts_and_classes`].
        failureClass: String,
    }

    /// Mirror of one fixture `case`: a rendered message plus the class that
    /// rendered it and the classification the frontend must derive from it
    /// (see [`FixtureTemplates`] for why the field names are left in the
    /// fixture's own casing).
    #[derive(serde::Deserialize)]
    #[serde(deny_unknown_fields)]
    #[allow(non_snake_case)]
    struct FixtureCase {
        id: String,
        /// Not asserted here (it is prose for the fixture's human reader), but
        /// kept as a typed field so the schema stays in lockstep with the
        /// fixture.
        #[allow(dead_code)]
        description: String,
        /// An `AuthFailureClass` variant name (`AuthRejection`/`Transient`/
        /// `Other`), validated against the enum in [`AuthFailureClass`].
        rustClass: String,
        /// Key into [`FixtureTemplates`].
        template: String,
        /// Key into [`FixtureContexts`].
        context: String,
        /// The sanitized/redacted cause interpolated into the template.
        cause: String,
        /// The exact rendered bytes (generated by rendering the real Rust
        /// templates, never hand-typed).
        message: String,
        frontend: FixtureFrontend,
    }

    /// Mirror of the whole fixture document (see [`FixtureTemplates`] for why
    /// the field names are left in the fixture's own casing).
    #[derive(serde::Deserialize)]
    #[serde(deny_unknown_fields)]
    struct Fixture {
        version: u32,
        /// Not asserted here: the fixture's prose description of the contract.
        #[allow(dead_code)]
        description: String,
        templates: FixtureTemplates,
        contexts: FixtureContexts,
        cases: Vec<FixtureCase>,
    }

    /// `source` with every `#[cfg(test)]`-gated item removed, so a substring
    /// hit proves the text is produced by PRODUCTION code and not merely
    /// spelled inside a test.
    ///
    /// Brace-counting scan (rustfmt-stable code assumed): a `#[cfg(test)]`
    /// item is either a single line ending in `;` or a balanced block; a
    /// mis-parse drops text and makes the substring pin go RED rather than
    /// silently including test code.
    fn without_cfg_test_items(source: &str) -> String {
        let mut production = String::new();
        let mut skipping = false;
        let mut block_started = false;
        let mut depth: i32 = 0;
        for line in source.lines() {
            if !skipping {
                if line.trim_start().starts_with("#[cfg(test)]") {
                    skipping = true;
                    block_started = false;
                    depth = 0;
                } else {
                    production.push_str(line);
                    production.push('\n');
                }
                continue;
            }
            depth += line.matches('{').count() as i32 - line.matches('}').count() as i32;
            if line.contains('{') {
                block_started = true;
            }
            if !block_started {
                // A single-line item such as `#[cfg(test)] use foo;`.
                if line.trim_end().ends_with(';') {
                    skipping = false;
                }
            } else if depth <= 0 {
                skipping = false;
            }
        }
        production
    }

    /// Load the shared fixture from the repo-root `fixtures/` directory.
    ///
    /// The `include_str!` path is relative to *this* file
    /// (`src-tauri/src/commands/errors.rs`): three levels up reaches the repo
    /// root, then down into `fixtures/`. `serde`'s `deny_unknown_fields` (on
    /// every mirror struct) makes any schema drift a hard load error rather
    /// than a silently-ignored extra key, and the `.expect` below names the
    /// fixture so a parse failure is self-describing.
    fn load_shared_fixture() -> Fixture {
        serde_json::from_str::<Fixture>(include_str!(
            "../../../fixtures/auth-failure-contract.json"
        ))
        .expect("the shared fixture must parse")
    }

    /// Render `case`'s message with the *class renderer* — the exact code path
    /// the Google Drive commands use in production.
    ///
    /// For the `AuthRejection`/`Transient`/`Other` templates this is
    /// [`AuthFailureClass::message`]; for the `TransientLocalStorage` template
    /// it is [`AuthFailureClass::into_command_error_local_storage`] (whose
    /// `CommandError::Io` payload carries the rendered message).
    fn render_with_class_renderer(fixture: &Fixture, case: &FixtureCase) -> String {
        let class = match case.rustClass.as_str() {
            "AuthRejection" => AuthFailureClass::AuthRejection,
            "Transient" => AuthFailureClass::Transient,
            "Other" => AuthFailureClass::Other,
            other => panic!(
                "fixture case {}: unknown rustClass {other:?} (expected one of \
                 AuthRejection/Transient/Other)",
                case.id
            ),
        };
        let context = fixture.contexts.value_of(&case.context).unwrap_or_else(|| {
            panic!(
                "fixture case {}: unknown context {:?} (expected one of the 6 keys \
                 of `contexts`)",
                case.id, case.context
            )
        });

        if case.template == "TransientLocalStorage" {
            observable_message(&class.into_command_error_local_storage(context, &case.cause))
        } else {
            assert_eq!(
                case.template,
                case.rustClass,
                "fixture case {}: the {template:?} template must be rendered by its \
                 same-named class",
                case.id,
                template = case.template
            );
            class.message(context, &case.cause)
        }
    }

    /// Render `case`'s message from the fixture's `templates`/`contexts`/`cause`
    /// directly — the *pure* template interpolation, with NO redaction,
    /// truncation, or sanitisation (the Rust-side twin of the TS loader's
    /// `renderContractMessage`). Used to assert that every pinned `message`
    /// really is the template render, except for the one documented case whose
    /// cause carries a routing keyword the class renderer redacts.
    fn render_pure_template(fixture: &Fixture, case: &FixtureCase) -> String {
        let template = match case.template.as_str() {
            "AuthRejection" => &fixture.templates.AuthRejection,
            "Transient" => &fixture.templates.Transient,
            "Other" => &fixture.templates.Other,
            "TransientLocalStorage" => &fixture.templates.TransientLocalStorage,
            other => panic!(
                "fixture case {}: unknown template {other:?} (expected one of the 4 \
                 keys of `templates`)",
                case.id
            ),
        };
        let context = fixture.contexts.value_of(&case.context).unwrap_or_else(|| {
            panic!(
                "fixture case {}: unknown context {:?} (expected one of the 6 keys of \
                 `contexts`)",
                case.id, case.context
            )
        });

        template
            .replace("{context}", context)
            .replace("{cause}", &case.cause)
    }

    /// Map a fixture `frontend.errorType` (`CloudStorageErrorType` name) to the
    /// matching [`FrontendBucket`] variant, so the fixture's classification can
    /// be validated against the keyword replica's output.
    fn frontend_bucket_of_error_type(error_type: &str) -> FrontendBucket {
        match error_type {
            "AUTHENTICATION_FAILED" => FrontendBucket::AuthenticationFailed,
            "TOKEN_EXPIRED" => FrontendBucket::TokenExpired,
            "NETWORK_ERROR" => FrontendBucket::NetworkError,
            "QUOTA_EXCEEDED" => FrontendBucket::QuotaExceeded,
            "VAULT_NOT_FOUND" => FrontendBucket::VaultNotFound,
            "PERMISSION_DENIED" => FrontendBucket::PermissionDenied,
            "PROVIDER_NOT_CONFIGURED" => FrontendBucket::ProviderNotConfigured,
            "INVALID_CREDENTIALS" => FrontendBucket::InvalidCredentials,
            "OPERATION_FAILED" => FrontendBucket::OperationFailed,
            other => panic!(
                "unknown frontend.errorType {other:?} (expected one of the 9 \
                 CloudStorageErrorType names)"
            ),
        }
    }

    /// The fixture is the single source of truth for the contract; this test is
    /// its Rust `include_str!` consumer (issue #28, D4/T12). It pins, for every
    /// one of the 8 curated `cases`:
    ///
    /// 1. the exact bytes the class renderer produces (the production code
    ///    path), byte for byte;
    /// 2. that the pinned `message` IS the pure template render — except for the
    ///    one documented case whose cause carries a routing keyword
    ///    (`oauth-state-other`: `expired` is redacted by `Other`);
    /// 3. that the frontend's keyword ladder (`bucket_of`) derives exactly the
    ///    `frontend.errorType` the fixture pins, and that the pinned
    ///    `failureClass` matches the frontend's derivation from it.
    ///
    /// It also verifies that every `context` string (all 6, whether or not a
    /// case references it) really is produced by the **production** code of
    /// `commands/storage.rs` (byte-identical substring pin over the source
    /// before its `#[cfg(test)]` module, so a context that disappears from the
    /// producer — or survives only in a test literal — goes red here) and that
    /// the fixture's own `version`/`cases` count are what the frontend loader
    /// expects.
    #[test]
    fn shared_fixture_pins_templates_contexts_and_classes() {
        let fixture = load_shared_fixture();

        assert_eq!(
            fixture.version, 1,
            "the shared fixture's schema version must stay at 1"
        );
        assert_eq!(
            fixture.cases.len(),
            8,
            "the shared fixture must pin exactly 8 curated cases"
        );

        let storage_source = include_str!("storage.rs");
        // The producer source WITHOUT its `#[cfg(test)]`-gated items: a
        // context must be produced by production code, not merely spelled in a
        // test literal (the file's test modules sit between production items,
        // so a plain "cut at the first #[cfg(test)]" would drop real producers).
        let production_source = without_cfg_test_items(storage_source);

        // (6) Every context string (all 6 — `tokenParse` has no case yet) must
        // be produced verbatim by `commands/storage.rs`'s production code, so a
        // context that disappears (or is reworded) there goes red here. An
        // empty context would satisfy any substring check, hence the first
        // assert.
        for context in fixture.contexts.values() {
            assert!(
                !context.trim().is_empty(),
                "the fixture context {context:?} must not be empty"
            );
            assert!(
                production_source.contains(context),
                "the context {context:?} must appear verbatim in the production code \
                 of `commands/storage.rs` — it is no longer produced by the crate"
            );
        }

        // Exactly the one documented case may take the redaction exception
        // below (`oauth-state-other`: its cause carries `expired`, which
        // `Other` rewrites to `[redacted]`). A second case must not silently
        // escape the strong pure-render pin.
        let redacted_ids: Vec<&str> = fixture
            .cases
            .iter()
            .filter(|case| case.message.contains(REDACTION_PLACEHOLDER))
            .map(|case| case.id.as_str())
            .collect();
        assert_eq!(
            redacted_ids,
            ["oauth-state-other"],
            "exactly the documented case may pin the redacted (class-renderer) form"
        );

        for case in &fixture.cases {
            let context = fixture.contexts.value_of(&case.context).unwrap_or_else(|| {
                panic!(
                    "fixture case {}: unknown context {:?} (expected one of the 6 keys \
                     of `contexts`)",
                    case.id, case.context
                )
            });

            // (1) The class renderer (the production code path) must produce
            // exactly the pinned `message`, byte for byte.
            let rendered = render_with_class_renderer(&fixture, case);
            assert_eq!(
                rendered, case.message,
                "fixture case {}: the class renderer's output for context {context:?} \
                 must match the pinned `message` byte for byte",
                case.id
            );

            // (2) The pinned `message` must also BE the pure template render —
            // except when the class renderer redacted a routing keyword out of
            // the cause (currently `oauth-state-other`, whose cause contains
            // `expired`, which `Other` rewrites to `[redacted]`).
            let pure = render_pure_template(&fixture, case);
            if case.message.contains(REDACTION_PLACEHOLDER) {
                assert_ne!(
                    pure, case.message,
                    "fixture case {}: the pure render must differ from the pinned \
                     `message` exactly when a routing keyword was redacted",
                    case.id
                );
                // The class-renderer pin (1) above already covers this case's
                // redacted `message`; this branch only pins the *difference*.
            } else {
                assert_eq!(
                    pure, case.message,
                    "fixture case {}: the pinned `message` must be the pure template \
                     render (no redaction was expected)",
                    case.id
                );
            }

            // (3) The frontend keyword ladder must derive exactly the pinned
            // `frontend.errorType` from the pinned `message`.
            let expected_bucket = frontend_bucket_of_error_type(&case.frontend.errorType);
            assert_eq!(
                bucket_of(&case.message),
                expected_bucket,
                "fixture case {}: the frontend bucket derived from the pinned \
                 `message` must match `frontend.errorType` ({})",
                case.id,
                case.frontend.errorType
            );

            // (4) `failureClass` is fully derivable from `errorType`: the
            // frontend treats exactly `NETWORK_ERROR` as retryable (see
            // `classifyCloudFailure` in `src/services/cloudStorageErrors.ts`).
            let expected_failure_class = if expected_bucket == FrontendBucket::NetworkError {
                "transient"
            } else {
                "terminal"
            };
            assert_eq!(
                case.frontend.failureClass, expected_failure_class,
                "fixture case {}: the pinned `failureClass` must match the frontend's \
                 derivation from `errorType` ({})",
                case.id, case.frontend.errorType
            );
        }
    }

    /// The 9-name `frontend.errorType` → [`FrontendBucket`] mapping this test
    /// module uses to interpret the fixture is itself pinned in full: only 3 of
    /// the 9 names occur in today's 8 cases, so a typo in one of the other arms
    /// would otherwise stay invisible until a future case exercises it.
    #[test]
    fn frontend_error_type_mapping_is_pinned_in_full() {
        for (name, expected) in [
            (
                "AUTHENTICATION_FAILED",
                FrontendBucket::AuthenticationFailed,
            ),
            ("TOKEN_EXPIRED", FrontendBucket::TokenExpired),
            ("NETWORK_ERROR", FrontendBucket::NetworkError),
            ("QUOTA_EXCEEDED", FrontendBucket::QuotaExceeded),
            ("VAULT_NOT_FOUND", FrontendBucket::VaultNotFound),
            ("PERMISSION_DENIED", FrontendBucket::PermissionDenied),
            (
                "PROVIDER_NOT_CONFIGURED",
                FrontendBucket::ProviderNotConfigured,
            ),
            ("INVALID_CREDENTIALS", FrontendBucket::InvalidCredentials),
            ("OPERATION_FAILED", FrontendBucket::OperationFailed),
        ] {
            assert_eq!(
                frontend_bucket_of_error_type(name),
                expected,
                "the {name} name must map to {expected:?}"
            );
        }
    }
}
