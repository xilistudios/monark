// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

#[tokio::main]
async fn main() {
    let storage_manager = monark_lib::storage::init_storage_manager().await;
    monark_lib::run(storage_manager)
}
