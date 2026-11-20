//! Passkey ceremony commands (T09/T10).
//!
//! The WebAuthn ceremonies run **entirely in Rust**: the frontend forwards the
//! RP's options object and receives a spec-shaped `PublicKeyCredential` JSON
//! value. Nothing here trusts the frontend to have validated anything — every
//! rule of the ceremony is checked on this side, *before* any vault IO, so a
//! malformed request can never cost an Argon2 derivation or a rate-limit slot.
//!
//! # Registration (`passkey_create`, T09)
//!
//! 1. **Validate the request** ([`validate_create_request`]): ES256-only,
//!    discoverable credential mandatory, attestation `none`, RP ID / user handle
//!    / challenge / origin / name rules.
//! 2. **Unlock the vault** through the [`store`] seam (rate-limited).
//! 3. **`excludeCredentials`** is the *only* deduplication mechanism: a request
//!    that excludes a credential we already hold for that RP is refused. A
//!    duplicate registration for the same RP **and** user is otherwise allowed —
//!    WebAuthn explicitly permits several credentials per account.
//! 4. **Generate** an ES256 key, a random 32-byte credential id, the COSE_Key,
//!    the `authenticatorData` (flags `UP|UV|AT`), the `clientDataJSON` and the
//!    `attestationObject` (`fmt: "none"`, empty `attStmt`).
//! 5. **Persist** the passkey at the vault **root** and save through the seam
//!    (which also applies the version policy: the vault becomes 1.1).
//! 6. **Respond** with base64url members, `authenticatorAttachment: "platform"`
//!    and `clientExtensionResults: {}`.
//!
//! # Secret handling
//!
//! The PKCS#8 DER buffer is a [`Zeroizing`] value from the moment it exists
//! ([`SecretPkcs8::to_pkcs8_der`] returns one, review T03-1) and the
//! `p256::ecdsa::SigningKey` zeroizes its scalar on drop, so no secret outlives
//! the scope that created it. No error message ever interpolates key material.
//!
//! # Deviations (documented in `docs/passkeys.md`)
//!
//! * The `UV` flag is always set: Monark is the authenticator and the user has
//!   just proven possession of the vault password (ruling Q14).
//! * Nothing binds the `origin` host to `rp.id` — the relying party enforces
//!   that binding when it verifies the ceremony (review note T02/T09).
//! * `signCount` stays `0` forever (ruling Q15).

use crate::commands::errors::CommandError;
use crate::commands::storage::StorageState;
use crate::crypto::base64::{decode_base64_urlsafe, encode_base64_urlsafe};
use crate::crypto::random::generate_random_bytes;
use crate::models::{Entry, SecretPkcs8};
use crate::passkey::cose::{attestation_object_none, cose_key_from_verifying};
use crate::passkey::es256::{
    generate_signing_key, signing_key_to_pkcs8_der, verifying_key_from_signing, ALG_ES256,
};
use crate::passkey::store::{self, VaultRef};
use crate::passkey::types::{
    AttestationResponse, PasskeyCreateRequest, PasskeyCreateResponse, PUBLIC_KEY_TYPE,
};
use crate::passkey::webauthn::{
    build_authenticator_data, build_client_data_json, validate_origin, validate_rp_id, AAGUID_ZERO,
    CLIENT_DATA_TYPE_CREATE, FLAG_AT, FLAG_UP, FLAG_UV, MAX_CHALLENGE_LEN, MIN_CHALLENGE_LEN,
    SIGN_COUNT,
};
use chrono::Utc;
use uuid::Uuid;
use zeroize::Zeroizing;

/// Length of the credential id this authenticator generates (bytes).
///
/// 32 random bytes: the plan's value, comfortably inside the 1..=1023 range the
/// `authenticatorData` encoder accepts and far above collision range.
pub const CREDENTIAL_ID_LEN: usize = 32;

/// Longest accepted `user.name` / `user.displayName` (characters).
pub const MAX_USER_NAME_CHARS: usize = 256;

/// Longest accepted `rp.name` (characters).
pub const MAX_RP_NAME_CHARS: usize = 256;

