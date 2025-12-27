use crate::commands::errors::{CommandError, CommandResult};
use crate::models::Entry;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::io::{Error as IoError, ErrorKind};
use std::path::PathBuf;
use std::sync::Arc;
use tauri::State;
use tokio::fs;
use tokio::sync::RwLock;

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
            volatile: None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct VaultVolatile {
    #[serde(default)]
    pub credential: String,
    #[serde(default)]
    pub entries: Vec<Entry>,
    #[serde(default)]
    pub navigation_path: Option<String>,
    #[serde(default)]
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

pub struct VaultStateManager {
    data: RwLock<VaultStateData>,
    volatile: RwLock<HashMap<String, VaultVolatile>>,
    path: PathBuf,
}

impl VaultStateManager {
    fn default_path() -> PathBuf {
        dirs::data_dir()
            .unwrap_or_else(|| PathBuf::from("."))
            .join("monark")
            .join("vault_state.json")
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

        let payload = serde_json::to_string_pretty(&state)
            .map_err(|err| IoError::new(ErrorKind::Other, err))?;
        fs::write(&self.path, payload).await
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
            summary.volatile = volatile.get(&summary.id).cloned();
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
        .map_err(|err| CommandError::State(format!("Failed to persist vault state: {}", err)))
}
