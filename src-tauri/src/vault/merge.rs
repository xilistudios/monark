//! Write-path merge: turn the sanitized IPC view back into a disk [`Vault`].
//!
//! The read path ([`crate::vault::lifecycle::read_vault`]) hands the frontend a
//! [`VaultView`] that has no passkey private keys at all. The write path
//! receives that same view back and must rebuild a *complete* disk vault from
//! it, re-attaching the secret material that only exists on disk.
//!
//! [`merge_vault_view`] implements the normative algorithm of the plan (§2.5):
//!
//! 1. **Index** the passkeys already stored on disk by entry id, remembering
//!    where each one lives in the group tree.
//! 2. **Duplicate guard** — an incoming tree that repeats an entry id is
//!    rejected (it would make the id → entry mapping ambiguous).
//! 3. **Convert / restore** — every incoming node is converted back to an
//!    [`Entry`]. Passkey nodes take their immutable core (key material, RP id,
//!    credential id, …) from the disk index and only the user-editable fields
//!    from the view. An id that is not on disk **fails closed**: the backend
//!    never fabricates or accepts key material from IPC.
//! 4. **Preservation pass** — passkeys present on disk but absent from the
//!    incoming tree are re-inserted unchanged (at their original group path
//!    when it survives, otherwise at the root). A full-vault write from a stale
//!    frontend view must never delete a passkey: losing one is a lockout at the
//!    relying party. Deletion goes through the dedicated `passkey_delete`
//!    command instead.
//!
//! Field mutability (CXF §3.3.12.1 — only the user name and the display name are
//! user-editable) is documented on [`crate::models::Entry::Passkey`]:
//!
//! * mutable from the view: `name`, `tags`, `user_name`, `user_display_name`,
//!   `updated_at`;
//! * immutable (always taken from disk): `id`, `created_at`, `rp_id`, `rp_name`,
//!   `credential_id`, `user_handle`, `private_key`, `algorithm`, `sign_count`,
//!   `discoverable`, `transports`, `aaguid`.

use crate::commands::errors::CommandError;
use crate::models::{Entry, EntryView, PasskeyView, SecretPkcs8, Vault, VaultView};
use std::collections::{HashMap, HashSet};
use uuid::Uuid;

/// The immutable part of a stored passkey, cloned out of the disk vault.
///
/// Everything here is authoritative: the frontend view can never change it.
#[derive(Debug, Clone, PartialEq)]
pub struct PasskeyCore {
    pub id: Uuid,
    pub created_at: chrono::DateTime<chrono::Utc>,
    pub rp_id: String,
    pub rp_name: String,
    pub credential_id: Vec<u8>,
    pub user_handle: Vec<u8>,
    pub private_key: SecretPkcs8,
    pub algorithm: i32,
    pub sign_count: u32,
    pub discoverable: bool,
    pub transports: Vec<String>,
    pub aaguid: Uuid,
}

/// A passkey found on disk, plus the group path that contains it.
///
/// `entry` is the disk entry **verbatim**: the preservation pass re-inserts it
/// unchanged, so a stale write cannot lose or rewrite a passkey it never saw.
/// `parent_path` lists group ids from the root down to the containing group; an
/// empty vector means the passkey sits at the vault root.
#[derive(Debug, Clone, PartialEq)]
pub struct DiskPasskey {
    pub core: PasskeyCore,
    pub entry: Entry,
    pub parent_path: Vec<Uuid>,
}

/// Converts an incoming IPC view into a disk [`Vault`], restoring passkey secret
/// material from `disk` and preserving passkeys the view does not mention.
///
/// `disk` is the vault currently stored on disk (decrypted). For a brand-new
/// vault pass an empty one — any passkey in the payload then fails closed,
/// because there is no key material to restore.
///
/// The returned vault keeps the incoming `updated_at`/`hmac`; callers stamp
/// `updated_at` themselves.
pub fn merge_vault_view(incoming: VaultView, disk: &Vault) -> Result<Vault, CommandError> {
    let index = index_disk_passkeys(&disk.entries);

    let mut seen = HashSet::new();
    ensure_unique_ids(&incoming.entries, &mut seen)?;

    let mut entries = convert_entries(&incoming.entries, &index)?;

    preserve_missing_passkeys(&mut entries, &index, &seen);

    Ok(Vault {
        updated_at: incoming.updated_at,
        hmac: incoming.hmac.clone(),
        entries,
    })
}

