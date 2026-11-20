//! Single source of truth for the vault key hierarchy (T07).
//!
//! Every vault file stores two encrypted layers:
//!
//! ```text
//! password ──Argon2id(salt, m/t/p)──► KDF key ──XChaCha20-Poly1305──► master key
//! master key ──XChaCha20-Poly1305──► vault JSON (entries, incl. passkey keys)
//! ```
//!
//! Before this module existed the same four steps were copy-pasted into
//! `lifecycle.rs` and `cloud_lifecycle.rs` (two copies of the unwrap, two of the
//! blob decrypt, two of the re-wrap). The copies had already drifted once — the
//! cloud copy silently lost the `validate_argon2_params` downgrade guard — so
//! the crypto lives here and the lifecycles only orchestrate:
//!
//! * [`derive_and_decrypt_master_key`] — password → master key (with the Argon2
//!   parameter bounds check);
//! * [`decrypt_vault_content`] / [`encrypt_vault_content`] — master key ↔ vault
//!   JSON;
//! * [`rewrap_master_key`] — password change: unwrap with the old password,
//!   re-encrypt the *same* master key under the new one;
//! * [`create_key_material`] — brand-new vault: fresh master key wrapped under
//!   the password.
//!
//! Invariants kept from the pre-refactor code (behavior-preserving refactor, no
//! bound was raised or lowered):
//!
//! * Every intermediate key buffer is zeroized ([`Zeroizing`]); the master key
//!   returned to callers is the caller's responsibility (see the lifecycles,
//!   which wrap it in `Zeroizing` too).
//! * Error messages are byte-identical to the ones the old private helpers
//!   produced, so no frontend routing/classification changes.
//! * Rate limiting is **not** done here: `check_attempts` / `record_failure` /
//!   `reset_attempts` stay at the call sites, which own the vault identifier
//!   (a canonical path locally, a vault id in the cloud).

use crate::commands::errors::CommandError;
use crate::crypto;
use crate::models::{Argon2Params, EncryptedData, Vault, VaultFile};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use zeroize::Zeroizing;

/// Length in bytes of every symmetric key in the hierarchy (KDF key and master
/// key). XChaCha20-Poly1305 requires 32.
pub(crate) const KEY_LENGTH: usize = 32;

/// Default Argon2id memory cost, in KiB (64 MiB).
pub(crate) const ARGON2_MEMORY_COST_KIB: u32 = 65536;
/// Default Argon2id iteration count.
pub(crate) const ARGON2_ITERATIONS: u32 = 3;
/// Default Argon2id parallelism.
pub(crate) const ARGON2_PARALLELISM: u32 = 4;

/// Upper bound on the stored memory cost (256 MiB) — DoS prevention.
pub(crate) const ARGON2_MAX_MEMORY_COST_KIB: u32 = 262144;
/// Upper bound on the stored iteration count — DoS prevention.
pub(crate) const ARGON2_MAX_ITERATIONS: u32 = 10;
/// Upper bound on the stored parallelism — DoS prevention.
pub(crate) const ARGON2_MAX_PARALLELISM: u32 = 16;

/// The Argon2id parameters this build writes when it creates or re-wraps key
/// material: a fresh random salt plus the compile-time defaults.
///
/// Kept in one place so a password change can never silently weaken a vault by
/// writing different parameters than creation does (review finding T01-1 pins
/// the values in the tests).
pub(crate) fn default_argon2_params() -> Result<Argon2Params, CommandError> {
    let user_salt = crypto::random::generate_salt()?;
    Ok(Argon2Params {
        salt: URL_SAFE_NO_PAD.encode(&user_salt),
        memory_cost_kib: ARGON2_MEMORY_COST_KIB,
        iterations: ARGON2_ITERATIONS,
        parallelism: ARGON2_PARALLELISM,
    })
}

