use commands::storage::StorageState;
use tauri::{Emitter, Manager};

use tauri::path::BaseDirectory;

pub mod commands;
pub mod crypto;
pub mod io;
pub mod models;
pub mod state;
pub mod storage;
pub mod vault;

pub fn run() {
    build_app();
}

#[cfg(mobile)]
#[tauri::mobile_entry_point]
pub fn mobile_main() {
    build_app();
}

fn build_app() {
    let vault_state_manager = state::VaultStateManager::new();

    let builder = tauri::Builder::default();

    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    let builder = builder.plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
        // Prevent multiple instances and focus the existing window for deep-link scenarios
        println!("Second instance attempted, focusing existing window");

        // Forward args to frontend for deep-link handling
        let _ = app.emit("single-instance-args", args);

        // Try to focus the main window or any existing window
        if let Some(window) = app.get_webview_window("main") {
            let _ = window.unminimize();
            let _ = window.show();
            if let Err(e) = window.set_focus() {
                println!("Failed to focus main window: {}", e);
            }
        } else if let Some(window) = app.get_webview_window("core") {
            let _ = window.unminimize();
            let _ = window.show();
            if let Err(e) = window.set_focus() {
                println!("Failed to focus core window: {}", e);
            }
        } else {
            // Fallback: try to focus the first available window
            if let Some(window) = app.webview_windows().values().next() {
                let _ = window.unminimize();
                let _ = window.show();
                if let Err(e) = window.set_focus() {
                    println!("Failed to focus fallback window: {}", e);
                }
            } else {
                println!("No windows found to focus");
            }
        }
    }));

    builder
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_opener::init())
        .setup(move |app| {
            let config_path = app
                .path()
                .resolve("storage_config.json", BaseDirectory::AppData)?;
            storage::set_storage_config_path(config_path);
            let storage_manager = tauri::async_runtime::block_on(storage::init_storage_manager());

            #[cfg(desktop)]
            let _ = app
                .handle()
                .plugin(tauri_plugin_updater::Builder::new().build());

            app.manage(StorageState {
                manager: storage_manager,
            });
            app.manage(state::ManagedVaultState::new(vault_state_manager));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            vault::lifecycle::write_vault,
            vault::lifecycle::read_vault,
            vault::lifecycle::delete_vault,
            vault::cloud_lifecycle::write_cloud_vault,
            vault::cloud_lifecycle::read_cloud_vault,
            vault::cloud_lifecycle::delete_cloud_vault,
            vault::cloud_lifecycle::list_cloud_vaults,
            vault::cloud_lifecycle::change_cloud_vault_password,
            commands::storage::list_providers,
            commands::storage::add_provider,
            commands::storage::remove_provider,
            commands::storage::set_default_provider,
            commands::storage::list_files,
            commands::storage::create_file,
            commands::storage::read_file,
            commands::storage::delete_file,
            commands::storage::update_file,
            commands::storage::create_folder,
            commands::storage::delete_folder,
            commands::storage::get_file_info,
            commands::storage::search_files,
            commands::storage::list_vaults,
            commands::storage::authenticate_provider,
            commands::storage::check_provider_auth_status,
            commands::storage::get_provider_auth_info,
            commands::storage::refresh_provider_auth,
            commands::storage::get_google_drive_oauth_url,
            commands::storage::handle_google_drive_oauth_callback,
            state::load_vault_state,
            state::save_vault_state,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
