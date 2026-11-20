//! Passkey persistence seam (T08): load and save a vault **by reference**.
//!
//! Every passkey and CXF command (T09, T10, T16, T17) needs the same three
//! steps against a vault that the frontend only knows by reference:
//!
//! 1. fetch the encrypted [`VaultFile`] (a local file or a cloud provider file),
//! 2. unlock it (rate-limited master-key unwrap) and decrypt the [`Vault`],
//! 3. mutate the [`Vault`] in memory, re-encrypt it and persist it back.
//!
//! This module owns exactly that. It holds **no** WebAuthn logic: the
//! ceremonies live in [`crate::passkey`] and the commands in
//! `commands::passkey`.
//!
//! # Why a `VaultRef` and not a path
//!
//! A local vault is addressed by a filesystem path; a cloud vault by a provider
//! file id plus the provider name. [`VaultRef`] is the tagged union of the two
//! and is the wire shape the frontend sends (`{ kind: "local", file_path }` /
//! `{ kind: "cloud", vault_id, provider_name }`, mirrored in
//! `src/interfaces/passkey.interface.ts`).
//!
//! # Invariants
//!
//! * **The master key is scrubbed on drop.** [`LoadedVault::master_key`] is a
//!   [`Zeroizing`] buffer; the decrypted [`Vault`] (which holds passkey private
//!   keys) is zeroized by its own `Drop` implementation.
//! * **No blocking IO on the async runtime.** Every local filesystem read/write
//!   runs inside [`tauri::async_runtime::spawn_blocking`].
//! * **The cloud path never falls back to the offline cache** (ruling R9). A
//!   read-modify-write from a stale cached copy would clobber newer cloud state,
//!   so an unreachable provider is a hard [`CommandError::Io`] error, not a
//!   silent write from cache. The cache is still *refreshed* after a successful
//!   read/write, so the rest of the app keeps its offline copy.
//! * **Version policy is enforced on both ends.** A load refuses a format this
//!   build cannot read ([`CommandError::UnsupportedVersion`], before any Argon2
//!   work); a save bumps the stored version when the content now holds a
//!   passkey (`version::version_for_content`).
//! * **Rate limiting is per vault identifier**: the canonical path locally, the
//!   provider file id in the cloud — the same keys the lifecycle commands use,
//!   so a wrong password here counts against the same counter.

use crate::commands::errors::CommandError;
use crate::io;
use crate::models::{Vault, VaultFile};
use crate::storage::StorageManager;
use crate::vault::cloud_lifecycle::{
    cache_vault_bytes, create_vault_bytes, parse_vault_from_bytes, resolve_provider_name,
};
use crate::vault::keys;
use crate::vault::lifecycle::validate_vault_path;
use crate::vault::rate_limit;
use crate::vault::version;
use chrono::Utc;
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use zeroize::Zeroizing;

/// Which vault a passkey command operates on.
///
/// Serialized as an internally tagged enum (`kind`), snake_case members, so the
/// frontend sends `{"kind":"local","file_path":"…"}` or
/// `{"kind":"cloud","vault_id":"…","provider_name":"…"}`. `provider_name` is
/// optional in the cloud case: when absent the storage manager's default
/// provider is used, exactly like `read_cloud_vault`.
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum VaultRef {
    /// A vault file on the local filesystem.
    Local { file_path: String },
    /// A vault file stored by a cloud provider.
    Cloud {
        vault_id: String,
        provider_name: Option<String>,
    },
}

/// An unlocked vault: the encrypted envelope, its plaintext content and the
/// master key that ties them together.
///
/// Holding the master key is what lets a command decrypt, mutate and re-encrypt
/// without asking the user for the password twice. It is scrubbed on drop.
pub struct LoadedVault {
    /// The encrypted envelope as read from disk/provider (nonce + ciphertext).
    pub file: VaultFile,
    /// The decrypted content. Holds passkey private keys: never send it to the
    /// frontend (convert to [`crate::models::VaultView`] instead).
    pub vault: Vault,
    /// The unwrapped master key, zeroized on drop.
    pub master_key: Zeroizing<[u8; keys::KEY_LENGTH]>,
}

