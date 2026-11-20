use crate::commands::errors::CommandError;
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
pub use uuid::Uuid; // Re-export Uuid publicly
use zeroize::{Zeroize, ZeroizeOnDrop};

// Section 2: Vault File Structure (on disk)

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "snake_case")]
pub struct VaultFile {
    pub version: String, // e.g., "1.2"
    pub argon2_params: Argon2Params,
    pub credentials: EncryptedData,
    pub vault: EncryptedData, // Contains the encrypted JSON of the Vault struct (Section 4)
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "snake_case")]
pub struct Argon2Params {
    pub salt: String, // Base64 encoded
    #[serde(rename = "m_cost")] // Match spec JSON key
    pub memory_cost_kib: u32, // Renamed from m_cost for clarity in Rust
    #[serde(rename = "t_cost")] // Match spec JSON key
    pub iterations: u32, // Renamed from t_cost
    #[serde(rename = "p_cost")] // Match spec JSON key
    pub parallelism: u32, // Renamed from p_cost
                      // hash_length_bytes is determined by the crypto implementation (e.g., 32 bytes for XChaCha20)
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Zeroize, ZeroizeOnDrop)]
#[serde(rename_all = "snake_case")]
pub struct EncryptedData {
    // Nonce should be zeroized as it could potentially leak info if reused with the same key,
    // although XChaCha20 is robust. Better safe than sorry.
    pub nonce: String, // Base64 encoded (XChaCha20 nonce, 24 bytes)
    #[zeroize(skip)] // Ciphertext itself doesn't need zeroizing, the key used does.
    pub ciphertext: String, // Base64 encoded
}

// Section 4: In-Memory Vault Structure (decrypted JSON content)

// Vault contains decrypted sensitive data (entries with passwords). Derive Zeroize so the
// in-memory representation is scrubbed when dropped.
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Zeroize, ZeroizeOnDrop)]
#[serde(rename_all = "snake_case")]
pub struct Vault {
    #[zeroize(skip)]
    pub updated_at: DateTime<Utc>,
    pub hmac: String,
    // Group structure doesn't contain secrets directly, entries do.
    pub entries: Vec<Entry>,
}

// Section 4.1: Entry enum with Group/Data variants

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Zeroize, ZeroizeOnDrop)]
#[serde(tag = "entry_type", rename_all = "snake_case")]
pub enum Entry {
    Group {
        #[zeroize(skip)]
        id: Uuid,
        name: String,
        data_type: String,
        children: Vec<Entry>,
    },
    #[serde(rename = "entry")]
    Data {
        #[zeroize(skip)]
        id: Uuid,
        name: String,
        data_type: String,
        #[zeroize(skip)]
        created_at: DateTime<Utc>,
        #[zeroize(skip)]
        updated_at: DateTime<Utc>,
        fields: Vec<Field>,
        tags: Vec<String>,
    },
    /// A WebAuthn passkey (software authenticator, ES256).
    ///
    /// **Disk-only shape.** `private_key` is part of the encrypted vault blob and
    /// must never reach the frontend: the IPC family (`EntryView`/`PasskeyView`)
    /// has no field for it, so it cannot be represented, let alone leaked.
    ///
    /// Field mutability (merge rule, CXF §3.3.12.1 — only the user name and the
    /// display name are user-editable):
    /// * mutable from the frontend view: `name`, `tags`, `user_name`,
    ///   `user_display_name`, `updated_at`;
    /// * immutable (always taken from disk on merge): `id`, `created_at`,
    ///   `rp_id`, `rp_name`, `credential_id`, `user_handle`, `private_key`,
    ///   `algorithm`, `sign_count`, `discoverable`, `transports`, `aaguid`.
    Passkey {
        #[zeroize(skip)]
        id: Uuid,
        name: String,
        #[zeroize(skip)]
        created_at: DateTime<Utc>,
        #[zeroize(skip)]
        updated_at: DateTime<Utc>,
        tags: Vec<String>,
        rp_id: String,
        rp_name: String,
        /// Raw credential id bytes; JSON is a URL_SAFE_NO_PAD base64 string.
        #[serde(with = "b64url_serde")]
        credential_id: Vec<u8>,
        /// Raw user handle bytes; JSON is a URL_SAFE_NO_PAD base64 string.
        #[serde(with = "b64url_serde")]
        user_handle: Vec<u8>,
        user_name: String,
        user_display_name: String,
        /// PKCS#8 DER private key, base64url encoded. DISK ONLY.
        private_key: SecretPkcs8,
        /// COSE algorithm id; `-7` (ES256) in F0/F1.
        algorithm: i32,
        /// Always 0: a software authenticator never increments it in F0/F1.
        sign_count: u32,
        /// Always true in F0/F1 (resident/discoverable credentials).
        discoverable: bool,
        /// e.g. `["internal"]`.
        transports: Vec<String>,
        /// `Uuid::nil()` in F0/F1 (zero AAGUID, attestation "none").
        #[zeroize(skip)]
        aaguid: Uuid,
    },
}

