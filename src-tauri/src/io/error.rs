use std::fmt;
use std::io::{self, Write};

#[derive(Debug)]
pub enum IoError {
    ReadError(io::Error),
    WriteError(io::Error),
    NotFound,
}

impl fmt::Display for IoError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            IoError::ReadError(e) => write!(f, "Failed to read file: {}", e),
            IoError::WriteError(e) => write!(f, "Failed to write file: {}", e),
            IoError::NotFound => write!(f, "File not found"),
        }
    }
}

impl std::error::Error for IoError {}
