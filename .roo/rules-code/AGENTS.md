# Project Coding Rules (Non-Obvious Only)

- **Vault Initialization**: `initializeVaultState()` must be called and resolved before `ReactDOM.createRoot`.
- **Service Initialization**: `deepLinkService` and `VaultManager` require manual initialization with Redux `dispatch` and `getState`.
- **Snake Case in Payloads**: When calling `invoke('write_vault', ...)` or `invoke('write_cloud_vault', ...)`, the `vaultContent` object MUST use `snake_case` keys (e.g., `updated_at`, `entries`) to match Rust structs.
- **Structured Clone**: Use `structuredClone()` for deep copying vault entries before modification to avoid Redux state mutation.
- **Tauri Plugins**: Use `@tauri-apps/plugin-*` packages for filesystem, store, and clipboard operations.