/// Bounds of the decoded `user.id` (WebAuthn user handle), in bytes.
pub const MIN_USER_HANDLE_LEN: usize = 1;
/// Upper bound of the decoded `user.id` (WebAuthn L2 §5.4.3: 1..=64 bytes).
pub const MAX_USER_HANDLE_LEN: usize = 64;

/// Authenticator attachment reported for every credential this app creates.
pub const AUTHENTICATOR_ATTACHMENT: &str = "platform";

/// Transport reported for every credential this app creates.
pub const TRANSPORT_INTERNAL: &str = "internal";

fn validation(message: &str) -> CommandError {
    CommandError::Validation(message.to_string())
}

// ---------------------------------------------------------------------------
// Registration ceremony (T09)
// ---------------------------------------------------------------------------

/// Creates a discoverable ES256 passkey in the vault and returns the WebAuthn
/// registration response.
///
/// See the module docs for the flow. The vault is unlocked with `password`; a
/// wrong password is rate-limited by the [`store`] seam exactly like the vault
/// commands.
#[tauri::command(async)]
pub async fn passkey_create(
    vault: VaultRef,
    password: String,
    request: PasskeyCreateRequest,
    state: tauri::State<'_, StorageState>,
) -> Result<PasskeyCreateResponse, CommandError> {
    passkey_create_with(&vault, &password, request, &state.manager).await
}

/// Body of [`passkey_create`], taking the storage manager directly.
///
/// The `tauri::State` wrapper only exists for IPC; keeping the logic here lets
/// the whole ceremony be tested end to end against a real local vault without
/// building a Tauri app (same pattern as `write_cloud_vault_with`).
pub async fn passkey_create_with(
    vault: &VaultRef,
    password: &str,
    request: PasskeyCreateRequest,
    manager: &std::sync::Arc<crate::storage::StorageManager>,
) -> Result<PasskeyCreateResponse, CommandError> {
    // 1. Everything that can be decided from the request alone is decided
    //    before the vault is touched (no IO, no Argon2, no rate-limit slot).
    let validated = validate_create_request(&request)?;

    // 2. Unlock (rate-limited) and check `excludeCredentials` against what we
    //    already hold for this RP.
    let mut loaded = store::load_vault(vault, password, manager).await?;
    ensure_not_excluded(
        &loaded.vault.entries,
        &validated.rp_id,
        &validated.excluded_ids,
    )?;

    // 3. Key material. `SigningKey` zeroizes its scalar on drop; the PKCS#8
    //    buffer is `Zeroizing` from the start.
    let signing_key = generate_signing_key()?;
    let verifying_key = verifying_key_from_signing(&signing_key);
    let pkcs8_der = Zeroizing::new(signing_key_to_pkcs8_der(&signing_key)?);
    let credential_id = Zeroizing::new(
        generate_random_bytes(CREDENTIAL_ID_LEN)
            .map_err(|_| CommandError::Crypto("Failed to generate a credential id".to_string()))?,
    );

    // 4. WebAuthn structures.
    let cose_key = cose_key_from_verifying(&verifying_key)?;
    let auth_data = build_authenticator_data(
        &validated.rp_id,
        FLAG_UP | FLAG_UV | FLAG_AT,
        SIGN_COUNT,
        Some((&AAGUID_ZERO, credential_id.as_slice(), &cose_key)),
    )?;
    let client_data_json = build_client_data_json(
        CLIENT_DATA_TYPE_CREATE,
        &validated.challenge_b64,
        &validated.origin,
    )?;
    let attestation_object = attestation_object_none(&auth_data)?;

    // 5. Persist at the vault root.
    let entry_id = Uuid::new_v4();
    let now = Utc::now();
    loaded.vault.entries.push(Entry::Passkey {
        id: entry_id,
        name: validated.entry_name.clone(),
        created_at: now,
        updated_at: now,
        tags: Vec::new(),
        rp_id: validated.rp_id.clone(),
        rp_name: validated.rp_name.clone(),
        credential_id: credential_id.to_vec(),
        user_handle: validated.user_handle.clone(),
        user_name: validated.user_name.clone(),
        user_display_name: validated.user_display_name.clone(),
        private_key: SecretPkcs8::from_pkcs8_der(&pkcs8_der),
        algorithm: ALG_ES256,
        sign_count: SIGN_COUNT,
        discoverable: true,
        transports: vec![TRANSPORT_INTERNAL.to_string()],
        aaguid: Uuid::nil(),
    });
    store::save_vault(vault, &mut loaded, manager).await?;

    // 6. Spec-shaped response. `id` and `rawId` are the same base64url string.
    let credential_id_b64 = encode_base64_urlsafe(&credential_id);
    Ok(PasskeyCreateResponse {
        entry_id: entry_id.to_string(),
        id: credential_id_b64.clone(),
        raw_id: credential_id_b64,
        type_: PUBLIC_KEY_TYPE.to_string(),
        response: AttestationResponse {
            client_data_json: encode_base64_urlsafe(&client_data_json),
            attestation_object: encode_base64_urlsafe(&attestation_object),
            transports: vec![TRANSPORT_INTERNAL.to_string()],
        },
        authenticator_attachment: AUTHENTICATOR_ATTACHMENT.to_string(),
        client_extension_results: serde_json::json!({}),
    })
}

