mod commands;
mod crypto;
mod io;
mod models;
mod vault;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            vault::lifecycle::write_vault,
            vault::lifecycle::read_vault,
            vault::lifecycle::delete_vault,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