/// Rejects Argon2 parameters that would weaken the KDF or exhaust memory.
///
/// The lower bounds are the defaults above: a vault file claiming to be weaker
/// than what this build writes is treated as a downgrade attack. The upper
/// bounds stop a malicious file from making the app allocate gigabytes.
///
/// The bounds are **unchanged** from the pre-refactor implementation (review
/// rule: a refactor must not move a security bound).
pub(crate) fn validate_argon2_params(params: &Argon2Params) -> Result<(), CommandError> {
    if params.memory_cost_kib < ARGON2_MEMORY_COST_KIB {
        return Err(CommandError::Crypto(
            "Argon2 parameters below security minimum (possible downgrade attack)".to_string(),
        ));
    }
    if params.iterations < ARGON2_ITERATIONS {
        return Err(CommandError::Crypto(
            "Argon2 parameters below security minimum (possible downgrade attack)".to_string(),
        ));
    }
    if params.parallelism < 1 {
        return Err(CommandError::Crypto(
            "Argon2 parameters below security minimum (possible downgrade attack)".to_string(),
        ));
    }
    if params.memory_cost_kib > ARGON2_MAX_MEMORY_COST_KIB {
        return Err(CommandError::Crypto(
            "Argon2 memory cost above security maximum (possible DoS)".to_string(),
        ));
    }
    if params.iterations > ARGON2_MAX_ITERATIONS {
        return Err(CommandError::Crypto(
            "Argon2 iterations above security maximum (possible DoS)".to_string(),
        ));
    }
    if params.parallelism > ARGON2_MAX_PARALLELISM {
        return Err(CommandError::Crypto(
            "Argon2 parallelism above security maximum (possible DoS)".to_string(),
        ));
    }
    Ok(())
}

/// Derives the KDF key from `password` and `params`, validating the parameters
/// first.
///
/// The returned key is wrapped in [`Zeroizing`] so it is scrubbed on drop.
fn derive_kdf_key(
    password: &str,
    params: &Argon2Params,
    salt: &[u8],
) -> Result<Zeroizing<Vec<u8>>, CommandError> {
    validate_argon2_params(params)?;

    let kdf_key = crypto::argon2::derive_key_argon2id(
        password.as_bytes(),
        salt,
        params.memory_cost_kib,
        params.iterations,
        params.parallelism,
        KEY_LENGTH as u32,
    )?;

    Ok(Zeroizing::new(kdf_key))
}

/// Unwraps the vault master key with `password`.
///
/// Steps: decode the stored salt → validate the Argon2 parameters → derive the
/// KDF key → decode the wrapped master key → decrypt it. The KDF key is
/// zeroized as soon as the master key is out.
pub(crate) fn derive_and_decrypt_master_key(
    password: &str,
    vault_file: &VaultFile,
) -> Result<[u8; KEY_LENGTH], CommandError> {
    let user_salt = URL_SAFE_NO_PAD
        .decode(&vault_file.argon2_params.salt)
        .map_err(|_e| CommandError::Crypto("Failed to decode salt".to_string()))?;

    let kdf_key = derive_kdf_key(password, &vault_file.argon2_params, &user_salt)?;

    let mk_nonce = URL_SAFE_NO_PAD
        .decode(&vault_file.credentials.nonce)
        .map_err(|_e| CommandError::Crypto("Failed to decode master key nonce".to_string()))?;
    let mk_ciphertext = URL_SAFE_NO_PAD
        .decode(&vault_file.credentials.ciphertext)
        .map_err(|_e| CommandError::Crypto("Failed to decode master key ciphertext".to_string()))?;

    let master_key_vec =
        crypto::chacha::decrypt_xchacha20poly1305(&kdf_key, &mk_nonce, &mk_ciphertext)?;

    master_key_vec
        .try_into()
        .map_err(|_| CommandError::Crypto("Invalid decrypted master key length".to_string()))
}

/// Decrypts the vault blob of `vault_file` into the disk [`Vault`].
///
/// The result still holds passkey private keys: callers that face the frontend
/// must convert it to [`crate::models::VaultView`] and drop it.
pub(crate) fn decrypt_vault_content(
    master_key: &[u8; KEY_LENGTH],
    vault_file: &VaultFile,
) -> Result<Vault, CommandError> {
    let vault_nonce = URL_SAFE_NO_PAD
        .decode(&vault_file.vault.nonce)
        .map_err(|_e| CommandError::Crypto("Failed to decode vault nonce".to_string()))?;

    let vault_ciphertext = URL_SAFE_NO_PAD
        .decode(&vault_file.vault.ciphertext)
        .map_err(|_e| CommandError::Crypto("Failed to decode vault ciphertext".to_string()))?;

    let vault_json_bytes =
        crypto::chacha::decrypt_xchacha20poly1305(master_key, &vault_nonce, &vault_ciphertext)?;

    serde_json::from_slice(&vault_json_bytes)
        .map_err(|_e| CommandError::Crypto("Failed to deserialize existing vault".to_string()))
}