/// A registration request that passed every pure check.
///
/// Holds only non-secret values (the user handle is a public WebAuthn
/// identifier) plus the base64url challenge, which is echoed into the client
/// data.
pub struct ValidatedCreateRequest {
    pub rp_id: String,
    pub rp_name: String,
    pub user_name: String,
    pub user_display_name: String,
    pub user_handle: Vec<u8>,
    pub challenge_b64: String,
    pub origin: String,
    /// Decoded credential ids of `excludeCredentials` (empty when absent).
    pub excluded_ids: Vec<Vec<u8>>,
    /// Entry name: `user.name`, falling back to `rp.name`.
    pub entry_name: String,
}

impl std::fmt::Debug for ValidatedCreateRequest {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("ValidatedCreateRequest")
            .field("rp_id", &self.rp_id)
            .field("rp_name", &self.rp_name)
            .field("user_name", &self.user_name)
            .field("user_display_name", &self.user_display_name)
            .field("user_handle_len", &self.user_handle.len())
            .field("origin", &self.origin)
            .field("excluded_ids", &self.excluded_ids.len())
            .field("entry_name", &self.entry_name)
            .finish()
    }
}

/// Validates a registration request. Pure: no IO, no randomness, no clock.
///
/// Rules (all failures are [`CommandError::Validation`] with a fixed message
/// that never echoes request content):
///
/// * `pubKeyCredParams` must contain `{type: "public-key", alg: -7}` — ES256 is
///   the only algorithm this authenticator implements;
/// * `authenticatorSelection` is **mandatory** and its `residentKey` must be
///   `"required"`: Monark only issues discoverable credentials (approved
///   decision), so a request that does not ask for one is refused rather than
///   silently upgraded;
/// * `attestation` must be absent or `"none"` (ruling Q3);
/// * `rp.id` must be a bare host name ([`validate_rp_id`]) and `rp.name` at most
///   [`MAX_RP_NAME_CHARS`] characters;
/// * `user.id` must decode to 1..=64 bytes, `user.name`/`displayName` must be
///   non-empty and at most [`MAX_USER_NAME_CHARS`] characters;
/// * `challenge` must decode to 16..=1024 bytes;
/// * `origin` must be a valid WebAuthn origin ([`validate_origin`]);
/// * every `excludeCredentials` entry must be `{type: "public-key", id: b64url}`.
pub fn validate_create_request(
    request: &PasskeyCreateRequest,
) -> Result<ValidatedCreateRequest, CommandError> {
    // --- Algorithm: ES256 only. ---
    let es256 = request
        .pub_key_cred_params
        .iter()
        .any(|param| param.type_ == PUBLIC_KEY_TYPE && param.alg == ALG_ES256);
    if !es256 {
        return Err(validation("Only ES256 is supported"));
    }

    // --- Discoverable credential mandatory. ---
    let selection = request
        .authenticator_selection
        .as_ref()
        .ok_or_else(|| validation("Discoverable credential required"))?;
    match selection.resident_key.as_deref() {
        Some("required") => {}
        // `None` means "the RP has no preference", which is not a request for a
        // discoverable credential: refuse instead of guessing.
        Some(_) | None => return Err(validation("Discoverable credential required")),
    }

    // --- Attestation: none. ---
    if let Some(attestation) = request.attestation.as_deref() {
        if attestation != "none" {
            return Err(validation("Only attestation none is supported"));
        }
    }

    // --- Relying party. ---
    validate_rp_id(&request.rp.id)?;
    if request.rp.name.chars().count() > MAX_RP_NAME_CHARS {
        return Err(validation("RP name is too long"));
    }

    // --- User. ---
    let user_handle = decode_base64_urlsafe(&request.user.id)
        .map_err(|_| validation("User id is not valid base64url"))?;
    if user_handle.len() < MIN_USER_HANDLE_LEN || user_handle.len() > MAX_USER_HANDLE_LEN {
        return Err(validation("User id length is out of range"));
    }
    if request.user.name.is_empty() || request.user.name.chars().count() > MAX_USER_NAME_CHARS {
        return Err(validation("User name is empty or too long"));
    }
    if request.user.display_name.chars().count() > MAX_USER_NAME_CHARS {
        return Err(validation("User display name is too long"));
    }

    // --- Challenge. ---
    let challenge = decode_base64_urlsafe(&request.challenge)
        .map_err(|_| validation("Challenge is not valid base64url"))?;
    if challenge.len() < MIN_CHALLENGE_LEN || challenge.len() > MAX_CHALLENGE_LEN {
        return Err(validation("Challenge length is out of range"));
    }

    // --- Origin. ---
    validate_origin(&request.origin)?;

    // --- excludeCredentials. ---
    let mut excluded_ids = Vec::new();
    for descriptor in request.exclude_credentials.iter().flatten() {
        if descriptor.type_ != PUBLIC_KEY_TYPE {
            return Err(validation("Excluded credential type is not public-key"));
        }
        let id = decode_base64_urlsafe(&descriptor.id)
            .map_err(|_| validation("Excluded credential id is not valid base64url"))?;
        excluded_ids.push(id);
    }

    let entry_name = if request.user.name.is_empty() {
        request.rp.name.clone()
    } else {
        request.user.name.clone()
    };

    Ok(ValidatedCreateRequest {
        rp_id: request.rp.id.clone(),
        rp_name: request.rp.name.clone(),
        user_name: request.user.name.clone(),
        user_display_name: request.user.display_name.clone(),
        user_handle,
        challenge_b64: request.challenge.clone(),
        origin: request.origin.clone(),
        excluded_ids,
        entry_name,
    })
}

