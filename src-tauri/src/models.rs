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



#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)] // No Zeroize needed here directly
#[serde(rename_all = "snake_case")]
pub struct Entry {
    pub id: Uuid, // UUID v4 string
    pub entry_type: String, // e.g., "group | entry"
    pub name: String,
    pub entries: Vec<Entry>, // Contains the encrypted entries
    pub data_type: String, // e.g., "website | note | card | etc."
}


#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Zeroize, ZeroizeOnDrop)]
#[serde(rename_all = "snake_case")]
pub struct EntryEncryption {
    // Salt is public but associated with secret derivation, zeroize for safety.
    pub entry_salt: String, // Base64 encoded, salt for HKDF (entry key derivation)
    // Nonce should be zeroized.
    pub nonce: String, // Base64 encoded, nonce for XChaCha20 entry encryption
}

// Section 5: Decrypted Entry Content (result of decrypting Entry.ciphertext)

// EntryData contains potentially sensitive fields, so derive Zeroize.
// DateTime<Utc> doesn't implement Zeroize, so we can't derive it directly here.
// We need to handle zeroization manually or wrap sensitive fields.
// For simplicity now, let's remove Zeroize derive from EntryData and rely on Field's Zeroize.
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)] // Removed Zeroize derive
#[serde(rename_all = "snake_case")]
pub struct EntryData {
    pub title: String, // Indexable
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub fields: Vec<Field>, // Field itself implements Zeroize for its value
    pub tags: Vec<String>, // Indexable, not typically secret
    // Add other relevant metadata if needed
}

// Field contains the sensitive 'value', so derive Zeroize. String implements Zeroize.
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Zeroize, ZeroizeOnDrop)]
#[serde(rename_all = "snake_case")]
pub struct Field {
    pub title: String, // e.g., "Username", "Password", "URL"
    pub property: String, // e.g., "username", "password", "url", "note" - determines indexability
    pub value: String, // The actual data, zeroized on drop
    pub secret: bool, // Indicates if the field is considered secret (e.g., password)
}

// Note: DTOs (Data Transfer Objects) like EntryAddDTO, EntryUpdateDTO from the previous version
// are removed. Commands will now likely take the necessary primitive types (String, Uuid, etc.)
// and potentially the full EntryData structure for adds/updates, handling encryption/decryption
// within the command logic based on the application state (e.g., session_key, index_key).
