# CXF (Credential Exchange Format) fixtures

Test-only inputs for the CXF subset Monark supports: **passkey credentials only**
(`type: "passkey"`), pinned to the FIDO Alliance **CXF 1.0 review draft
2025-03-13** (`https://fidoalliance.org/specs/cx/cxf-v1.0-rd-20250313.html`,
§3.1 Header, §3.2.1 Account, §3.2.3 Item, §3.3.12 Passkey, Appendix A).
Pin date: **2026-02-13**.

Consumers: `src-tauri/src/passkey/cxf.rs` tests (`include_str!`, compile-time) and,
from T16 on, the `import_cxf`/`export_cxf` command tests. No production module
reads these files at runtime.

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

## Files

| File | Purpose | Expected outcome |
|------|---------|------------------|
| `spec-appendix-a.json` | Spec Appendix A example, trimmed to one passkey item plus one `basic-auth` and one `totp` item | envelope parses; 1 valid passkey; 2 skipped with exact types |
| `valid-single.json` | One account, one item, one passkey | envelope parses; 1 valid passkey |
| `valid-multi-account.json` | 2 accounts, 3 passkeys, one item without timestamps, one credential with `fido2Extensions` | envelope parses; 3 valid passkeys; the extension-bearing one reports `extensions_present = true` |
| `duplicate-credential.json` | Same `(rpId, credentialId)` twice, plus the same `credentialId` under a different `rpId` | 3 credentials validate; dedup (T16) keeps 2 |
| `bad-base64.json` | Padded credential id, standard-alphabet user handle, non-base64 key | 3 credentials rejected with base64 reasons |
| `wrong-curve-key.json` | Ed25519 and P-384 PKCS#8 keys | 2 credentials rejected (ES256-only) |
| `bad-rpid.json` | Empty, scheme, path, port and whitespace `rpId` values | 5 credentials rejected |
| `missing-fields.json` | Missing `rpId`/`key`/`type`, wrong JSON type, non-object credential | 5 credentials rejected |
| `wrong-major-version.json` | `version.major = 2` | whole envelope rejected (`CommandError::Validation`) |

`oversized.json` (the 10 MiB DoS cap) is **generated in-test**, never committed:
a 10 MiB file in git would be pure bloat and would trip size linters.

## Editing rules

* Keep the tab indentation and the key order of the spec examples so a diff
  against the published Appendix A stays readable.
* Do not "fix" a deliberately broken value: every negative fixture is a
  regression test for one specific validation rule (the rule is named in the
  test that consumes it).
* Adding a fixture means adding its row to the table above and a consumer test.