/// Refuses the ceremony when `excluded_ids` names a passkey we already hold for
/// `rp_id` (WebAuthn L2 §5.1.3 step 4).
///
/// `excludeCredentials` is the **only** deduplication mechanism in Monark: a
/// duplicate registration for the same RP and user is legitimate (an account can
/// hold several credentials), so nothing else is checked here.
pub fn ensure_not_excluded(
    entries: &[Entry],
    rp_id: &str,
    excluded_ids: &[Vec<u8>],
) -> Result<(), CommandError> {
    if excluded_ids.is_empty() {
        return Ok(());
    }
    let excluded = find_excluded_passkey(entries, rp_id, excluded_ids);
    match excluded {
        Some(()) => Err(validation("Credential excluded by request")),
        None => Ok(()),
    }
}

/// Whether the entry tree holds a passkey for `rp_id` whose credential id is one
/// of `excluded_ids` (recursive: passkeys may live inside groups).
fn find_excluded_passkey(entries: &[Entry], rp_id: &str, excluded_ids: &[Vec<u8>]) -> Option<()> {
    for entry in entries {
        match entry {
            Entry::Passkey {
                rp_id: stored_rp_id,
                credential_id,
                ..
            } => {
                if stored_rp_id == rp_id
                    && excluded_ids
                        .iter()
                        .any(|excluded| excluded.as_slice() == credential_id.as_slice())
                {
                    return Some(());
                }
            }
            Entry::Group { children, .. } => {
                if find_excluded_passkey(children, rp_id, excluded_ids).is_some() {
                    return Some(());
                }
            }
            Entry::Data { .. } => {}
        }
    }
    None
}

#[cfg(test)]
#[path = "passkey_tests.rs"]
mod tests;
