# Vault Format Workflow

```
+-------------------+         +--------------------------+         +-----------------------------+
|                   |         |                          |         |                             |
|      Disk         +--------->   Rust Backend           +--------->   TypeScript Frontend       |
| (Encrypted Vault) |         | (Version Check,          |         | (Vault Consumption,         |
|                   |         |  Decryption, Zeroization)|         |  Entry Mapping)             |
+-------------------+         +--------------------------+         +-----------------------------+
                                 |        |      |   |                       |
                                 v        v      v   v                       v
                          [Version]⚠️ [Decryption]⚠️ [Zeroize]⚠️         [Type Mapping]
```

---

## 1. Overview

This document describes the integrated workflow for the vault format, focusing on the secure flow of data from disk storage through Rust decryption and validation, into TypeScript consumption. It highlights the critical boundaries where encryption, decryption, and verification occur, and explains how core data structures are mapped between Rust and TypeScript.

- **Entry**: The term "entry" refers to any vault record (group, login, note, passkey, etc.) as defined in both Rust and TypeScript.
- The workflow enforces strict security practices, including a vault format version check, zeroization, and Argon2-based key derivation.
- Cross-language mappings ensure that vault data remains consistent and type-safe across both codebases.

> ⚠️ **The HMAC field is designed but NOT implemented.** `Vault.hmac`
> ([`models.rs`](../src-tauri/src/models.rs#L50)) is always an empty string today:
> no HMAC is computed on write and none is verified on read. Integrity of the
> vault blob comes from the XChaCha20-Poly1305 AEAD tag, not from an HMAC. Any
> statement in this document (or elsewhere) that claims "HMAC is verified before
> data is exposed" describes the *design intent*, not the current code.

---

## 1.1 Format Versions

`VaultFile.version` ([`models.rs`](../src-tauri/src/models.rs#L8-L15)) is the format
generation of the file. The policy lives in one place,
[`vault/version.rs`](../src-tauri/src/vault/version.rs):

| Constant / function | Value / behaviour |
|---------------------|-------------------|
| `CURRENT_VAULT_VERSION` | `"1.1"` — written by this build for new vaults |
| `SUPPORTED_VAULT_VERSIONS` | `["1.0", "1.1"]` — every version this build can read |
| `check_version(&str)` | `Err(CommandError::UnsupportedVersion(v))` for anything else |
| `has_passkey(&[Entry])` | recursive scan of the entry tree |
| `version_for_content(existing, &Vault)` | `"1.1"` iff the content holds a passkey, else `existing` |

* **1.0** — pre-passkey format: `group` and `entry` variants only.
* **1.1** — adds the `passkey` entry variant (`"entry_type":"passkey"`; shape
  documented in [`docs/passkeys.md`](passkeys.md)).

### Read path

`read_vault` and `read_cloud_vault` call `check_version` **immediately after the
`VaultFile` is parsed, and before the rate-limit gate and the Argon2
derivation**. A version mismatch is not an authentication failure: it costs no
Argon2 work, consumes no rate-limit attempt, and is reported as
`UnsupportedVersion(<version>)` so the UI can name the version it needs.

### Write path

* **Create** always writes `CURRENT_VAULT_VERSION` (`"1.1"`).
* **Update** keeps the version the file already had, and bumps it to `"1.1"`
  **iff** the merged content contains at least one passkey. A 1.0 vault without
  passkeys therefore stays 1.0 forever, which keeps it readable by older
  clients. The bump is content-driven on purpose: the version string is only
  raised when the file really becomes unreadable by a pre-passkey client.

### Old-client behaviour (what a pre-passkey build does with a 1.1 file)

Old clients never look at `version`. What they do depends on the *content*:

* a 1.1 vault **without** passkeys opens normally on an old client (the JSON is
  identical to 1.0);
* a 1.1 vault **with** passkeys fails deserialization of the unknown
  `"entry_type":"passkey"` variant. The old client reports "Failed to
  deserialize vault" and refuses to open the vault: **no partial read, no data
  loss, no silent drop** of the passkey. This is pinned by
  `vault::tests::version::old_client_cannot_deserialize_passkey_vault`, which
  deserializes the real stored JSON with a local replica of the pre-passkey
  `Entry` enum.

New clients give the clear `UnsupportedVersion` error for future formats
(`"1.2"`, `"2.0"`, …) instead of a generic deserialization failure.

---

## 2. Data Flow

The vault data flow is a multi-stage process ensuring confidentiality and integrity from disk to application memory:

1. **Disk Storage**
   - The vault is stored as an encrypted file, containing a format `version`, ciphertext, and Argon2 parameters ([`VaultFile`](../src-tauri/src/models.rs#L8-L15)).
2. **Rust Backend**
   - On load, Rust reads the file, checks the format version, and decrypts it:
     - **Version Check**: `version::check_version` runs before any KDF work (see §1.1).
       ⚠️ *Boundary: an unsupported format is rejected before a password is even derived.*
     - **Decryption/Encryption Boundaries**: All cryptographic operations are handled within Rust ([`EncryptedVault`](../src-tauri/src/models.rs#L403-L413)).
       ⚠️ *Boundary: Decrypted data never leaves Rust until the AEAD tag verifies and secrets are zeroized.*
     - **HMAC**: designed, **not implemented** — the field is always empty (see the note in §1).
3. **TypeScript Consumption**
   - Once decrypted, Rust serializes the sanitized view as JSON and passes it to TypeScript for consumption.

**Security Boundaries:**
- All cryptographic checks and the format version check are performed in Rust before data is exposed to the frontend.
- Only validated, decrypted data is ever accessible in TypeScript.

---

## 3. Type Mappings

Seamless integration between Rust and TypeScript relies on precise type mapping and serialization:

### Entry Mapping

- **Rust**: The `Entry` enum defines all possible entry types ([`models.rs`](../src-tauri/src/models.rs#L56-L78)).
- **TypeScript**: The `Entry` union mirrors these variants ([`vault.interface.ts`](../src/interfaces/vault.interface.ts#L68)).
- **Mapping**: Each Rust variant is serialized to a discriminated union in TypeScript, preserving structure and type safety.

### Entry Shapes (disk)

`Entry` is internally tagged on `entry_type`
([`models.rs`](../src-tauri/src/models.rs#L58-L60)) and has three variants:

| `entry_type` | Variant | Fields | Anchor |
|---|---|---|---|
| `group` | `Entry::Group` | `id`, `name`, `data_type`, `children` — **no timestamps** | [`models.rs`](../src-tauri/src/models.rs#L61-L67) |
| `entry` | `Entry::Data` | `id`, `name`, `data_type`, `created_at`, `updated_at`, `fields`, `tags` | [`models.rs`](../src-tauri/src/models.rs#L68-L77) |
| `passkey` | `Entry::Passkey` | `id`, `name`, `created_at`, `updated_at`, `tags`, `rp_id`, `rp_name`, `credential_id`, `user_handle`, `user_name`, `user_display_name`, **`private_key`**, `algorithm`, `sign_count`, `discoverable`, `transports`, `aaguid` | [`models.rs`](../src-tauri/src/models.rs#L94-L127) |

`Entry::Passkey` has **no `data_type`** (it is not a user-typed entry) and its
`private_key` is a [`SecretPkcs8`](../src-tauri/src/models.rs#L138): PKCS#8 DER
stored as a URL_SAFE_NO_PAD base64 string, `ZeroizeOnDrop`, with a redacted
`Debug` ([`models.rs`](../src-tauri/src/models.rs#L140-L144)). `credential_id` and
`user_handle` are raw bytes serialized as base64url
([`b64url_serde`](../src-tauri/src/models.rs#L196-L210)).

### Passkey: disk shape → IPC view

The IPC family (`VaultView`/`EntryView`) is **not** the disk family. A passkey
crosses the boundary as `PasskeyView`
([`models.rs`](../src-tauri/src/models.rs#L246-L270)), which is `Entry::Passkey`
**minus `private_key`**:

| Disk field (`Entry::Passkey`) | IPC field (`PasskeyView`) | Notes |
|---|---|---|
| `id` | `id` | UUID |
| `name` | `name` | user-editable |
| `created_at` | `created_at` | immutable |
| `updated_at` | `updated_at` | user-editable |
| `tags` | `tags` | user-editable |
| `rp_id` | `rp_id` | immutable; ASCII-lowercase canonical |
| `rp_name` | `rp_name` | immutable |
| `credential_id` | `credential_id` | immutable; base64url |
| `user_handle` | `user_handle` | immutable; base64url |
| `user_name` | `user_name` | user-editable |
| `user_display_name` | `user_display_name` | user-editable |
| `private_key` | — | **absent by construction** |
| `algorithm` | `algorithm` | immutable; COSE `-7` |
| `sign_count` | `sign_count` | immutable; always `0` |
| `discoverable` | `discoverable` | immutable; always `true` |
| `transports` | `transports` | immutable |
| `aaguid` | `aaguid` | immutable; `Uuid::nil()` |

The conversion is `From<&Entry> for EntryView`
([`models.rs`](../src-tauri/src/models.rs#L315-L385)); its passkey arm destructures
with `..` and never reads `private_key`
([`models.rs`](../src-tauri/src/models.rs#L346)). There is no field on the IPC side
to carry it, so a key cannot cross the boundary even by mistake. The TypeScript
mirror is `PasskeyEntry` ([`vault.interface.ts`](../src/interfaces/vault.interface.ts#L46-L66)),
which likewise has no `private_key` member.

### Passkey: write-merge (view → disk)

Because the view has no key, a full-vault write must rebuild the disk entry.
`merge_vault_view` ([`vault/merge.rs`](../src-tauri/src/vault/merge.rs#L81)) takes
the immutable core from the vault already on disk and only the user-editable
fields from the view ([`restore_passkey`](../src-tauri/src/vault/merge.rs#L231-L261)),
then **re-inserts every disk passkey the view did not mention**
([`preserve_missing_passkeys`](../src-tauri/src/vault/merge.rs#L269-L288)). Omitting a
passkey from a write therefore does **not** delete it; deletion goes through the
dedicated `passkey_delete` command. A view that names a passkey id absent from
disk fails closed ([`merge.rs`](../src-tauri/src/vault/merge.rs#L231-L240)).

Full rationale, ceremony model and threat model:
[`docs/passkeys.md`](passkeys.md).

### Passkey: provisioning path (CXF import/export)

A passkey reaches a vault by exactly two routes: the registration ceremony
(`passkey_create`) or a **CXF import** (`import_cxf`), and it leaves it only via
`passkey_delete` or a **CXF export** (`export_cxf`). Both CXF commands go
through the same store seam as every other passkey command
([`passkey_import.rs`](../src-tauri/src/commands/passkey_import.rs#L100-L165),
[`passkey_export.rs`](../src-tauri/src/commands/passkey_export.rs#L112-L142)),
so the on-disk shape is unchanged: an imported passkey is a plain
`Entry::Passkey` at the vault root, and an export only *reads* the vault.

Two consequences for this document's format rules:

* An import that brings in at least one passkey bumps the file to **1.1** like
  any other passkey write (§1.1); an import that imports nothing does not write
  the file at all, so the version is untouched.
* The exported `.cxf.json` is **not** a vault file and is **not** encrypted — it
  is a plaintext key export. See
  [`docs/passkeys.md` §11](passkeys.md#11-cxf-importexport-f1), in particular
  §11.8 for the threat model.

### DateTime Conversion

- **Rust**: Timestamps use `DateTime<Utc>`, serialized with `.to_rfc3339()` ([`models.rs`](../src-tauri/src/models.rs#L428-L436)).
- **TypeScript**: Consumes these as ISO 8601 strings, ensuring cross-language consistency.

### Field Structure Alignment

- **Rust**: Entry fields are defined in structs ([`models.rs`](../src-tauri/src/models.rs#L88-L96)).
- **TypeScript**: Corresponding interfaces match these fields ([`vault.interface.ts`](../src/interfaces/vault.interface.ts#L36-L41)).
- **Alignment**: Field names and types must remain synchronized to avoid runtime errors.

⚠️ **Pitfall:**
Any mismatch in enum variants, field names, or types between Rust and TypeScript will cause deserialization failures or runtime bugs. Always update both sides together.

---

## 4. Security Considerations

Security is enforced at every stage of the workflow:

- **Zeroization Strategy**
  - Sensitive data is zeroized on drop using `ZeroizeOnDrop` on the vault types — `Argon2Params`, `Vault`, `Entry` ([`models.rs`](../src-tauri/src/models.rs#L32-L32), [`models.rs`](../src-tauri/src/models.rs#L46-L46), [`models.rs`](../src-tauri/src/models.rs#L58-L58)) — and on `Field`, whose `value` holds the secret ([`models.rs`](../src-tauri/src/models.rs#L224-L224)).
    ⚠️ *Ensures secrets are not left in memory after use.*

- **Secret Field Handling**
  - Secret fields are explicitly marked and handled in TypeScript ([`vault.interface.ts`](../src/interfaces/vault.interface.ts#L76-L81)).
    ⚠️ *Never expose secrets in logs or UI without explicit user action.*

- **Argon2 Parameter Consistency**
  - Argon2 parameters are defined and enforced in Rust ([`models.rs`](../src-tauri/src/models.rs#L19-L28)).
    ⚠️ *Parameter drift between Rust and TypeScript will break decryption.*

- **Vault Format Version**
  - The version is checked before the rate limiter and the Argon2 derivation ([`vault/version.rs`](../src-tauri/src/vault/version.rs)).
    ⚠️ *A vault from a newer format is rejected with `UnsupportedVersion`, never half-read.*

- **HMAC (designed, not implemented)**
  - `Vault.hmac` ([`models.rs`](../src-tauri/src/models.rs#L50)) is always empty: no HMAC is written or verified today.
    ⚠️ *Do not rely on it for integrity; the AEAD tag of the vault blob is what detects tampering.*

---

## 5. Navigation Patterns

Vault navigation and entry lookup are implemented consistently across both codebases:

- **Path Traversal**
  - TypeScript uses `findEntryByPath()` to traverse entry trees ([`vault.interface.ts`](../src/interfaces/vault.interface.ts#L59-L78)).
    ⚠️ *Invalid paths may result in undefined or incorrect entries. Always validate input paths.*

- **Depth Calculation**
  - Entry depth is calculated for navigation and UI ([`vault.interface.ts`](../src/interfaces/vault.interface.ts#L98-L113)).
    *Ensure depth logic matches Rust-side tree structure for consistency.*

---

## Common Pitfalls & Warnings

- ⚠️ **Invalid Path Traversal**: Supplying an invalid path to `findEntryByPath()` can result in undefined behavior or security issues. Always validate and sanitize paths.
- ⚠️ **Type Drift**: Any change to entry structure or enum variants must be reflected in both Rust and TypeScript.
- ⚠️ **Parameter Mismatch**: Argon2 or cryptographic parameter mismatches will prevent vault decryption.
- ⚠️ **Version Bump**: a vault that gains a passkey is stamped `1.1` and becomes unreadable by pre-passkey clients; a 1.0 vault without passkeys stays 1.0 on purpose (see §1.1).
- ⚠️ **HMAC Not Implemented**: `Vault.hmac` is always empty — do not treat it as an integrity check.