use std::io::{self, Write};
use crate::io::error::IoError;
use std::io::{Error, ErrorKind};
   

#[test]
fn test_display_read_error() {
    let io_err = Error::new(ErrorKind::Other, "test read error");
    let io_error = IoError::ReadError(io_err);
    assert_eq!(format!("{}", io_error), "Failed to read file: test read error");
}

#[test]
fn test_display_write_error() {
    let io_err = Error::new(ErrorKind::Other, "test write error");
    let io_error = IoError::WriteError(io_err);
    assert_eq!(format!("{}", io_error), "Failed to write file: test write error");
}

#[test]
fn test_display_not_found() {
    let io_error = IoError::NotFound;
    assert_eq!(format!("{}", io_error), "File not found");
}

#[test]
fn test_error_trait() {
    // This test primarily ensures that IoError implements the Error trait
    let _io_error: Box<dyn std::error::Error> = Box::new(IoError::NotFound);
}

#[test]
fn test_enum_variants() {
    let _read_error = IoError::ReadError(Error::new(ErrorKind::Other, ""));
    let _write_error = IoError::WriteError(Error::new(ErrorKind::Other, ""));
    let _not_found = IoError::NotFound;
}
