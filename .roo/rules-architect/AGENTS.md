# Project Architecture Rules (Non-Obvious Only)

- **Storage Abstraction**: All storage operations (local/cloud) must go through `StorageManager` in Rust or `VaultManager`/`VaultInstance` in TypeScript.
- **State Synchronization**: Redux is the source of truth for the UI, but `VaultManager` manages the lifecycle of `VaultInstance` objects that perform the actual operations.
- **Provider Extensibility**: New cloud providers must implement the `StorageProvider` trait in `src-tauri/src/storage/providers/mod.rs`.
- **Async Initialization**: The app bootstraps the `StorageManager` asynchronously in `main.rs` before starting the Tauri runtime.
