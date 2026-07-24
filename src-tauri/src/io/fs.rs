use crate::io::error;
use std::fs::File;
use std::io::{self, Read, Write};
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

/// Writes the given content to a file atomically, overwriting if it exists.
/// Uses a temp file + rename to prevent partial writes. Sets 0600 on Unix.
pub fn write_file(path: &str, content: &str) -> Result<(), error::IoError> {
    let path_ref = std::path::Path::new(path);
    let tmp_path = path_ref.with_extension("monark.tmp");
    let mut file = File::create(&tmp_path).map_err(error::IoError::WriteError)?;
    file.write_all(content.as_bytes())
        .map_err(error::IoError::WriteError)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&tmp_path, std::fs::Permissions::from_mode(0o600))
            .map_err(error::IoError::WriteError)?;
    }
    std::fs::rename(&tmp_path, path_ref).map_err(error::IoError::WriteError)?;
    Ok(())
}