/// PKCS#8 DER private key, stored as URL_SAFE_NO_PAD base64.
///
/// * `ZeroizeOnDrop`: the encoded key is scrubbed when the value is dropped.
/// * `Debug` is **redacted**: formatting a passkey entry can never print the key.
/// * `Serialize`/`Deserialize` are `transparent`, so the on-disk JSON is the plain
///   base64 string (no wrapper object) and old/new readers agree on the shape.
/// * NEVER part of any IPC type — see [`Entry::Passkey`].
#[derive(Clone, Serialize, Deserialize, Zeroize, ZeroizeOnDrop)]
#[serde(transparent)]
pub struct SecretPkcs8(String);

impl std::fmt::Debug for SecretPkcs8 {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("SecretPkcs8([REDACTED])")
    }
}

/// Equality is implemented **only** because [`Entry`] derives `PartialEq` (test
/// comparisons, round-trip assertions). It is a plain field comparison and must
/// never be used for a security decision (no constant-time guarantee, no
/// authentication semantics).
impl PartialEq for SecretPkcs8 {
    fn eq(&self, other: &Self) -> bool {
        self.0 == other.0
    }
}

impl SecretPkcs8 {
    /// Wraps PKCS#8 DER bytes, encoding them as URL_SAFE_NO_PAD base64.
    pub fn from_pkcs8_der(der: &[u8]) -> Self {
        Self(URL_SAFE_NO_PAD.encode(der))
    }

    /// Decodes the stored base64 back to PKCS#8 DER bytes.
    ///
    /// Invalid base64 is a caller error (corrupted vault content), reported as
    /// [`CommandError::Validation`] — never a panic.
    pub fn to_pkcs8_der(&self) -> Result<Vec<u8>, CommandError> {
        URL_SAFE_NO_PAD
            .decode(&self.0)
            .map_err(|_| CommandError::Validation("Invalid passkey private key encoding".into()))
    }
}

/// Serde adapter for `Vec<u8>` fields stored as URL_SAFE_NO_PAD base64 strings.
///
/// Used by the passkey `credential_id`/`user_handle` (disk and IPC families) so
/// the JSON stays a compact string instead of a byte array.
pub(crate) mod b64url_serde {
    use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
    use serde::{Deserialize, Deserializer, Serializer};

    pub fn serialize<S: Serializer>(bytes: &[u8], serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(&URL_SAFE_NO_PAD.encode(bytes))
    }

    pub fn deserialize<'de, D: Deserializer<'de>>(deserializer: D) -> Result<Vec<u8>, D::Error> {
        let encoded = String::deserialize(deserializer)?;
        URL_SAFE_NO_PAD
            .decode(encoded.as_bytes())
            .map_err(|_| serde::de::Error::custom("invalid base64url value"))
    }
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Zeroize, ZeroizeOnDrop)]
#[serde(rename_all = "snake_case")]
pub struct EntryEncryption {
    // Salt is public but associated with secret derivation, zeroize for safety.
    pub entry_salt: String, // Base64 encoded, salt for HKDF (entry key derivation)
    // Nonce should be zeroized.
    pub nonce: String, // Base64 encoded, nonce for XChaCha20 entry encryption
}

// Section 5: Field structure for data entries

// Field contains the sensitive 'value', so derive Zeroize. String implements Zeroize.
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Zeroize, ZeroizeOnDrop)]
#[serde(rename_all = "snake_case")]
pub struct Field {
    pub title: String,    // e.g., "Username", "Password", "URL"
    pub property: String, // e.g., "username", "password", "url", "note" - determines indexability
    pub value: String,    // The actual data, zeroized on drop
    pub secret: bool,     // Indicates if the field is considered secret (e.g., password)
}

// Section 6: Command Interface Types for TypeScript Integration

