//! Tests for `lifecycle::change_vault_password` (T01).
//!
//! The command re-wraps the master key under a new password (cloud parity)
//! instead of going through `write_vault`/`update_existing_vault`, which used to
//! derive the master key from the *new* password and fail with a crypto error.
//!
//! Negative controls (the suite must be able to go red):
//! - `change_vault_password_wrong_old_fails` — a wrong old password must error
//!   (with the pre-fix `write_vault` path this "succeeded" by failing to derive
//!   the master key, and the old password kept working).
//! - `change_vault_password_old_password_stops_working` — if the re-wrap were
//!   skipped, the old password would still unlock the vault.
//! - `change_vault_password_leaves_vault_blob_untouched` — if the command
//!   re-encrypted the blob (or bumped `updated_at`), the ciphertext would change.

#[cfg(test)]
mod tests {
    use crate::commands::errors::CommandError;
    use crate::io;
    use crate::models::{Entry, Field, Vault, VaultView};
    use crate::vault::lifecycle;
    use chrono::Utc;
    use tempfile::tempdir;
    use uuid::Uuid;

    const OLD_PASSWORD: &str = "old-password";
    const NEW_PASSWORD: &str = "new-password";

    /// Builds a vault with a single data entry carrying a secret field.
    fn vault_with_entry() -> Vault {
        let now = Utc::now();
        Vault {
            updated_at: now,
            hmac: String::new(),
            entries: vec![Entry::Data {
                id: Uuid::new_v4(),
                name: "Test Entry".to_string(),
                data_type: "login".to_string(),
                created_at: now,
                updated_at: now,
                fields: vec![Field {
                    title: "Password".to_string(),
                    property: "password".to_string(),
                    value: "s3cr3t-value".to_string(),
                    secret: true,
                }],
                tags: vec!["tag-a".to_string()],
            }],
        }
    }

    /// Creates a vault on disk and returns its path.
    fn create_vault(dir: &tempfile::TempDir) -> Result<String, CommandError> {
        let file_path = dir
            .path()
            .join("password_change.monark")
            .to_str()
            .ok_or_else(|| CommandError::Validation("Invalid temp path".to_string()))?
            .to_string();
        lifecycle::write_vault(
            file_path.clone(),
            OLD_PASSWORD.to_string(),
            VaultView::from(&vault_with_entry()),
        )?;
        Ok(file_path)
    }

    #[test]
    fn change_vault_password_rewraps_and_preserves_entries() -> Result<(), CommandError> {
        let dir = tempdir().expect("temp dir");
        let file_path = create_vault(&dir)?;

        let before = lifecycle::read_vault(file_path.clone(), OLD_PASSWORD.to_string())?;

        lifecycle::change_vault_password(
            file_path.clone(),
            OLD_PASSWORD.to_string(),
            NEW_PASSWORD.to_string(),
        )?;

        let after = lifecycle::read_vault(file_path, NEW_PASSWORD.to_string())?;

        assert_eq!(
            after.entries, before.entries,
            "entries must survive the password change byte-for-byte"
        );
        assert_eq!(after.hmac, before.hmac);
        assert_eq!(
            after.updated_at, before.updated_at,
            "the vault blob (and its updated_at) must not be rewritten"
        );

        Ok(())
    }

    #[test]
    fn change_vault_password_old_password_stops_working() -> Result<(), CommandError> {
        let dir = tempdir().expect("temp dir");
        let file_path = create_vault(&dir)?;

        lifecycle::change_vault_password(
            file_path.clone(),
            OLD_PASSWORD.to_string(),
            NEW_PASSWORD.to_string(),
        )?;

        let result = lifecycle::read_vault(file_path, OLD_PASSWORD.to_string());
        assert!(
            result.is_err(),
            "the old password must no longer unlock the vault after a re-wrap"
        );

        Ok(())
    }

    #[test]
    fn change_vault_password_wrong_old_fails() -> Result<(), CommandError> {
        let dir = tempdir().expect("temp dir");
        let file_path = create_vault(&dir)?;

        let result = lifecycle::change_vault_password(
            file_path.clone(),
            "definitely-wrong".to_string(),
            NEW_PASSWORD.to_string(),
        );
        assert!(
            result.is_err(),
            "a wrong old password must be rejected (negative control)"
        );

        // The vault is untouched: the original password still works, the new one does not.
        assert!(lifecycle::read_vault(file_path.clone(), OLD_PASSWORD.to_string()).is_ok());
        assert!(lifecycle::read_vault(file_path, NEW_PASSWORD.to_string()).is_err());

        Ok(())
    }

