//! Vault format version policy (plan §2.8).
//!
//! The on-disk [`VaultFile::version`](crate::models::VaultFile) string decides
//! whether this build may open a vault at all. Two rules:
//!
//! 1. **Read**: anything outside [`SUPPORTED_VAULT_VERSIONS`] is rejected with
//!    [`CommandError::UnsupportedVersion`] *before* any rate-limit accounting or
//!    Argon2 work. A version mismatch is not an authentication failure, so it
//!    must neither consume a rate-limit attempt nor be hidden behind a slow KDF.
//! 2. **Write**: new vaults are created with [`CURRENT_VAULT_VERSION`]; an
//!    existing vault keeps its version unless the content now holds a passkey,
//!    in which case it is bumped to [`CURRENT_VAULT_VERSION`]. A 1.0 vault
//!    without passkeys therefore stays 1.0 forever, which keeps it readable by
//!    older clients (see `docs/vault-format.md`).
//!
//! Why the bump is content-driven and not unconditional: old clients never look
//! at `version`, so a 1.1 file *without* passkeys opens fine on them, but a 1.1
//! file *with* passkeys makes their `Entry` enum fail to deserialize
//! (`"entry_type":"passkey"` is unknown to them). Bumping only when a passkey is
//! actually present keeps the maximum number of vaults readable by old clients
//! while making the incompatibility explicit for the ones that really are
//! incompatible.

use crate::commands::errors::CommandError;
use crate::models::{Entry, Vault};

/// Version written by this build for new vaults and for vaults that gain a
/// passkey.
pub const CURRENT_VAULT_VERSION: &str = "1.1";

/// Every version this build can read.
///
/// `"1.0"` is the pre-passkey format; `"1.1"` adds the `passkey` entry variant.
/// Future formats (`"1.2"`, `"2.0"`, …) are rejected until this build learns to
/// read them.
pub const SUPPORTED_VAULT_VERSIONS: &[&str] = &["1.0", "1.1"];

/// Rejects a vault whose `version` this build cannot read.
///
/// Call this immediately after the [`VaultFile`](crate::models::VaultFile) is
/// parsed and **before** `rate_limit::check_attempts` / Argon2 derivation, so a
/// version error is cheap, deterministic, and never counts as a failed password
/// attempt.
///
/// The error carries the offending version verbatim so the UI can tell the user
/// which build they need; it deliberately contains no secret material.
pub fn check_version(version: &str) -> Result<(), CommandError> {
    if SUPPORTED_VAULT_VERSIONS.contains(&version) {
        Ok(())
    } else {
        Err(CommandError::UnsupportedVersion(version.to_string()))
    }
}

/// Whether the entry tree contains at least one passkey (recursive).
///
/// Groups are traversed at any depth; a passkey nested inside a group nested
/// inside a group counts.
pub fn has_passkey(entries: &[Entry]) -> bool {
    entries.iter().any(|entry| match entry {
        Entry::Passkey { .. } => true,
        Entry::Group { children, .. } => has_passkey(children),
        Entry::Data { .. } => false,
    })
}