/// EncryptedVault represents the encrypted vault data as expected by Tauri commands.
/// This matches the Redux action payload structure for encrypted vault data.
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Zeroize, ZeroizeOnDrop)]
#[serde(rename_all = "camelCase")]
pub struct EncryptedVault {
    /// Base64 encoded encrypted vault data
    pub encrypted_data: String,
    /// Base64 encoded nonce used for encryption
    pub nonce: String,
    /// Base64 encoded salt for key derivation
    pub salt: String,
    /// Argon2 parameters used for key derivation (not zeroized as they're public)
    #[zeroize(skip)]
    pub argon2_params: Argon2Params,
}

/// DecryptedVault represents the decrypted vault content returned to TypeScript.
/// This matches the VaultContent interface on the frontend.
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "snake_case")]
pub struct DecryptedVault {
    /// Timestamp when vault was last updated (ISO 8601 string)
    pub updated_at: String,
    /// HMAC signature of the vault content
    pub hmac: String,
    /// List of entries (both groups and individual entries)
    pub entries: Vec<Entry>,
}

// Conversion traits between Rust and TypeScript types
impl From<Vault> for DecryptedVault {
    fn from(vault: Vault) -> Self {
        DecryptedVault {
            updated_at: vault.updated_at.to_rfc3339(),
            hmac: vault.hmac.clone(),
            entries: vault.entries.clone(),
        }
    }
}

impl TryFrom<DecryptedVault> for Vault {
    type Error = chrono::ParseError;

    fn try_from(decrypted: DecryptedVault) -> Result<Self, Self::Error> {
        Ok(Vault {
            updated_at: chrono::DateTime::parse_from_rfc3339(&decrypted.updated_at)?
                .with_timezone(&chrono::Utc),
            hmac: decrypted.hmac,
            entries: decrypted.entries,
        })
    }
}

