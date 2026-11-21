//! `import_cxf` command (T16): import passkeys from a CXF JSON document.
//!
//! The whole CXF parsing/validation lives in [`crate::passkey::cxf`] (T15) and
//! the vault seam in [`crate::passkey::store`] (T08); this module owns exactly
//! the **merge**: what to do with each credential of the document, how to
//! deduplicate against what the vault already holds, and when to write.
//!
//! # Flow
//!
//! 1. **Parse the envelope first** ([`cxf::parse_envelope`]). Everything that can
//!    be decided from the document alone is decided before the vault is touched:
//!    a malformed document costs neither an Argon2 derivation nor a rate-limit
//!    slot, and cannot leave the vault half-imported.
//! 2. **Unlock** the vault through the [`store`] seam (rate-limited, cloud-aware).
//! 3. **Index** the passkeys already stored, by `(rp_id, credential_id)`
//!    (ruling Q8) — recursively, because passkeys may live inside groups.
//! 4. **Merge** every `account → item → credential`:
//!    * not a passkey → reported as skipped with its exact `type`;
//!    * fails T15 validation → reported as skipped with T15's reason;
//!    * `(rp_id, credential_id)` already present → counted as a duplicate;
//!    * otherwise → a new [`Entry::Passkey`] at the vault **root** (Q12).
//! 5. **Save once**, and only when something was actually imported. A document
//!    that imports nothing (all duplicates, all skipped, or empty) leaves the
//!    vault file **byte-identical**: no re-encryption, no `updated_at` stamp, no
//!    version bump. That is the atomicity contract of the plan: per-credential
//!    skips are reported, never partially written, and a no-op import is a
//!    no-op on disk.
//!
//! # Decisions (documented, see the report)
//!
//! * **Timestamps.** `item.creationAt` / `item.modifiedAt` are used when present
//!   (plan §4.2 mapping). The fallback applies to the member that is *absent*,
//!   never to the one that is present: `created_at` falls back to `modifiedAt`
//!   and only then to `now`; `updated_at` falls back to `now` and is clamped up
//!   to `created_at` so the entry never claims to have been modified before it
//!   was created. Consequences: both present → both respected; `creationAt`
//!   only → `created_at` is the `creationAt` and `updated_at` is `now` clamped up
//!   to it (so `now` for a past `creationAt`, pinned by
//!   `creation_at_only_item_uses_it_for_both_timestamps`); `modifiedAt` only →
//!   both equal to `modifiedAt`; neither → `now` for both.
//! * **`name`.** `item.title`, with `username@rpId` as the fallback when the
//!   title is empty or blank (plan §4.2). CXF has no non-empty rule on `title`,
//!   and an entry with an empty name is invisible in every list UI.
//! * **`rp_name = rp_id`** (ruling Q12): CXF carries no RP display name, and
//!   inventing one would be a lie in the UI.
//! * **`fido2Extensions`** are ignored (ruling Q11) and reported per credential
//!   with [`cxf::EXTENSIONS_IGNORED_NOTE`] — the import is not silent about
//!   dropping data it cannot represent. The credential **is** imported: the
//!   report row is a note, not a rejection (see [`CxfImportReport::skipped`]).
//! * **Duplicates are not skipped entries.** They are counted in
//!   [`CxfImportReport::duplicates`], which is what the plan's criteria pin
//!   (`{imported: 0, duplicates: 1, skipped: []}` on a re-import).
//! * **A duplicate *inside* the document** (the same credential twice in one
//!   file) is handled by the same index: the first occurrence wins, the second
//!   is counted as a duplicate, so a file can never store one credential twice.
//! * **Cloud vaults** go through the same seam: `store::load_vault` /
//!   `store::save_vault` dispatch on the [`VaultRef`] variant, so the cloud
//!   branch is the local branch with a different transport (tested against a
//!   hermetic local provider, see `passkey_import_tests.rs`).
//!
//! # Secrets
//!
//! The only secret here is the PKCS#8 key of each credential, which travels as
//! [`cxf::ValidatedPasskey::pkcs8_der`] (a `Zeroizing` buffer) straight into
//! [`cxf::secret_from_validated`] → [`Entry::Passkey::private_key`]. No error
//! message, no report field and no log line ever interpolates key material.