/// Walks `entries` recursively and indexes every passkey by entry id.
fn index_disk_passkeys(entries: &[Entry]) -> HashMap<Uuid, DiskPasskey> {
    let mut index = HashMap::new();
    index_entries(entries, &mut Vec::new(), &mut index);
    index
}

fn index_entries(
    entries: &[Entry],
    parent_path: &mut Vec<Uuid>,
    index: &mut HashMap<Uuid, DiskPasskey>,
) {
    for entry in entries {
        match entry {
            Entry::Group { id, children, .. } => {
                parent_path.push(*id);
                index_entries(children, parent_path, index);
                parent_path.pop();
            }
            Entry::Passkey {
                id,
                created_at,
                rp_id,
                rp_name,
                credential_id,
                user_handle,
                private_key,
                algorithm,
                sign_count,
                discoverable,
                transports,
                aaguid,
                ..
            } => {
                index.insert(
                    *id,
                    DiskPasskey {
                        core: PasskeyCore {
                            id: *id,
                            created_at: *created_at,
                            rp_id: rp_id.clone(),
                            rp_name: rp_name.clone(),
                            credential_id: credential_id.clone(),
                            user_handle: user_handle.clone(),
                            private_key: private_key.clone(),
                            algorithm: *algorithm,
                            sign_count: *sign_count,
                            discoverable: *discoverable,
                            transports: transports.clone(),
                            aaguid: *aaguid,
                        },
                        entry: entry.clone(),
                        parent_path: parent_path.clone(),
                    },
                );
            }
            Entry::Data { .. } => {}
        }
    }
}

/// Rejects an incoming tree that repeats an entry id (any type, any depth).
fn ensure_unique_ids(entries: &[EntryView], seen: &mut HashSet<Uuid>) -> Result<(), CommandError> {
    for entry in entries {
        let id = match entry {
            EntryView::Group { id, .. } => *id,
            EntryView::Data { id, .. } => *id,
            EntryView::Passkey(view) => view.id,
        };
        if !seen.insert(id) {
            return Err(CommandError::Validation(
                "Duplicate entry id in vault content".to_string(),
            ));
        }
        if let EntryView::Group { children, .. } = entry {
            ensure_unique_ids(children, seen)?;
        }
    }
    Ok(())
}

/// Converts the incoming tree, restoring passkey cores from `index`.
fn convert_entries(
    entries: &[EntryView],
    index: &HashMap<Uuid, DiskPasskey>,
) -> Result<Vec<Entry>, CommandError> {
    entries
        .iter()
        .map(|entry| convert_entry(entry, index))
        .collect()
}

fn convert_entry(
    entry: &EntryView,
    index: &HashMap<Uuid, DiskPasskey>,
) -> Result<Entry, CommandError> {
    match entry {
        EntryView::Group {
            id,
            name,
            data_type,
            children,
        } => Ok(Entry::Group {
            id: *id,
            name: name.clone(),
            data_type: data_type.clone(),
            children: convert_entries(children, index)?,
        }),
        EntryView::Data {
            id,
            name,
            data_type,
            created_at,
            updated_at,
            fields,
            tags,
        } => Ok(Entry::Data {
            id: *id,
            name: name.clone(),
            data_type: data_type.clone(),
            created_at: *created_at,
            updated_at: *updated_at,
            fields: fields.clone(),
            tags: tags.clone(),
        }),
        EntryView::Passkey(view) => restore_passkey(view, index),
    }
}

