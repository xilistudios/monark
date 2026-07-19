use crate::commands::errors::{CommandError, CommandResult};
use crate::crypto::totp::{self, TotpResponse};

#[tauri::command]
pub async fn generate_totp(secret: String) -> CommandResult<TotpResponse> {
    totp::generate_totp(&secret).map_err(CommandError::from)
}
