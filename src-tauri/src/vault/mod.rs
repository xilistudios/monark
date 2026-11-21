//! Vault storage: local (`lifecycle`) and cloud (`cloud_lifecycle`) lifecycles,
//! the shared key hierarchy (`keys`), the write-path merge (`merge`), the format
//! version policy (`version`) and the password-attempt rate limiter
//! (`rate_limit`).

pub mod cloud_lifecycle;
pub mod keys;
pub mod lifecycle;
pub mod merge;
pub mod rate_limit;
mod tests;
pub mod version;