    #[test]
    fn change_vault_password_wrong_old_records_rate_limit_failure() -> Result<(), CommandError> {
        let dir = tempdir().expect("temp dir");
        let file_path = create_vault(&dir)?;
        let canonical = std::fs::canonicalize(&file_path)
            .map_err(|_e| CommandError::Io("canonicalize failed".to_string()))?
            .to_string_lossy()
            .to_string();

        // A wrong old password records a failure for the canonical path...
        let _ = lifecycle::change_vault_password(
            file_path.clone(),
            "definitely-wrong".to_string(),
            NEW_PASSWORD.to_string(),
        );
        assert!(
            crate::vault::rate_limit::check_attempts(&canonical).is_ok(),
            "one failure stays below the free-attempt threshold"
        );

        // ...and exhausting the free attempts locks further attempts out.
        for _ in 0..4 {
            let _ = lifecycle::change_vault_password(
                file_path.clone(),
                "definitely-wrong".to_string(),
                NEW_PASSWORD.to_string(),
            );
        }
        match crate::vault::rate_limit::check_attempts(&canonical) {
            Err(CommandError::Validation(msg)) => {
                assert!(msg.contains("Too many failed attempts"), "got: {}", msg);
            }
            other => panic!("expected rate-limit Validation error, got {:?}", other),
        }

        // Cleanup so the global limiter does not leak into other tests.
        crate::vault::rate_limit::reset_attempts(&canonical);
        Ok(())
    }

    #[test]
    fn change_vault_password_rejects_empty_new() -> Result<(), CommandError> {
        let dir = tempdir().expect("temp dir");
        let file_path = create_vault(&dir)?;

        let result = lifecycle::change_vault_password(
            file_path.clone(),
            OLD_PASSWORD.to_string(),
            String::new(),
        );
        match result {
            Err(CommandError::Validation(msg)) => {
                assert!(msg.contains("New password is required"), "got: {}", msg);
            }
            other => panic!("expected Validation error, got {:?}", other),
        }

        // Nothing was written: the old password still unlocks the vault.
        assert!(lifecycle::read_vault(file_path, OLD_PASSWORD.to_string()).is_ok());

        Ok(())
    }

    #[test]
    fn change_vault_password_missing_file() -> Result<(), CommandError> {
        let dir = tempdir().expect("temp dir");
        let file_path = dir
            .path()
            .join("does_not_exist.monark")
            .to_str()
            .ok_or_else(|| CommandError::Validation("Invalid temp path".to_string()))?
            .to_string();

        let result = lifecycle::change_vault_password(
            file_path.clone(),
            OLD_PASSWORD.to_string(),
            NEW_PASSWORD.to_string(),
        );
        match result {
            Err(CommandError::NotFound(msg)) => {
                assert!(msg.contains("Vault file does not exist"), "got: {}", msg);
            }
            other => panic!("expected NotFound error, got {:?}", other),
        }

        // The command must never create a vault as a side effect (unlike write_vault).
        assert!(!std::path::Path::new(&file_path).exists());

        Ok(())
    }

    #[test]
    fn change_vault_password_leaves_vault_blob_untouched() -> Result<(), CommandError> {
        let dir = tempdir().expect("temp dir");
        let file_path = create_vault(&dir)?;

        let before = io::vault::read_vault(file_path.clone())?;

        lifecycle::change_vault_password(
            file_path.clone(),
            OLD_PASSWORD.to_string(),
            NEW_PASSWORD.to_string(),
        )?;

        let after = io::vault::read_vault(file_path)?;

        assert_eq!(
            after.vault, before.vault,
            "the encrypted vault blob must stay byte-identical (negative control)"
        );
        assert_eq!(after.version, before.version);
        assert_ne!(
            after.argon2_params, before.argon2_params,
            "a fresh salt must be generated"
        );
        assert_ne!(
            after.credentials, before.credentials,
            "the master key must be re-wrapped"
        );

        Ok(())
    }
}
