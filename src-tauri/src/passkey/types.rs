//! Serde request/response shapes of the passkey commands.
//!
//! These are the WebAuthn JSON member names (`camelCase`, `type` instead of
//! `type_`), so the frontend can forward a `PublicKeyCredentialCreationOptions`
//! / `PublicKeyCredentialRequestOptions` object with minimal reshaping and the
//! responses look like the spec's `PublicKeyCredential` JSON.
//!
//! Conventions enforced by construction (see [`PasskeyCreateResponse`] and
//! [`PasskeyAssertResponse`]):
//!
//! * Every binary member (`challenge`, `id`, `rawId`, `clientDataJSON`,
//!   `attestationObject`, `authenticatorData`, `signature`, `userHandle`) is
//!   URL_SAFE_NO_PAD base64.
//! * `type` is always `"public-key"`.
//! * `clientExtensionResults` is always `{}` (no extensions are supported).
//!
//! The structs carry no secret material: a private key never appears in any of
//! them (it never leaves Rust).

use serde::{Deserialize, Serialize};

/// Value of the `type` member on every credential descriptor and response.
pub const PUBLIC_KEY_TYPE: &str = "public-key";

/// Relying party entity (`PublicKeyCredentialRpEntity`).
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RpEntity {
    pub id: String,
    pub name: String,
}

/// User entity (`PublicKeyCredentialUserEntity`); `id` is base64url.
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct UserEntity {
    pub id: String,
    pub name: String,
    pub display_name: String,
}

/// Accepted algorithm (`PublicKeyCredentialParameters`).
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Eq)]
pub struct PubKeyCredParam {
    #[serde(rename = "type")]
    pub type_: String,
    pub alg: i32,
}

/// Credential descriptor (`PublicKeyCredentialDescriptor`); `id` is base64url.
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Eq)]
pub struct PublicKeyCredentialDescriptor {
    #[serde(rename = "type")]
    pub type_: String,
    pub id: String,
}

/// Authenticator selection criteria (`AuthenticatorSelectionCriteria`).
#[derive(Serialize, Deserialize, Debug, Clone, Default, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AuthenticatorSelection {
    pub resident_key: Option<String>,
    pub user_verification: Option<String>,
    pub authenticator_attachment: Option<String>,
}

/// Input of the registration ceremony (`passkey_create`).
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PasskeyCreateRequest {
    pub rp: RpEntity,
    pub user: UserEntity,
    /// base64url challenge, 16..=1024 bytes once decoded.
    pub challenge: String,
    /// WebAuthn origin, e.g. `https://webauthn.io`.
    pub origin: String,
    pub pub_key_cred_params: Vec<PubKeyCredParam>,
    pub authenticator_selection: Option<AuthenticatorSelection>,
    pub exclude_credentials: Option<Vec<PublicKeyCredentialDescriptor>>,
    pub attestation: Option<String>,
}

/// Registration response (`PublicKeyCredential` with an attestation response).
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PasskeyCreateResponse {
    /// Vault entry id of the stored passkey.
    pub entry_id: String,
    pub id: String,
    pub raw_id: String,
    #[serde(rename = "type")]
    pub type_: String,
    pub response: AttestationResponse,
    pub authenticator_attachment: String,
    pub client_extension_results: serde_json::Value,
}

/// `AuthenticatorAttestationResponse` in JSON form (all binary members base64url).
///
/// The member names are pinned explicitly (`clientDataJSON`, not
/// `clientDataJson`): `rename_all = "camelCase"` would mangle the acronym and
/// break every relying party that reads the spec name.
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Eq)]
pub struct AttestationResponse {
    #[serde(rename = "clientDataJSON")]
    pub client_data_json: String,
    #[serde(rename = "attestationObject")]
    pub attestation_object: String,
    pub transports: Vec<String>,
}

/// `AuthenticatorAssertionResponse` in JSON form (all binary members base64url).
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Eq)]
pub struct AssertionResponse {
    #[serde(rename = "clientDataJSON")]
    pub client_data_json: String,
    #[serde(rename = "authenticatorData")]
    pub authenticator_data: String,
    pub signature: String,
    #[serde(rename = "userHandle")]
    pub user_handle: Option<String>,
}

/// Input of the authentication ceremony (`passkey_assert`).
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PasskeyAssertRequest {
    pub rp_id: String,
    /// base64url challenge, 16..=1024 bytes once decoded.
    pub challenge: String,
    pub origin: String,
    pub allow_credentials: Option<Vec<PublicKeyCredentialDescriptor>>,
    /// Explicit credential selection (base64url); required when several
    /// credentials for `rp_id` are allowed.
    pub credential_id: Option<String>,
    pub user_verification: Option<String>,
}

/// Authentication response (`PublicKeyCredential` with an assertion response).
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PasskeyAssertResponse {
    /// Vault entry id of the passkey that signed.
    pub entry_id: String,
    pub id: String,
    pub raw_id: String,
    #[serde(rename = "type")]
    pub type_: String,
    pub response: AssertionResponse,
    pub authenticator_attachment: String,
    pub client_extension_results: serde_json::Value,
}

