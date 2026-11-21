use crate::commands::errors::{CommandError, CommandResult};
use crate::models::EntryView;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::io::{Error as IoError, ErrorKind};
use std::path::PathBuf;
use std::sync::{Arc, OnceLock};
use tauri::State;
use tokio::fs;
use tokio::sync::RwLock;
use zeroize::{Zeroize, ZeroizeOnDrop};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum StorageType {
    Local,
    Cloud,
}

impl Default for StorageType {
    fn default() -> Self {
        StorageType::Local
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct CloudMetadata {
    pub file_id: String,
    pub provider: String,
    #[serde(default)]
    pub last_sync: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultSummary {
    pub id: String,
    pub name: String,
    pub path: String,
    #[serde(default)]
    pub last_accessed: Option<String>,
    #[serde(default)]
    pub is_locked: bool,
    #[serde(default)]
    pub storage_type: StorageType,
    #[serde(default)]
    pub provider_id: Option<String>,
    #[serde(default)]
    pub cloud_metadata: Option<CloudMetadata>,
    #[serde(default)]
    pub biometric_enabled: bool,
    #[serde(default)]
    pub volatile: Option<VaultVolatile>,
}

impl Default for VaultSummary {
    fn default() -> Self {
        Self {
            id: String::new(),
            name: String::new(),
            path: String::new(),
            last_accessed: None,
            is_locked: true,
            storage_type: StorageType::Local,
            provider_id: None,
            cloud_metadata: None,
            biometric_enabled: false,
            volatile: None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default, Zeroize, ZeroizeOnDrop)]
#[serde(rename_all = "camelCase")]
pub struct VaultVolatile {
    #[serde(default)]
    pub credential: String,
    /// Sanitized IPC entries: the volatile mirror can never hold a passkey
    /// private key (see `models::EntryView`).
    #[serde(default)]
    pub entries: Vec<EntryView>,
    #[serde(default)]
    #[zeroize(skip)]
    pub navigation_path: Option<String>,
    #[serde(default)]
    #[zeroize(skip)]
    pub encrypted_data: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub struct PersistedProvider {
    pub name: String,
    #[serde(default)]
    pub provider_type: String,
    #[serde(default)]
    pub is_default: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct VaultStateData {
    #[serde(default)]
    pub vaults: Vec<VaultSummary>,
    #[serde(default)]
    pub providers: Vec<PersistedProvider>,
    #[serde(default)]
    pub default_provider: Option<String>,
    #[serde(default)]
    pub provider_status: HashMap<String, String>,
}

static VAULT_STATE_PATH: OnceLock<PathBuf> = OnceLock::new();

/// Set the vault state file path. Called from Tauri `.setup()` with the app's
/// AppData directory so the path is correct on mobile (Android/iOS).
pub fn set_vault_state_path(path: PathBuf) {
    let _ = VAULT_STATE_PATH.set(path);
}

pub struct VaultStateManager {
    data: RwLock<VaultStateData>,
    volatile: RwLock<HashMap<String, VaultVolatile>>,
    path: PathBuf,
}

impl VaultStateManager {
    pub fn default_path() -> PathBuf {
        VAULT_STATE_PATH.get().cloned().unwrap_or_else(|| {
            dirs::data_dir()
                .unwrap_or_else(|| PathBuf::from("."))
                .join("monark")
                .join("vault_state.json")
        })
    }

    pub fn new() -> Arc<Self> {
        Self::with_path(Self::default_path())
    }

    pub fn with_path(path: PathBuf) -> Arc<Self> {
        let initial = std::fs::read_to_string(&path)
            .ok()
            .and_then(|content| serde_json::from_str::<VaultStateData>(&content).ok())
            .unwrap_or_default();

        let (initial_state, initial_volatile) = Self::partition_volatile(initial);

        Arc::new(Self {
            data: RwLock::new(initial_state),
            volatile: RwLock::new(initial_volatile),
            path,
        })
    }

    async fn persist(&self, state: &VaultStateData) -> Result<(), IoError> {
        if let Some(parent) = self.path.parent() {
            fs::create_dir_all(parent).await?;
        }

        let payload = serde_json::to_string_pretty(state)
            .map_err(|err| IoError::new(ErrorKind::Other, err))?;

        // Atomic write: write to temp file, then rename.
        // This prevents corruption if the app is killed mid-write (common on mobile).
        let tmp_path = self.path.with_extension("json.tmp");
        fs::write(&tmp_path, &payload).await?;
        fs::rename(&tmp_path, &self.path).await
    }

    pub async fn get(&self) -> VaultStateData {
        let base_state = self.data.read().await.clone();
        let volatile = self.volatile.read().await.clone();

        Self::merge_volatile(base_state, &volatile)
    }

    pub async fn set(&self, next: VaultStateData) -> Result<(), IoError> {
        let (persistable_state, volatile_map) = Self::partition_volatile(next);

        {
            let mut guard = self.data.write().await;
            *guard = persistable_state.clone();
        }

        {
            let mut volatile_guard = self.volatile.write().await;
            *volatile_guard = volatile_map;
        }

        self.persist(&persistable_state).await
    }
}

pub struct ManagedVaultState {
    pub manager: Arc<VaultStateManager>,
}

impl ManagedVaultState {
    pub fn new(manager: Arc<VaultStateManager>) -> Self {
        Self { manager }
    }
}

impl VaultStateManager {
    fn partition_volatile(
        state: VaultStateData,
    ) -> (VaultStateData, HashMap<String, VaultVolatile>) {
        let VaultStateData {
            vaults,
            providers,
            default_provider,
            provider_status,
        } = state;

        let mut volatile_map = HashMap::new();

        let sanitized_vaults = vaults
            .into_iter()
            .map(|mut summary| {
                if let Some(volatile) = summary.volatile.take() {
                    volatile_map.insert(summary.id.clone(), volatile);
                }
                summary
            })
            .collect();

        (
            VaultStateData {
                vaults: sanitized_vaults,
                providers,
                default_provider,
                provider_status,
            },
            volatile_map,
        )
    }

    fn merge_volatile(
        mut state: VaultStateData,
        volatile: &HashMap<String, VaultVolatile>,
    ) -> VaultStateData {
        for summary in &mut state.vaults {
            if let Some(mut vol) = volatile.get(&summary.id).cloned() {
                vol.credential = String::new(); // Never expose credential via IPC
                summary.volatile = Some(vol);
            }
        }

        state
    }
}

#[tauri::command]
pub async fn load_vault_state(
    state: State<'_, ManagedVaultState>,
) -> CommandResult<VaultStateData> {
    Ok(state.manager.get().await)
}

#[tauri::command]
pub async fn save_vault_state(
    new_state: VaultStateData,
    state: State<'_, ManagedVaultState>,
) -> CommandResult<()> {
    state
        .manager
        .set(new_state)
        .await
        .map_err(|_err| CommandError::State("Failed to persist vault state".to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::{EntryView, PasskeyView};
    use chrono::{DateTime, Utc};
    use serde_json::Value;

    fn fixed_time() -> DateTime<Utc> {
        DateTime::parse_from_rfc3339("2026-01-02T03:04:05Z")
            .expect("fixed timestamp parses")
            .with_timezone(&Utc)
    }

    fn sample_passkey_view() -> PasskeyView {
        PasskeyView {
            id: uuid::Uuid::from_bytes([0x11; 16]),
            name: "GitHub".to_string(),
            created_at: fixed_time(),
            updated_at: fixed_time(),
            tags: vec!["work".to_string()],
            rp_id: "github.com".to_string(),
            rp_name: "GitHub".to_string(),
            credential_id: vec![0xde, 0xad, 0xbe, 0xef],
            user_handle: vec![0x01, 0x02, 0x03, 0x04],
            user_name: "octocat".to_string(),
            user_display_name: "The Octocat".to_string(),
            algorithm: -7,
            sign_count: 0,
            discoverable: true,
            transports: vec!["internal".to_string()],
            aaguid: uuid::Uuid::nil(),
        }
    }

    fn sample_state() -> VaultStateData {
        VaultStateData {
            vaults: vec![VaultSummary {
                id: "vault-1".to_string(),
                name: "Personal".to_string(),
                path: "/tmp/personal.monark".to_string(),
                volatile: Some(VaultVolatile {
                    credential: "secret-credential".to_string(),
                    entries: vec![
                        EntryView::Group {
                            id: uuid::Uuid::from_bytes([0x33; 16]),
                            name: "Root".to_string(),
                            data_type: "group".to_string(),
                            children: vec![EntryView::Passkey(sample_passkey_view())],
                        },
                        EntryView::Passkey(sample_passkey_view()),
                    ],
                    navigation_path: Some("/".to_string()),
                    encrypted_data: None,
                }),
                ..Default::default()
            }],
            ..Default::default()
        }
    }

    /// Acceptance criterion 4: the volatile mirror round-trips a passkey view and
    /// its JSON never contains a private key.
    #[test]
    fn vault_state_volatile_sanitized() {
        let state = sample_state();
        let json = serde_json::to_string(&state).expect("state serializes");

        assert!(
            !json.contains("private_key"),
            "the persisted volatile mirror must not contain a private_key key: {json}"
        );
        assert!(
            json.contains("\"entry_type\":\"passkey\""),
            "the passkey view must survive serialization: {json}"
        );

        let back: VaultStateData = serde_json::from_str(&json).expect("state deserializes");
        assert_eq!(back.vaults.len(), 1);
        let volatile = back.vaults[0]
            .volatile
            .as_ref()
            .expect("volatile survives the round-trip");
        assert_eq!(volatile.entries.len(), 2);
        assert_eq!(volatile.credential, "secret-credential");
    }

    /// Negative control: a payload that *does* carry a private key cannot be
    /// represented by the mirror — the field has no counterpart in `EntryView`,
    /// so it is dropped on the way in and never re-serialized on the way out.
    #[test]
    fn vault_state_drops_private_key_field() {
        let mut value: Value =
            serde_json::to_value(sample_state()).expect("state serializes to a value");
        value["vaults"][0]["volatile"]["entries"][1]["private_key"] = Value::String("AAAA".into());

        let parsed: VaultStateData =
            serde_json::from_value(value).expect("unknown fields are ignored by serde");
        let reserialized = serde_json::to_string(&parsed).expect("state re-serializes");
        assert!(
            !reserialized.contains("private_key"),
            "the view type has no private_key field, so it can never be persisted: {reserialized}"
        );
    }

    /// `merge_volatile` still blanks the credential (unchanged behaviour) and
    /// now returns sanitized entries.
    #[test]
    fn merge_volatile_blanks_credential() {
        let state = sample_state();
        let (persistable, volatile) = VaultStateManager::partition_volatile(state);
        assert!(
            persistable.vaults[0].volatile.is_none(),
            "volatile data is never persisted"
        );

        let merged = VaultStateManager::merge_volatile(persistable, &volatile);
        let merged_volatile = merged.vaults[0]
            .volatile
            .as_ref()
            .expect("volatile is merged back");
        assert_eq!(merged_volatile.credential, "");
        assert_eq!(merged_volatile.entries.len(), 2);
    }
}
