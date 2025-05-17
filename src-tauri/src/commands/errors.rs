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
    fn from(err: IoError) -> Self {
        CommandError::Io(err.to_string())
    }
}

impl From<CryptoError> for CommandError {
    fn from(err: CryptoError) -> Self {
        match err {
            _ => CommandError::Crypto(err.to_string()),
        }
    }
}

impl From<serde_json::Error> for CommandError {
    fn from(err: serde_json::Error) -> Self {
        CommandError::Serialization(err.to_string())
    }
}

impl From<DecodeError> for CommandError {
    fn from(err: DecodeError) -> Self {
        CommandError::Base64Decode(err.to_string())
    }
}

// Result type alias for commands
pub type CommandResult<T> = Result<T, CommandError>;