/// Rebuilds a disk passkey from its view, taking the immutable core from disk.
///
/// Fails closed when the id is not on disk: there is no key material to
/// re-attach, and the backend must never accept one from IPC.
fn restore_passkey(
    view: &PasskeyView,
    index: &HashMap<Uuid, DiskPasskey>,
) -> Result<Entry, CommandError> {
    let disk = index.get(&view.id).ok_or_else(|| {
        CommandError::Validation(
            "Passkey entry has no stored key material; create or import it first".to_string(),
        )
    })?;
    let core = &disk.core;

    Ok(Entry::Passkey {
        id: core.id,
        name: view.name.clone(),
        created_at: core.created_at,
        updated_at: view.updated_at,
        tags: view.tags.clone(),
        rp_id: core.rp_id.clone(),
        rp_name: core.rp_name.clone(),
        credential_id: core.credential_id.clone(),
        user_handle: core.user_handle.clone(),
        user_name: view.user_name.clone(),
        user_display_name: view.user_display_name.clone(),
        private_key: core.private_key.clone(),
        algorithm: core.algorithm,
        sign_count: core.sign_count,
        discoverable: core.discoverable,
        transports: core.transports.clone(),
        aaguid: core.aaguid,
    })
}

/// Re-inserts every disk passkey the incoming tree did not mention.
///
/// The entry is re-inserted unchanged (it comes straight from disk), at its
/// original group path when every group of that path still exists in the
/// result, otherwise at the root. `seen` holds the ids the incoming tree
/// carried, so a passkey the view *did* mention is not duplicated.
fn preserve_missing_passkeys(
    entries: &mut Vec<Entry>,
    index: &HashMap<Uuid, DiskPasskey>,
    seen: &HashSet<Uuid>,
) {
    // Deterministic order: sort by id so the result does not depend on the
    // HashMap iteration order.
    let mut missing: Vec<&DiskPasskey> = index
        .values()
        .filter(|disk| !seen.contains(&disk.core.id))
        .collect();
    missing.sort_by_key(|disk| disk.core.id);

    for disk in missing {
        // The disk entry is re-inserted verbatim: metadata included.
        if !insert_at_path(entries, &disk.parent_path, disk.entry.clone()) {
            entries.push(disk.entry.clone());
        }
    }
}

