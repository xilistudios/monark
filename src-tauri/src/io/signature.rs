use crate::models;
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};

pub const SIGNATURE: &str = "p->monark/";
pub struct Signature {
    pub signature: String,
    pub content: String,
}
pub fn is_valid_signature(signature: &str) -> bool {
    signature.starts_with(SIGNATURE)
}
pub fn sign_content(content: &str) -> String {
    format!("{}{}", SIGNATURE, content)
}
pub fn parse_content(signed_content: &str) -> Signature {
    if signed_content.starts_with(SIGNATURE) {
        let part: Vec<&str> = signed_content.splitn(2, SIGNATURE).collect::<Vec<&str>>();
        Signature {
            signature: part[0].to_string(),
            content: part[1].to_string(),
        }
    } else {
        Signature {
            signature: signed_content.to_string(),
            content: "".to_string(),
        }
    }
}
pub fn sign_vault(vault: &models::VaultFile) -> String {
    let vault_json = serde_json::to_string(&vault).unwrap();
    let base64_encoded = URL_SAFE_NO_PAD.encode(vault_json);
    sign_content(&base64_encoded)
}
