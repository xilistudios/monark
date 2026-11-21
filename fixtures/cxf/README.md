# CXF (Credential Exchange Format) fixtures

Test-only inputs for the CXF subset Monark supports: **passkey credentials only**
(`type: "passkey"`), pinned to the FIDO Alliance **CXF 1.0 review draft
2025-03-13** (`https://fidoalliance.org/specs/cx/cxf-v1.0-rd-20250313.html`,
§3.1 Header, §3.2.1 Account, §3.2.3 Item, §3.3.12 Passkey, Appendix A).
Pin date: **2025-03-13** (the draft revision, not the date the fixtures were
written).

The supported subset is documented in
[`docs/passkeys.md` §11](../../docs/passkeys.md#11-cxf-importexport-f1); this
directory is its test corpus.

## Consumers

The fixtures are **`include_str!`d at compile time** — no production module reads
them at runtime, and a renamed or deleted file is a build error rather than a
test that silently stops covering a rule:

* [`src-tauri/src/passkey/cxf.rs`](../../src-tauri/src/passkey/cxf.rs) — parser
  and per-credential validator tests
  (`include_str!` block at
  [`cxf.rs:627-641`](../../src-tauri/src/passkey/cxf.rs#L627-L641)).
* [`src-tauri/src/commands/passkey_import_tests.rs`](../../src-tauri/src/commands/passkey_import_tests.rs)
  — end-to-end `import_cxf` tests against a real vault
  ([`passkey_import_tests.rs:36-47`](../../src-tauri/src/commands/passkey_import_tests.rs#L36-L47)).

`export_cxf` does not read these files: it exports whatever the vault holds, and
its round-trip test imports a fixture first.

## Files

| File | Purpose | Expected outcome |
|------|---------|------------------|
| `spec-appendix-a.json` | Spec Appendix A example, trimmed to one passkey item plus one `basic-auth` and one `totp` item | envelope parses; 1 valid passkey; 2 skipped with exact types |
| `valid-single.json` | One account, one item, one passkey | envelope parses; 1 valid passkey |
| `valid-multi-account.json` | 2 accounts, 3 passkeys, one item without timestamps, one credential with `fido2Extensions` | envelope parses; 3 valid passkeys; the extension-bearing one reports `extensions_present = true` and a lossy report row (`EXTENSIONS_IGNORED_NOTE`) |
| `duplicate-credential.json` | Same `(rpId, credentialId)` twice, plus the same `credentialId` under a different `rpId` | 3 credentials validate; dedup keeps 2, 1 counted as a duplicate |
| `bad-base64.json` | Padded credential id, standard-alphabet user handle, non-base64 key | 3 credentials rejected with base64 reasons |
| `wrong-curve-key.json` | Ed25519 and P-384 PKCS#8 keys | 2 credentials rejected (ES256-only) |
| `bad-rpid.json` | Empty, scheme, path, port and whitespace `rpId` values | 5 credentials rejected |
| `missing-fields.json` | Missing `rpId`/`key`/`type`, wrong JSON type, non-object credential | 5 credentials rejected |
| `wrong-major-version.json` | `version.major = 2` | whole envelope rejected (`CommandError::Validation`) |

That is the list required by the plan's §4 fixture pin, one file per rule. The
`oversized` case (the 10 MiB DoS cap) is **generated in-test, never committed**:
a 10 MiB file in git would be pure bloat and would trip size linters
([`parse_rejects_oversized_document`](../../src-tauri/src/passkey/cxf.rs#L842-L858),
[`passkey_import_tests.rs:889-901`](../../src-tauri/src/commands/passkey_import_tests.rs#L889-L901)).

## Provenance of the key material

Every fixture that carries a `key` uses the **published example private key from
Appendix A of the CXF review draft** (a P-256 PKCS#8 DER blob, base64url):

```
MIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQgARu_0sCt20EpgVxb4Puq3Ga5VVLpuTY75ngvZlyq3X6hRANCAASmdk1xLsK0oOlhxIPp0d1ZuS0sT9nf6BZtSelhqvLBW0fOL33l_bXgsr_STUHjCLn8l6gcRJwe7OQvbQubZ1dY
```

It is a **published specification example, not a secret**: it grants access to
nothing, and it is the same value the T02 known-answer vector uses
(`VECTOR_KEY_B64URL` in `src-tauri/src/passkey/tests.rs`). The `credentialId`,
`userHandle`, account/item ids and the non-passkey credential payloads
(`basic-auth` password, `totp` secret) are likewise **synthetic placeholders**
that exist only to exercise the parser and the skip-report path. No real
credential, password, TOTP seed or private key is stored in this directory.

`wrong-curve-key.json` carries two *public* non-P-256 test keys:

* Ed25519 PKCS#8 — the RFC 8410 published test key
  (`d75a9801…f707511a`), a well-known non-secret vector.
* P-384 PKCS#8 — a throwaway key generated locally with `openssl ecparam -name
  secp384r1` for this fixture only. It is not used anywhere else.

## Regenerating and validating

There is no generator script: the fixtures are hand-written JSON and are meant to
stay small and reviewable. To change or add one:

1. **Edit or add the JSON** here, keeping the tab indentation and the key order
   of the spec examples so a diff against the published Appendix A stays
   readable.
2. **Add or update its row** in the table above.
3. **Point a test at it.** A new fixture with no consumer is dead weight: add the
   `include_str!` constant and the assertion that names the rule it pins.
4. **Run the suites** (from the repo root, with the Rust toolchain on `PATH`):

   ```bash
   cd src-tauri && cargo test -p monark
   ```

   `cargo test` is the whole validation loop for this directory — the fixtures
   are compiled into the test binary, so a malformed JSON file fails the build
   and a changed expectation fails the test. There is no separate fixture
   validator to run.
5. **Do not "fix" a deliberately broken value** — see the rules below.

## Editing rules

* Keep the tab indentation and the key order of the spec examples so a diff
  against the published Appendix A stays readable.
* Do not "fix" a deliberately broken value: every negative fixture is a
  regression test for one specific validation rule (the rule is named in the
  test that consumes it).
* Adding a fixture means adding its row to the table above and a consumer test.
* Never commit real key material, and never commit the `oversized` case.