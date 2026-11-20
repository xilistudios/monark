# Passkeys (F0)

Monark is a **software WebAuthn authenticator**: the passkey private keys live
inside the encrypted vault blob and the ceremony (registration and assertion) is
computed in Rust. This document describes what F0 actually ships, with a
`file:line` anchor for every claim. Where a guarantee is weaker than the WebAuthn
specification would allow, it says so explicitly under **Limitation**.

> **Scope of this document.** F0 = store, create, assert, list, delete, sync,
> plus the `rpId`↔`origin` domain-suffix binding. F1 = CXF exchange: **export
> ships** (`export_cxf`), **import does not yet** (§11 — preview only).
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

Registered in [`src-tauri/src/lib.rs:287-290`](../src-tauri/src/lib.rs#L287-L290)
(`export_cxf` is the fifth, F1 command, at
[`lib.rs:291`](../src-tauri/src/lib.rs#L291) — see §11).
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

## 11. CXF import/export (F1 preview)

CXF is the FIDO **Credential Exchange Format**. Monark's F1 goal is to let a user
carry passkeys in and out of the vault as a CXF document. **What is shipped
today is the export half plus the shared parsing/validation layer; the import
command is not merged yet.** This section describes exactly that, and nothing
more — a fuller CXF treatment is planned for a later task.

| Piece | State | Anchor |
|---|---|---|
| CXF serde types + strict per-credential validator | **shipped** | [`src-tauri/src/passkey/cxf.rs`](../src-tauri/src/passkey/cxf.rs) |
| `export_cxf` command + `PasskeyCommands.exportCxf` wrapper | **shipped** (T17) | [`commands/passkey_export.rs`](../src-tauri/src/commands/passkey_export.rs), [`src/services/passkey.ts:176-182`](../src/services/passkey.ts#L176-L182) |
| `import_cxf` command | **not merged** — do not rely on it | — |

Registered commands are the four F0 ceremonies plus `export_cxf`
([`lib.rs:287-291`](../src-tauri/src/lib.rs#L287-L291) — the four F0 commands
at 287-290 plus `export_cxf` at 291); there is no
`import_cxf` in the invoke handler.

**Export, as implemented**

* **Consent is mandatory and checked first.** `consent != true` is a
  `Validation` error raised before any path validation, file read, rate-limit
  slot or Argon2 derivation
  ([`passkey_export.rs:118-124`](../src-tauri/src/commands/passkey_export.rs#L118-L124)).
* **Read-only.** There is no `store::save_vault` call in the module; the vault
  file is byte-identical afterwards
  ([`passkey_export.rs:20-25`](../src-tauri/src/commands/passkey_export.rs#L20-L25),
  test `export_cxf_is_read_only`,
  [`passkey_export_tests.rs:860-886`](../src-tauri/src/commands/passkey_export_tests.rs#L860-L886)).
* **Fail closed on a partial export.** A passkey with a non-zero signature
  counter is excluded by `build_export` and reported through `notes`; the
  command refuses the whole export rather than return a document that silently
  lost a credential ([`passkey_export.rs:136-141`](../src-tauri/src/commands/passkey_export.rs#L136-L141)).
* **Shape:** one account, one item per passkey, `version = {1, 0}`,
  `exporterRpId = "monark.app"`, `exporterDisplayName = "Monark"`
  ([`EXPORTER_RP_ID`, `cxf.rs:47-53`](../src-tauri/src/passkey/cxf.rs#L47-L53);
  [`build_export`, `cxf.rs:537-596`](../src-tauri/src/passkey/cxf.rs#L537-L596)).
  `key` is the stored base64url PKCS#8 string, byte-identical to the vault.

**The shared layer (used by export today, by import when it lands)**

* **Format:** CXF 1.0 review draft 2025-03-13, the `passkey` credential type only
  ([`cxf.rs:1-8`](../src-tauri/src/passkey/cxf.rs#L1-L8)).
* **Lenient envelope, strict credentials:** unknown members are ignored (spec
  MUST); each credential is validated field by field so one bad credential is
  skipped with a precise reason instead of failing the file
  ([`cxf.rs:13-29`](../src-tauri/src/passkey/cxf.rs#L13-L29)).
* **Size cap:** 10 MiB, checked before parsing
  ([`MAX_ENVELOPE_BYTES`, `cxf.rs:44`](../src-tauri/src/passkey/cxf.rs#L44);
  [`parse_envelope`, `cxf.rs:338-352`](../src-tauri/src/passkey/cxf.rs#L338-L352)).
* **Version gate:** `version.major` must be `1`; any minor is accepted
  ([`cxf.rs:338-352`](../src-tauri/src/passkey/cxf.rs#L338-L352)).
* **ES256 only:** the `key` member must parse as a P-256 PKCS#8 key; P-384,
  Ed25519, RSA and garbage are rejected
  ([`cxf.rs:447-451`](../src-tauri/src/passkey/cxf.rs#L447-L451)).
* **Non-passkey credentials are skipped with their exact `type`** in the report
  — never silently
  ([`validate_credential`, `cxf.rs:375-402`](../src-tauri/src/passkey/cxf.rs#L375-L402)).
* **`fido2Extensions`** are ignored on import (reported via
  `EXTENSIONS_IGNORED_NOTE`, [`cxf.rs:57`](../src-tauri/src/passkey/cxf.rs#L57))
  and never exported (`skip_serializing_if`,
  [`cxf.rs:141-155`](../src-tauri/src/passkey/cxf.rs#L141-L155)).
* **Dedup key** is `(rp_id, credential_id)` (ruling Q8); the same credential id
  under a different `rp_id` is a distinct credential.
* **`rpId` is canonicalized on import** (ASCII-lowercase) but only checked
  lexically — a file has no origin to bind to
  ([`cxf.rs:453-455`](../src-tauri/src/passkey/cxf.rs#L453-L455),
  [`cxf.rs:486-499`](../src-tauri/src/passkey/cxf.rs#L486-L499)).
* **No secrets in error messages:** every rejection reason is a fixed template
  naming the field or the rule, never an input value
  ([`cxf.rs:27-29`](../src-tauri/src/passkey/cxf.rs#L27-L29)).

**Not promised here:** CXP (Credential Provider extension protocol), HPKE, and
any OS/browser hand-off. They are outside F0/F1 scope.

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
| **CXF import** | §11 — the `import_cxf` command is not merged; only export ships. |

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
| Write-merge (restore + preserve) | [`src-tauri/src/vault/merge.rs`](../src-tauri/src/vault/merge.rs) |
| Version policy | [`src-tauri/src/vault/version.rs`](../src-tauri/src/vault/version.rs) |
| IPC wrappers | [`src/services/passkey.ts`](../src/services/passkey.ts) |
| UV gate + ceremony orchestration | [`src/services/passkeyCeremony.ts`](../src/services/passkeyCeremony.ts) |
| Sync merge | [`src/services/vaultMerge.ts`](../src/services/vaultMerge.ts) |
| TS contract mirror | [`src/interfaces/passkey.interface.ts`](../src/interfaces/passkey.interface.ts) |