/// Encrypts `vault` under `master_key` with a fresh nonce.
///
/// The JSON buffer holds every secret in the vault, so it is zeroized after the
/// encryption.
pub(crate) fn encrypt_vault_content(
    master_key: &[u8; KEY_LENGTH],
    vault: &Vault,
) -> Result<EncryptedData, CommandError> {
    let vault_json_bytes = Zeroizing::new(serde_json::to_vec(vault)?);
    let vault_nonce = crypto::random::generate_nonce()?;
    let vault_ciphertext =
        crypto::chacha::encrypt_xchacha20poly1305(master_key, &vault_nonce, &vault_json_bytes)?;

    Ok(EncryptedData {
        nonce: URL_SAFE_NO_PAD.encode(vault_nonce),
        ciphertext: URL_SAFE_NO_PAD.encode(vault_ciphertext),
    })
}

/// Generates the key material of a brand-new vault: a random master key wrapped
/// under `password`.
///
/// Returns `(argon2_params, credentials, master_key)`. The master key is needed
/// by the caller to encrypt the initial vault blob.
pub(crate) fn create_key_material(
    password: &str,
) -> Result<(Argon2Params, EncryptedData, [u8; KEY_LENGTH]), CommandError> {
    let master_key_vec = Zeroizing::new(crypto::random::generate_key()?);
    let master_key: [u8; KEY_LENGTH] = master_key_vec
        .as_slice()
        .try_into()
        .map_err(|_| CommandError::Crypto("Invalid generated master key length".to_string()))?;

    let argon2_params = default_argon2_params()?;
    let user_salt = URL_SAFE_NO_PAD
        .decode(&argon2_params.salt)
        .map_err(|_e| CommandError::Crypto("Failed to decode salt".to_string()))?;
    let kdf_key = derive_kdf_key(password, &argon2_params, &user_salt)?;

    let credentials = wrap_master_key(&kdf_key, &master_key)?;

    Ok((argon2_params, credentials, master_key))
}

/// Re-wraps the vault master key under a new password.
///
/// The master key is unwrapped with `old_password`, a fresh salt plus the
/// default Argon2id parameters are generated, and the *unchanged* master key is
/// re-encrypted under the new KDF key. Only `argon2_params` and `credentials`
/// are replaced: `vault_file.vault` is left byte-identical, so every entry
/// (including passkeys) survives untouched.
///
/// Rate limiting stays at the call sites; this function only does crypto.
pub(crate) fn rewrap_master_key(
    old_password: &str,
    new_password: &str,
    vault_file: &mut VaultFile,
) -> Result<(), CommandError> {
    // The master key is the most sensitive value in the process: scrub it as
    // soon as it has been re-wrapped (review finding T01-2).
    let master_key = Zeroizing::new(derive_and_decrypt_master_key(old_password, vault_file)?);

    let argon2_params = default_argon2_params()?;
    let user_salt = URL_SAFE_NO_PAD
        .decode(&argon2_params.salt)
        .map_err(|_e| CommandError::Crypto("Failed to decode salt".to_string()))?;
    let kdf_key = derive_kdf_key(new_password, &argon2_params, &user_salt)?;

    let credentials = wrap_master_key(&kdf_key, &master_key)?;

    vault_file.argon2_params = argon2_params;
    vault_file.credentials = credentials;
    // `vault_file.vault` is deliberately NOT touched: the blob stays byte-identical.

    Ok(())
}

