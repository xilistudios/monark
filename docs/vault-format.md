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
> ([`models.rs`](src-tauri/src/models.rs:47-48)) is always an empty string today:
> no HMAC is computed on write and none is verified on read. Integrity of the
> vault blob comes from the XChaCha20-Poly1305 AEAD tag, not from an HMAC. Any
> statement in this document (or elsewhere) that claims "HMAC is verified before
> data is exposed" describes the *design intent*, not the current code.

---

## 1.1 Format Versions

`VaultFile.version` ([`models.rs`](src-tauri/src/models.rs:8-15)) is the format
generation of the file. The policy lives in one place,
[`vault/version.rs`](src-tauri/src/vault/version.rs):

| Constant / function | Value / behaviour |
|---------------------|-------------------|
| `CURRENT_VAULT_VERSION` | `"1.1"` — written by this build for new vaults |
| `SUPPORTED_VAULT_VERSIONS` | `["1.0", "1.1"]` — every version this build can read |
| `check_version(&str)` | `Err(CommandError::UnsupportedVersion(v))` for anything else |
| `has_passkey(&[Entry])` | recursive scan of the entry tree |
| `version_for_content(existing, &Vault)` | `"1.1"` iff the content holds a passkey, else `existing` |

* **1.0** — pre-passkey format: `group` and `entry` variants only.
* **1.1** — adds the `passkey` entry variant (`"entry_type":"passkey"`; shape
  documented in [`docs/passkeys.md`](docs/passkeys.md)).

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
   - The vault is stored as an encrypted file, containing a format `version`, ciphertext, and Argon2 parameters ([`VaultFile`](src-tauri/src/models.rs:8-15)).
2. **Rust Backend**
   - On load, Rust reads the file, checks the format version, and decrypts it:
     - **Version Check**: `version::check_version` runs before any KDF work (see §1.1).
       ⚠️ *Boundary: an unsupported format is rejected before a password is even derived.*
     - **Decryption/Encryption Boundaries**: All cryptographic operations are handled within Rust ([`EncryptedVault`](src-tauri/src/models.rs:102-114)).
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

- **Rust**: The `Entry` enum defines all possible entry types ([`models.rs`](src-tauri/src/models.rs:56-75)).
- **TypeScript**: The `Entry` union mirrors these variants ([`vault.interface.ts`](src/interfaces/vault.interface.ts:14-27)).
- **Mapping**: Each Rust variant is serialized to a discriminated union in TypeScript, preserving structure and type safety.

### DateTime Conversion

- **Rust**: Timestamps use `DateTime<Utc>`, serialized with `.to_rfc3339()` ([`models.rs`](src-tauri/src/models.rs:133-134)).
- **TypeScript**: Consumes these as ISO 8601 strings, ensuring cross-language consistency.

### Field Structure Alignment

- **Rust**: Entry fields are defined in structs ([`models.rs`](src-tauri/src/models.rs:88-96)).
- **TypeScript**: Corresponding interfaces match these fields ([`vault.interface.ts`](src/interfaces/vault.interface.ts:36-41)).
- **Alignment**: Field names and types must remain synchronized to avoid runtime errors.

⚠️ **Pitfall:**
Any mismatch in enum variants, field names, or types between Rust and TypeScript will cause deserialization failures or runtime bugs. Always update both sides together.

---

## 4. Security Considerations

Security is enforced at every stage of the workflow:

- **Zeroization Strategy**
  - Sensitive data is zeroized on drop using `ZeroizeOnDrop` ([`models.rs`](src-tauri/src/models.rs:30,77,88)).
    ⚠️ *Ensures secrets are not left in memory after use.*

- **Secret Field Handling**
  - Secret fields are explicitly marked and handled in TypeScript ([`vault.interface.ts`](src/interfaces/vault.interface.ts:40)).
    ⚠️ *Never expose secrets in logs or UI without explicit user action.*

- **Argon2 Parameter Consistency**
  - Argon2 parameters are defined and enforced in Rust ([`models.rs`](src-tauri/src/models.rs:19-28)).
    ⚠️ *Parameter drift between Rust and TypeScript will break decryption.*

- **Vault Format Version**
  - The version is checked before the rate limiter and the Argon2 derivation ([`vault/version.rs`](src-tauri/src/vault/version.rs)).
    ⚠️ *A vault from a newer format is rejected with `UnsupportedVersion`, never half-read.*

- **HMAC (designed, not implemented)**
  - `Vault.hmac` ([`models.rs`](src-tauri/src/models.rs:47-48)) is always empty: no HMAC is written or verified today.
    ⚠️ *Do not rely on it for integrity; the AEAD tag of the vault blob is what detects tampering.*

---

## 5. Navigation Patterns

Vault navigation and entry lookup are implemented consistently across both codebases:

- **Path Traversal**
  - TypeScript uses `findEntryByPath()` to traverse entry trees ([`vault.interface.ts`](src/interfaces/vault.interface.ts:59-78)).
    ⚠️ *Invalid paths may result in undefined or incorrect entries. Always validate input paths.*

- **Depth Calculation**
  - Entry depth is calculated for navigation and UI ([`vault.interface.ts`](src/interfaces/vault.interface.ts:98-113)).
    *Ensure depth logic matches Rust-side tree structure for consistency.*

---

## Common Pitfalls & Warnings

- ⚠️ **Invalid Path Traversal**: Supplying an invalid path to `findEntryByPath()` can result in undefined behavior or security issues. Always validate and sanitize paths.
- ⚠️ **Type Drift**: Any change to entry structure or enum variants must be reflected in both Rust and TypeScript.
- ⚠️ **Parameter Mismatch**: Argon2 or cryptographic parameter mismatches will prevent vault decryption.
- ⚠️ **Version Bump**: a vault that gains a passkey is stamped `1.1` and becomes unreadable by pre-passkey clients; a 1.0 vault without passkeys stays 1.0 on purpose (see §1.1).
- ⚠️ **HMAC Not Implemented**: `Vault.hmac` is always empty — do not treat it as an integrity check.