use crate::commands::errors::CommandError;
use crate::commands::storage::StorageState;
use crate::models::Entry;
use crate::passkey::cxf::{self, CxfImportReport, ValidatedPasskey};
use crate::passkey::store::{self, VaultRef};
use crate::passkey::webauthn::SIGN_COUNT;
use chrono::{DateTime, TimeZone, Utc};
use std::collections::HashSet;
use std::sync::Arc;
use uuid::Uuid;

/// Imports the passkeys of a CXF document into the vault `vault` points at.
///
/// See the module docs for the flow. The vault is unlocked with `password`; a
/// wrong password is rate-limited by the [`store`] seam exactly like the vault
/// commands, and the vault is left untouched.
#[tauri::command(async)]
pub async fn import_cxf(
    vault: VaultRef,
    password: String,
    content: String,
    state: tauri::State<'_, StorageState>,
) -> Result<CxfImportReport, CommandError> {
    import_cxf_with(&vault, &password, &content, &state.manager).await
}

/// Body of [`import_cxf`], taking the storage manager directly.
///
/// The `tauri::State` wrapper only exists for IPC; keeping the logic here lets
/// the whole import be tested end to end against a real vault (local file or a
/// hermetic local provider standing in for the cloud) without building a Tauri
/// app — the same pattern as `passkey_create_with`.
pub async fn import_cxf_with(
    vault: &VaultRef,
    password: &str,
    content: &str,
    manager: &Arc<crate::storage::StorageManager>,
) -> Result<CxfImportReport, CommandError> {
    // 1. Document-level validation first: no IO, no Argon2, no rate-limit slot.
    let header = cxf::parse_envelope(content)?;

    // 2. Unlock (rate-limited; cloud or local, decided by the seam).
    let mut loaded = store::load_vault(vault, password, manager).await?;

    // 3. What we already hold, by `(rp_id, credential_id)`.
    let mut known = PasskeyIndex::from_entries(&loaded.vault.entries);

    // 4. Merge.
    let now = Utc::now();
    let mut report = CxfImportReport::default();
    let mut imported_entries: Vec<Entry> = Vec::new();

    for account in &header.accounts {
        for item in &account.items {
            for credential in &item.credentials {
                let (credential_type, outcome) = cxf::validate_credential(credential);
                let passkey = match outcome {
                    Ok(passkey) => passkey,
                    Err(reason) => {
                        report.push_skipped(&item.title, &credential_type, &reason);
                        continue;
                    }
                };

                if !known.insert(&passkey) {
                    report.duplicates += 1;
                    continue;
                }

                if passkey.extensions_present {
                    report.push_skipped(
                        &item.title,
                        &credential_type,
                        cxf::EXTENSIONS_IGNORED_NOTE,
                    );
                }

                imported_entries.push(entry_from_passkey(
                    &item.title,
                    &item.tags,
                    item.creation_at,
                    item.modified_at,
                    &passkey,
                    now,
                ));
            }
        }
    }

    report.imported = u32::try_from(imported_entries.len()).unwrap_or(u32::MAX);

    // 5. One write, and only if the vault actually changes.
    if report.imported > 0 {
        loaded.vault.entries.extend(imported_entries);
        store::save_vault(vault, &mut loaded, manager).await?;
    }

    Ok(report)
}

/// The `(rp_id, credential_id)` pairs a vault already holds.
///
/// Built once before the merge and then kept up to date with every credential
/// imported, so a document that repeats a credential (or a credential already on
/// disk) can never store it twice.
struct PasskeyIndex {
    pairs: HashSet<(String, Vec<u8>)>,
}

impl PasskeyIndex {
    /// Collects the passkeys of `entries`, descending into groups.
    fn from_entries(entries: &[Entry]) -> Self {
        let mut pairs = HashSet::new();
        collect_pairs(entries, &mut pairs);
        Self { pairs }
    }

    /// Records `passkey`; returns `false` when the pair was already known.
    fn insert(&mut self, passkey: &ValidatedPasskey) -> bool {
        self.pairs
            .insert((passkey.rp_id.clone(), passkey.credential_id.clone()))
    }
}

