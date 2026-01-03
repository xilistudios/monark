# AGENTS.md

This file provides guidance to agents when working with code in this repository.

## Project Stack
- **Frontend**: React 18, TypeScript, TanStack Router, Redux Toolkit, TailwindCSS, DaisyUI.
- **Backend**: Tauri 2 (Rust), Argon2, ChaCha20Poly1305.
- **Tools**: Bun (package manager), Biome (lint/format), Vitest (frontend tests), Cargo (Rust tests).

## Critical Commands
- **Test Single File**: `bun vitest run src/path/to/file.test.ts`
- **Rust Tests**: `bun test:rust` (runs `cargo test` for the lib)
- **Lint/Format**: `bunx biome check --write .`

## Non-Obvious Patterns
- **Vault State**: Initialized in `src/main.tsx` via `initializeVaultState()` before React renders.
- **Deep Links**: Managed by `deepLinkService` which requires Redux `dispatch`/`getState` initialization.
- **Tauri Lib**: The Rust core is in `src-tauri/src/lib.rs` named `monark_lib`.
- **Cloud Storage**: Uses a provider-based architecture (`src-tauri/src/storage/providers`).
- **Testing**: Frontend tests MUST mock `@tauri-apps/api/core` and `__TAURI_INTERNALS__`. See `src/test/setup.ts`.
- **Snake Case**: Backend (Rust) uses `snake_case` for vault content (e.g., `updated_at`), while frontend interfaces might use `camelCase`. Be careful with `invoke` payloads.

## Code Style (Biome)
- **Indentation**: Tabs.
- **Quotes**: Double quotes for JS/TS.
- **Imports**: Organized automatically by Biome.