/// Sanitized passkey summary returned by `passkey_list_for_rp`.
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PasskeySummary {
    pub entry_id: String,
    pub credential_id: String,
    pub rp_id: String,
    pub user_name: String,
    pub user_display_name: String,
    pub created_at: String,
    pub transports: Vec<String>,
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn create_request_json() -> serde_json::Value {
        json!({
            "rp": { "id": "example.com", "name": "Example" },
            "user": { "id": "dXNlcg", "name": "alice", "displayName": "Alice" },
            "challenge": "ERERERERERERERERERERERERERERERERERERERERERE",
            "origin": "https://example.com",
            "pubKeyCredParams": [ { "type": "public-key", "alg": -7 } ],
            "authenticatorSelection": {
                "residentKey": "required",
                "userVerification": "required",
                "authenticatorAttachment": "platform"
            },
            "excludeCredentials": [ { "type": "public-key", "id": "AQID" } ],
            "attestation": "none"
        })
    }

    #[test]
    fn create_request_parses_webauthn_json_names() {
        let request: PasskeyCreateRequest =
            serde_json::from_value(create_request_json()).expect("parse");
        assert_eq!(request.rp.id, "example.com");
        assert_eq!(request.user.display_name, "Alice");
        assert_eq!(request.pub_key_cred_params[0].type_, PUBLIC_KEY_TYPE);
        assert_eq!(request.pub_key_cred_params[0].alg, -7);
        let selection = request.authenticator_selection.expect("selection");
        assert_eq!(selection.resident_key.as_deref(), Some("required"));
        assert_eq!(
            request
                .exclude_credentials
                .expect("exclude")
                .first()
                .expect("one")
                .id,
            "AQID"
        );
    }

    #[test]
    fn create_request_optional_members_may_be_absent() {
        let mut value = create_request_json();
        let object = value.as_object_mut().expect("object");
        object.remove("authenticatorSelection");
        object.remove("excludeCredentials");
        object.remove("attestation");
        let request: PasskeyCreateRequest = serde_json::from_value(value).expect("parse");
        assert!(request.authenticator_selection.is_none());
        assert!(request.exclude_credentials.is_none());
        assert!(request.attestation.is_none());
    }

    #[test]
    fn create_response_serializes_camel_case_and_type_member() {
        let response = PasskeyCreateResponse {
            entry_id: "entry".to_string(),
            id: "cred".to_string(),
            raw_id: "cred".to_string(),
            type_: PUBLIC_KEY_TYPE.to_string(),
            response: AttestationResponse {
                client_data_json: "e30".to_string(),
                attestation_object: "o2NmbXQ".to_string(),
                transports: vec!["internal".to_string()],
            },
            authenticator_attachment: "platform".to_string(),
            client_extension_results: json!({}),
        };
        let value = serde_json::to_value(&response).expect("serialize");
        assert_eq!(value["type"], "public-key");
        assert_eq!(value["entryId"], "entry");
        assert_eq!(value["rawId"], "cred");
        assert_eq!(value["response"]["clientDataJSON"], "e30");
        assert_eq!(value["response"]["attestationObject"], "o2NmbXQ");
        assert_eq!(value["response"]["transports"][0], "internal");
        assert_eq!(value["authenticatorAttachment"], "platform");
        assert_eq!(value["clientExtensionResults"], json!({}));
        assert!(value.get("type_").is_none());
    }

    #[test]
    fn assert_request_and_response_shapes() {
        let request: PasskeyAssertRequest = serde_json::from_value(json!({
            "rpId": "example.com",
            "challenge": "ERERERERERERERERERERERERERERERERERERERERERE",
            "origin": "https://example.com",
            "allowCredentials": [ { "type": "public-key", "id": "AQID" } ],
            "credentialId": "AQID",
            "userVerification": "required"
        }))
        .expect("parse");
        assert_eq!(request.rp_id, "example.com");
        assert_eq!(request.credential_id.as_deref(), Some("AQID"));

        let response = PasskeyAssertResponse {
            entry_id: "entry".to_string(),
            id: "cred".to_string(),
            raw_id: "cred".to_string(),
            type_: PUBLIC_KEY_TYPE.to_string(),
            response: AssertionResponse {
                client_data_json: "e30".to_string(),
                authenticator_data: "AAAA".to_string(),
                signature: "MEUCIQ".to_string(),
                user_handle: Some("dXNlcg".to_string()),
            },
            authenticator_attachment: "platform".to_string(),
            client_extension_results: json!({}),
        };
        let value = serde_json::to_value(&response).expect("serialize");
        assert_eq!(value["response"]["clientDataJSON"], "e30");
        assert_eq!(value["response"]["authenticatorData"], "AAAA");
        assert_eq!(value["response"]["signature"], "MEUCIQ");
        assert_eq!(value["response"]["userHandle"], "dXNlcg");
        assert_eq!(value["clientExtensionResults"], json!({}));
    }

    #[test]
    fn summary_shape_is_camel_case() {
        let summary = PasskeySummary {
            entry_id: "entry".to_string(),
            credential_id: "cred".to_string(),
            rp_id: "example.com".to_string(),
            user_name: "alice".to_string(),
            user_display_name: "Alice".to_string(),
            created_at: "2026-11-19T00:00:00Z".to_string(),
            transports: vec!["internal".to_string()],
        };
        let value = serde_json::to_value(&summary).expect("serialize");
        assert_eq!(value["entryId"], "entry");
        assert_eq!(value["credentialId"], "cred");
        assert_eq!(value["rpId"], "example.com");
        assert_eq!(value["userName"], "alice");
        assert_eq!(value["userDisplayName"], "Alice");
        assert_eq!(value["createdAt"], "2026-11-19T00:00:00Z");
        assert_eq!(value["transports"][0], "internal");
    }
}
