//! WebAuthn passkey core (F0).
//!
//! Self-contained cryptographic primitives for a software authenticator that
//! produces **ES256** (ECDSA P-256 / SHA-256) WebAuthn credentials with
//! attestation format `"none"`. Nothing in this module performs IO, touches the
//! vault, or talks to the frontend: the commands (`commands::passkey`, T09/T10)
//! and the persistence layer (`passkey::store`, T08) build on top of it.
//!
//! Module map:
//!
//! * [`es256`] — key generation, PKCS#8 import/export, DER-signature signing and
//!   verification.
//! * [`cose`] — COSE_Key (RFC 9052/9053) and `attestationObject` CBOR encoding,
//!   built on `ciborium::value::Value` (explicit integer map keys).
//! * [`webauthn`] — client data, authenticator data, RP ID hashing and the
//!   assertion signature input.
//! * [`types`] — serde request/response shapes shared with the frontend
//!   (camelCase, WebAuthn JSON member names).
//! * [`cxf`] — the Credential Exchange Format subset (F1): envelope parsing,
//!   strict per-credential validation and export building. Pure parsing, no IO.
//!
//! Invariants enforced here (see `docs/passkeys.md`):
//!
//! * The AAGUID is all-zero and the attestation statement is `"none"` (ruling
//!   Q3): Monark is a software authenticator, so it has no attestation identity.
//! * `signCount` is always `0` and is never incremented (ruling Q15).
//! * Randomness comes exclusively from [`crate::crypto::random`] (OsRng), never
//!   from a crate-local RNG.
//! * No secret material is ever formatted: keys have no `Debug`/`Display` path
//!   that could reach a log or an error string.

pub mod cose;
pub mod cxf;
pub mod es256;
pub mod types;
pub mod webauthn;

#[cfg(test)]
mod tests;
