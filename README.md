<p align="center">
  <img src="public/logo.svg" width="128" height="128" alt="Monark Password Manager Logo" />
</p>

<h1 align="center">Monark Password Manager</h1>

<p align="center">
  <a href="https://tauri.app"><img src="https://img.shields.io/badge/Tauri-2.0-FFC131?logo=tauri&logoColor=black" alt="Tauri" /></a>
  <a href="https://react.dev"><img src="https://img.shields.io/badge/React-18.3-61DAFB?logo=react&logoColor=black" alt="React" /></a>
  <a href="https://www.rust-lang.org"><img src="https://img.shields.io/badge/Rust-Stable-DEA584?logo=rust&logoColor=black" alt="Rust" /></a>
  <img src="https://img.shields.io/badge/License-AGPL--3.0-blue" alt="License" />
</p>

<p align="center">
  Monark is a secure, local-first, cross-platform password manager engineered with a zero-knowledge architecture. By combining the safety and performance of Rust with a fast, modern React user interface, Monark delivers desktop-grade encryption and a seamless user experience across platforms.
</p>

---

## 🔒 Security & Cryptographic Architecture

Monark operates on a strict zero-knowledge security model. All cryptographic processes are performed locally within the secure Rust backend before any sensitive information is persisted or transmitted.

### Cryptographic Standards

*   **Key Derivation Function (KDF):** Argon2id with memory-hard parameters (64MB memory, 3 iterations, 4-thread parallelism) to mitigate brute-force and GPU-accelerated side-channel attacks.
*   **Symmetric Encryption:** XChaCha20-Poly1305 (IETF variant) authenticated encryption using 256-bit keys and 192-bit random nonces.
*   **Entropy Generation:** Cryptographically Secure Pseudo-Random Number Generation (CSPRNG) utilizing the operating system's native entropy sources (`OsRng`).
*   **Memory Protection:** Automated zeroization of sensitive credentials (`ZeroizeOnDrop`) to protect against cold-boot attacks and memory forensic extraction.

---

## 🚀 Key Features

*   **Offline-First & Local-First:** Complete data ownership. Your vault is stored locally and encrypted at rest.
*   **Cross-Platform Architecture:** Built on Tauri v2 to support Windows, macOS, Linux, Android, and iOS natively from a single codebase.
*   **Modern Frontend Stack:** Powered by React, TypeScript, TanStack Router for type-safe routing, and Tailwind CSS v4 / DaisyUI for highly responsive styling.
*   **Rigorous Verification:** Robust type safety across the Rust-TypeScript boundary, combined with comprehensive test coverage.

---

## 🛠️ Technical Documentation

Detailed specifications and architectural guides are available in the `docs` directory:

*   [Cryptographic Architecture](docs/crypto-architecture.md) — Mathematical parameters, key derivation, and cipher implementations.
*   [Vault Storage Format](docs/vault-format.md) — Disk serialization formats, HMAC verification, and Rust-to-TypeScript type mappings.
*   [Cloud Storage & Sync](docs/cloud-storage-architecture.md) — Design documents for remote backup and synchronization.
*   [Testing & Quality Assurance](docs/testing-cloud-storage.md) — Integration testing strategies for the storage layer.
*   [Security Audit Results](docs/security-audit.md) — Vulnerability checklist and verification of crypto implementations.
*   [State Management & Store](docs/redux-state.md) — Redux Toolkit slice structure and application state flow.
*   [Internationalization (i18n)](docs/i18n-system.md) — Localization framework and translation setup.
*   [Accessibility Guide](docs/accessibility-guide.md) — WCAG compliance guidelines and focus management patterns.

---

## 💻 Getting Started

### Prerequisites

Ensure you have the following installed on your system:
*   [Rust (Stable)](https://www.rust-lang.org/tools/install)
*   [Bun (JavaScript Runtime)](https://bun.sh)
*   Platform-specific Tauri dependencies (see the [Tauri Prerequisites Guide](https://v2.tauri.app/start/prerequisites/))

### Installation & Development

1.  **Clone the Repository:**
    ```bash
    git clone https://github.com/xilistudios/monark.git
    cd monark
    ```

2.  **Install Workspace Dependencies:**
    ```bash
    bun install
    ```

3.  **Run Development Environment:**
    ```bash
    # Run frontend dev server along with Tauri window
    bun tauri dev
    ```
    *Note for Linux users: If you experience rendering/driver issues, you may need to disable DMA-Buf:*
    ```bash
    WEBKIT_DISABLE_DMABUF_RENDERER=1 bun tauri dev
    ```

### Testing & Linting

Run the test suites and check formatting consistency:

```bash
# Run Vitest suite for frontend
bun test

# Run Rust unit/integration tests
bun run test:rust

# Lint codebase with Biome
bun run biome lint .
```

### Production Build

To compile a production-ready installer for your native platform:

```bash
bun tauri build
```

---

## 🤝 Contributing

We welcome contributions to Monark. Please adhere to the following development guidelines:
1.  Ensure complete TypeScript type safety across all frontend models.
2.  Maintain strict cargo safety rules in the native wrapper.
3.  Add comprehensive test coverage in Vitest and Cargo test suites for all new features.
4.  Run `bun run biome check --write` to align with the workspace formatting standard.

---

## 📄 License

This project is licensed under the **GNU Affero General Public License v3.0 (AGPL-3.0)**. See the `LICENSE` file for details.

Copyright © 2025-2026 [Xili Studios](https://github.com/xilistudios). All rights reserved.