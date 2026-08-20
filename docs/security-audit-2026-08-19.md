# Security Audit Report — Monark Password Manager v0.2.5

**Date:** 2026-08-19
**Scope:** Rust backend (`src-tauri/src`, ~8.8k lines), React/TS frontend (`src/`, 102 files), Tauri configuration, capabilities, dependencies, CI/CD, and OAuth flow.
**Methodology:** Manual review of cryptographic and storage code + automated explorer scans (frontend, dependencies/config), with all critical findings verified against source code.

---

## ✅ Verified Strengths

The cryptographic core is professional-grade:

| Aspect | Status |
|---|---|
| Argon2id (64 MB / 3 iterations / 4 parallelism) + **anti-downgrade protection** (`validate_argon2_params`) | ✅ |
| XChaCha20-Poly1305 with random 192-bit nonces via `OsRng` | ✅ |
| Master key wrapped by KDF-key; `kdf_key.zeroize()` after every use | ✅ |
| `ZeroizeOnDrop` on `Vault`, `Entry`, `Field`, `EncryptedData` | ✅ |
| Path validation + canonicalization (anti path-traversal) in `lifecycle.rs` | ✅ |
| Atomic writes (tmp + rename) with `0600` permissions on Unix | ✅ |
| OAuth tokens and WebDAV passwords stored in **OS keychain**, never on disk (`config.rs`) | ✅ |
| OAuth with **PKCE (S256) + CSRF state**, single-use, 5-minute expiry | ✅ |
| Credential never exposed over IPC (`merge_volatile` blanks it); volatile data **never persisted to disk** (`partition_volatile`) | ✅ |
| Cloud cache stores the **encrypted** vault, never plaintext | ✅ |
| Frontend: zero `dangerouslySetInnerHTML`/`eval`, clipboard auto-clear after 30 s, 5-minute auto-lock, DevTools disabled, TOTP computed in Rust | ✅ |
| Updater with minisign pubkey + HTTPS endpoint; CI actions pinned by SHA | ✅ |

> **False positive discarded:** an automated scan flagged decrypted entries being persisted to disk as CRITICAL. Verified against the Rust backend: `partition_volatile()` ensures only metadata is persisted; entries remain in RAM only. Not a vulnerability, but it does highlight a questionable design choice (sending sensitive data to the backend merely to hold it in memory).

---

## 🔴 CRITICAL / HIGH Findings

### 1. 🔴 Unscoped `http:default` + wildcard `*.googleapis.com` — exfiltration channel

**File:** `src-tauri/capabilities/default.json`

The frontend is granted `http:default` plus a `remote.urls` allowlist including `https://*.googleapis.com/*`. In a password manager, an XSS or supply-chain compromise could exfiltrate the vault through any Google API endpoint.

**Verified fact that changes the calculus:** the frontend makes **zero HTTP calls** — no `fetch`, no `@tauri-apps/plugin-http` usage anywhere in `src/`. All WebDAV and Google Drive requests are issued by the **Rust backend via reqwest** (`webdav.rs`, `google_drive.rs`), which is *not* governed by capabilities. The OAuth URL is opened via `plugin-opener` (system browser), not the webview.

**Conclusion:** the wildcard is not required for external WebDAV support (any-URL WebDAV works through Rust reqwest regardless). The entire `http:default` permission and the `remote.urls` block can be **removed outright**, closing the exfiltration channel with no functional impact.

**Fix:**
```json
// Remove from capabilities/default.json:
//   "http:default"
//   "remote": { "urls": [...] }
```
If frontend HTTP is ever needed in the future, scope it to exact endpoints then.

### 2. 🔴 WebDAV credential leak via malicious hrefs

**File:** `src-tauri/src/storage/providers/webdav.rs` (~lines 480–500, `search_recursive`)

If a WebDAV server returns an absolute `href` (`https://evil.com/...`), Monark issues a PROPFIND to that URL **attaching the user's Basic `Authorization` header** (`propfind()` always adds it). A malicious or compromised server steals the credentials.

**Fix:** in `search_recursive`, reject absolute hrefs whose host does not match `server_url`'s host.

### 3. 🔴 npm vulnerabilities (including one in a production dependency)

- **seroval** (transitive of `@tanstack/react-router`, **production**): RCE via deserialization — CRITICAL
- **vitest** < 3.2.6: arbitrary file read + execute — CRITICAL (dev)
- **vite** < 6.3.6, **tar**, **rollup** < 4.59, **postcss**, **ws**, **lodash**, **nanoid** — HIGH

**Fix:** `bun update` + `overrides` in `package.json`:
```json
"overrides": {
  "seroval": ">=1.4.1",
  "tar": ">=7.5.7",
  "rollup": ">=4.59.0",
  "postcss": ">=8.5.23",
  "nanoid": ">=3.3.16"
}
```

### 4. 🟠 OAuth `client_secret` embedded in the binary

**Files:** `src-tauri/build.rs`, `option_env!()` in `src-tauri/src/storage/config.rs`

The client secret is baked into every distributed binary (extractable with `strings`). Google tolerates this for desktop apps, **but** the `redirect_uri` is a web URL (Firebase), which moves it closer to a web client. Revocation also requires a full re-release.

**Fix:** document the risk in SECURITY.md, or migrate to a loopback redirect + pure PKCE (no secret).

### 5. 🟠 No rate limiting on password attempts

**Files:** `src-tauri/src/vault/lifecycle.rs`, `src-tauri/src/vault/cloud_lifecycle.rs`