/// Encrypts `master_key` under `kdf_key` with a fresh nonce.
fn wrap_master_key(
    kdf_key: &[u8],
    master_key: &[u8; KEY_LENGTH],
) -> Result<EncryptedData, CommandError> {
    let mk_nonce = crypto::random::generate_nonce()?;
    let mk_ciphertext = crypto::chacha::encrypt_xchacha20poly1305(kdf_key, &mk_nonce, master_key)?;

    Ok(EncryptedData {
        nonce: URL_SAFE_NO_PAD.encode(mk_nonce),
        ciphertext: URL_SAFE_NO_PAD.encode(mk_ciphertext),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::{Entry, Vault};
    use chrono::Utc;

    fn params(memory_cost_kib: u32, iterations: u32, parallelism: u32) -> Argon2Params {
        Argon2Params {
            salt: "c2FsdA".to_string(),
            memory_cost_kib,
            iterations,
            parallelism,
        }
    }

    fn empty_vault() -> Vault {
        Vault {
            updated_at: Utc::now(),
            hmac: String::new(),
            entries: Vec::new(),
        }
    }

    #[test]
    fn validate_argon2_params_accepts_defaults() {
        let p = params(
            ARGON2_MEMORY_COST_KIB,
            ARGON2_ITERATIONS,
            ARGON2_PARALLELISM,
        );
        assert!(validate_argon2_params(&p).is_ok());
    }

    #[test]
    fn validate_argon2_params_rejects_excessive_memory_cost() {
        let p = params(
            ARGON2_MAX_MEMORY_COST_KIB + 1,
            ARGON2_ITERATIONS,
            ARGON2_PARALLELISM,
        );
        assert!(validate_argon2_params(&p).is_err());
    }

    #[test]
    fn validate_argon2_params_rejects_excessive_iterations() {
        let p = params(
            ARGON2_MEMORY_COST_KIB,
            ARGON2_MAX_ITERATIONS + 1,
            ARGON2_PARALLELISM,
        );
        assert!(validate_argon2_params(&p).is_err());
    }

    #[test]
    fn validate_argon2_params_rejects_excessive_parallelism() {
        let p = params(
            ARGON2_MEMORY_COST_KIB,
            ARGON2_ITERATIONS,
            ARGON2_MAX_PARALLELISM + 1,
        );
        assert!(validate_argon2_params(&p).is_err());
    }

    #[test]
    fn validate_argon2_params_rejects_below_minimum_memory_cost() {
        let p = params(1024, ARGON2_ITERATIONS, ARGON2_PARALLELISM);
        assert!(validate_argon2_params(&p).is_err());
    }

    #[test]
    fn validate_argon2_params_rejects_below_minimum_iterations() {
        let p = params(ARGON2_MEMORY_COST_KIB, 1, ARGON2_PARALLELISM);
        assert!(validate_argon2_params(&p).is_err());
    }

    #[test]
    fn validate_argon2_params_rejects_zero_parallelism() {
        let p = params(ARGON2_MEMORY_COST_KIB, ARGON2_ITERATIONS, 0);
        assert!(validate_argon2_params(&p).is_err());
    }

    /// The defaults written by creation and by a re-wrap are the compile-time
    /// constants (review finding T01-1: a silent KDF downgrade must not pass).
    #[test]
    fn default_argon2_params_are_the_compile_time_defaults() -> Result<(), CommandError> {
        let p = default_argon2_params()?;
        assert_eq!(p.memory_cost_kib, 65_536);
        assert_eq!(p.iterations, 3);
        assert_eq!(p.parallelism, 4);
        assert_eq!(p.memory_cost_kib, ARGON2_MEMORY_COST_KIB);
        assert_eq!(p.iterations, ARGON2_ITERATIONS);
        assert_eq!(p.parallelism, ARGON2_PARALLELISM);
        // A fresh salt every call.
        assert_ne!(p.salt, default_argon2_params()?.salt);
        Ok(())
    }

    /// Criterion: encrypt → decrypt round-trips the vault content.
    #[test]
    fn keys_roundtrip_encrypt_decrypt() -> Result<(), CommandError> {
        let (argon2_params, credentials, master_key) = create_key_material("password")?;
        let vault = empty_vault();

        let encrypted = encrypt_vault_content(&master_key, &vault)?;
        let vault_file = VaultFile {
            version: "1.1".to_string(),
            argon2_params,
            credentials,
            vault: encrypted,
        };

        let unwrapped = derive_and_decrypt_master_key("password", &vault_file)?;
        assert_eq!(unwrapped, master_key, "the unwrap must return the same key");

        let decrypted = decrypt_vault_content(&unwrapped, &vault_file)?;
        assert_eq!(decrypted.entries, vault.entries);
        assert_eq!(decrypted.hmac, vault.hmac);
        Ok(())
    }

    /// Negative control: a single flipped ciphertext byte must fail the AEAD
    /// tag check instead of yielding garbage.
    #[test]
    fn decrypt_vault_content_rejects_flipped_ciphertext() -> Result<(), CommandError> {
        let (argon2_params, credentials, master_key) = create_key_material("password")?;
        let vault = Vault {
            updated_at: Utc::now(),
            hmac: String::new(),
            entries: vec![Entry::Group {
                id: uuid::Uuid::new_v4(),
                name: "Root".to_string(),
                data_type: "group".to_string(),
                children: Vec::new(),
            }],
        };
        let mut encrypted = encrypt_vault_content(&master_key, &vault)?;

        let mut ciphertext = URL_SAFE_NO_PAD
            .decode(&encrypted.ciphertext)
            .map_err(|_e| CommandError::Crypto("Failed to decode vault ciphertext".to_string()))?;
        // Flip the last byte (inside the Poly1305 tag).
        if let Some(last) = ciphertext.last_mut() {
            *last ^= 0x01;
        }
        encrypted.ciphertext = URL_SAFE_NO_PAD.encode(&ciphertext);

        let vault_file = VaultFile {
            version: "1.1".to_string(),
            argon2_params,
            credentials,
            vault: encrypted,
        };

        // The error must come from the AEAD tag check, not from a later JSON
        // parse: `CryptoError::Aead` renders as "ChaCha20Poly1305
        // encryption/decryption failed", which no other step produces. Without
        // this pin, a broken decrypt chain (e.g. skipping the tag check and
        // failing on serde instead) would still look like a crypto error.
        match decrypt_vault_content(&master_key, &vault_file) {
            Err(CommandError::Crypto(msg)) => assert!(
                msg.contains("ChaCha20Poly1305"),
                "the flipped byte must fail the AEAD tag check, got: {msg}"
            ),
            other => panic!("a flipped ciphertext byte must be a crypto error, got {other:?}"),
        }
        Ok(())
    }

    /// A wrong password must not unwrap the master key.
    #[test]
    fn derive_and_decrypt_master_key_rejects_wrong_password() -> Result<(), CommandError> {
        let (argon2_params, credentials, _master_key) = create_key_material("password")?;
        let vault_file = VaultFile {
            version: "1.1".to_string(),
            argon2_params,
            credentials,
            vault: EncryptedData {
                nonce: "bm9uY2U".to_string(),
                ciphertext: "Y2lwaGVy".to_string(),
            },
        };

        assert!(derive_and_decrypt_master_key("wrong-password", &vault_file).is_err());
        Ok(())
    }

    /// A vault file claiming weaker Argon2 parameters is refused before any
    /// derivation happens (downgrade guard on the shared path).
    #[test]
    fn derive_and_decrypt_master_key_rejects_downgraded_params() -> Result<(), CommandError> {
        let (argon2_params, credentials, _master_key) = create_key_material("password")?;
        let vault_file = VaultFile {
            version: "1.1".to_string(),
            argon2_params: Argon2Params {
                iterations: 1,
                ..argon2_params
            },
            credentials,
            vault: EncryptedData {
                nonce: "bm9uY2U".to_string(),
                ciphertext: "Y2lwaGVy".to_string(),
            },
        };

        match derive_and_decrypt_master_key("password", &vault_file) {
            Err(CommandError::Crypto(msg)) => {
                assert!(msg.contains("below security minimum"), "got: {msg}");
            }
            other => panic!("expected a downgrade error, got {other:?}"),
        }
        Ok(())
    }

    /// `rewrap_master_key` keeps the master key and the blob, and replaces the
    /// salt, the parameters and the wrapped credentials.
    #[test]
    fn rewrap_master_key_preserves_master_key_and_blob() -> Result<(), CommandError> {
        let (argon2_params, credentials, master_key) = create_key_material("old-password")?;
        let vault = empty_vault();
        let blob = encrypt_vault_content(&master_key, &vault)?;

        let mut vault_file = VaultFile {
            version: "1.1".to_string(),
            argon2_params,
            credentials,
            vault: blob.clone(),
        };

        rewrap_master_key("old-password", "new-password", &mut vault_file)?;

        assert_eq!(
            vault_file.vault, blob,
            "the encrypted vault blob must stay byte-identical"
        );
        assert_eq!(vault_file.argon2_params.memory_cost_kib, 65_536);
        assert_eq!(vault_file.argon2_params.iterations, 3);
        assert_eq!(vault_file.argon2_params.parallelism, 4);

        let rewrapped = derive_and_decrypt_master_key("new-password", &vault_file)?;
        assert_eq!(
            rewrapped, master_key,
            "the master key must survive the re-wrap"
        );
        assert!(
            derive_and_decrypt_master_key("old-password", &vault_file).is_err(),
            "the old password must stop working"
        );
        Ok(())
    }

    /// `create_key_material` returns a master key that its own credentials
    /// unwrap to.
    #[test]
    fn create_key_material_roundtrips() -> Result<(), CommandError> {
        let (argon2_params, credentials, master_key) = create_key_material("password")?;
        let vault_file = VaultFile {
            version: "1.1".to_string(),
            argon2_params,
            credentials,
            vault: EncryptedData {
                nonce: "bm9uY2U".to_string(),
                ciphertext: "Y2lwaGVy".to_string(),
            },
        };

        assert_eq!(
            derive_and_decrypt_master_key("password", &vault_file)?,
            master_key
        );
        Ok(())
    }
}