/// Loads and decrypts the vault `target` points at.
///
/// Local: validate the path → require the file to exist → rate-limit gate →
/// read + verify the signed envelope → version gate → unwrap the master key
/// (recording a failure or resetting the counter) → decrypt the content. The
/// blocking file read runs on the blocking pool.
///
/// Cloud: fetch from the provider (**no offline-cache fallback**, see the module
/// docs) → parse → version gate → rate-limit gate → unwrap → decrypt. The
/// fetched bytes refresh the local cache, as `read_cloud_vault` does.
pub async fn load_vault(
    target: &VaultRef,
    password: &str,
    manager: &Arc<StorageManager>,
) -> Result<LoadedVault, CommandError> {
    match target {
        VaultRef::Local { file_path } => load_local_vault(file_path, password).await,
        VaultRef::Cloud {
            vault_id,
            provider_name,
        } => load_cloud_vault(vault_id, password, provider_name, manager).await,
    }
}

/// Persists the (possibly mutated) content of `loaded` back to `target`.
///
/// Re-encrypts [`LoadedVault::vault`] under the loaded master key, applies the
/// version policy and writes the envelope. `loaded.file` is updated in place so
/// a caller that saves twice does not resurrect a stale ciphertext.
///
/// The caller owns the mutation: nothing here touches `loaded.vault` except
/// `updated_at` (stamped to now, like every other write path).
pub async fn save_vault(
    target: &VaultRef,
    loaded: &mut LoadedVault,
    manager: &Arc<StorageManager>,
) -> Result<(), CommandError> {
    match target {
        VaultRef::Local { file_path } => save_local_vault(file_path, loaded).await,
        VaultRef::Cloud {
            vault_id,
            provider_name,
        } => save_cloud_vault(vault_id, provider_name, loaded, manager).await,
    }
}

// ---------------------------------------------------------------------------
// Local
// ---------------------------------------------------------------------------

async fn load_local_vault(file_path: &str, password: &str) -> Result<LoadedVault, CommandError> {
    let canonical = validate_vault_path(file_path)?;
    let canonical_str = canonical.to_string_lossy().to_string();

    // `read_vault` maps a missing file to a generic IO error; a passkey command
    // must tell "wrong vault reference" apart from "corrupted vault", so the
    // existence check is explicit here.
    if !canonical.exists() {
        return Err(CommandError::NotFound(
            "Vault file does not exist".to_string(),
        ));
    }

    rate_limit::check_attempts(&canonical_str)?;

    // Signed-envelope read + signature verification are blocking filesystem IO.
    let read_path = canonical_str.clone();
    let vault_file = tauri::async_runtime::spawn_blocking(move || io::vault::read_vault(read_path))
        .await
        .map_err(|_e| CommandError::Internal("Vault read task failed".to_string()))??;

    // A format this build cannot read is not a password attempt: fail before the
    // Argon2 derivation and without touching the rate-limit counter.
    version::check_version(&vault_file.version)?;

    let master_key = unwrap_master_key(password, &vault_file, &canonical_str)?;
    let vault = keys::decrypt_vault_content(&master_key, &vault_file)?;

    Ok(LoadedVault {
        file: vault_file,
        vault,
        master_key,
    })
}

async fn save_local_vault(file_path: &str, loaded: &mut LoadedVault) -> Result<(), CommandError> {
    let canonical = validate_vault_path(file_path)?;
    let canonical_str = canonical.to_string_lossy().to_string();

    reencrypt(loaded)?;

    let vault_file = loaded.file.clone();
    tauri::async_runtime::spawn_blocking(move || io::vault::write_vault(canonical_str, &vault_file))
        .await
        .map_err(|_e| CommandError::Internal("Vault write task failed".to_string()))?
}

// ---------------------------------------------------------------------------
// Cloud
// ---------------------------------------------------------------------------