/// Recursively inserts the `(rp_id, credential_id)` of every stored passkey.
fn collect_pairs(entries: &[Entry], pairs: &mut HashSet<(String, Vec<u8>)>) {
    for entry in entries {
        match entry {
            Entry::Passkey {
                rp_id,
                credential_id,
                ..
            } => {
                pairs.insert((rp_id.clone(), credential_id.clone()));
            }
            Entry::Group { children, .. } => collect_pairs(children, pairs),
            Entry::Data { .. } => {}
        }
    }
}

/// Builds the vault entry of a validated CXF passkey (plan §4.2 mapping).
///
/// * `name` ← `item.title`, or `username@rpId` when the title is blank (an
///   empty name would be invisible in the list UI); `tags` ← `item.tags` (empty
///   when absent);
/// * `created_at` / `updated_at` ← `item.creationAt` / `item.modifiedAt`, or
///   `now` when the item carries none; a missing `createdAt` falls back to
///   `modifiedAt` (so a `modifiedAt`-only item keeps its real timestamp) and
///   `updated_at` never precedes `created_at`;
/// * `rp_name` ← `rp_id` (ruling Q12), `algorithm` ← ES256, `sign_count` ← 0
///   (ruling Q15), `discoverable` ← `true`, `transports` ← `["internal"]`,
///   `aaguid` ← nil (ruling Q3);
/// * `private_key` ← the validated PKCS#8 bytes, through the single
///   implementation in [`cxf::secret_from_validated`].
fn entry_from_passkey(
    item_title: &str,
    item_tags: &Option<Vec<String>>,
    creation_at: Option<u64>,
    modified_at: Option<u64>,
    passkey: &ValidatedPasskey,
    now: DateTime<Utc>,
) -> Entry {
    // The fallback applies to the member that is missing, never to the one the
    // file carries: a `modifiedAt`-only item keeps its real timestamp instead of
    // having it rewritten to `now` by the clamp below.
    let created_at = creation_at
        .map(unix_to_datetime)
        .or_else(|| modified_at.map(unix_to_datetime))
        .unwrap_or(now);
    // A file may claim `modifiedAt < creationAt`; the entry must not.
    let updated_at = modified_at
        .map(unix_to_datetime)
        .unwrap_or(now)
        .max(created_at);

    // CXF has no non-empty rule on `title`; an empty name would make the entry
    // invisible in the list UI, so fall back to the identifier the user knows.
    let name = if item_title.trim().is_empty() {
        format!("{}@{}", passkey.user_name, passkey.rp_id)
    } else {
        item_title.to_string()
    };

    Entry::Passkey {
        id: Uuid::new_v4(),
        name,
        created_at,
        updated_at,
        tags: item_tags.clone().unwrap_or_default(),
        rp_id: passkey.rp_id.clone(),
        // CXF carries no RP display name; the RP ID is the honest value (Q12).
        rp_name: passkey.rp_id.clone(),
        credential_id: passkey.credential_id.clone(),
        user_handle: passkey.user_handle.clone(),
        user_name: passkey.user_name.clone(),
        user_display_name: passkey.user_display_name.clone(),
        private_key: cxf::secret_from_validated(passkey),
        algorithm: cxf::IMPORTED_ALGORITHM,
        sign_count: SIGN_COUNT,
        discoverable: true,
        transports: vec!["internal".to_string()],
        aaguid: Uuid::nil(),
    }
}

/// Converts a CXF UNIX-seconds timestamp to UTC.
///
/// A value outside `DateTime`'s range cannot come from a real export; it falls
/// back to the epoch instead of panicking, so a hostile file can only produce an
/// odd timestamp, never a crash.
fn unix_to_datetime(secs: u64) -> DateTime<Utc> {
    match i64::try_from(secs) {
        Ok(secs) => Utc.timestamp_opt(secs, 0).single().unwrap_or_else(epoch),
        Err(_) => epoch(),
    }
}

/// The UNIX epoch, the fallback of [`unix_to_datetime`].
fn epoch() -> DateTime<Utc> {
    Utc.timestamp_opt(0, 0)
        .single()
        .unwrap_or_else(|| DateTime::from_timestamp(0, 0).unwrap_or_default())
}

#[cfg(test)]
#[path = "passkey_import_tests.rs"]
mod tests;