/// Inserts `entry` into the group identified by `parent_path`.
///
/// Returns `false` (and inserts nothing) when any group of the path is missing
/// from `entries` — the caller then falls back to the root.
fn insert_at_path(entries: &mut Vec<Entry>, parent_path: &[Uuid], entry: Entry) -> bool {
    let Some((first, rest)) = parent_path.split_first() else {
        entries.push(entry);
        return true;
    };

    for node in entries.iter_mut() {
        if let Entry::Group { id, children, .. } = node {
            if id == first {
                return insert_at_path(children, rest, entry);
            }
        }
    }
    false
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::{EntryView, Field, PasskeyView, VaultView};
    use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
    use chrono::{DateTime, TimeZone, Utc};
    use uuid::Uuid;

    /// Test-only PKCS#8 DER blob (not a real credential).
    const TEST_PKCS8_DER: [u8; 16] = [
        0x30, 0x0e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x04, 0x02, 0x03,
        0x04,
    ];

    const PASSKEY_ID: Uuid = Uuid::from_bytes([0x11; 16]);
    const GROUP_ID: Uuid = Uuid::from_bytes([0x33; 16]);

    fn fixed_time() -> DateTime<Utc> {
        Utc.with_ymd_and_hms(2026, 1, 2, 3, 4, 5)
            .single()
            .expect("valid fixed timestamp")
    }

    fn disk_passkey(id: Uuid) -> Entry {
        Entry::Passkey {
            id,
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

    fn disk_data(id: Uuid) -> Entry {
        Entry::Data {
            id,
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
            tags: vec!["personal".to_string()],
        }
    }

    /// Disk vault: root group `GROUP_ID` holding the passkey, plus a root data
    /// entry.
    fn disk_vault() -> Vault {
        Vault {
            updated_at: fixed_time(),
            hmac: "disk-hmac".to_string(),
            entries: vec![
                Entry::Group {
                    id: GROUP_ID,
                    name: "Root".to_string(),
                    data_type: "group".to_string(),
                    children: vec![disk_passkey(PASSKEY_ID)],
                },
                disk_data(Uuid::from_bytes([0x44; 16])),
            ],
        }
    }

    fn key_b64() -> String {
        URL_SAFE_NO_PAD.encode(TEST_PKCS8_DER)
    }

    /// The passkey view for `PASSKEY_ID`, as the frontend would send it back.
    fn passkey_view() -> PasskeyView {
        let entry_view = EntryView::from(&disk_passkey(PASSKEY_ID));
        let EntryView::Passkey(view) = &entry_view else {
            panic!("disk passkey must convert to a passkey view");
        };
        view.clone()
    }

    /// Incoming view that mirrors `disk_vault()` (round-trip baseline).
    fn roundtrip_view() -> VaultView {
        VaultView::from(&disk_vault())
    }

    fn find_passkey(entries: &[Entry], id: Uuid) -> Option<&Entry> {
        for entry in entries {
            match entry {
                Entry::Group { children, .. } => {
                    if let Some(found) = find_passkey(children, id) {
                        return Some(found);
                    }
                }
                Entry::Passkey { id: entry_id, .. } if *entry_id == id => return Some(entry),
                _ => {}
            }
        }
        None
    }

    fn count_passkeys(entries: &[Entry]) -> usize {
        entries
            .iter()
            .map(|entry| match entry {
                Entry::Group { children, .. } => count_passkeys(children),
                Entry::Passkey { .. } => 1,
                Entry::Data { .. } => 0,
            })
            .sum()
    }

    // ---------------------------------------------------------------------
    // Criterion 1 — round-trip preserves keys
    // ---------------------------------------------------------------------

    #[test]
    fn roundtrip_preserves_passkey_key_material() -> Result<(), CommandError> {
        let disk = disk_vault();
        let merged = merge_vault_view(VaultView::from(&disk), &disk)?;

        assert_eq!(merged, disk, "a pure view round-trip must be lossless");

        let Some(Entry::Passkey { private_key, .. }) = find_passkey(&merged.entries, PASSKEY_ID)
        else {
            panic!("the merged vault must still hold the passkey");
        };
        assert_eq!(
            private_key.to_pkcs8_der()?,
            TEST_PKCS8_DER.to_vec(),
            "the private key must be restored byte-identically from disk"
        );

        Ok(())
    }

    #[test]
    fn roundtrip_keeps_incoming_updated_at_and_hmac() -> Result<(), CommandError> {
        let disk = disk_vault();
        let mut view = VaultView::from(&disk);
        view.hmac = "incoming-hmac".to_string();
        let later = fixed_time() + chrono::Duration::hours(1);
        view.updated_at = later;

        let merged = merge_vault_view(view, &disk)?;

        assert_eq!(merged.hmac, "incoming-hmac");
        assert_eq!(
            merged.updated_at, later,
            "the caller stamps updated_at; the merge must not invent one"
        );

        Ok(())
    }

    // ---------------------------------------------------------------------
    // Criterion 2 — metadata edit applies, immutable core comes from disk
    // ---------------------------------------------------------------------

    #[test]
    fn metadata_edits_apply_but_immutable_core_comes_from_disk() -> Result<(), CommandError> {
        let disk = disk_vault();
        let mut view = VaultView::from(&disk);

        let EntryView::Group { children, .. } = &mut view.entries[0] else {
            panic!("expected a group view at the root");
        };
        let EntryView::Passkey(passkey) = &mut children[0] else {
            panic!("expected a passkey view inside the group");
        };

        // Mutable fields: the view wins.
        passkey.name = "GitHub (work)".to_string();
        passkey.tags = vec!["work".to_string(), "critical".to_string()];
        passkey.user_name = "octocat2".to_string();
        passkey.user_display_name = "The Octocat II".to_string();
        passkey.updated_at = fixed_time() + chrono::Duration::days(1);

        // Immutable fields: the view is ignored, disk wins.
        passkey.rp_id = "evil.example".to_string();
        passkey.rp_name = "Evil".to_string();
        passkey.credential_id = vec![0x00];
        passkey.user_handle = vec![0xff];
        passkey.algorithm = -257;
        passkey.sign_count = 42;
        passkey.discoverable = false;
        passkey.transports = vec!["usb".to_string()];
        passkey.aaguid = Uuid::from_bytes([0x99; 16]);
        passkey.created_at = fixed_time() - chrono::Duration::days(30);

        let merged = merge_vault_view(view, &disk)?;

        let Some(Entry::Passkey {
            name,
            tags,
            user_name,
            user_display_name,
            updated_at,
            created_at,
            rp_id,
            rp_name,
            credential_id,
            user_handle,
            algorithm,
            sign_count,
            discoverable,
            transports,
            aaguid,
            private_key,
            ..
        }) = find_passkey(&merged.entries, PASSKEY_ID)
        else {
            panic!("the merged vault must still hold the passkey");
        };

        assert_eq!(name, "GitHub (work)");
        assert_eq!(tags, &vec!["work".to_string(), "critical".to_string()]);
        assert_eq!(user_name, "octocat2");
        assert_eq!(user_display_name, "The Octocat II");
        assert_eq!(*updated_at, fixed_time() + chrono::Duration::days(1));

        assert_eq!(*created_at, fixed_time(), "created_at is immutable");
        assert_eq!(rp_id, "github.com", "rp_id is immutable");
        assert_eq!(rp_name, "GitHub", "rp_name is immutable");
        assert_eq!(credential_id, &vec![0xde, 0xad, 0xbe, 0xef]);
        assert_eq!(user_handle, &vec![0x01, 0x02, 0x03, 0x04]);
        assert_eq!(*algorithm, -7);
        assert_eq!(*sign_count, 0);
        assert!(*discoverable);
        assert_eq!(transports, &vec!["internal".to_string()]);
        assert_eq!(*aaguid, Uuid::nil());
        assert_eq!(private_key.to_pkcs8_der()?, TEST_PKCS8_DER.to_vec());

        Ok(())
    }

    // ---------------------------------------------------------------------
    // Criterion 3 — stale write preserves passkeys
    // ---------------------------------------------------------------------

    #[test]
    fn stale_view_preserves_passkey_at_its_group_path() -> Result<(), CommandError> {
        let disk = disk_vault();

        // A stale Redux view: it knows about the group but not the passkey
        // (e.g. it was captured right before a backend-side `passkey_create`).
        let view = VaultView {
            updated_at: fixed_time(),
            hmac: String::new(),
            entries: vec![EntryView::Group {
                id: GROUP_ID,
                name: "Root".to_string(),
                data_type: "group".to_string(),
                children: Vec::new(),
            }],
        };

        let merged = merge_vault_view(view, &disk)?;

        let EntryView::Group { children, .. } = &VaultView::from(&merged).entries[0] else {
            panic!("expected a group at the root");
        };
        assert_eq!(
            children.len(),
            1,
            "the passkey must be re-inserted into its surviving group"
        );
        assert_eq!(
            find_passkey(&merged.entries, PASSKEY_ID),
            Some(&disk_passkey(PASSKEY_ID)),
            "the preserved entry must be the disk entry, unchanged"
        );

        Ok(())
    }

    #[test]
    fn stale_view_preserves_passkey_at_root_when_group_is_gone() -> Result<(), CommandError> {
        let disk = disk_vault();

        // The stale view also dropped the containing group.
        let view = VaultView {
            updated_at: fixed_time(),
            hmac: String::new(),
            entries: Vec::new(),
        };

        let merged = merge_vault_view(view, &disk)?;

        assert_eq!(
            merged.entries,
            vec![disk_passkey(PASSKEY_ID)],
            "with the group gone, the passkey is appended at the root"
        );

        Ok(())
    }

    #[test]
    fn stale_view_preserves_every_passkey_once() -> Result<(), CommandError> {
        let disk = Vault {
            updated_at: fixed_time(),
            hmac: String::new(),
            entries: vec![
                disk_passkey(PASSKEY_ID),
                disk_passkey(Uuid::from_bytes([0x22; 16])),
            ],
        };

        let merged = merge_vault_view(
            VaultView {
                updated_at: fixed_time(),
                hmac: String::new(),
                entries: Vec::new(),
            },
            &disk,
        )?;

        assert_eq!(count_passkeys(&merged.entries), 2);
        assert!(find_passkey(&merged.entries, PASSKEY_ID).is_some());
        assert!(find_passkey(&merged.entries, Uuid::from_bytes([0x22; 16])).is_some());

        Ok(())
    }

    #[test]
    fn mentioned_passkey_is_not_duplicated() -> Result<(), CommandError> {
        let disk = disk_vault();
        let merged = merge_vault_view(roundtrip_view(), &disk)?;

        assert_eq!(
            count_passkeys(&merged.entries),
            1,
            "a passkey present in the view must not be re-inserted by the preservation pass"
        );

        Ok(())
    }

    // ---------------------------------------------------------------------
    // Criterion 4 — unknown passkey id fails closed
    // ---------------------------------------------------------------------

    #[test]
    fn unknown_passkey_id_fails_closed() {
        let disk = disk_vault();
        let mut view = roundtrip_view();

        let EntryView::Group { children, .. } = &mut view.entries[0] else {
            panic!("expected a group view at the root");
        };
        let EntryView::Passkey(passkey) = &mut children[0] else {
            panic!("expected a passkey view inside the group");
        };
        passkey.id = Uuid::from_bytes([0x77; 16]);

        match merge_vault_view(view, &disk) {
            Err(CommandError::Validation(msg)) => {
                assert!(
                    msg.contains("no stored key material"),
                    "unexpected message: {msg}"
                );
                assert!(
                    !msg.contains(&Uuid::from_bytes([0x77; 16]).to_string()),
                    "the error must not echo the entry id: {msg}"
                );
            }
            other => panic!("expected CommandError::Validation, got {other:?}"),
        }
    }

    #[test]
    fn passkey_in_a_brand_new_vault_fails_closed() {
        // `create_new_vault` merges against an empty disk vault: a passkey in a
        // creation payload has no key material to restore.
        let empty = Vault {
            updated_at: fixed_time(),
            hmac: String::new(),
            entries: Vec::new(),
        };
        let view = VaultView {
            updated_at: fixed_time(),
            hmac: String::new(),
            entries: vec![EntryView::Passkey(passkey_view())],
        };

        assert!(matches!(
            merge_vault_view(view, &empty),
            Err(CommandError::Validation(_))
        ));
    }

    // ---------------------------------------------------------------------
    // Criterion 5 — duplicate ids rejected
    // ---------------------------------------------------------------------

    #[test]
    fn duplicate_leaf_ids_are_rejected() {
        let disk = disk_vault();
        let mut view = roundtrip_view();
        let duplicate = view.entries[1].clone();
        view.entries.push(duplicate);

        match merge_vault_view(view, &disk) {
            Err(CommandError::Validation(msg)) => {
                assert!(
                    msg.contains("Duplicate entry id"),
                    "unexpected message: {msg}"
                );
            }
            other => panic!("expected CommandError::Validation, got {other:?}"),
        }
    }

    #[test]
    fn duplicate_group_and_leaf_ids_are_rejected() {
        let disk = disk_vault();
        let view = VaultView {
            updated_at: fixed_time(),
            hmac: String::new(),
            entries: vec![
                EntryView::Group {
                    id: GROUP_ID,
                    name: "Root".to_string(),
                    data_type: "group".to_string(),
                    children: Vec::new(),
                },
                EntryView::Data {
                    id: GROUP_ID,
                    name: "Clash".to_string(),
                    data_type: "note".to_string(),
                    created_at: fixed_time(),
                    updated_at: fixed_time(),
                    fields: Vec::new(),
                    tags: Vec::new(),
                },
            ],
        };

        assert!(matches!(
            merge_vault_view(view, &disk),
            Err(CommandError::Validation(_))
        ));
    }

    #[test]
    fn duplicate_ids_nested_in_groups_are_rejected() {
        let disk = disk_vault();
        let view = VaultView {
            updated_at: fixed_time(),
            hmac: String::new(),
            entries: vec![EntryView::Group {
                id: GROUP_ID,
                name: "Root".to_string(),
                data_type: "group".to_string(),
                children: vec![
                    EntryView::from(&disk_data(Uuid::from_bytes([0x55; 16]))),
                    EntryView::from(&disk_data(Uuid::from_bytes([0x55; 16]))),
                ],
            }],
        };

        assert!(matches!(
            merge_vault_view(view, &disk),
            Err(CommandError::Validation(_))
        ));
    }

    // ---------------------------------------------------------------------
    // Criterion 6 — data entries unaffected
    // ---------------------------------------------------------------------

    #[test]
    fn data_entries_roundtrip_and_edits_apply() -> Result<(), CommandError> {
        let disk = disk_vault();
        let mut view = roundtrip_view();

        let EntryView::Data {
            name, fields, tags, ..
        } = &mut view.entries[1]
        else {
            panic!("expected a data view at the root");
        };
        name.push_str(" (edited)");
        fields.clear();
        tags.push("edited".to_string());

        let merged = merge_vault_view(view, &disk)?;

        let Some(Entry::Data {
            name, fields, tags, ..
        }) = merged
            .entries
            .iter()
            .find(|entry| matches!(entry, Entry::Data { .. }))
        else {
            panic!("the data entry must survive the merge");
        };
        assert_eq!(name, "Mail (edited)");
        assert!(fields.is_empty());
        assert_eq!(tags, &vec!["personal".to_string(), "edited".to_string()]);

        Ok(())
    }

    #[test]
    fn deleting_a_data_entry_through_the_view_works() -> Result<(), CommandError> {
        let disk = disk_vault();
        let mut view = roundtrip_view();
        view.entries.pop(); // drop the root data entry

        let merged = merge_vault_view(view, &disk)?;

        assert_eq!(merged.entries.len(), 1);
        assert!(matches!(merged.entries[0], Entry::Group { .. }));

        Ok(())
    }

    #[test]
    fn empty_view_against_empty_disk_is_ok() -> Result<(), CommandError> {
        let empty = Vault {
            updated_at: fixed_time(),
            hmac: String::new(),
            entries: Vec::new(),
        };
        let merged = merge_vault_view(
            VaultView {
                updated_at: fixed_time(),
                hmac: String::new(),
                entries: Vec::new(),
            },
            &empty,
        )?;

        assert!(merged.entries.is_empty());
        Ok(())
    }

    // ---------------------------------------------------------------------
    // Helpers
    // ---------------------------------------------------------------------

    #[test]
    fn insert_at_path_reports_missing_group() {
        let mut entries = vec![Entry::Group {
            id: GROUP_ID,
            name: "Root".to_string(),
            data_type: "group".to_string(),
            children: Vec::new(),
        }];
        let missing = Uuid::from_bytes([0xee; 16]);

        assert!(!insert_at_path(
            &mut entries,
            &[missing],
            disk_passkey(PASSKEY_ID)
        ));
        assert!(find_passkey(&entries, PASSKEY_ID).is_none());
    }

    #[test]
    fn index_records_parent_paths() {
        let index = index_disk_passkeys(&disk_vault().entries);
        let entry = index.get(&PASSKEY_ID).expect("passkey is indexed");

        assert_eq!(entry.parent_path, vec![GROUP_ID]);
        assert_eq!(entry.core.rp_id, "github.com");
        assert_eq!(
            entry.core.private_key.to_pkcs8_der().expect("valid b64"),
            TEST_PKCS8_DER.to_vec()
        );
    }

    #[test]
    fn key_material_never_appears_in_the_view() {
        let view_json = serde_json::to_string(&roundtrip_view()).expect("view serializes");

        assert!(!view_json.contains("private_key"));
        assert!(!view_json.contains(&key_b64()));
    }
}
