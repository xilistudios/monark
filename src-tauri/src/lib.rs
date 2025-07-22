mod crypto;
mod io;
mod models;
mod vault;
mod commands;
// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            greet,
            vault::lifecycle::create_vault,
            vault::lifecycle::open_vault,
            vault::lifecycle::update_vault,
            commands::vault::unlock_vault,
            commands::vault::update_vault_encrypted
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