`read_vault` / `read_cloud_vault` do not limit failed attempts. Argon2id makes each attempt expensive, but there is no lockout or exponential backoff (already listed as pending in the project's own docs).

**Fix:** add progressive delay / lockout after N failures.

### 6. 🟠 DoS via unbounded Argon2 parameters

`validate_argon2_params` only validates **minimums**. A malicious `.monark` file with a multi-GiB `m_cost` forces huge memory allocations on open.

**Fix:** add upper bounds (e.g. `m_cost ≤ 256 MiB`, `t_cost ≤ 10`).

### 7. 🟠 Ad-hoc macOS signing (`signingIdentity: "-"`)

No Developer ID: Gatekeeper blocks the app and there is no integrity verification — unacceptable for a distributed password manager.

### 8. 🟠 Outdated TLS stack

`reqwest 0.11` drags in `rustls 0.21` and `webpki 0.101` (two versions present in the lockfile).

**Fix:** migrate to `reqwest 0.12` and consolidate.

---

## 🟡 MEDIUM Findings

| # | Finding | Location |
|---|---|---|
| M1 | **`Vault.hmac` is security theater**: the field exists but is never computed or verified (created as `""`). Real integrity comes from the AEAD tag — fine — but the dead field is misleading | `models.rs`, `lifecycle.rs` |
| M2 | `io::signature` is not a signature: it is the magic prefix `p->monark/`. The name is misleading (docs mention "HMAC verification") | `io/signature.rs` |
| M3 | `master_key` returned as `[u8; 32]` without `Zeroize` — not cleared after use in `read_vault` / `update_existing_vault` | `lifecycle.rs` |
| M4 | Mock OAuth in production code with predictable `state` (`providerId_Date.now()`) and `http://localhost` redirect | `src/services/vault.ts:1027` |
| M5 | `Math.random()` used for vault IDs | `src/services/vault.ts:1244` → use `crypto.randomUUID()` |
| M6 | CSV import with no size limit + unbounded quote-continuation loop (file-based DoS) | `ImportCsvModal.tsx:118`, `utils/csv.ts:40` |
| M7 | ~50 `console.log` statements in production (none leak secrets, but `localOAuthServer.ts:60` logs the full callback URL including the OAuth `code`) → use Vite's `drop_console` | various |
| M8 | CSP with `style-src 'unsafe-inline'` (acceptable for Tailwind, but document the rationale) | `tauri.conf.json` |

---

## 🟢 LOW / Informational

- `Cargo.toml` version out of sync (0.2.3 vs 0.2.5).
- Orphan file `src-tauri/src/crypto/tests/mod copy.rs`.
- Deep link `monark://`: any app can register the scheme, but PKCE + state mitigate `code` interception — low residual risk.
- Master password travels over IPC as plaintext JSON (inherent to Tauri; acceptable).
- Missing `cargo-audit` in CI (add it alongside `bun audit`).

---

## 📋 Prioritized Roadmap

1. **Remove `http:default` + `remote.urls`** entirely (verified unused by frontend; WebDAV works through Rust reqwest) — one-line config change, maximum impact
2. **Fix WebDAV credential leak** (validate host of absolute hrefs)
3. **`bun update` + overrides** for the npm CVEs
4. **Argon2 upper bounds** + password-attempt rate limiting
5. Clean up security theater: remove or implement `Vault.hmac`, rename `io::signature`
6. Real macOS signing, upgrade `reqwest 0.12`, add `cargo-audit` / `bun audit` to CI

---

## 🔧 Remediation Status (2026-08-20)

| # | Item | Status | Commit |
|---|---|---|---|
| 1 | Remove `http:default` + `remote.urls` | ✅ DONE | `8e55fb9` |
| 2 | WebDAV credential leak (`is_same_host` guard) | ✅ DONE (4 new tests) | `ff7e833` |
| 3 | npm CVEs (`bun update` + overrides) | ✅ DONE — 44 → 2 vulns (both low, dev-only, pending upstream) | `b59a82f` |
| 4a | Argon2 upper bounds (256 MiB / 10 iter / 16 par) | ✅ DONE (5 new tests) | `5a5cb11` |
| 4b | Progressive rate limiting (3 free attempts, exp backoff capped 60 s) | ✅ DONE (new `vault::rate_limit` module, 5 new tests) | `5a5cb11` |
| M5 | `crypto.randomUUID()` for vault IDs | ✅ DONE | `b858d27` |
| 5 | hmac/signature cleanup | ⏳ pending | — |
| 6 | macOS signing, reqwest 0.12, cargo-audit in CI | ⏳ pending | — |
| M1–M4, M6–M8 | remaining MEDIUM items | ⏳ pending | — |

**Validation:** full `cargo check` + `cargo test` run inside an Ubuntu 22.04 container with Tauri Linux deps (host lacks GTK dev libs + no sudo). Result: compiles clean; all new tests pass (rate_limit 5/5, argon2 6/6, webdav 11/11). The only 5 failures are pre-existing keychain tests requiring a dbus secret-service (environmental, unrelated). Frontend: `bun run build` clean, 251/251 tests pass (3 test *files* fail collection due to a pre-existing localStorage/jsdom issue, unchanged by this work).

Branch: `fix/security-audit-2026-08-19` (6 commits, NOT pushed).

---

## Overall Verdict

The cryptography and secret handling are well above average — the zero-knowledge design is real and correctly implemented. The real risks live at the **edges**: unscoped network permissions, vulnerable dependencies, the WebDAV provider, and distribution (code signing). Items 1–3 are less than a day of work.
