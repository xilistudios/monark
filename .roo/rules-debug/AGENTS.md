# Project Debug Rules (Non-Obvious Only)

- **Tauri Invoke Mocks**: Frontend tests fail if `@tauri-apps/api/core` and `__TAURI_INTERNALS__` are not mocked. See `src/test/setup.ts`.
- **Snake Case Errors**: "Missing field" errors in `invoke` calls usually mean a `camelCase` key was sent instead of `snake_case`.
- **Deep Link Debugging**: `deepLinkService` logs initialization status to the console. Check for `[Main] Global deep link service initialized`.
- **Rust Lib Name**: When running Rust tests, use `-p monark_lib` as the library name differs from the package name.