/// The version to store for `vault`, given the version the file already had.
///
/// * content holds a passkey → [`CURRENT_VAULT_VERSION`] (the format is now
///   unreadable by pre-passkey clients, so say so);
/// * otherwise → `existing_version` unchanged (a 1.0 vault without passkeys
///   stays 1.0 and keeps opening on old clients).
pub fn version_for_content(existing_version: &str, vault: &Vault) -> String {
    if has_passkey(&vault.entries) {
        CURRENT_VAULT_VERSION.to_string()
    } else {
        existing_version.to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::{Field, SecretPkcs8};
    use chrono::{DateTime, Utc};
    use uuid::Uuid;

    fn fixed_time() -> DateTime<Utc> {
        DateTime::parse_from_rfc3339("2026-01-02T03:04:05Z")
            .expect("fixed timestamp parses")
            .with_timezone(&Utc)
    }

    fn data_entry(id: u8) -> Entry {
        Entry::Data {
            id: Uuid::from_bytes([id; 16]),
            name: "Mail".to_string(),
            data_type: "login".to_string(),
            created_at: fixed_time(),
            updated_at: fixed_time(),
            fields: vec![Field {
                title: "Password".to_string(),
                property: "password".to_string(),
                value: "s3cr3t".to_string(),
                secret: true,
            }],
            tags: Vec::new(),
        }
    }

    fn passkey_entry(id: u8) -> Entry {
        Entry::Passkey {
            id: Uuid::from_bytes([id; 16]),
            name: "GitHub".to_string(),
            created_at: fixed_time(),
            updated_at: fixed_time(),
            tags: Vec::new(),
            rp_id: "github.com".to_string(),
            rp_name: "GitHub".to_string(),
            credential_id: vec![0xde, 0xad, 0xbe, 0xef],
            user_handle: vec![0x01, 0x02, 0x03, 0x04],
            user_name: "octocat".to_string(),
            user_display_name: "The Octocat".to_string(),
            private_key: SecretPkcs8::from_pkcs8_der(&[0x30, 0x00]),
            algorithm: -7,
            sign_count: 0,
            discoverable: true,
            transports: vec!["internal".to_string()],
            aaguid: Uuid::nil(),
        }
    }

    fn group(id: u8, children: Vec<Entry>) -> Entry {
        Entry::Group {
            id: Uuid::from_bytes([id; 16]),
            name: "Root".to_string(),
            data_type: "group".to_string(),
            children,
        }
    }

    fn vault(entries: Vec<Entry>) -> Vault {
        Vault {
            updated_at: fixed_time(),
            hmac: String::new(),
            entries,
        }
    }

    #[test]
    fn check_version_accepts_1_0_and_1_1() {
        assert!(check_version("1.0").is_ok());
        assert!(check_version("1.1").is_ok());
    }

    #[test]
    fn check_version_rejects_unknown() {
        for version in ["1.2", "2.0", "0.9", "", "garbage", "1.1.0", " 1.1"] {
            match check_version(version) {
                Err(CommandError::UnsupportedVersion(reported)) => {
                    assert_eq!(reported, version, "the offending version must be reported");
                }
                other => panic!("expected UnsupportedVersion for {version:?}, got {other:?}"),
            }
        }
    }

    #[test]
    fn has_passkey_recursive() {
        assert!(!has_passkey(&[]));
        assert!(!has_passkey(&[data_entry(0x01)]));
        assert!(!has_passkey(&[group(0x02, vec![data_entry(0x01)])]));
        assert!(has_passkey(&[passkey_entry(0x11)]));
        assert!(has_passkey(&[data_entry(0x01), passkey_entry(0x11)]));
        // Nested two levels deep, next to a data entry.
        assert!(has_passkey(&[group(
            0x02,
            vec![group(0x03, vec![data_entry(0x01), passkey_entry(0x11)])]
        )]));
    }

    #[test]
    fn version_for_content_bumps_only_with_passkey() {
        let data_only = vault(vec![group(0x02, vec![data_entry(0x01)])]);
        assert_eq!(version_for_content("1.0", &data_only), "1.0");
        assert_eq!(version_for_content("1.1", &data_only), "1.1");
        assert_eq!(version_for_content("1.0", &vault(Vec::new())), "1.0");

        let with_passkey = vault(vec![group(0x02, vec![passkey_entry(0x11)])]);
        assert_eq!(
            version_for_content("1.0", &with_passkey),
            CURRENT_VAULT_VERSION
        );
        assert_eq!(
            version_for_content("1.1", &with_passkey),
            CURRENT_VAULT_VERSION
        );
    }

    #[test]
    fn current_version_is_supported() {
        assert!(
            SUPPORTED_VAULT_VERSIONS.contains(&CURRENT_VAULT_VERSION),
            "the version this build writes must be one it can read"
        );
    }
}
