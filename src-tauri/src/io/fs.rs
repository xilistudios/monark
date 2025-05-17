use std::fs::File;
use std::io::{self, Read, Write};
use crate::io::error;
/// Reads the entire content of a file.
pub fn read_file(path: &str) -> Result<String, error::IoError> {
    let mut file = File::open(path).map_err(|e| {
        if e.kind() == io::ErrorKind::NotFound {
            error::IoError::NotFound
        } else {
            error::IoError::ReadError(e)
        }
    })?;
    let mut contents = String::new();
    file.read_to_string(&mut contents)
        .map_err(error::IoError::ReadError)?;
    Ok(contents)
}

/// Writes the given content to a file, overwriting if it exists.
pub fn write_file(path: &str, content: &str) -> Result<(), error::IoError> {
    let mut file = File::create(path).map_err(error::IoError::WriteError)?;
    file.write_all(content.as_bytes())
        .map_err(error::IoError::WriteError)?;
    Ok(())
}