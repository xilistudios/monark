#[test]
fn test_read_file_success() {
    let content = "Hello, world!";
    let file = tempfile::NamedTempFile::new().expect("Failed to create temporary file");
    let file_path = file.path();
    std::fs::write(file_path, content).expect("Failed to write to temporary file");

    let result = crate::io::fs::read_file(file_path.to_str().unwrap());
    assert!(result.is_ok());
    assert_eq!(result.unwrap(), content);
}

#[test]
fn test_read_file_not_found() {
    let non_existent_path = "non_existent_file.txt";
    let result = crate::io::fs::read_file(non_existent_path);
    assert!(result.is_err());
    match result.unwrap_err() {
        crate::io::error::IoError::NotFound => assert!(true),
        _ => assert!(false, "Expected IoError::NotFound"),
    }
}

#[test]
fn test_write_file_success() {
    let content = "Test content for writing.";
    let file = tempfile::NamedTempFile::new().expect("Failed to create temporary file for writing");
    let file_path = file.path();

    let result = crate::io::fs::write_file(file_path.to_str().unwrap(), content);
    assert!(result.is_ok());

    let read_content = std::fs::read_to_string(file_path).expect("Failed to read written file");
    assert_eq!(read_content, content);
}
