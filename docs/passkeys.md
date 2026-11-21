# Passkeys (F0)

Monark is a **software WebAuthn authenticator**: the passkey private keys live
inside the encrypted vault blob and the ceremony (registration and assertion) is
computed in Rust. This document describes what F0 actually ships, with a
`file:line` anchor for every claim. Where a guarantee is weaker than the WebAuthn
specification would allow, it says so explicitly under **Limitation**.

> **Scope of this document.** F0 = store, create, assert, list, delete, sync,
> plus the `rpId`↔`origin` domain-suffix binding. F1 = CXF exchange: **both
> directions ship** — `import_cxf` and `export_cxf`, with the import/export UI
> (§11).
> **Not implemented, and not promised here:** per-entry encryption, vault HMAC,
> system/browser autofill integration, a browser extension, iOS, CXP/HPKE, and a
> public-suffix-list check on `rpId`. See §10 (threat model) and §12 (what F0
> does not do).

---

## 1. Architecture: disk entry vs IPC view

There are two shapes for a passkey, and the difference between them is the
security property of the whole feature.

### 1.1 `Entry::Passkey` — the disk shape (holds the key)

[`src-tauri/src/models.rs:94-127`](../src-tauri/src/models.rs#L94-L127)

```rust
Entry::Passkey {
    id, name, created_at, updated_at, tags,
    rp_id, rp_name, credential_id, user_handle,
    user_name, user_display_name,
    private_key: SecretPkcs8,   // PKCS#8 DER, base64url — DISK ONLY
    algorithm: i32,             // COSE alg, -7 (ES256)
    sign_count: u32,            // always 0
    discoverable: bool,         // always true
    transports: Vec<String>,    // ["internal"]
    aaguid: Uuid,               // Uuid::nil()
}
```

`SecretPkcs8` ([`models.rs:138`](../src-tauri/src/models.rs#L138)) is the key
wrapper, and it is defensive by construction:

| Property | Where | Effect |
|---|---|---|
| `ZeroizeOnDrop` | [`models.rs:138`](../src-tauri/src/models.rs#L138) | the encoded key is scrubbed when the value drops |
| redacted `Debug` | [`models.rs:140-144`](../src-tauri/src/models.rs#L140-L144) | `SecretPkcs8([REDACTED])` — formatting a passkey can never print the key |
| `serde(transparent)` | [`models.rs:139`](../src-tauri/src/models.rs#L139) | on-disk JSON is the plain base64 string, no wrapper object |
| `to_pkcs8_der()` returns `Zeroizing<Vec<u8>>` | [`models.rs:173-179`](../src-tauri/src/models.rs#L173-L179) | the decoded buffer is scrubbed on drop; a plain `Vec<u8>` copy cannot be produced by accident |

### 1.2 `PasskeyView` — the IPC shape (cannot hold the key)

[`src-tauri/src/models.rs:246-270`](../src-tauri/src/models.rs#L246-L270)

`PasskeyView` is `Entry::Passkey` **minus `private_key`**. It is not filtered at
serialization time — there is no field to filter:

```rust
pub struct PasskeyView {
    id, name, created_at, updated_at, tags,
    rp_id, rp_name, credential_id, user_handle,
    user_name, user_display_name,
    algorithm, sign_count, discoverable, transports, aaguid,
    // NO private_key. Intentionally absent: see `Entry::Passkey`.
}
```

The conversion is a `From<&Entry> for EntryView` impl whose passkey arm
destructures with `..` and simply never reads `private_key`
([`models.rs:315-385`](../src-tauri/src/models.rs#L315-L385), comment at
[`models.rs:346`](../src-tauri/src/models.rs#L346)).

**Consequence:** a private key cannot cross the IPC boundary because the type on
the other side has no place to put it. `VaultView`
([`models.rs:308-314`](../src-tauri/src/models.rs#L308-L314)) is what
`read_vault` returns ([`src-tauri/src/vault/lifecycle.rs:86-110`](../src-tauri/src/vault/lifecycle.rs#L86-L110)),
and the decrypted `Vault` — which does hold the keys — is dropped (zeroized) at
the end of that function.

The TypeScript mirror is `PasskeyEntry`
([`src/interfaces/vault.interface.ts:46-65`](../src/interfaces/vault.interface.ts#L46-L65)),
which likewise has no `private_key` member.

### 1.3 The command surface

| Command | Purpose | Writes? |
|---|---|---|
| `passkey_create` | registration ceremony | yes (appends the entry) |
| `passkey_assert` | authentication ceremony | **no** (§5) |
| `passkey_list_for_rp` | account picker | **no** |
| `passkey_delete` | the only deletion path (§2) | yes |
| `import_cxf` | CXF import (§11) | yes (once, iff something was imported) |
| `export_cxf` | CXF export (§11) | **no** — returns a plaintext document |

The four F0 ceremonies are registered in
[`src-tauri/src/lib.rs:287-290`](../src-tauri/src/lib.rs#L287-L290); the two F1
CXF commands follow at
[`lib.rs:291-292`](../src-tauri/src/lib.rs#L291-L292) — see §11.
Every command takes a `VaultRef` (local path or cloud provider file id,
[`passkey/store.rs:65-75`](../src-tauri/src/passkey/store.rs#L65-L75)) plus the
vault password, and unlocks the vault itself — no plaintext vault content
crosses IPC in either direction.

---

## 2. Write path: merge by id, preserve-on-write, explicit delete

The frontend never holds key material, so a full-vault write
(`write_vault`) receives a `VaultView` with passkeys that have no `private_key`.
The backend rebuilds a complete disk vault from it in
[`vault/merge.rs`](../src-tauri/src/vault/merge.rs), called from
`update_existing_vault` ([`src-tauri/src/vault/lifecycle.rs:236`](../src-tauri/src/vault/lifecycle.rs#L236)).

[`merge_vault_view`](../src-tauri/src/vault/merge.rs#L81) runs four steps:

1. **Index** every passkey already on disk by entry id, remembering its group
   path (`index_disk_passkeys` → `index_entries`, [`merge.rs:99-158`](../src-tauri/src/vault/merge.rs#L99-L158)).
2. **Duplicate guard** — an incoming tree that repeats an entry id is rejected
   with `Validation("Duplicate entry id in vault content")`
   ([`merge.rs:160-177`](../src-tauri/src/vault/merge.rs#L160-L177)).
3. **Restore** — each incoming passkey takes its immutable core from the disk
   index and only the user-editable fields from the view
   ([`restore_passkey`, `merge.rs:231-261`](../src-tauri/src/vault/merge.rs#L231-L261)).
4. **Preserve** — every disk passkey the incoming tree did *not* mention is
   re-inserted **verbatim**, at its original group path when that path still
   exists, otherwise at the root
   ([`preserve_missing_passkeys`, `merge.rs:269-288`](../src-tauri/src/vault/merge.rs#L269-L288);
   [`insert_at_path`, `merge.rs:294-308`](../src-tauri/src/vault/merge.rs#L294-L308)).

### Field mutability

Documented on `Entry::Passkey` ([`models.rs:83-94`](../src-tauri/src/models.rs#L83-L94))
and enforced by `restore_passkey`:

| Mutable from the IPC view | Always taken from disk |
|---|---|
| `name`, `tags`, `user_name`, `user_display_name`, `updated_at` | `id`, `created_at`, `rp_id`, `rp_name`, `credential_id`, `user_handle`, `private_key`, `algorithm`, `sign_count`, `discoverable`, `transports`, `aaguid` |

### Preserve-on-write and explicit delete

**Omitting a passkey from a write does not delete it.** That is deliberate: a
stale frontend view must never lock a user out of an account at the relying
party. Removal therefore requires the dedicated command:

* `passkey_delete` ([`commands/passkey.rs:836-865`](../src-tauri/src/commands/passkey.rs#L836-L865))
  parses the id, loads the vault, **type-checks the target before mutating**
  (a data entry or group is a `Validation` error, and a rejected delete leaves
  the file untouched), removes the entry and saves.
* The frontend routes passkey deletion through it and returns **without**
  `_saveVault()` ([`src/services/vault.ts:353-395`](../src/services/vault.ts#L353-L395)):
  a full write would re-attach the passkey the command just removed.

### Limitation — a stale view that still *mentions* a deleted passkey fails hard

`restore_passkey` fails closed when an incoming view names a passkey id that is
no longer on disk: `Validation("Passkey entry has no stored key material; create
or import it first")` ([`merge.rs:231-240`](../src-tauri/src/vault/merge.rs#L231-L240)).
That is the correct direction (never resurrect, never accept key material from
IPC), but it means a frontend holding a stale entry gets a hard error on its next
write. The UI must refresh its state after a delete; the delete path in
`vault.ts` already dispatches the updated entries
([`src/services/vault.ts:365-394`](../src/services/vault.ts#L365-L394)).

---

## 3. Ceremony model (F0)

### 3.1 Registration (`passkey_create`)

Flow documented at [`commands/passkey.rs:1-27`](../src-tauri/src/commands/passkey.rs#L1-L27);
implementation [`commands/passkey.rs:168-251`](../src-tauri/src/commands/passkey.rs#L168-L251)
(request validation in `validate_create_request`,
[`commands/passkey.rs:313-403`](../src-tauri/src/commands/passkey.rs#L313-L403)).

| Property | Value | Anchor |
|---|---|---|
| Algorithm | **ES256 only** (COSE `-7`) | `ALG_ES256` [`passkey/es256.rs:30`](../src-tauri/src/passkey/es256.rs#L30); rejected otherwise at [`commands/passkey.rs:316-323`](../src-tauri/src/commands/passkey.rs#L316-L323) |
| Attestation | **`"none"`**, empty `attStmt` | [`passkey/cose.rs:158-172`](../src-tauri/src/passkey/cose.rs#L158-L172); non-`none` rejected at [`commands/passkey.rs:338-343`](../src-tauri/src/commands/passkey.rs#L338-L343) |
| AAGUID | **all zero** (`Uuid::nil()`) | `AAGUID_ZERO` [`passkey/webauthn.rs:52`](../src-tauri/src/passkey/webauthn.rs#L52); stored at [`commands/passkey.rs:232`](../src-tauri/src/commands/passkey.rs#L232) |
| `signCount` | **always `0`**, never incremented | `SIGN_COUNT` [`passkey/webauthn.rs:55`](../src-tauri/src/passkey/webauthn.rs#L55); stored at [`commands/passkey.rs:229`](../src-tauri/src/commands/passkey.rs#L229) |
| Discoverable | **required** — `residentKey: "required"` is mandatory | [`commands/passkey.rs:325-335`](../src-tauri/src/commands/passkey.rs#L325-L335) |
| Credential id | 32 random bytes | `CREDENTIAL_ID_LEN` [`commands/passkey.rs:102`](../src-tauri/src/commands/passkey.rs#L102) |
| Transports | `["internal"]`, `authenticatorAttachment: "platform"` | [`commands/passkey.rs:231`](../src-tauri/src/commands/passkey.rs#L231), [`commands/passkey.rs:116-119`](../src-tauri/src/commands/passkey.rs#L116-L119) |
| Deduplication | `excludeCredentials` only | [`commands/passkey.rs:411-427`](../src-tauri/src/commands/passkey.rs#L411-L427) |

Registration `authenticatorData` flags are `UP|UV|AT` = `0x45`
([`commands/passkey.rs:199-204`](../src-tauri/src/commands/passkey.rs#L199-L204)):
`FLAG_UP = 0x01`, `FLAG_UV = 0x04`, `FLAG_AT = 0x40`
([`passkey/webauthn.rs:45-49`](../src-tauri/src/passkey/webauthn.rs#L45-L49)).

### 3.2 Assertion (`passkey_assert`)

Flow at [`commands/passkey.rs:481-535`](../src-tauri/src/commands/passkey.rs#L481-L535).

**Selection** ([`select_assertion_candidate`, `commands/passkey.rs:674-716`](../src-tauri/src/commands/passkey.rs#L674-L716)):

1. **Exact `rpId` match** — a passkey stored for `example.com` is *not* offered
   to `login.example.com` ([`collect_rp_passkeys`, `commands/passkey.rs:718-761`](../src-tauri/src/commands/passkey.rs#L718-L761)).
   This is narrower than WebAuthn's registrable-suffix rule and it is deliberate
   (ruling Q6): exact match cannot be turned into a cross-origin credential leak
   by an RP-id typo. The comparison is on the **canonical** (lowercase) `rpId`
   (§3.3), so case never splits a credential in two.
2. `allowCredentials`, when non-empty, **intersects** the candidates
   ([`commands/passkey.rs:681-687`](../src-tauri/src/commands/passkey.rs#L681-L687)).
   An **empty** list is treated as "no restriction", which is what WebAuthn L3
   §5.1.3/§6.3.3 mean by it ([`commands/passkey.rs:600-612`](../src-tauri/src/commands/passkey.rs#L600-L612)).
3. An explicit `credentialId` narrows to exactly one
   ([`commands/passkey.rs:689-704`](../src-tauri/src/commands/passkey.rs#L689-L704)).
4. **Zero candidates → `NotFound`; more than one without an explicit
   `credentialId` → `Validation`** (fail closed, ruling Q5 — never guess which
   account to sign for) ([`commands/passkey.rs:706-714`](../src-tauri/src/commands/passkey.rs#L706-L714)).

Passkeys nested inside groups are found: the tree is walked recursively.

### 3.3 `rpId` canonicalization and the `rpId`↔`origin` binding

Both ceremonies validate `rpId` and `origin` **and** check that one binds to the
other. The binding is a plain domain-suffix rule with **no public-suffix-list
lookup** — that gap is deliberate in F0 and is stated below.

**`rpId` — lexical check, then ASCII-lowercase canonicalization.**
`validate_rp_id` rejects an empty id, one longer than 253 bytes, one containing
`://`, `/` or `:`, and one with whitespace or control characters, and returns
`Result<String, _>` holding the **canonical** (ASCII-lowercased) value
([`webauthn.rs:190-204`](../src-tauri/src/passkey/webauthn.rs#L190-L204)). Every
entry point uses the returned string, never the caller's:

| Entry point | Anchor |
|---|---|
| registration | [`commands/passkey.rs:346`](../src-tauri/src/commands/passkey.rs#L346) |
| assertion | [`commands/passkey.rs:584`](../src-tauri/src/commands/passkey.rs#L584) |
| `passkey_list_for_rp` | [`commands/passkey.rs:790`](../src-tauri/src/commands/passkey.rs#L790) |
| CXF import (T15 validator) | [`cxf.rs:467-473`](../src-tauri/src/passkey/cxf.rs#L467-L473) |

`build_authenticator_data` canonicalizes again before hashing, so `rpIdHash` is
`SHA-256` of the canonical form
([`webauthn.rs:254-267`](../src-tauri/src/passkey/webauthn.rs#L254-L267),
[`rp_id_hash`, `webauthn.rs:86-90`](../src-tauri/src/passkey/webauthn.rs#L86-L90)).
Consequence: `Example.COM` and `example.com` are **the same credential** here —
pinned by `rp_id_hash_uses_the_canonical_rp_id`
([`webauthn.rs:763-775`](../src-tauri/src/passkey/webauthn.rs#L763-L775)) and
`validate_rp_id_returns_the_ascii_lowercase_canonical_form`
([`webauthn.rs:740-759`](../src-tauri/src/passkey/webauthn.rs#L740-L759)). Exact
selection (§3.2) compares canonical strings, so it is case-insensitive in
practice.

**`origin` — syntax check, canonical serialization.** `validate_origin` parses
the string as an absolute `http`/`https` URL with no path, query, fragment or
userinfo ([`webauthn.rs:143-150`](../src-tauri/src/passkey/webauthn.rs#L143-L150),
[`canonical_origin`, `webauthn.rs:153-176`](../src-tauri/src/passkey/webauthn.rs#L153-L176)).
The emitted `clientDataJSON` carries `Url::origin().ascii_serialization()`, not
the caller's raw string ([`webauthn.rs:119-141`](../src-tauri/src/passkey/webauthn.rs#L119-L141)).

**The binding — `validate_rp_id_binding(rp_id, origin)`.** After both syntax
checks, each ceremony requires the origin's host to be the `rpId` itself or a
domain suffix of it, on a label boundary
([`webauthn.rs:223-231`](../src-tauri/src/passkey/webauthn.rs#L223-L231)):

```rust
let host = origin_host(origin)?;            // ASCII-lowercased host
if host == rp_id || host.ends_with(&format!(".{rp_id}")) {
    return Ok(());
}
Err(validation("RP ID is not a domain suffix of the origin's host"))
```

Call sites: registration
([`commands/passkey.rs:372-373`](../src-tauri/src/commands/passkey.rs#L372-L373))
and assertion
([`commands/passkey.rs:592-593`](../src-tauri/src/commands/passkey.rs#L592-L593)).
So `rpId = "example.com"` binds to `https://example.com` and to
`https://login.example.com`, but **not** to `https://notexample.com` (no label
boundary) and **not** to a super-domain such as `rpId = "example"`. The
rejection is pinned from both ceremonies:
`create_rejects_rp_id_that_does_not_bind_to_the_origin`
([`passkey_tests.rs:397-408`](../src-tauri/src/commands/passkey_tests.rs#L397-L408)),
`assert_rejects_rp_id_that_does_not_bind_to_the_origin`
([`passkey_assert_tests.rs:1042-1059`](../src-tauri/src/commands/passkey_assert_tests.rs#L1042-L1059)),
and the positive (sub-domain) side by
`assert_accepts_rp_id_that_is_a_domain_suffix_of_the_origin`
([`passkey_assert_tests.rs:1063`](../src-tauri/src/commands/passkey_assert_tests.rs#L1063)).
A negative control (`negative_control_rp_id_binding_is_not_a_no_op`,
[`webauthn.rs:822-833`](../src-tauri/src/passkey/webauthn.rs#L822-L833)) fails if
the check is ever reduced to a no-op.

> **Limitation — the binding has no public-suffix-list lookup.**
> F0 implements the *suffix* half of WebAuthn L2 §5.1.4 but not the
> *registrable-domain* half: there is no PSL, so a bare TLD is accepted as an
> `rpId` for any host under it. `validate_rp_id_binding("com", "https://evil.com")`
> succeeds. This is pinned as a deliberate gap by
> `rp_id_binding_has_no_public_suffix_list_in_f0`
> ([`webauthn.rs:812-817`](../src-tauri/src/passkey/webauthn.rs#L812-L817)), which
> also asserts that a host *not* under the TLD is still refused. Full
> registrable-domain validation is out of scope for F0.
>
> This is **not** a privilege escalation inside Monark's threat model: the caller
> already holds the vault password and can already sign for any stored RP
> (§10.2). It matters only if a future caller is less trusted than the vault
> password — e.g. a browser extension or a web page driving the ceremony — and
> that is exactly the F1+ integration this document does not promise. Any such
> integration **must** add the PSL check before it ships.

`passkey_list_for_rp` has no origin to bind to, so it stays lexical-only: the
`rpId` is canonicalized and an unmatched value simply returns an empty list (fail
closed) ([`commands/passkey.rs:766-771`](../src-tauri/src/commands/passkey.rs#L766-L771),
[`commands/passkey.rs:782-806`](../src-tauri/src/commands/passkey.rs#L782-L806)).
The CXF import path is likewise lexical-only — it has no origin in the file
([`cxf.rs:486-499`](../src-tauri/src/passkey/cxf.rs#L486-L499)).

---

## 4. User verification (UV) — and its honest limitation

### 4.1 What happens

The UV step lives in the **frontend**, where the OS biometric prompt is
available: [`src/services/passkeyCeremony.ts`](../src/services/passkeyCeremony.ts)
is the gate in front of every ceremony.

```
resolve vault (Redux) ──▶ locked? ──▶ throw (before any IPC)
       │
       ▼
checkBiometricAvailability()
       ├── available ──▶ authenticate(prompt) ──▶ false ──▶ throw (no password fallback)
       │                                    └──▶ true  ──▶ command
       └── unavailable ──────────────────────────────────▶ command
```

* The vault must be **unlocked** before anything else; a locked vault throws
  before any IPC call ([`passkeyCeremony.ts:116-147`](../src/services/passkeyCeremony.ts#L116-L147)).
* The request is validated with a strict Zod schema **before** the prompt, so a
  malformed request never interrupts the user with a biometric dialog
  ([`passkeyCeremony.ts:214-221`](../src/services/passkeyCeremony.ts#L214-L221)).
* Biometry **available and failing** (cancel, lockout, sensor error) → the
  ceremony throws; there is no password fallback and no retry
  ([`passkeyCeremony.ts:176-195`](../src/services/passkeyCeremony.ts#L176-L195)).
* Biometry **unavailable** (no sensor, nothing enrolled, plugin missing) → the
  ceremony proceeds; the vault password the user just typed is the documented
  fallback UV ([`passkeyCeremony.ts:170-174`](../src/services/passkeyCeremony.ts#L170-L174)).
* A broken biometric subsystem is *not* "unavailable": it throws rather than
  silently proceeding ([`passkeyCeremony.ts:156-168`](../src/services/passkeyCeremony.ts#L156-L168)).

The backend always sets the `UV` flag on assertions
([`commands/passkey.rs:496`](../src-tauri/src/commands/passkey.rs#L496)) and on
registrations ([`commands/passkey.rs:201`](../src-tauri/src/commands/passkey.rs#L201)).

### 4.2 `userVerification` is accepted and then ignored

`PasskeyAssertRequest.user_verification`
([`passkey/types.rs:136`](../src-tauri/src/passkey/types.rs#L136)) and
`AuthenticatorSelection.user_verification`
([`passkey/types.rs:63`](../src-tauri/src/passkey/types.rs#L63)) are
`Option<String>` fields that deserialize from the frontend. They are checked
against the WebAuthn enum at the boundary — `required` / `preferred` /
`discouraged`, anything else (`"banana"`) is a `Validation` error
([`USER_VERIFICATION_VALUES`, `commands/passkey.rs:126`](../src-tauri/src/commands/passkey.rs#L126);
[`validate_user_verification`, `commands/passkey.rs:134-141`](../src-tauri/src/commands/passkey.rs#L134-L141)) —
and are then **not used to gate anything**.

The value **never gates the `UV` flag**. Monark always sets it, including for
`"discouraged"` (ruling Q14) — the behaviour is stated in the validator's own
doc comment ([`commands/passkey.rs:578-580`](../src-tauri/src/commands/passkey.rs#L578-L580))
and pinned by a test that sets `"discouraged"` and still expects `UV`
(`assert_sets_uv_even_when_discouraged`,
[`passkey_assert_tests.rs:304-317`](../src-tauri/src/commands/passkey_assert_tests.rs#L304-L317)).

A relying party that requires a UV-disabled assertion is out of F0 scope.

### 4.3 Limitation — the backend cannot verify that the biometric prompt happened

**This is the most important limitation in this document.**

The Rust commands take the vault password and sign. They cannot tell whether a
biometric prompt was shown, passed, or skipped: the prompt is orchestrated by
webview code, and nothing cryptographically binds it to the command call.

* Any code running in the webview that holds the vault password can invoke
  `passkey_create` / `passkey_assert` directly, bypassing
  `passkeyCeremony.ts` entirely.
* The trust boundary is therefore **possession of the vault password** — exactly
  the same boundary `read_vault` has today
  ([`src-tauri/src/vault/lifecycle.rs:86-110`](../src-tauri/src/vault/lifecycle.rs#L86-L110)).
  Passkeys do not raise the bar above "the vault is unlocked".
* The `UV` flag Monark emits is honest about *what Monark knows* (the user
  proved the vault password moments ago) but it is **not** proof that a
  biometric check occurred.

Binding UV to the command cryptographically would need a backend session token
minted after a verified prompt — a plugin change, out of F0 scope (ruling Q4).
The deviation is documented in the module header
([`commands/passkey.rs:60-71`](../src-tauri/src/commands/passkey.rs#L60-L71)).

---

## 5. Assertion is read-only

`passkey_assert` is read-only **by construction**, not by promise: there is no
`store::save_vault` call on any path of
[`passkey_assert_with`](../src-tauri/src/commands/passkey.rs#L481-L535). The only
two `save_vault` call sites in the file are `passkey_create`
([`commands/passkey.rs:234`](../src-tauri/src/commands/passkey.rs#L234)) and
`passkey_delete` ([`commands/passkey.rs:864`](../src-tauri/src/commands/passkey.rs#L864)).

Consequences:

* The vault file stays **byte-identical** after an assertion. Any save would
  re-encrypt with a fresh nonce and stamp `updated_at`, so a byte comparison is
  a real check.
* The stored `signCount` stays `0` (ruling Q15). A software authenticator whose
  credential lives in a single vault has no clone signal to report; a counter
  would be a false one.

### The assertion bytes

| Member | Value | Anchor |
|---|---|---|
| `authenticatorData` | **37 bytes**: `rpIdHash(32) ‖ flags(1) ‖ signCount(4, BE)` | [`webauthn.rs:254-287`](../src-tauri/src/passkey/webauthn.rs#L254-L287) |
| flags | `UP|UV` = **`0x05`**, `AT` **clear** | [`commands/passkey.rs:496`](../src-tauri/src/commands/passkey.rs#L496); `build_authenticator_data` rejects a flags/attested mismatch ([`webauthn.rs:260-265`](../src-tauri/src/passkey/webauthn.rs#L260-L265)) |
| `rpIdHash` | `SHA-256` of the **canonical** (ASCII-lowercase) `rpId`, the same string that is stored (§3.3) | [`webauthn.rs:86-90`](../src-tauri/src/passkey/webauthn.rs#L86-L90) |
| signature | ES256 (DER, low-S, RFC 6979 deterministic nonce) over `authData ‖ SHA-256(clientDataJSON)` | [`passkey/es256.rs:111-120`](../src-tauri/src/passkey/es256.rs#L111-L120); input built at [`webauthn.rs:393-399`](../src-tauri/src/passkey/webauthn.rs#L393-L399) |
| `clientDataJSON` | compact JSON, `{type:"webauthn.get", challenge, origin}` with the **canonical** origin | [`webauthn.rs:119-141`](../src-tauri/src/passkey/webauthn.rs#L119-L141) |
| `userHandle` | echoes the stored handle (always present: every F0 credential is discoverable) | [`commands/passkey.rs:526`](../src-tauri/src/commands/passkey.rs#L526) |

`0x05` is `UP|UV` with `AT` **clear** — `FLAG_AT` is `0x40`, not part of `0x05`
([`webauthn.rs:45-49`](../src-tauri/src/passkey/webauthn.rs#L45-L49)). A relying
party parsing this assertion must stop at byte 37.

> **Note for integrators:** the response also carries `entryId`, an internal
> vault UUID that is **not** part of the WebAuthn spec. Strip it before handing
> the credential to a relying party — it is a cross-RP linkage handle.

---

## 6. Sync: union merge, cloud-wins groups, resurrection

Cloud sync merges per entry id in the frontend
([`src/services/vaultMerge.ts`](../src/services/vaultMerge.ts), entry point
[`mergeVaultEntries`, `vaultMerge.ts:213`](../src/services/vaultMerge.ts#L213)):

* **Union by entry id**, recursive through groups.
* Same id, **data or passkey entry** → the copy with the **newest `updated_at`
  wins wholesale** ([`isNewer`, `vaultMerge.ts:80-92`](../src/services/vaultMerge.ts#L80-L92)).
  No field-level merge.
* Same id, **group** → the group's own metadata (`name`, `data_type`) is
  **cloud-authoritative**; its children are still merged recursively
  ([`mergeGroupPair`, `vaultMerge.ts:108-118`](../src/services/vaultMerge.ts#L108-L118)).
  This is forced by the vault format, not a preference: `Entry::Group` carries no
  timestamps ([`models.rs:61-67`](../src-tauri/src/models.rs#L61-L67)), so
  "newest wins" is inert for groups. **Consequence:** a group renamed locally is
  reverted by the next sync — and, because the merged view is pushed back,
  reverted for every device. Documented in
  [`docs/cloud-storage-architecture.md` §8.3](cloud-storage-architecture.md#83-sync-semantics-union-merge).
* Passkey views merge like any other entry; they carry no secret material, and
  the backend write-merge re-attaches the key from the stored vault by entry id
  (§2).
* Deterministic order: cloud entries first, then local-only entries in local
  order.

### Limitation — deletion can be resurrected

Union merge plus preserve-on-write means **a deletion does not propagate by
itself**: a passkey deleted on device A can be resurrected by a sync from device
B that still holds it. Deletions propagate reliably only when every device syncs
after the delete. This is the deliberate trade — resurrection is recoverable
(delete again), whereas silently dropping a passkey is a lockout at the relying
party. Tombstones would fix it but would redesign sync, so they are out of scope.
Documented at [`vaultMerge.ts:37-43`](../src/services/vaultMerge.ts#L37-L43) and
[`docs/cloud-storage-architecture.md` §8.3](cloud-storage-architecture.md#83-sync-semantics-union-merge).

---

## 7. Cloud vaults: a live provider is required

Every passkey command loads the vault through the store seam
([`passkey/store.rs:102-115`](../src-tauri/src/passkey/store.rs#L102-L115)). For a
cloud `VaultRef` the seam **deliberately does not fall back to the offline
cache** ([`store.rs:202-209`](../src-tauri/src/passkey/store.rs#L202-L209)): this
vault is about to be written back, and writing from a stale cached copy would
clobber whatever the provider holds now. An unreachable provider is a hard
`CommandError::Io`, not a silent write from cache.

**Consequence:** passkey operations on a cloud vault **fail while offline**. The
rest of the app keeps its offline copy — a successful read/write still
*refreshes* the local cache with the encrypted envelope
([`store.rs:211-219`](../src-tauri/src/passkey/store.rs#L211-L219),
[`store.rs:256-262`](../src-tauri/src/passkey/store.rs#L256-L262)) — but a
passkey command is a read-modify-write and cannot run from it.

---

## 8. Format version 1.1

A vault that holds a passkey is stamped `"1.1"`; a 1.0 vault without passkeys
stays 1.0 so pre-passkey clients keep opening it. The full policy — constants,
read gate, write rule, old-client behaviour — lives in
[`docs/vault-format.md` §1.1](vault-format.md#11-format-versions) and is
implemented in [`vault/version.rs`](../src-tauri/src/vault/version.rs)
(`CURRENT_VAULT_VERSION` [`src-tauri/src/vault/version.rs:29`](../src-tauri/src/vault/version.rs#L29),
`SUPPORTED_VAULT_VERSIONS` [`src-tauri/src/vault/version.rs:36`](../src-tauri/src/vault/version.rs#L36),
`check_version` [`src-tauri/src/vault/version.rs:47`](../src-tauri/src/vault/version.rs#L47),
`version_for_content` [`src-tauri/src/vault/version.rs:73`](../src-tauri/src/vault/version.rs#L73)).
It is not repeated here.

One passkey-specific consequence worth stating: **deleting the last passkey does
not downgrade the file.** `version_for_content` returns the existing version when
the content holds no passkey, so a 1.1 vault stays 1.1
([`src-tauri/src/vault/version.rs:73-80`](../src-tauri/src/vault/version.rs#L73-L80)).

---

## 9. Concurrency limitations

### 9.1 No optimistic concurrency on passkey writes

`passkey_create` and `passkey_delete` are load-mutate-save cycles
([`store.rs:102-131`](../src-tauri/src/passkey/store.rs#L102-L131)) with no
version check between the load and the save. A concurrent full-vault write that
lands inside that window is silently lost — the loaded copy wins. This is a
property of the seam, shared with the vault commands; `passkey_delete` is simply
the destructive one, so the window is most expensive there.

### 9.2 A stale view after a delete fails hard

See §2: `restore_passkey` refuses a view that names a passkey no longer on disk
([`merge.rs:231-240`](../src-tauri/src/vault/merge.rs#L231-L240)). The UI must
refresh after a delete; the delete path already dispatches the new entry list
([`src/services/vault.ts:365-394`](../src/services/vault.ts#L365-L394)).

### 9.3 Rate limiting is shared with the vault commands

Every passkey command goes through the store seam, which runs
`rate_limit::check_attempts` **before** any Argon2 work and records a failure on
a wrong password ([`store.rs:155`](../src-tauri/src/passkey/store.rs#L155),
[`store.rs:273-288`](../src-tauri/src/passkey/store.rs#L273-L288)). The counter
is keyed by canonical path (local) or provider file id (cloud) — the same key the
lifecycle commands use, so a wrong password here counts against the same counter.

There is **no backend "vault is unlocked" state** for these commands: they take
the password and derive. The unlock gate is the frontend ceremony service (§4).
Do not assume the backend enforces "the vault is unlocked".

---

## 10. Threat model

### 10.1 What protects the keys

The passkey private key is a field of the encrypted vault blob. Its
confidentiality is the vault's confidentiality:

* **One encrypted blob.** The whole `Vault` — data entries and passkey keys
  together — is serialized to JSON and sealed with XChaCha20-Poly1305 under the
  Argon2id-derived master key
  ([`vault/keys.rs:176-199`](../src-tauri/src/vault/keys.rs#L176-L199),
  [`vault/keys.rs:205-219`](../src-tauri/src/vault/keys.rs#L205-L219)).
  There is **no per-entry encryption**: `EntryEncryption`
  ([`models.rs:212-220`](../src-tauri/src/models.rs#L212-L220)) is declared but
  unused.
* **No HMAC.** `Vault.hmac` is always the empty string; integrity comes from the
  AEAD tag, which is verified on decrypt
  ([`src-tauri/src/crypto/chacha.rs:46-74`](../src-tauri/src/crypto/chacha.rs#L46-L74)). See the
  warning in [`docs/vault-format.md`](vault-format.md#1-overview).
* **Memory hygiene.** The key wrapper zeroizes on drop and redacts `Debug`
  (§1.1); the decoded PKCS#8 buffer is `Zeroizing`; the plaintext vault JSON is
  `Zeroizing` on both the encrypt and decrypt side
  ([`vault/keys.rs:190-197`](../src-tauri/src/vault/keys.rs#L190-L197),
  [`vault/keys.rs:210`](../src-tauri/src/vault/keys.rs#L210)).

### 10.2 Trust boundary

**The vault password.** Everything above follows from it:

* Anyone who can unlock the vault can read every passkey private key (they are
  in the blob) and can invoke the ceremonies.
* The biometric prompt (§4) is a UX-level confirmation, **not** a cryptographic
  gate on the commands. It raises the cost of a shoulder-surfing attacker at an
  unlocked session; it does not stop code that already holds the password.
* Same boundary as `read_vault` today. Passkeys do not weaken it, and they do not
  strengthen it either.

### 10.3 Non-rotatable keys

A passkey private key **cannot be rotated without the relying party**. The RP
stores the public key at registration; the only way to replace the private key is
to register a new credential at the RP and delete the old one. There is no
"change passkey password" operation, by design of WebAuthn.

Consequences for incident response:

* A compromised vault means every passkey in it must be **re-registered at each
  relying party**, individually. There is no bulk rotation.
* Contrast with data entries, where changing the vault password re-wraps
  everything at once.
* This is why preserve-on-write (§2) errs so strongly toward never losing a
  passkey: the recovery cost is a per-RP account recovery flow.

### 10.4 What an attacker with the vault password gets

| Capability | Yes/No | Note |
|---|---|---|
| Read all passkey private keys | **yes** | they are in the decrypted blob |
| Sign arbitrary assertions for stored RPs | **yes** | `passkey_assert` needs only the password |
| Mint new passkeys | **yes** | `passkey_create` needs only the password |
| Sign for an RP with no stored credential | no | selection is exact-match over stored entries (§3.2) |
| Sign with an `origin` that is not the `rpId` or a sub-domain of it | no | rejected by `validate_rp_id_binding` (§3.3) |
| Sign with `rpId = "com"` and `origin = "https://evil.com"` | **yes** | the suffix check has no PSL (§3.3); the caller already holds the password |
| Exfiltrate keys over IPC | no | `PasskeyView` has no key field (§1.2) |
| Export every private key in plaintext | **yes** | `export_cxf` with `consent: true` (§10.5) |

### 10.5 CXF export is a plaintext key export

`export_cxf` (T17, shipped as a command) returns a **plain, unencrypted** JSON
document containing every passkey's PKCS#8 private key in base64url
([`build_export`, `passkey/cxf.rs:537-596`](../src-tauri/src/passkey/cxf.rs#L537-L596);
the `key` member is the stored `SecretPkcs8` string verbatim, copied through
`as_b64url` with no decode/re-encode round trip —
[`ExportPasskey::from_entry`, `cxf.rs:267-296`](../src-tauri/src/passkey/cxf.rs#L267-L296)).

The command is gated on an explicit `consent: true` argument, checked **before
any IO** ([`passkey_export.rs:118-124`](../src-tauri/src/commands/passkey_export.rs#L118-L124)),
and it refuses to return a partial document (a credential with a non-zero
signature counter aborts the whole export,
[`passkey_export.rs:136-141`](../src-tauri/src/commands/passkey_export.rs#L136-L141)).
It never writes the vault: the file is byte-identical afterwards
(`export_cxf_is_read_only`,
[`passkey_export_tests.rs:860-886`](../src-tauri/src/commands/passkey_export_tests.rs#L860-L886)).

Treat an exported `.cxf.json` as **equivalent to the vault password** for those
credentials. The caller (the UI) owns where the document is written; the Rust
command only returns the string.

---

## 11. CXF import/export (F1)

CXF is the FIDO Alliance **Credential Exchange Format**. F1 lets a user carry
passkeys in and out of the vault as a CXF document, so an existing passkey can
be migrated from another password manager instead of being re-registered by
hand. **Both directions ship**: `import_cxf` (T16) and `export_cxf` (T17), with
the UI in T18 (import template card + export modal). This section documents
exactly the subset that is implemented, with a `file:line` anchor for every
claim.

### 11.1 What is supported

| Piece | State | Anchor |
|---|---|---|
| CXF serde types + strict per-credential validator | **shipped** (T15) | [`src-tauri/src/passkey/cxf.rs`](../src-tauri/src/passkey/cxf.rs) |
| `import_cxf` command + `PasskeyCommands.importCxf` wrapper | **shipped** (T16) | [`commands/passkey_import.rs:85-97`](../src-tauri/src/commands/passkey_import.rs#L85-L97), [`src/services/passkey.ts:175-188`](../src/services/passkey.ts#L175-L188) |
| `export_cxf` command + `PasskeyCommands.exportCxf` wrapper | **shipped** (T17) | [`commands/passkey_export.rs:98-108`](../src-tauri/src/commands/passkey_export.rs#L98-L108), [`src/services/passkey.ts:205-212`](../src/services/passkey.ts#L205-L212) |
| Import UI (passkey template card → import modal) | **shipped** (T18) | [`AddEntryModal.tsx:192-196`](../src/components/Vault/Modals/AddEntryModal.tsx#L192-L196), [`PasskeyImportModal.tsx`](../src/components/Vault/Modals/PasskeyImportModal.tsx) |
| Export UI (toolbar button + consent modal) | **shipped** (T18) | [`VaultToolbar.tsx:143-148`](../src/components/Vault/VaultToolbar.tsx#L143-L148), [`PasskeyExportModal.tsx`](../src/components/Vault/Modals/PasskeyExportModal.tsx) |

Both commands are registered in the invoke handler
([`lib.rs:291-292`](../src-tauri/src/lib.rs#L291-L292)).

**Draft pin.** The format is the FIDO Alliance **CXF 1.0 review draft
2025-03-13** (`https://fidoalliance.org/specs/cx/cxf-v1.0-rd-20250313.html`),
sections §3.1 Header, §3.2.1 Account, §3.2.3 Item, §3.3.12 Passkey and the
Appendix A example ([`cxf.rs:1-8`](../src-tauri/src/passkey/cxf.rs#L1-L8)). It is
a **draft**, not a ratified standard: a later revision of the draft may change
member names or semantics, and Monark will then need a migration. Nothing here
promises compatibility with any other CXF revision.

**Only `type: "passkey"` credentials are imported or exported.** Every other
credential type (`basic-auth`, `totp`, `credit-card`, `address`, `api-key`,
`note`, `item-reference`, `file`, `ssh-key`, …) is **ignored on import with a
per-credential report entry** — never silently
([`validate_credential`, `cxf.rs:375-406`](../src-tauri/src/passkey/cxf.rs#L375-L406);
the reason is `unsupported credential type: <type>`, `cxf.rs:390-395`).

Because the support is a *subset of a draft*, the honest framing for a user is
**"migrate passkeys from a manager that exports CXF"**, not "compatible with
Apple/Google/Bitwarden". Whether a given vendor's export parses depends on
whether that vendor follows the same draft revision and on the per-credential
rules below; a file that fails is reported credential by credential, not
guessed at.

### 11.2 Envelope and credential shape

Import parses **leniently** (the spec says importers MUST ignore unknown
members: the envelope structs simply do not declare them, so `serde` drops
them — [`cxf.rs:13-21`](../src-tauri/src/passkey/cxf.rs#L13-L21)) and validates
**strictly** per credential. Export emits exactly the members Monark has
([`build_export`, `cxf.rs:537-590`](../src-tauri/src/passkey/cxf.rs#L537-L590)).

| Member | Import | Export |
|---|---|---|
| `version.major` | must be `1`; any `minor` accepted ([`parse_envelope`, `cxf.rs:338-352`](../src-tauri/src/passkey/cxf.rs#L338-L352), [`SUPPORTED_MAJOR_VERSION`, `cxf.rs:51`](../src-tauri/src/passkey/cxf.rs#L51)) | `{major: 1, minor: 0}` ([`EXPORT_MINOR_VERSION`, `cxf.rs:53`](../src-tauri/src/passkey/cxf.rs#L53)) |
| `exporterRpId` / `exporterDisplayName` | ignored | `"monark.app"` / `"Monark"` ([`cxf.rs:47-49`](../src-tauri/src/passkey/cxf.rs#L47-L49)) |
| `timestamp` | ignored | now, UNIX seconds ([`cxf.rs:538`](../src-tauri/src/passkey/cxf.rs#L538)) |
| `accounts[]` | required array, may be empty | exactly one account, `username`/`email` empty, `collections: []` ([`cxf.rs:562-578`](../src-tauri/src/passkey/cxf.rs#L562-L578)) |
| `items[]` | each item → one vault entry | one item per exported passkey ([`cxf.rs:548-560`](../src-tauri/src/passkey/cxf.rs#L548-L560)) |
| `item.title` | entry name; blank → `username@rpId` ([`passkey_import.rs:245-250`](../src-tauri/src/commands/passkey_import.rs#L245-L250)) | entry name |
| `item.tags` | entry tags, `[]` when absent | entry tags |
| `item.creationAt` / `modifiedAt` | entry timestamps, `now` when absent ([`passkey_import.rs:231-238`](../src-tauri/src/commands/passkey_import.rs#L231-L238)) | entry timestamps |
| `item.subtitle`, `favorite`, `scope`, `collections` | ignored | omitted |
| `credential.type` | must be `"passkey"` | `"passkey"` |
| `credential.key` | **PKCS#8 DER, base64url** — ES256/P-256 only (see §11.3) | the stored `SecretPkcs8` string verbatim ([`cxf.rs:292`](../src-tauri/src/passkey/cxf.rs#L292)) |
| `credential.fido2Extensions` | ignored, reported (§11.4) | never emitted ([`cxf.rs:510-528`](../src-tauri/src/passkey/cxf.rs#L510-L528)) |

The private key member is **`key`**, not `privateKey` (§3.3.12 of the draft —
[`cxf.rs:22-25`](../src-tauri/src/passkey/cxf.rs#L22-L25)). On export it is
copied straight from `SecretPkcs8::as_b64url()` with no decode/re-encode round
trip, so the exported `key` is byte-identical to what the vault stores
([`ExportPasskey::from_entry`, `cxf.rs:267-296`](../src-tauri/src/passkey/cxf.rs#L267-L296)).

### 11.3 Per-credential validation (import)

A bad credential is **skipped with a reason**; it never fails the whole file.
Envelope-level problems (invalid JSON, `version.major != 1`, missing
`accounts`/`items`/`credentials`, a document over the 10 MiB cap) reject the
whole import with a `Validation` error
([`parse_envelope`, `cxf.rs:338-352`](../src-tauri/src/passkey/cxf.rs#L338-L352),
[`MAX_ENVELOPE_BYTES`, `cxf.rs:44`](../src-tauri/src/passkey/cxf.rs#L44)).

| Rule | Rejection reason | Anchor |
|---|---|---|
| `credentialId` / `userHandle` / `key` must be URL_SAFE_NO_PAD base64 | `<field> is not valid base64url (URL_SAFE_NO_PAD)` | [`cxf.rs:480-483`](../src-tauri/src/passkey/cxf.rs#L480-L483) |
| `credentialId` decodes to 1..=1023 bytes | `credentialId must decode to 1..=1023 bytes` | [`cxf.rs:437-440`](../src-tauri/src/passkey/cxf.rs#L437-L440) |
| `userHandle` decodes to ≤ 64 bytes | `userHandle must decode to at most 64 bytes` | [`cxf.rs:442-445`](../src-tauri/src/passkey/cxf.rs#L442-L445) |
| `key` must parse as a **P-256 PKCS#8** key (**ES256 only**) | `private key is not a valid P-256 PKCS#8 key` | [`cxf.rs:447-451`](../src-tauri/src/passkey/cxf.rs#L447-L451) |
| `rpId` non-empty, no `://`, `/`, `:`, whitespace | `rpId is not a valid relying party identifier` | [`is_valid_rp_id`, `cxf.rs:493-499`](../src-tauri/src/passkey/cxf.rs#L493-L499) |
| `username` / `userDisplayName` ≤ 256 chars | `username exceeds 256 characters` / `userDisplayName exceeds 256 characters` | [`cxf.rs:457-463`](../src-tauri/src/passkey/cxf.rs#L457-L463) |
| required member missing / wrong JSON type | `missing or malformed field: <name>` | [`malformed_field_reason`, `cxf.rs:415-427`](../src-tauri/src/passkey/cxf.rs#L415-L427) |
| credential is not a JSON object, or has no `type` | `missing or malformed field: type` | [`cxf.rs:375-389`](../src-tauri/src/passkey/cxf.rs#L375-L389) |

**ES256 only.** The `key` member must parse as a P-256 PKCS#8 key. P-384,
Ed25519, RSA and garbage are rejected with the same fixed reason — the
signature algorithm Monark implements is ES256 and nothing else
([`signing_key_from_pkcs8_der`, `es256.rs:62-65`](../src-tauri/src/passkey/es256.rs#L62-L65)).
A passkey from another manager that uses a different algorithm is therefore
**skipped, not converted**.

**No secrets in reasons.** Every reason is a fixed template naming the field or
the rule; no input value is ever interpolated into a message, so a private key
can never reach a log or a UI error string
([`cxf.rs:26-29`](../src-tauri/src/passkey/cxf.rs#L26-L29),
[`malformed_field_reason`, `cxf.rs:408-414`](../src-tauri/src/passkey/cxf.rs#L408-L414)).

**`rpId` is canonicalized, not bound.** Import ASCII-lowercases `rpId` when it
stores the entry ([`cxf.rs:466-471`](../src-tauri/src/passkey/cxf.rs#L466-L471)),
so `Example.COM` becomes `example.com` and a later assertion for `example.com`
matches. The check is **syntactic only**: a file has no `origin` to bind against,
so the `rpId`↔`origin` domain-suffix binding of §3.3 does not (and cannot) apply
at import time. It applies later, when the credential is actually used.

### 11.4 `fido2Extensions` and the double meaning of `skipped`

`fido2Extensions` are **ignored on import** (Monark supports no extension) and
**never exported** ([`credential_value`, `cxf.rs:510-528`](../src-tauri/src/passkey/cxf.rs#L510-L528)
passes `fido2_extensions: None`). Dropping them is not silent: the credential is
imported **and** a report row is added with the reason
`EXTENSIONS_IGNORED_NOTE` = `"extension data ignored (fido2Extensions)"`
([`cxf.rs:57`](../src-tauri/src/passkey/cxf.rs#L57),
[`passkey_import.rs:138-146`](../src-tauri/src/commands/passkey_import.rs#L138-L146)).

That makes `skipped` carry **two different kinds of row**:

1. **Rejected** — the credential was *not* imported (unsupported type, invalid
   field). The reason is the rejection reason.
2. **Imported but lossy** — the credential *was* imported, but something the
   vault cannot represent was dropped. Today the only case is
   `fido2Extensions`, identified by `reason === EXTENSIONS_IGNORED_NOTE`.

The `reason` string is the **only discriminator** — the report has no separate
note channel ([`CxfSkipped`, `src/interfaces/passkey.interface.ts:160-192`](../src/interfaces/passkey.interface.ts#L160-L192)).
Consequently **`imported + duplicates + skipped` is NOT a strict partition** of
the document's credentials: a credential that is imported *and* carries
`fido2Extensions` counts once in `imported` and once in `skipped`
([`CxfImportReport`, `passkey.interface.ts:193-218`](../src/interfaces/passkey.interface.ts#L193-L218)).
The UI honours this: it splits the rows on the reason constant and renders a
lossy row as a warning, never as "N failed"
([`PasskeyImportModal.tsx:19-29`](../src/components/Vault/Modals/PasskeyImportModal.tsx#L19-L29),
[`PasskeyImportModal.tsx:195-200`](../src/components/Vault/Modals/PasskeyImportModal.tsx#L195-L200)).
The TS constant is pinned byte-for-byte against the Rust one by a test
([`PasskeyImportModal.test.tsx:283`](../src/test/components/Vault/PasskeyImportModal.test.tsx#L283)).

### 11.5 Deduplication

The dedup key is **`(rpId, credentialId)`** (ruling Q8): the same credential id
under a *different* `rpId` is a different credential and is imported
([`PasskeyIndex`, `passkey_import.rs:168-191`](../src-tauri/src/commands/passkey_import.rs#L168-L191)).
The index is built from the whole existing tree — passkeys nested inside groups
are found too ([`collect_pairs`, `passkey_import.rs:192-207`](../src-tauri/src/commands/passkey_import.rs#L192-L207)) —
and is updated as the document is merged, so a credential repeated *inside one
file* is stored once: the first occurrence wins, the rest are duplicates.

Duplicates are counted in `report.duplicates`, **not** listed in `skipped`
([`passkey_import.rs:132-135`](../src-tauri/src/commands/passkey_import.rs#L132-L135)).
A re-import of the same file therefore returns `{imported: 0, duplicates: N,
skipped: []}` and leaves the vault file **byte-identical**
(`reimport_counts_duplicates_and_leaves_file_bytes_identical`,
[`passkey_import_tests.rs:264-299`](../src-tauri/src/commands/passkey_import_tests.rs#L264-L299)).

### 11.6 Import: parse before unlock, save once

The order is deliberate and is what makes a malformed file cheap
([`import_cxf_with`, `passkey_import.rs:100-165`](../src-tauri/src/commands/passkey_import.rs#L100-L165)):

1. **Parse and validate the envelope first** — no IO, no Argon2 derivation, no
   rate-limit slot ([`passkey_import.rs:106-107`](../src-tauri/src/commands/passkey_import.rs#L106-L107)).
   A malformed document therefore costs nothing and cannot leave the vault
   half-imported; it also wins over a wrong password (the envelope error is
   reported instead of a password error).
2. **Unlock** through the store seam (rate-limited, cloud-aware)
   ([`passkey_import.rs:110`](../src-tauri/src/commands/passkey_import.rs#L110)).
3. **Merge** every credential; skips and duplicates are recorded, not written.
4. **Save exactly once, and only if `imported > 0`**
   ([`passkey_import.rs:159-163`](../src-tauri/src/commands/passkey_import.rs#L159-L163)).
   An all-duplicate, all-skipped or empty import leaves the file untouched: no
   re-encryption, no `updated_at` stamp, no version bump.

Imported passkeys are placed at the **vault root** (ruling Q12). The mapping
from a CXF credential to `Entry::Passkey` follows §4.2 of the plan:
`rp_name = rp_id` (CXF carries no RP display name), `algorithm = -7`,
`sign_count = 0`, `discoverable = true`, `transports = ["internal"]`,
`aaguid = Uuid::nil()`, `id = Uuid::new_v4()`
([`entry_from_passkey`, `passkey_import.rs:223-275`](../src-tauri/src/commands/passkey_import.rs#L223-L275)).

### 11.7 Export: consent, plaintext, and fail-closed

**Consent is a hard gate, checked before any IO.** `export_cxf` requires
`consent: true`; anything else is a `Validation` error raised before path
validation, file read, rate-limit slot or Argon2 derivation
([`passkey_export.rs:118-124`](../src-tauri/src/commands/passkey_export.rs#L118-L124)).
A caller that forgot the flag cannot make the command touch the disk, and a
wrong password cannot mask the consent error (`export_cxf_consent_is_checked_before_any_io`,
[`passkey_export_tests.rs:315-350`](../src-tauri/src/commands/passkey_export_tests.rs#L315-L350)).

**The returned document is not encrypted.** It is a plain JSON string carrying
every passkey's PKCS#8 private key in base64url
([`build_export`, `cxf.rs:537-590`](../src-tauri/src/passkey/cxf.rs#L537-L590)).
The vault stays encrypted at rest; the *exported file* does not. This is the
single place where key material leaves the vault blob, and it does so only
because the user consented.

**The UI collects informed consent.** The export modal shows the plaintext
warning unconditionally, keeps the Export button disabled until the
acknowledgement checkbox is ticked, and only then calls
`exportCxf(..., true)` ([`PasskeyExportModal.tsx:171`](../src/components/Vault/Modals/PasskeyExportModal.tsx#L171),
[`PasskeyExportModal.tsx:209`](../src/components/Vault/Modals/PasskeyExportModal.tsx#L209),
[`PasskeyExportModal.tsx:124-128`](../src/components/Vault/Modals/PasskeyExportModal.tsx#L124-L128)).
The warning copy is *"This file contains your passkeys' private keys
UNENCRYPTED. Anyone with the file can sign in as you. Store it securely and
delete it after use."*
([`i18n/locales/en.json:665`](../src/i18n/locales/en.json#L665)). The save dialog
runs **before** the export call, so a cancelled dialog never even produces the
plaintext document ([`PasskeyExportModal.tsx:114-121`](../src/components/Vault/Modals/PasskeyExportModal.tsx#L114-L121)).
The acknowledgement covers one export only: a second export requires a fresh
consent ([`PasskeyExportModal.tsx:130-133`](../src/components/Vault/Modals/PasskeyExportModal.tsx#L130-L133)).

**Export is read-only.** The module has no `save_vault` call; the vault file is
byte-identical afterwards (`export_cxf_is_read_only`,
[`passkey_export_tests.rs:860-898`](../src-tauri/src/commands/passkey_export_tests.rs#L860-L898)).

**Fail closed on a partial export.** The draft says passkeys with a non-zero
signature counter must be excluded from an export. Monark always stores `0`
([`SIGN_COUNT`, `webauthn.rs:55`](../src-tauri/src/passkey/webauthn.rs#L55)) and
nothing ever increments it, so the filter is unreachable for vaults this build
writes — but Monark also *reads* files written by other builds, so the filter is
implemented anyway ([`cxf.rs:544-548`](../src-tauri/src/passkey/cxf.rs#L544-L548))
and the command refuses the whole export when anything was excluded, rather than
hand back a valid-looking file that silently lost a credential
([`passkey_export.rs:136-141`](../src-tauri/src/commands/passkey_export.rs#L136-L141),
`export_cxf_refuses_partial_export_when_a_counter_is_nonzero`,
[`passkey_export_tests.rs:557-596`](../src-tauri/src/commands/passkey_export_tests.rs#L557-L596)).

**Shape.** One account, one item per passkey, `version = {1, 0}`,
`exporterRpId = "monark.app"`, `exporterDisplayName = "Monark"`, `timestamp =
now`, random 16-byte base64url account/item ids
([`build_export`, `cxf.rs:537-590`](../src-tauri/src/passkey/cxf.rs#L537-L590),
[`random_export_id`, `cxf.rs:592-597`](../src-tauri/src/passkey/cxf.rs#L592-L597)).
A vault with no passkeys still returns a valid empty envelope (`accounts:[{items:[]}]`)
(`export_cxf_empty_vault`, [`passkey_export_tests.rs:681-698`](../src-tauri/src/commands/passkey_export_tests.rs#L681-L698)).

### 11.8 Threat model: the export file is unencrypted

The vault is encrypted at rest (§10.1). **An exported `.cxf.json` is not.**
Treat it as **equivalent to the vault password for the passkeys it contains**:

* Anyone who obtains the file can read every private key in it and sign in as
  the user on every relying party those passkeys cover. No password, no
  biometric prompt, no Monark install is needed.
* The keys are **not rotatable** without the relying party (§10.3), so a leaked
  export means re-registering each affected passkey at its RP.
* Monark does not encrypt the file, does not upload it anywhere, and does not
  delete it: the user picks the destination and is reminded to delete it after
  use ([`PasskeyExportModal.tsx:171-176`](../src/components/Vault/Modals/PasskeyExportModal.tsx#L171-L176),
  `passkey.export.deleteReminder` in [`i18n/locales/en.json:671`](../src/i18n/locales/en.json#L671)).
* The command never logs the document and never puts it in an error message
  ([`passkey_export.rs:31-37`](../src-tauri/src/commands/passkey_export.rs#L31-L37)).

On the import side the risk is different: an imported credential is only as
trustworthy as the file it came from. Monark validates the *shape* of the key
(P-256 PKCS#8) but cannot tell whether the file's owner was its legitimate
owner — importing a file someone else gave you gives them a passkey that signs
as you at that RP.

### 11.9 Fixtures

The CXF fixtures live in [`fixtures/cxf/`](../fixtures/cxf/) and are consumed at
**compile time** by `include_str!` in the Rust tests
([`cxf.rs:627-641`](../src-tauri/src/passkey/cxf.rs#L627-L641),
[`passkey_import_tests.rs:36-47`](../src-tauri/src/commands/passkey_import_tests.rs#L36-L47)),
so a renamed or missing fixture is a build error rather than a silent skip. The
`oversized` case (the 10 MiB cap) is generated in-test and is **not** committed
([`parse_rejects_oversized_document`, `cxf.rs:842-858`](../src-tauri/src/passkey/cxf.rs#L842-L858)).
Provenance, the per-file expected outcome and the regeneration rules are in
[`fixtures/cxf/README.md`](../fixtures/cxf/README.md).

### 11.10 Not promised here

* **CXP** (the Credential Provider extension protocol) and **HPKE** transport:
  **out of scope**. Monark's export is a plain file the user writes themselves;
  there is no encrypted exchange channel, no key agreement, no provider
  protocol. Nothing in this codebase implements or plans them for F1.
* **OS/browser hand-off** of an imported passkey: none. An imported passkey is
  used inside Monark like any other (§3), not by a browser or the OS.
* **Compatibility with every CXF producer**: the support is the draft subset
  above. Non-passkey credentials, non-ES256 keys and extension data are
  reported, not converted.
* **Merging into existing entries**: an imported passkey always becomes a new
  root-level `Entry::Passkey`; it is never attached to an existing login entry.

---

## 12. What F0 does not do

Stated plainly, because each of these is easy to assume from the feature name:

| Not implemented | Detail |
|---|---|
| **System/browser autofill integration** | No credential provider, no browser extension, no native messaging host. Passkeys are used by Monark itself, not by browsers or the OS. |
| **iOS** | `src-tauri/gen/` contains only `android` and `schemas`; there is no `gen/apple`. |
| **Per-entry encryption** | `EntryEncryption` is declared and unused ([`models.rs:212-220`](../src-tauri/src/models.rs#L212-L220)). |
| **Vault HMAC** | `Vault.hmac` is always empty; integrity is the AEAD tag. |
| **Public-suffix-list validation of `rpId`** | §3.3 — the `rpId`↔`origin` domain-suffix binding **is** implemented, but without a PSL: `rpId = "com"` is accepted for `https://evil.com`. |
| **Cryptographic UV binding** | §4.3 — the biometric prompt is not provable by the backend. |
| **Registrable-suffix `rpId` matching** | §3.2 — exact match only. |
| **Sign counter** | Always `0`, never incremented (§5). |
| **Attestation** | `"none"` with a zero AAGUID (§3.1). |
| **Tombstones / reliable delete propagation** | §6 — deletion can be resurrected by a stale sync. |
| **Optimistic concurrency on passkey writes** | §9.1. |
| **Offline passkey operations on cloud vaults** | §7. |
| **CXP / HPKE exchange** | §11.10 — CXF is exchanged as a plain file the user writes; there is no encrypted transport and no provider protocol. |
| **CXF compatibility beyond the draft subset** | §11.1 — only `type: "passkey"` credentials with P-256 PKCS#8 keys are imported; everything else is reported, not converted. |

---

## 13. Reference: where the code lives

| Concern | File |
|---|---|
| Disk + IPC types, `SecretPkcs8` | [`src-tauri/src/models.rs`](../src-tauri/src/models.rs) |
| WebAuthn structures, `rpId`/`origin` validation + binding | [`src-tauri/src/passkey/webauthn.rs`](../src-tauri/src/passkey/webauthn.rs) |
| ES256 sign/verify, PKCS#8 handling | [`src-tauri/src/passkey/es256.rs`](../src-tauri/src/passkey/es256.rs) |
| COSE key + `attestationObject` | [`src-tauri/src/passkey/cose.rs`](../src-tauri/src/passkey/cose.rs) |
| Ceremony request/response types | [`src-tauri/src/passkey/types.rs`](../src-tauri/src/passkey/types.rs) |
| Vault load/save seam (`VaultRef`) | [`src-tauri/src/passkey/store.rs`](../src-tauri/src/passkey/store.rs) |
| CXF types + validation + export | [`src-tauri/src/passkey/cxf.rs`](../src-tauri/src/passkey/cxf.rs) |
| Ceremony commands | [`src-tauri/src/commands/passkey.rs`](../src-tauri/src/commands/passkey.rs) |
| CXF export command (T17) | [`src-tauri/src/commands/passkey_export.rs`](../src-tauri/src/commands/passkey_export.rs) |
| CXF import command (T16) | [`src-tauri/src/commands/passkey_import.rs`](../src-tauri/src/commands/passkey_import.rs) |
| CXF import/export UI (T18) | [`src/components/Vault/Modals/PasskeyImportModal.tsx`](../src/components/Vault/Modals/PasskeyImportModal.tsx), [`PasskeyExportModal.tsx`](../src/components/Vault/Modals/PasskeyExportModal.tsx) |
| CXF fixtures | [`fixtures/cxf/`](../fixtures/cxf/) |
| Write-merge (restore + preserve) | [`src-tauri/src/vault/merge.rs`](../src-tauri/src/vault/merge.rs) |
| Version policy | [`src-tauri/src/vault/version.rs`](../src-tauri/src/vault/version.rs) |
| IPC wrappers | [`src/services/passkey.ts`](../src/services/passkey.ts) |
| UV gate + ceremony orchestration | [`src/services/passkeyCeremony.ts`](../src/services/passkeyCeremony.ts) |
| Sync merge | [`src/services/vaultMerge.ts`](../src/services/vaultMerge.ts) |
| TS contract mirror | [`src/interfaces/passkey.interface.ts`](../src/interfaces/passkey.interface.ts) |