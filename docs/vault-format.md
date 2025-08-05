# Vault Format Workflow

```
+-------------------+         +--------------------------+         +-----------------------------+
|                   |         |                          |         |                             |
|      Disk         +--------->   Rust Backend           +--------->   TypeScript Frontend       |
| (Encrypted Vault) |         | (Decryption, HMAC,       |         | (Vault Consumption,         |
|                   |         |  Zeroization)            |         |  Entry Mapping)             |
+-------------------+         +--------------------------+         +-----------------------------+
                                 |        |      |   |                       |
                                 v        v      v   v                       v
                             [Decryption]⚠️ [HMAC]⚠️ [Zeroize]⚠️         [Type Mapping]
```

---

## 1. Overview

This document describes the integrated workflow for the vault format, focusing on the secure flow of data from disk storage through Rust decryption and validation, into TypeScript consumption. It highlights the critical boundaries where encryption, decryption, and verification occur, and explains how core data structures are mapped between Rust and TypeScript.

- **Entry**: The term "entry" refers to any vault record (group, login, note, etc.) as defined in both Rust and TypeScript.
- The workflow enforces strict security practices, including zeroization, HMAC verification, and Argon2-based key derivation.
- Cross-language mappings ensure that vault data remains consistent and type-safe across both codebases.

---

## 2. Data Flow

The vault data flow is a multi-stage process ensuring confidentiality and integrity from disk to application memory:

1. **Disk Storage**
   - The vault is stored as an encrypted file, containing ciphertext, HMAC, and Argon2 parameters ([`VaultFile`](src-tauri/src/models.rs:8-15)).
2. **Rust Backend**
   - On load, Rust reads the file and performs decryption and HMAC verification:
     - **Decryption/Encryption Boundaries**: All cryptographic operations are handled within Rust ([`EncryptedVault`](src-tauri/src/models.rs:102-114)).
       ⚠️ *Boundary: Decrypted data never leaves Rust until HMAC is verified and secrets are zeroized.*
     - **HMAC Verification**: Before any data is exposed, HMAC is checked ([`Vault`](src-tauri/src/models.rs:47-48)).
       ⚠️ *Boundary: If HMAC fails, no data is released to TypeScript.*
3. **TypeScript Consumption**
   - Once verified and decrypted, Rust serializes the vault as JSON and passes it to TypeScript for consumption.

**Security Boundaries:**
- All cryptographic and integrity checks are performed in Rust before data is exposed to the frontend.
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

- **HMAC Verification**
  - HMAC is checked before any decryption output is released ([`Vault`](src-tauri/src/models.rs:47-48)).
    ⚠️ *Tampered vaults are rejected before any data is exposed.*

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