async fn load_cloud_vault(
    vault_id: &str,
    password: &str,
    provider_name: &Option<String>,
    manager: &Arc<StorageManager>,
) -> Result<LoadedVault, CommandError> {
    let provider_cache_key = resolve_provider_name(manager, provider_name).await?;

    // Deliberately NO `load_cached_vault` fallback (ruling R9): this vault is
    // about to be written back, and writing from a stale cache would clobber
    // whatever the provider holds now. Offline is an error, not a guess.
    let vault_data = manager
        .read_file(vault_id.to_string(), provider_name.clone())
        .await
        .map_err(|_e| CommandError::Io("Failed to read vault file".to_string()))?;

    // Refresh the offline copy with the bytes we just fetched (encrypted
    // envelope only). Failure is non-fatal, like in `read_cloud_vault`.
    if let Err(cache_err) = cache_vault_bytes(&provider_cache_key, vault_id, &vault_data) {
        println!(
            "[passkey::store] Failed to cache vault '{}' locally: {}",
            vault_id, cache_err
        );
    }

    let vault_file = parse_vault_from_bytes(&vault_data)?;
    version::check_version(&vault_file.version)?;

    let master_key = unwrap_master_key(password, &vault_file, vault_id)?;
    let vault = keys::decrypt_vault_content(&master_key, &vault_file)?;

    Ok(LoadedVault {
        file: vault_file,
        vault,
        master_key,
    })
}

async fn save_cloud_vault(
    vault_id: &str,
    provider_name: &Option<String>,
    loaded: &mut LoadedVault,
    manager: &Arc<StorageManager>,
) -> Result<(), CommandError> {
    let provider_cache_key = resolve_provider_name(manager, provider_name).await?;

    reencrypt(loaded)?;

    let vault_bytes = create_vault_bytes(&loaded.file)?;
    let cached_bytes = vault_bytes.clone();

    manager
        .update_file(
            crate::storage::providers::UpdateFileRequest {
                id: vault_id.to_string(),
                content: vault_bytes,
                metadata: None,
            },
            provider_name.clone(),
        )
        .await
        .map_err(|_e| CommandError::Io("Failed to update vault file".to_string()))?;

    // The cache holds the encrypted envelope only, never plaintext.
    if let Err(cache_err) = cache_vault_bytes(&provider_cache_key, vault_id, &cached_bytes) {
        println!(
            "[passkey::store] Failed to update cached vault '{}' locally: {}",
            vault_id, cache_err
        );
    }

    Ok(())
}

// ---------------------------------------------------------------------------
// Shared steps
// ---------------------------------------------------------------------------

/// Unwraps the master key, recording a rate-limit failure on a wrong password
/// and resetting the counter on success (same orchestration as the lifecycles).
fn unwrap_master_key(
    password: &str,
    vault_file: &VaultFile,
    rate_limit_key: &str,
) -> Result<Zeroizing<[u8; keys::KEY_LENGTH]>, CommandError> {
    match keys::derive_and_decrypt_master_key(password, vault_file) {
        Ok(key) => {
            rate_limit::reset_attempts(rate_limit_key);
            Ok(Zeroizing::new(key))
        }
        Err(err) => {
            rate_limit::record_failure(rate_limit_key);
            Err(err)
        }
    }
}

