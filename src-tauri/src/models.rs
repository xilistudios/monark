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

// Vault itself doesn't need Zeroize derive; sensitive parts are handled within or are keys managed by AppState
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "snake_case")]
pub struct Vault {
    pub updated_at: DateTime<Utc>,
    pub hmac: String, // hmac signature of the vault
    // Group structure doesn't contain secrets directly, entries do.
    pub entries: Vec<Entry>,
}



// Section 4.1: Entry enum with Group/Data variants

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
#[serde(tag = "entry_type", rename_all = "snake_case")]
pub enum Entry {
    Group {
        id: Uuid,
        name: String,
        data_type: String,
        children: Vec<Uuid>,
        parent_id: Option<Uuid>,
    },
    #[serde(rename = "entry")]
    Data {
        id: Uuid,
        name: String,
        data_type: String,
        created_at: DateTime<Utc>,
        updated_at: DateTime<Utc>,
        fields: Vec<Field>,
        tags: Vec<String>,
        parent_id: Option<Uuid>,
    },
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
    pub title: String, // e.g., "Username", "Password", "URL"
    pub property: String, // e.g., "username", "password", "url", "note" - determines indexability
    pub value: String, // The actual data, zeroized on drop
    pub secret: bool, // Indicates if the field is considered secret (e.g., password)
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
            hmac: vault.hmac,
            entries: vault.entries,
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
