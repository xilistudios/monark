//! CXF export command (T17): stored passkeys → CXF JSON, behind explicit consent.
//!
//! The command is deliberately small: it owns **consent**, the vault unlock and
//! the recursive collection of passkeys. Everything about the document itself
//! (envelope shape, version, `exporterRpId`, sign-count exclusion) lives in
//! [`crate::passkey::cxf`] (T15) and is reused verbatim, and the unlock path is
//! the [`store`] seam (T08), so this module adds no cryptography of its own.
//!
//! # Flow (in this exact order)
//!
//! 1. **Consent gate.** `consent != true` is a [`CommandError::Validation`]
//!    raised *before any IO*: no path validation, no file read, no rate-limit
//!    slot, no Argon2 derivation. A caller that forgot the consent flag can
//!    never make the command touch the disk, and a wrong password cannot mask
//!    the consent error (see the negative control in the tests).
//! 2. **Unlock** through [`store::load_vault`] (rate-limited, version-gated).
//! 3. **Collect** every [`Entry::Passkey`] of the tree, at any depth: passkeys
//!    nested inside groups are exported exactly like root-level ones.
//! 4. **Build** the document with [`cxf::build_export`] and return its JSON.
//!    A build that had to exclude anything fails closed (see below).
//!
//! # Read-only by construction
//!
//! Export never calls [`store::save_vault`]: the vault file is byte-identical
//! before and after a successful export (pinned by a test). There is no write
//! path in this module at all.
//!
//! # Secret handling
//!
//! The PKCS#8 private keys leave the decrypted vault blob **only** inside the
//! returned JSON string, which exists because the user consented to exporting
//! it. Nothing here logs, formats or interpolates key material: the only
//! strings this module produces are fixed error messages, and the export
//! document is never printed. `SecretPkcs8::as_b64url` is copied straight into
//! the CXF `key` member (no decode/re-encode round trip, hence no second secret
//! buffer to scrub).
//!
//! # Fail closed: a partial export is never returned
//!
//! [`cxf::build_export`] also returns `notes`/`exported`: a passkey with a
//! non-zero signature counter is **excluded** from the document and reported
//! through `notes` instead. Returning `outcome.json` unconditionally would hand
//! the user a valid-looking CXF file that silently **lost a credential** — the
//! exact "never silently" rule the CXF module is built around.
//!
//! In F0/F1 the counter is structurally `0` — the registration ceremony (T09)
//! and the CXF import (T16) both store `0` and nothing ever increments it
//! (ruling Q15) — so `notes` is empty for every vault this build writes. But
//! Monark also **reads** vault files produced by other builds and other
//! versions (the version gate accepts 1.0 and 1.1), so "unreachable" is a
//! property of our writers, not of the input space. The command therefore
//! checks `notes` and refuses the whole export when it is not empty: an error
//! the user can act on beats a document that is quietly incomplete.
//!
//! The rejection is a fixed [`CommandError::Validation`] string that echoes no
//! entry name, no key and no document content (the `notes` themselves do carry
//! entry names, so they are never forwarded). The signature stays
//! `Result<String, CommandError>` (ruling E15) — the failure is expressed as an
//! error, not as a richer success type.

use crate::commands::errors::CommandError;
use crate::commands::storage::StorageState;
use crate::models::Entry;
use crate::passkey::cxf::{self, ExportPasskey};
use crate::passkey::store::{self, VaultRef};
use std::sync::Arc;

/// Consent flag value that authorizes the export.
///
/// Named so the check reads as a policy ("explicit consent given") rather than
/// a bare boolean comparison.
const CONSENT_GIVEN: bool = true;

/// Message of the consent rejection. Fixed text: it never echoes the vault
/// reference, the password or any vault content.
///
/// Private on purpose: nothing outside this module (and its child test module)
/// needs it. The frontend cannot read a Rust constant, so the UI owns its own
/// copy of the wording; keeping this one private avoids advertising a
/// crate-wide contract that does not exist.
const CONSENT_REQUIRED_MESSAGE: &str = "Export requires explicit user consent";

