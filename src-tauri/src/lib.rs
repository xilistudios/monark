use commands::storage::StorageState;
#[cfg(desktop)]
use tauri::image::Image;
#[cfg(desktop)]
use tauri::menu::{Menu, MenuItem};
#[cfg(desktop)]
use tauri::tray::{TrayIconBuilder, TrayIconEvent};
use tauri::{Emitter, Manager, WindowEvent};

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

/// Recursively copy a directory and all its contents.
fn copy_dir_recursive(src: &std::path::Path, dst: &std::path::Path) -> std::io::Result<()> {
    std::fs::create_dir_all(dst)?;
    for entry in std::fs::read_dir(src)? {
        let entry = entry?;
        let src_path = entry.path();
        let dst_path = dst.join(entry.file_name());
        if entry.file_type()?.is_dir() {
            copy_dir_recursive(&src_path, &dst_path)?;
        } else {
            std::fs::copy(&src_path, &dst_path)?;
        }
    }
    Ok(())
}

fn build_app() {
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
        .plugin(tauri_plugin_biometry::init())
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
            let token_path = app
                .path()
                .resolve("provider_tokens.json", BaseDirectory::AppData)?;
            storage::set_token_store_path(token_path);

            // Set vault state path using Tauri's path API (correct on mobile)
            let vault_state_path = app
                .path()
                .resolve("monark/vault_state.json", BaseDirectory::AppData)?;
            state::set_vault_state_path(vault_state_path.clone());

            // Set cloud cache base directory using Tauri's path API
            let cloud_cache_path = app
                .path()
                .resolve("monark/cloud_cache", BaseDirectory::AppData)?;
            vault::cloud_lifecycle::set_cloud_cache_path(cloud_cache_path.clone());

            // Migration: if new vault_state.json doesn't exist, try old dirs::data_dir() location
            if !vault_state_path.exists() {
                if let Some(old_data_dir) = dirs::data_dir() {
                    let old_vault_state = old_data_dir.join("monark").join("vault_state.json");
                    if old_vault_state.exists() {
                        if let Some(parent) = vault_state_path.parent() {
                            let _ = std::fs::create_dir_all(parent);
                        }
                        let _ = std::fs::copy(&old_vault_state, &vault_state_path);
                        println!(
                            "[migration] Migrated vault_state.json from {} to {}",
                            old_vault_state.display(),
                            vault_state_path.display()
                        );
                    }
                }
            }

            // Migration: if new cloud_cache doesn't exist, try old dirs::data_dir() location
            if !cloud_cache_path.exists() {
                if let Some(old_data_dir) = dirs::data_dir() {
                    let old_cloud_cache = old_data_dir.join("monark").join("cloud_cache");
                    if old_cloud_cache.exists() {
                        if let Some(parent) = cloud_cache_path.parent() {
                            let _ = std::fs::create_dir_all(parent);
                        }
                        let _ = copy_dir_recursive(&old_cloud_cache, &cloud_cache_path);
                        println!(
                            "[migration] Migrated cloud cache from {} to {}",
                            old_cloud_cache.display(),
                            cloud_cache_path.display()
                        );
                    }
                }
            }

            let storage_manager = tauri::async_runtime::block_on(storage::init_storage_manager())?;

            #[cfg(desktop)]
            let _ = app
                .handle()
                .plugin(tauri_plugin_updater::Builder::new().build());

            app.manage(StorageState {
                manager: storage_manager,
            });

            // Create vault state manager with the correct (Tauri-resolved) path
            let vault_state_manager = state::VaultStateManager::with_path(vault_state_path);
            app.manage(state::ManagedVaultState::new(vault_state_manager));

            // --- Desktop-only features: system tray + close-to-hide ---
            #[cfg(desktop)]
            {
                // System Tray
                let show_i = MenuItem::with_id(app, "show", "Show Monark", true, None::<&str>)?;
                let quit_i = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
                let menu = Menu::with_items(app, &[&show_i, &quit_i])?;

                let tray_icon = Image::from_bytes(include_bytes!("../icons/systray_32.png"))
                    .expect("failed to load tray icon");

                let app_handle = app.handle().clone();
                let _tray = TrayIconBuilder::new()
                    .icon(tray_icon)
                    .tooltip("Monark Password Manager")
                    .menu(&menu)
                    .show_menu_on_left_click(false)
                    .on_menu_event(move |app, event| match event.id.as_ref() {
                        "show" => {
                            if let Some(window) = app.get_webview_window("main") {
                                let _ = window.show();
                                let _ = window.unminimize();
                                let _ = window.set_focus();
                            }
                        }
                        "quit" => {
                            app.exit(0);
                        }
                        _ => {}
                    })
                    .on_tray_icon_event(move |tray, event| {
                        if let TrayIconEvent::Click {
                            button: tauri::tray::MouseButton::Left,
                            button_state: tauri::tray::MouseButtonState::Up,
                            ..
                        } = event
                        {
                            let app = tray.app_handle();
                            if let Some(window) = app.get_webview_window("main") {
                                let _ = window.show();
                                let _ = window.unminimize();
                                let _ = window.set_focus();
                            }
                        }
                    })
                    .build(app)?;

                // Intercept window close to hide to tray instead of quitting
                let main_window = app
                    .get_webview_window("main")
                    .expect("main window not found");
                let handle = app_handle.clone();
                main_window.on_window_event(move |event| {
                    if let WindowEvent::CloseRequested { api, .. } = event {
                        api.prevent_close();
                        if let Some(window) = handle.get_webview_window("main") {
                            let _ = window.hide();
                        }
                    }
                });
            }

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
            commands::storage::test_webdav_connection,
            commands::totp::generate_totp,
            state::load_vault_state,
            state::save_vault_state,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