// Note: DTOs (Data Transfer Objects) like EntryAddDTO, EntryUpdateDTO from the previous version
// are removed. Commands will now likely take the necessary primitive types (String, Uuid, etc.)
// and potentially the full EntryData structure for adds/updates, handling encryption/decryption
// within the command logic based on the application state (e.g., session_key, index_key).
#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::{json, Value};

    /// Published-example grade PKCS#8 DER blob (test-only, NOT a real credential).
    /// 48 bytes: enough to exercise the encode/decode path without crypto.
    const TEST_PKCS8_DER: [u8; 48] = [
        0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x04, 0x22, 0x04,
        0x20, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x0e,
        0x0f, 0x10, 0x11, 0x12, 0x13, 0x14, 0x15, 0x16, 0x17, 0x18, 0x19, 0x1a, 0x1b, 0x1c, 0x1d,
        0x1e, 0x1f, 0x20,
    ];

    const TEST_CREDENTIAL_ID: [u8; 16] = [
        0xde, 0xad, 0xbe, 0xef, 0x00, 0x11, 0x22, 0x33, 0x44, 0x55, 0x66, 0x77, 0x88, 0x99, 0xaa,
        0xbb,
    ];
    const TEST_USER_HANDLE: [u8; 8] = [0x01, 0x02, 0x03, 0x04, 0xfe, 0xfd, 0xfc, 0xfb];

    fn fixed_uuid(n: u8) -> Uuid {
        Uuid::from_bytes([n; 16])
    }

    fn fixed_time() -> DateTime<Utc> {
        DateTime::parse_from_rfc3339("2026-01-02T03:04:05Z")
            .expect("fixed timestamp parses")
            .with_timezone(&Utc)
    }

    fn sample_passkey() -> Entry {
        Entry::Passkey {
            id: fixed_uuid(0x11),
            name: "GitHub".to_string(),
            created_at: fixed_time(),
            updated_at: fixed_time(),
            tags: vec!["work".to_string()],
            rp_id: "github.com".to_string(),
            rp_name: "GitHub".to_string(),
            credential_id: TEST_CREDENTIAL_ID.to_vec(),
            user_handle: TEST_USER_HANDLE.to_vec(),
            user_name: "octocat".to_string(),
            user_display_name: "The Octocat".to_string(),
            private_key: SecretPkcs8::from_pkcs8_der(&TEST_PKCS8_DER),
            algorithm: -7,
            sign_count: 0,
            discoverable: true,
            transports: vec!["internal".to_string()],
            aaguid: Uuid::nil(),
        }
    }

    fn sample_data_entry() -> Entry {
        Entry::Data {
            id: fixed_uuid(0x22),
            name: "Mail".to_string(),
            data_type: "login".to_string(),
            created_at: fixed_time(),
            updated_at: fixed_time(),
            fields: vec![Field {
                title: "Password".to_string(),
                property: "password".to_string(),
                value: "hunter2".to_string(),
                secret: true,
            }],
            tags: vec!["personal".to_string()],
        }
    }

    fn sample_group(children: Vec<Entry>) -> Entry {
        Entry::Group {
            id: fixed_uuid(0x33),
            name: "Root".to_string(),
            data_type: "group".to_string(),
            children,
        }
    }

    fn sample_vault(entries: Vec<Entry>) -> Vault {
        Vault {
            updated_at: fixed_time(),
            hmac: "hmac-value".to_string(),
            entries,
        }
    }

    fn key_b64() -> String {
        URL_SAFE_NO_PAD.encode(TEST_PKCS8_DER)
    }

    // --- Acceptance criterion 1: full Vault round-trip, byte-for-byte ---

    #[test]
    fn passkey_entry_serde_roundtrip() {
        let vault = sample_vault(vec![sample_group(vec![sample_passkey()])]);

        let json = serde_json::to_string(&vault).expect("vault serializes");
        let back: Vault = serde_json::from_str(&json).expect("vault deserializes");

        assert_eq!(back, vault, "Vault must round-trip losslessly");

        // Byte-for-byte: re-serializing the deserialized value yields the same JSON.
        let json_again = serde_json::to_string(&back).expect("vault re-serializes");
        assert_eq!(json, json_again, "JSON must be stable across round-trip");
    }

    // --- Acceptance criterion 1 + 2: exact JSON shape of the passkey variant ---

    #[test]
    fn passkey_entry_json_shape() {
        let entry = sample_passkey();
        let value: Value = serde_json::to_value(&entry).expect("entry serializes");

        let expected = json!({
            "entry_type": "passkey",
            "id": fixed_uuid(0x11).to_string(),
            "name": "GitHub",
            "created_at": "2026-01-02T03:04:05Z",
            "updated_at": "2026-01-02T03:04:05Z",
            "tags": ["work"],
            "rp_id": "github.com",
            "rp_name": "GitHub",
            "credential_id": URL_SAFE_NO_PAD.encode(TEST_CREDENTIAL_ID),
            "user_handle": URL_SAFE_NO_PAD.encode(TEST_USER_HANDLE),
            "user_name": "octocat",
            "user_display_name": "The Octocat",
            // SecretPkcs8 is #[serde(transparent)]: a plain base64url string on disk.
            "private_key": key_b64(),
            "algorithm": -7,
            "sign_count": 0,
            "discoverable": true,
            "transports": ["internal"],
            "aaguid": Uuid::nil().to_string(),
        });

        assert_eq!(value, expected, "passkey disk JSON shape is pinned");

        // The b64url fields are strings, not byte arrays.
        assert!(value["credential_id"].is_string());
        assert!(value["user_handle"].is_string());
        assert!(value["private_key"].is_string());
    }

    // --- Acceptance criterion 2: pre-existing variants are untouched ---

    #[test]
    fn data_entry_json_unchanged() {
        let entry = sample_data_entry();
        let json = serde_json::to_string(&entry).expect("data entry serializes");

        // Pinned fixture string: proves the passkey addition did not perturb the
        // existing Data JSON (key order follows the struct declaration order).
        let expected = concat!(
            r#"{"entry_type":"entry","id":"22222222-2222-2222-2222-222222222222","#,
            r#""name":"Mail","data_type":"login","#,
            r#""created_at":"2026-01-02T03:04:05Z","updated_at":"2026-01-02T03:04:05Z","#,
            r#""fields":[{"title":"Password","property":"password","value":"hunter2","secret":true}],"#,
            r#""tags":["personal"]}"#
        );
        assert_eq!(json, expected);

        let back: Entry = serde_json::from_str(&json).expect("data entry deserializes");
        assert_eq!(back, entry);
    }

    #[test]
    fn group_entry_json_unchanged() {
        let entry = sample_group(vec![]);
        let json = serde_json::to_string(&entry).expect("group entry serializes");

        let expected = concat!(
            r#"{"entry_type":"group","id":"33333333-3333-3333-3333-333333333333","#,
            r#""name":"Root","data_type":"group","children":[]}"#
        );
        assert_eq!(json, expected);

        let back: Entry = serde_json::from_str(&json).expect("group entry deserializes");
        assert_eq!(back, entry);
    }

    // --- Acceptance criterion 3: Debug never leaks the key ---

    #[test]
    fn secret_pkcs8_debug_redacted() {
        let secret = SecretPkcs8::from_pkcs8_der(&TEST_PKCS8_DER);
        let debug = format!("{:?}", secret);
        assert_eq!(debug, "SecretPkcs8([REDACTED])");
        assert!(!debug.contains(&key_b64()));

        // The same holds when the secret is nested inside an Entry/Vault Debug dump.
        let entry = sample_passkey();
        let entry_debug = format!("{:?}", entry);
        assert!(
            entry_debug.contains("[REDACTED]"),
            "entry Debug must show the redaction marker: {entry_debug}"
        );
        assert!(
            !entry_debug.contains(&key_b64()),
            "entry Debug must never contain the key material"
        );
        assert!(
            !entry_debug.contains("0102030405060708"),
            "entry Debug must never contain the raw key bytes"
        );

        let vault_debug = format!("{:?}", sample_vault(vec![sample_group(vec![entry])]));
        assert!(vault_debug.contains("[REDACTED]"));
        assert!(!vault_debug.contains(&key_b64()));
    }

    // --- Acceptance criterion 4: zeroize scrubs the inner string ---

    #[test]
    fn secret_pkcs8_zeroize() {
        let mut secret = SecretPkcs8::from_pkcs8_der(&TEST_PKCS8_DER);
        let encoded_len = secret.0.len();
        assert!(
            encoded_len > 0,
            "sample key must encode to a non-empty string"
        );

        secret.zeroize();

        // `Zeroize for String` overwrites the buffer and then truncates it, so
        // the observable post-condition is an empty string with no readable
        // payload left — not an equal-length string of NUL bytes.
        assert!(
            secret.0.is_empty(),
            "zeroize must leave no readable payload: {:?}",
            secret.0
        );
        assert!(!secret.0.contains('A'), "no base64 payload survives");
    }

    // --- Acceptance criterion 5: bad base64 is a Validation error, not a panic ---

    #[test]
    fn secret_pkcs8_bad_base64_errors() {
        let secret: SecretPkcs8 =
            serde_json::from_str(r#""not valid base64!!""#).expect("deserializes as a string");
        match secret.to_pkcs8_der() {
            Err(CommandError::Validation(message)) => {
                assert!(message.contains("private key"));
            }
            other => panic!("expected CommandError::Validation, got {other:?}"),
        }

        // A well-formed value still decodes to the original bytes.
        let good = SecretPkcs8::from_pkcs8_der(&TEST_PKCS8_DER);
        assert_eq!(
            good.to_pkcs8_der().expect("valid base64 decodes"),
            TEST_PKCS8_DER.to_vec()
        );
    }

    // --- Acceptance criterion 1: the variant nests inside a group ---

    #[test]
    fn passkey_inside_group_roundtrip() {
        let vault = sample_vault(vec![sample_group(vec![
            sample_data_entry(),
            sample_passkey(),
        ])]);

        let json = serde_json::to_string(&vault).expect("vault serializes");
        let back: Vault = serde_json::from_str(&json).expect("vault deserializes");
        assert_eq!(back, vault);

        let Entry::Group { children, .. } = &back.entries[0] else {
            panic!("expected a group at the root");
        };
        assert_eq!(children.len(), 2);
        match &children[1] {
            Entry::Passkey {
                credential_id,
                user_handle,
                private_key,
                algorithm,
                aaguid,
                ..
            } => {
                assert_eq!(credential_id, &TEST_CREDENTIAL_ID.to_vec());
                assert_eq!(user_handle, &TEST_USER_HANDLE.to_vec());
                assert_eq!(
                    private_key.to_pkcs8_der().expect("key decodes"),
                    TEST_PKCS8_DER.to_vec()
                );
                assert_eq!(*algorithm, -7);
                assert_eq!(*aaguid, Uuid::nil());
            }
            other => panic!("expected a passkey child, got {other:?}"),
        }
    }

    // --- Negative control for the b64url adapter: bad base64 in a byte field ---

    #[test]
    fn passkey_bad_b64url_field_rejected() {
        let mut value: Value =
            serde_json::to_value(sample_passkey()).expect("passkey serializes to a value");
        value["credential_id"] = json!("!!!not-base64!!!");

        let result: Result<Entry, _> = serde_json::from_value(value);
        assert!(
            result.is_err(),
            "an invalid base64url credential_id must be rejected"
        );
    }
}