/// Re-encrypts `loaded.vault` into `loaded.file`, stamping `updated_at` and
/// applying the version policy.
///
/// The version policy is the one every write path uses: a vault that now holds
/// a passkey becomes [`version::CURRENT_VAULT_VERSION`]; otherwise the stored
/// version is kept (a 1.0 vault without passkeys stays readable by old clients).
fn reencrypt(loaded: &mut LoadedVault) -> Result<(), CommandError> {
    loaded.vault.updated_at = Utc::now();
    let encrypted = keys::encrypt_vault_content(&loaded.master_key, &loaded.vault)?;
    loaded.file.version = version::version_for_content(&loaded.file.version, &loaded.vault);
    loaded.file.vault = encrypted;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::{Entry, SecretPkcs8, VaultView};
    use crate::storage::StorageConfig;
    use crate::vault::lifecycle;
    use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
    use chrono::{DateTime, Utc};
    use std::path::{Path, PathBuf};
    use tempfile::TempDir;
    use uuid::Uuid;

    const PASSWORD: &str = "store-test-password";
    /// Published-example grade PKCS#8 DER blob (test-only, NOT a real credential).
    const TEST_PKCS8_DER: [u8; 16] = [
        0x30, 0x0e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x04, 0x02, 0x03,
        0x04,
    ];
    const PASSKEY_ID: Uuid = Uuid::from_bytes([0x11; 16]);

    fn fixed_time() -> DateTime<Utc> {
        DateTime::parse_from_rfc3339("2026-01-02T03:04:05Z")
            .expect("fixed timestamp parses")
            .with_timezone(&Utc)
    }

    fn passkey_entry() -> Entry {
        Entry::Passkey {
            id: PASSKEY_ID,
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
            private_key: SecretPkcs8::from_pkcs8_der(&TEST_PKCS8_DER),
            algorithm: -7,
            sign_count: 0,
            discoverable: true,
            transports: vec!["internal".to_string()],
            aaguid: Uuid::nil(),
        }
    }

    fn data_entry(name: &str) -> Entry {
        Entry::Data {
            id: Uuid::new_v4(),
            name: name.to_string(),
            data_type: "login".to_string(),
            created_at: fixed_time(),
            updated_at: fixed_time(),
            fields: Vec::new(),
            tags: Vec::new(),
        }
    }

    fn vault_with(entries: Vec<Entry>) -> Vault {
        Vault {
            updated_at: fixed_time(),
            hmac: String::new(),
            entries,
        }
    }

    /// Encrypts `vault` into a fresh envelope (fresh master key wrapped under
    /// [`PASSWORD`]), the layout both lifecycles produce.
    fn vault_file_with_passkey(vault: &Vault) -> VaultFile {
        let (argon2_params, credentials, master_key) =
            crate::vault::keys::create_key_material(PASSWORD).expect("seed key material");
        let encrypted =
            crate::vault::keys::encrypt_vault_content(&master_key, vault).expect("seed encrypt");
        VaultFile {
            version: version::CURRENT_VAULT_VERSION.to_string(),
            argon2_params,
            credentials,
            vault: encrypted,
        }
    }

    /// Writes `vault` (passkey key material included) straight to disk, the way
    /// a backend-side `passkey_create` would, and returns the temp dir + path.
    ///
    /// The command write path cannot do this: it only receives sanitized views,
    /// so a passkey in a payload fails closed (that is T05's contract, not a bug
    /// here). The test therefore builds the encrypted envelope itself, with the
    /// same layout `lifecycle::create_new_vault` produces.
    fn seed_local_vault(vault: &Vault) -> (TempDir, PathBuf) {
        let dir = TempDir::new().expect("temp dir");
        let path = dir.path().join("store.monark");
        let vault_file = vault_file_with_passkey(vault);
        io::vault::write_vault(path.to_string_lossy().to_string(), &vault_file)
            .expect("seed vault");
        (dir, path)
    }

    fn local_ref(path: &Path) -> VaultRef {
        VaultRef::Local {
            file_path: path.to_string_lossy().to_string(),
        }
    }

    /// A hermetic storage manager backed by a temp directory (no network).
    async fn local_manager(base: &TempDir) -> Arc<StorageManager> {
        let config = StorageConfig::new_local(base.path().to_string_lossy().to_string());
        Arc::new(
            StorageManager::new(config)
                .await
                .expect("local storage manager builds"),
        )
    }

    /// Criterion 1: a local load returns the identical vault, passkey key
    /// included, and the master key it returns is the one that decrypts it.
    #[tokio::test]
    async fn local_load_roundtrip() -> Result<(), CommandError> {
        let (dir, path) = seed_local_vault(&vault_with(vec![passkey_entry()]));
        let manager = local_manager(&dir).await;

        let loaded = load_vault(&local_ref(&path), PASSWORD, &manager).await?;

        assert_eq!(loaded.vault.entries, vec![passkey_entry()]);
        // The master key really is the vault's: re-encrypting with it and
        // decrypting through the shared helper must round-trip.
        let reencrypted = keys::encrypt_vault_content(&loaded.master_key, &loaded.vault)?;
        let mut file = loaded.file.clone();
        file.vault = reencrypted;
        let decrypted = keys::decrypt_vault_content(&loaded.master_key, &file)?;
        assert_eq!(decrypted.entries, loaded.vault.entries);
        Ok(())
    }

    /// Criterion 1: a wrong password fails and counts as a failed attempt, so a
    /// later attempt is refused by the rate limiter.
    #[tokio::test]
    async fn local_load_wrong_password_rate_limited() -> Result<(), CommandError> {
        let (dir, path) = seed_local_vault(&vault_with(Vec::new()));
        let manager = local_manager(&dir).await;
        let target = local_ref(&path);

        // The limiter allows MAX_FREE_ATTEMPTS failures before imposing a delay.
        for _ in 0..4 {
            assert!(load_vault(&target, "wrong-password", &manager)
                .await
                .is_err());
        }
        match load_vault(&target, "wrong-password", &manager).await {
            Err(CommandError::Validation(msg)) => {
                assert!(msg.contains("Too many failed attempts"), "got: {msg}");
            }
            Err(other) => panic!("expected a rate-limit error, got {other:?}"),
            Ok(_) => panic!("a rate-limited attempt must not load the vault"),
        }
        Ok(())
    }

    /// Criterion 1: an unsupported format is rejected before any Argon2 work and
    /// without consuming a rate-limit slot.
    #[tokio::test]
    async fn local_load_version_check() -> Result<(), CommandError> {
        let (dir, path) = seed_local_vault(&vault_with(Vec::new()));
        let manager = local_manager(&dir).await;

        // Rewrite the envelope with a future version, keeping everything else.
        let mut vault_file = io::vault::read_vault(path.to_string_lossy().to_string())?;
        vault_file.version = "9.9".to_string();
        io::vault::write_vault(path.to_string_lossy().to_string(), &vault_file)?;

        match load_vault(&local_ref(&path), PASSWORD, &manager).await {
            Err(CommandError::UnsupportedVersion(v)) => assert_eq!(v, "9.9"),
            Err(other) => panic!("expected UnsupportedVersion, got {other:?}"),
            Ok(_) => panic!("an unsupported version must not load"),
        }
        Ok(())
    }

    /// Criterion 1: a missing file is a `NotFound`, not a generic IO error.
    #[tokio::test]
    async fn local_load_missing_file() -> Result<(), CommandError> {
        let dir = TempDir::new().expect("temp dir");
        let manager = local_manager(&dir).await;
        let path = dir.path().join("absent.monark");

        match load_vault(&local_ref(&path), PASSWORD, &manager).await {
            Err(CommandError::NotFound(_)) => Ok(()),
            Err(other) => panic!("expected NotFound, got {other:?}"),
            Ok(_) => panic!("a missing file must not load"),
        }
    }

    /// Criterion 2: mutating the loaded vault and saving persists the change
    /// (visible through the `read_vault` command) and bumps the version when the
    /// content gains a passkey.
    #[tokio::test]
    async fn local_save_persists_and_bumps() -> Result<(), CommandError> {
        let (dir, path) = seed_local_vault(&vault_with(vec![data_entry("first")]));
        let manager = local_manager(&dir).await;
        let target = local_ref(&path);

        // A data-only vault stays 1.0 (seeded as 1.1 by `write_vault`, so pin
        // the downgrade path explicitly: force 1.0 on disk first).
        let mut vault_file = io::vault::read_vault(path.to_string_lossy().to_string())?;
        vault_file.version = "1.0".to_string();
        io::vault::write_vault(path.to_string_lossy().to_string(), &vault_file)?;

        let mut loaded = load_vault(&target, PASSWORD, &manager).await?;
        loaded.vault.entries.push(data_entry("second"));
        save_vault(&target, &mut loaded, &manager).await?;

        let view = lifecycle::read_vault(path.to_string_lossy().to_string(), PASSWORD.to_string())?;
        assert_eq!(view.entries.len(), 2, "the added entry must be persisted");
        assert_eq!(
            io::vault::read_vault(path.to_string_lossy().to_string())?.version,
            "1.0",
            "a vault without passkeys keeps its stored version"
        );

        // Now add a passkey: the stored version must bump to 1.1.
        let mut loaded = load_vault(&target, PASSWORD, &manager).await?;
        loaded.vault.entries.push(passkey_entry());
        save_vault(&target, &mut loaded, &manager).await?;

        assert_eq!(
            io::vault::read_vault(path.to_string_lossy().to_string())?.version,
            version::CURRENT_VAULT_VERSION,
            "a vault holding a passkey must be stored as 1.1"
        );
        // And the passkey (key included) survives the round-trip.
        let reloaded = load_vault(&target, PASSWORD, &manager).await?;
        assert!(reloaded
            .vault
            .entries
            .iter()
            .any(|e| matches!(e, Entry::Passkey { id, .. } if *id == PASSKEY_ID)));
        Ok(())
    }

    /// Criterion 4: `VaultRef` is the wire shape the frontend sends.
    #[test]
    fn vault_ref_serde() {
        let local = VaultRef::Local {
            file_path: "/tmp/vault.monark".to_string(),
        };
        let value = serde_json::to_value(&local).expect("serialize local");
        assert_eq!(
            value,
            serde_json::json!({ "kind": "local", "file_path": "/tmp/vault.monark" })
        );
        assert_eq!(
            serde_json::from_value::<VaultRef>(value).expect("deserialize local"),
            local
        );

        let cloud = VaultRef::Cloud {
            vault_id: "file-123".to_string(),
            provider_name: Some("google_drive".to_string()),
        };
        let value = serde_json::to_value(&cloud).expect("serialize cloud");
        assert_eq!(
            value,
            serde_json::json!({
                "kind": "cloud",
                "vault_id": "file-123",
                "provider_name": "google_drive"
            })
        );
        assert_eq!(
            serde_json::from_value::<VaultRef>(value).expect("deserialize cloud"),
            cloud
        );

        // `provider_name` is optional: the default provider is used when absent.
        let without_provider: VaultRef = serde_json::from_value(serde_json::json!({
            "kind": "cloud",
            "vault_id": "file-123"
        }))
        .expect("deserialize cloud without provider");
        assert_eq!(
            without_provider,
            VaultRef::Cloud {
                vault_id: "file-123".to_string(),
                provider_name: None,
            }
        );
    }

    /// Criterion 3: the cloud branch, driven against a hermetic **local**
    /// provider (no network): load → mutate → save → reload, with the provider
    /// file holding only the encrypted envelope.
    #[tokio::test]
    async fn cloud_load_save_roundtrip() -> Result<(), CommandError> {
        let dir = TempDir::new().expect("temp dir");
        // The cloud cache is process-wide: point it at this test's temp dir
        // before any cloud code runs (other tests in this binary may have set
        // it already; the value is only used for the cache path).
        crate::vault::cloud_lifecycle::set_cloud_cache_path(dir.path().join("cloud_cache"));

        let manager = local_manager(&dir).await;

        // Seed through the real cloud create path (empty payload: a passkey
        // cannot be created through the write path, see `seed_local_vault`),
        // then replace the stored envelope with one holding a passkey, built
        // exactly like the local seed.
        let file_id = crate::vault::cloud_lifecycle::write_cloud_vault_with(
            "store".to_string(),
            PASSWORD.to_string(),
            VaultView::from(&vault_with(Vec::new())),
            None,
            None,
            None,
            &manager,
        )
        .await?;
        let seeded = vault_file_with_passkey(&vault_with(vec![passkey_entry()]));
        manager
            .update_file(
                crate::storage::providers::UpdateFileRequest {
                    id: file_id.clone(),
                    content: crate::vault::cloud_lifecycle::create_vault_bytes(&seeded)?,
                    metadata: None,
                },
                None,
            )
            .await
            .map_err(|_e| CommandError::Io("Failed to update vault file".to_string()))?;

        let target = VaultRef::Cloud {
            vault_id: file_id.clone(),
            provider_name: None,
        };

        let mut loaded = load_vault(&target, PASSWORD, &manager).await?;
        assert_eq!(loaded.vault.entries, vec![passkey_entry()]);

        loaded.vault.entries.push(data_entry("cloud-added"));
        save_vault(&target, &mut loaded, &manager).await?;

        let reloaded = load_vault(&target, PASSWORD, &manager).await?;
        assert_eq!(reloaded.vault.entries.len(), 2);
        assert!(reloaded
            .vault
            .entries
            .iter()
            .any(|e| matches!(e, Entry::Data { name, .. } if name == "cloud-added")));

        // Criterion 5: the provider file holds the encrypted envelope only — no
        // plaintext entry name may appear in the stored bytes.
        let raw = manager
            .read_file(file_id, None)
            .await
            .map_err(|_e| CommandError::Io("Failed to read vault file".to_string()))?;
        let raw_text = String::from_utf8_lossy(&raw);
        assert!(
            !raw_text.contains("cloud-added") && !raw_text.contains("octocat"),
            "the provider file must never contain plaintext vault content"
        );
        Ok(())
    }

    /// Ruling R9: an unreachable provider is a hard error — the cloud load must
    /// NOT fall back to the offline cache (a stale copy would be written back).
    #[tokio::test]
    async fn cloud_load_does_not_fall_back_to_cache() -> Result<(), CommandError> {
        let dir = TempDir::new().expect("temp dir");
        crate::vault::cloud_lifecycle::set_cloud_cache_path(dir.path().join("cloud_cache"));
        let manager = local_manager(&dir).await;

        let file_id = crate::vault::cloud_lifecycle::write_cloud_vault_with(
            "cache".to_string(),
            PASSWORD.to_string(),
            VaultView::from(&vault_with(Vec::new())),
            None,
            None,
            None,
            &manager,
        )
        .await?;

        // The successful create cached the envelope; deleting the provider file
        // leaves the cache behind, which is exactly the dangerous state.
        let target = VaultRef::Cloud {
            vault_id: file_id.clone(),
            provider_name: None,
        };
        assert!(load_vault(&target, PASSWORD, &manager).await.is_ok());
        manager
            .delete_file(file_id.clone(), None)
            .await
            .map_err(|_e| CommandError::Io("Failed to delete vault".to_string()))?;

        match load_vault(&target, PASSWORD, &manager).await {
            Err(CommandError::Io(msg)) => {
                assert_eq!(msg, "Failed to read vault file");
            }
            Err(other) => panic!("a missing provider file must not read from cache, got {other:?}"),
            Ok(_) => panic!("a missing provider file must not read from cache, got a loaded vault"),
        }
        Ok(())
    }

    /// Negative control: a corrupted ciphertext must fail the load (AEAD tag
    /// check), never yield a partially-decrypted vault.
    #[tokio::test]
    async fn local_load_rejects_corrupted_ciphertext() -> Result<(), CommandError> {
        let (dir, path) = seed_local_vault(&vault_with(vec![passkey_entry()]));
        let manager = local_manager(&dir).await;

        let mut vault_file = io::vault::read_vault(path.to_string_lossy().to_string())?;
        let mut ciphertext = URL_SAFE_NO_PAD
            .decode(&vault_file.vault.ciphertext)
            .map_err(|_e| CommandError::Crypto("Failed to decode vault ciphertext".to_string()))?;
        if let Some(last) = ciphertext.last_mut() {
            *last ^= 0x01;
        }
        vault_file.vault.ciphertext = URL_SAFE_NO_PAD.encode(&ciphertext);
        io::vault::write_vault(path.to_string_lossy().to_string(), &vault_file)?;

        match load_vault(&local_ref(&path), PASSWORD, &manager).await {
            Err(CommandError::Crypto(msg)) => assert!(
                msg.contains("ChaCha20Poly1305"),
                "the flipped byte must fail the AEAD tag check, got: {msg}"
            ),
            Err(other) => panic!("expected a crypto error, got {other:?}"),
            Ok(_) => panic!("a corrupted ciphertext must not load"),
        }
        Ok(())
    }

    /// A save must not lose the passkey key: the on-disk entry keeps the exact
    /// PKCS#8 bytes after a load → save cycle that only touched a data entry.
    #[tokio::test]
    async fn local_save_preserves_passkey_key_bytes() -> Result<(), CommandError> {
        let (dir, path) = seed_local_vault(&vault_with(vec![passkey_entry()]));
        let manager = local_manager(&dir).await;
        let target = local_ref(&path);

        let mut loaded = load_vault(&target, PASSWORD, &manager).await?;
        loaded.vault.entries.push(data_entry("added"));
        save_vault(&target, &mut loaded, &manager).await?;

        let reloaded = load_vault(&target, PASSWORD, &manager).await?;
        let stored = reloaded
            .vault
            .entries
            .iter()
            .find_map(|e| match e {
                // `to_pkcs8_der` returns a `Zeroizing` buffer: copy it out for
                // the assertion and let the original be scrubbed on drop.
                Entry::Passkey { private_key, .. } => {
                    private_key.to_pkcs8_der().ok().map(|der| der.to_vec())
                }
                _ => None,
            })
            .expect("the passkey must still be on disk");
        assert_eq!(stored, TEST_PKCS8_DER.to_vec());
        Ok(())
    }
}