/// Message of the fail-closed rejection (see the module docs).
///
/// Fixed text: it never echoes an entry name, a key or any document content.
/// The underlying `notes` name the excluded entries, so they are deliberately
/// not forwarded to the caller.
const PARTIAL_EXPORT_MESSAGE: &str =
    "Export aborted: one or more credentials have a non-zero signature counter and cannot be exchanged";

/// Exports the vault's passkeys as a CXF JSON document.
///
/// `consent` must be exactly `true`; anything else is refused before the vault
/// is touched. The returned string contains **private keys in plain text** — it
/// exists only because the user consented, and the caller must treat it as
/// secret material (write it where the user asked, never log it).
#[tauri::command(async)]
pub async fn export_cxf(
    vault: VaultRef,
    password: String,
    consent: bool,
    state: tauri::State<'_, StorageState>,
) -> Result<String, CommandError> {
    export_cxf_with(&vault, &password, consent, &state.manager).await
}

/// Body of [`export_cxf`], taking the storage manager directly.
///
/// The `tauri::State` wrapper only exists for IPC; keeping the logic here lets
/// the whole flow be tested end to end against a real local vault without
/// building a Tauri app (same pattern as `passkey_create_with`).
pub async fn export_cxf_with(
    vault: &VaultRef,
    password: &str,
    consent: bool,
    manager: &Arc<crate::storage::StorageManager>,
) -> Result<String, CommandError> {
    // 1. Consent first: nothing below this line may run without it, so a
    //    refused export costs no IO, no rate-limit slot and no Argon2 work.
    if consent != CONSENT_GIVEN {
        return Err(CommandError::Validation(
            CONSENT_REQUIRED_MESSAGE.to_string(),
        ));
    }

    // 2. Unlock (rate-limited + version-gated inside the seam).
    let loaded = store::load_vault(vault, password, manager).await?;

    // 3. Collect every passkey of the tree, groups included.
    let passkeys = collect_export_passkeys(&loaded.vault.entries);

    // 4. Build the document. `notes` is empty for every vault this build
    //    writes (Q15), but a foreign vault can carry a non-zero counter; in
    //    that case `build_export` excluded a credential and we must not hand
    //    back a document that silently lost it.
    let outcome = cxf::build_export(&passkeys)?;
    if !outcome.notes.is_empty() {
        // Fail closed. The notes are not echoed: they carry entry names.
        return Err(CommandError::Validation(PARTIAL_EXPORT_MESSAGE.to_string()));
    }
    Ok(outcome.json)
}

/// Collects the export projection of every passkey in `entries`, recursively.
///
/// Order is the vault's own depth-first order (root entries in order, a group's
/// children in place), so the export is deterministic for a given vault and an
/// item's position mirrors where the user sees the entry.
///
/// Non-passkey entries are skipped: [`ExportPasskey::from_entry`] returns `None`
/// for data entries and groups (groups are traversed, not exported).
///
/// Private: the only caller is [`export_cxf_with`] and the tests are a child
/// module, so no crate-wide API materialises key material outside the consent
/// gate.
fn collect_export_passkeys(entries: &[Entry]) -> Vec<ExportPasskey> {
    let mut collected = Vec::new();
    append_export_passkeys(entries, &mut collected);
    collected
}

/// Depth-first walk appending to `out` (kept private: the public entry point is
/// [`collect_export_passkeys`], which cannot be called with a partial buffer).
fn append_export_passkeys(entries: &[Entry], out: &mut Vec<ExportPasskey>) {
    for entry in entries {
        match entry {
            Entry::Group { children, .. } => append_export_passkeys(children, out),
            Entry::Passkey { .. } => {
                if let Some(passkey) = ExportPasskey::from_entry(entry) {
                    out.push(passkey);
                }
            }
            Entry::Data { .. } => {}
        }
    }
}

#[cfg(test)]
#[path = "passkey_export_tests.rs"]
mod tests;
