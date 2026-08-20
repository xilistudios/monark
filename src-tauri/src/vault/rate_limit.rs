//! Progressive rate limiting for vault password attempts.
//!
//! Mitigates brute-force attacks against the Tauri unlock commands by
//! enforcing a growing delay after repeated failures per vault identifier.

use std::collections::HashMap;
use std::sync::{LazyLock, Mutex};
use std::time::{Duration, Instant};

use crate::commands::errors::CommandError;

/// Number of attempts allowed before any delay is imposed.
const MAX_FREE_ATTEMPTS: u32 = 3;
/// Maximum enforced delay between attempts.
const MAX_DELAY_SECS: u64 = 60;
/// Entries idle for longer than this are pruned.
const ENTRY_TTL_SECS: u64 = 3600;
/// Upper bound on tracked entries before pruning kicks in.
const MAX_ENTRIES: usize = 1000;

struct AttemptRecord {
    failures: u32,
    last_failure: Instant,
}

pub struct RateLimiter {
    attempts: HashMap<String, AttemptRecord>,
}

impl RateLimiter {
    pub fn new() -> Self {
        RateLimiter {
            attempts: HashMap::new(),
        }
    }

    /// Returns Ok(()) if an attempt is currently allowed for `key`,
    /// or Err(CommandError::Validation(...)) with the remaining wait time.
    pub fn check(&self, key: &str) -> Result<(), CommandError> {
        let record = match self.attempts.get(key) {
            Some(record) => record,
            None => return Ok(()),
        };

        if record.failures < MAX_FREE_ATTEMPTS {
            return Ok(());
        }

        let delay = required_delay(record.failures);
        let elapsed = record.last_failure.elapsed();
        if elapsed < delay {
            let remaining = delay.saturating_sub(elapsed);
            let remaining_secs = remaining.as_secs().max(1);
            return Err(CommandError::Validation(format!(
                "Too many failed attempts. Try again in {} second(s).",
                remaining_secs
            )));
        }

        Ok(())
    }

    /// Records a failed attempt for `key`.
    pub fn record_failure(&mut self, key: &str) {
        let entry = self
            .attempts
            .entry(key.to_string())
            .or_insert_with(|| AttemptRecord {
                failures: 0,
                last_failure: Instant::now(),
            });
        entry.failures += 1;
        entry.last_failure = Instant::now();

        // Best-effort pruning to bound memory growth under load.
        if self.attempts.len() > MAX_ENTRIES {
            let cutoff = Instant::now() - Duration::from_secs(ENTRY_TTL_SECS);
            self.attempts
                .retain(|_key, rec| rec.last_failure > cutoff);
        }
    }

    /// Clears the failure history for `key` (call after a successful unlock).
    pub fn reset(&mut self, key: &str) {
        self.attempts.remove(key);
    }
}

/// The required delay for a given number of failures. A failed attempt count
/// at or below MAX_FREE_ATTEMPTS yields no delay.
fn required_delay(failures: u32) -> Duration {
    if failures <= MAX_FREE_ATTEMPTS {
        return Duration::from_secs(0);
    }
    let extra = failures - MAX_FREE_ATTEMPTS;
    let exponent = extra - 1;
    let secs = 1u64.checked_shl(exponent).unwrap_or(u64::MAX);
    let capped = secs.min(MAX_DELAY_SECS);
    Duration::from_secs(capped)
}

static RATE_LIMITER: LazyLock<Mutex<RateLimiter>> = LazyLock::new(|| Mutex::new(RateLimiter::new()));

/// Global gate: call BEFORE attempting password derivation.
pub fn check_attempts(key: &str) -> Result<(), CommandError> {
    let limiter = RATE_LIMITER
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    limiter.check(key)
}

/// Global recorder: call AFTER a failed password derivation.
pub fn record_failure(key: &str) {
    let mut limiter = RATE_LIMITER
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    limiter.record_failure(key);
}

/// Global reset: call AFTER a successful password derivation.
pub fn reset_attempts(key: &str) {
    let mut limiter = RATE_LIMITER
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    limiter.reset(key);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn first_three_checks_pass_with_no_delay() {
        let mut limiter = RateLimiter::new();
        assert!(limiter.check("vault-1").is_ok());
        limiter.record_failure("vault-1");
        assert!(limiter.check("vault-1").is_ok());
        limiter.record_failure("vault-1");
        assert!(limiter.check("vault-1").is_ok());
        limiter.record_failure("vault-1");
        // 3 failures == MAX_FREE_ATTEMPTS, still no delay required.
        assert!(limiter.check("vault-1").is_ok());
    }

    #[test]
    fn check_returns_validation_after_free_attempts_exhausted() {
        let mut limiter = RateLimiter::new();
        for _ in 0..4 {
            limiter.record_failure("vault-2");
        }
        match limiter.check("vault-2") {
            Err(CommandError::Validation(msg)) => {
                assert!(msg.contains("Too many failed attempts"), "got: {}", msg);
            }
            other => panic!("expected Validation error, got {:?}", other),
        }
    }

    #[test]
    fn reset_allows_check_to_pass_again() {
        let mut limiter = RateLimiter::new();
        for _ in 0..5 {
            limiter.record_failure("vault-3");
        }
        assert!(limiter.check("vault-3").is_err());
        limiter.reset("vault-3");
        assert!(limiter.check("vault-3").is_ok());
    }

    #[test]
    fn delay_grows_after_multiple_failures() {
        let mut limiter = RateLimiter::new();
        for _ in 0..5 {
            limiter.record_failure("vault-4");
        }
        match limiter.check("vault-4") {
            Err(CommandError::Validation(msg)) => {
                // Parse the reported seconds and require at least 1s remaining.
                let seconds = msg
                    .split_whitespace()
                    .find_map(|tok| tok.trim_matches(|c: char| !c.is_ascii_digit()).parse::<u64>().ok())
                    .expect("error message should contain a seconds value");
                assert!(seconds >= 1, "expected positive wait, got {}", seconds);
            }
            other => panic!("expected Validation error, got {:?}", other),
        }
    }

    #[test]
    fn required_delay_grows_and_caps() {
        assert_eq!(required_delay(0), Duration::from_secs(0));
        assert_eq!(required_delay(3), Duration::from_secs(0));
        assert_eq!(required_delay(4), Duration::from_secs(1));
        assert_eq!(required_delay(5), Duration::from_secs(2));
        assert_eq!(required_delay(6), Duration::from_secs(4));
        assert_eq!(required_delay(10), Duration::from_secs(MAX_DELAY_SECS));
        assert_eq!(required_delay(100), Duration::from_secs(MAX_DELAY_SECS));
    }
}