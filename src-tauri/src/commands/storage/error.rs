use super::super::errors::{AuthFailureClass, CommandError};

pub(super) const MAX_ERROR_BODY_CAUSE_CHARS: usize = 960;

pub(super) struct ClassifiedAuthError {
    pub(super) class: AuthFailureClass,
    pub(super) keep_state: bool,
    pub(super) error: CommandError,
}

impl ClassifiedAuthError {
    pub(super) fn new(class: AuthFailureClass, context: &str, cause: &str) -> Self {
        Self::with_lifecycle(class, class == AuthFailureClass::Transient, context, cause)
    }
    pub(super) fn terminal(class: AuthFailureClass, context: &str, cause: &str) -> Self {
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

/// Whether an HTTP status is a transient (retryable) condition.
pub(super) fn is_transient_status(status: u16) -> bool {
    matches!(status, 408 | 429) || (500..600).contains(&status)
}

pub(super) fn bounded_error_body(body: &str) -> String {
    if body.chars().count() <= MAX_ERROR_BODY_CAUSE_CHARS {
        return body.to_string();
    }
    let head: String = body.chars().take(MAX_ERROR_BODY_CAUSE_CHARS).collect();
    format!("{head}…")
}

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
        let prefix = "e".repeat(MAX_ERROR_BODY_CAUSE_CHARS - 1);
        let body = format!("{prefix}ééé tail");
        let bounded = bounded_error_body(&body);
        assert_eq!(bounded.chars().count(), MAX_ERROR_BODY_CAUSE_CHARS + 1);
        assert!(bounded.ends_with('…'));
        assert!(bounded.contains('é'));
        assert!(!bounded.contains('\u{FFFD}'));
    }
}
