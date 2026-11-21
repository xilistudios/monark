/**
 * Zod schemas for the passkey IPC trust boundary (T11).
 *
 * Every passkey command takes a WebAuthn options object built by the UI and
 * hands it to Rust, which validates it again before touching the vault. These
 * schemas are the **frontend** half of that contract: they reject a malformed
 * request before it reaches the IPC boundary, so the user gets a precise field
 * error instead of a generic `Validation Error: …` from the backend.
 *
 * ## Rules mirrored from Rust (single source of truth)
 *
 * The limits below are copies of the backend constants, not independent
 * choices — a schema that is *stricter* than Rust would reject requests the
 * backend accepts, and one that is *looser* would let the backend reject
 * requests the UI already called valid. Sources:
 *
 * | rule | Rust |
 * | --- | --- |
 * | challenge decodes to 16..=1024 bytes | `webauthn.rs` `MIN/MAX_CHALLENGE_LEN` |
 * | origin is `http(s)://host[:port]`, no userinfo/query/fragment/path | `webauthn.rs` `canonical_origin` |
 * | `rp.id` bare host, ≤253 chars, no `://`, `/`, `:`, whitespace | `webauthn.rs` `validate_rp_id` |
 * | `rp.name` ≤256 chars | `commands/passkey.rs` `MAX_RP_NAME_CHARS` |
 * | `user.id` decodes to 1..=64 bytes | `commands/passkey.rs` `MIN/MAX_USER_HANDLE_LEN` |
 * | `user.name` non-empty ≤256, `user.displayName` ≤256 | `commands/passkey.rs` `MAX_USER_NAME_CHARS` |
 * | `pubKeyCredParams` contains `{type:"public-key", alg:-7}` | `commands/passkey.rs` `validate_create_request` |
 * | `authenticatorSelection.residentKey` is `"required"` | idem (discoverable only) |
 * | `attestation` absent or `"none"` | idem (ruling Q3) |
 *
 * ## Strictness
 *
 * Every object is a `z.strictObject`: an unknown member is a **rejection**, not
 * a silently dropped field. That is what makes the schema a real gate — a
 * typo such as `display_name` (snake_case, the Rust *struct* field) or
 * `resident_key` would otherwise vanish and the backend would see a request
 * that is missing a mandatory member.
 *
 * ## Member naming
 *
 * Request objects are WebAuthn JSON (`camelCase`, `type` instead of `type_`),
 * exactly like `src/interfaces/passkey.interface.ts`. The **view** schemas
 * (`passkeySummarySchema`, `passkeyEntrySchema`) mirror the serde output of
 * `PasskeySummary` / `PasskeyView`, which is also camelCase.
 *
 * @module passkeySchemas
 */

import { z } from "zod";

/** `type` member of every credential descriptor and response. */
const PUBLIC_KEY_TYPE = "public-key" as const;

/** ES256 (ECDSA P-256 / SHA-256) — the only algorithm Monark implements. */
export const ES256_ALG = -7 as const;

/** Decoded challenge length bounds (`MIN/MAX_CHALLENGE_LEN` in Rust). */
export const MIN_CHALLENGE_BYTES = 16;
export const MAX_CHALLENGE_BYTES = 1024;

/** Decoded user-handle length bounds (`MIN/MAX_USER_HANDLE_LEN` in Rust). */
export const MIN_USER_HANDLE_BYTES = 1;
export const MAX_USER_HANDLE_BYTES = 64;

/** Longest accepted `rp.name` / `user.name` / `user.displayName` (chars). */
export const MAX_NAME_CHARS = 256;

/** Longest accepted `rp.id` (bytes; `validate_rp_id`). */
export const MAX_RP_ID_CHARS = 253;

/** Longest accepted passkey entry name (UI limit, shared with data entries). */
export const MAX_ENTRY_NAME_CHARS = 100;

/** Longest accepted single tag (mirrors `addEntryFormSchema`). */
export const MAX_TAG_CHARS = 30;

// ---------------------------------------------------------------------------
// base64url helpers
// ---------------------------------------------------------------------------

/**
 * Characters of the unpadded URL-safe base64 alphabet.
 *
 * Rust decodes with `URL_SAFE_NO_PAD`, which rejects `+`, `/` and any `=`
 * padding — so `"AQID=="` is valid standard base64 but an invalid challenge.
 */
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/;

/**
 * Decodes unpadded base64url to bytes, or `undefined` when the input is not
 * valid base64url.
 *
 * `atob` is used because it exists in both the browser and jsdom, but it only
 * understands the *standard* alphabet and requires padding, so the input is
 * translated first (`-`→`+`, `_`→`/`) and padded to a multiple of 4. Length
 * `% 4 === 1` is structurally impossible in base64 and is rejected explicitly
 * (Rust's decoder rejects it too).
 */
export function decodeBase64Url(input: string): Uint8Array | undefined {
	if (!BASE64URL_PATTERN.test(input) || input.length % 4 === 1) {
		return undefined;
	}
	const standard = input.replace(/-/g, "+").replace(/_/g, "/");
	const padded = standard.padEnd(
		standard.length + ((4 - (standard.length % 4)) % 4),
		"=",
	);
	try {
		const binary = atob(padded);
		const bytes = new Uint8Array(binary.length);
		for (let i = 0; i < binary.length; i += 1) {
			bytes[i] = binary.charCodeAt(i);
		}
		return bytes;
	} catch {
		return undefined;
	}
}

/** Number of characters (code points) in `value`; Rust counts `chars()`. */
const charCount = (value: string): number => [...value].length;

// ---------------------------------------------------------------------------
// Field schemas
// ---------------------------------------------------------------------------

/** Unpadded base64url string, non-empty. */
export const base64UrlSchema = z
	.string()
	.min(1, "Must be a non-empty base64url string")
	.regex(BASE64URL_PATTERN, "Must be unpadded base64url (A-Z a-z 0-9 - _)");

/** A WebAuthn challenge: unpadded base64url decoding to 16..=1024 bytes. */
export const challengeSchema = base64UrlSchema.superRefine((value, ctx) => {
	const decoded = decodeBase64Url(value);
	if (decoded === undefined) {
		ctx.addIssue({
			code: "custom",
			message: "Challenge is not valid base64url",
		});
		return;
	}
	if (
		decoded.length < MIN_CHALLENGE_BYTES ||
		decoded.length > MAX_CHALLENGE_BYTES
	) {
		ctx.addIssue({
			code: "custom",
			message: `Challenge must decode to ${MIN_CHALLENGE_BYTES}-${MAX_CHALLENGE_BYTES} bytes`,
		});
	}
});

/**
 * A WebAuthn origin: absolute `http(s)` URL with a host and **no** userinfo,
 * query, fragment or path (only `/` is tolerated).
 *
 * Mirrors `canonical_origin` in `passkey/webauthn.rs` check for check. The
 * canonical serialization the backend compares against is not computed here —
 * the schema only decides whether the value is *acceptable*.
 */
export const originSchema = z.string().superRefine((value, ctx) => {
	if (value.length === 0) {
		ctx.addIssue({ code: "custom", message: "Origin is empty" });
		return;
	}
	let parsed: URL;
	try {
		parsed = new URL(value);
	} catch {
		ctx.addIssue({ code: "custom", message: "Origin is not a valid URL" });
		return;
	}
	if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
		ctx.addIssue({
			code: "custom",
			message: "Origin must use http or https",
		});
		return;
	}
	if (parsed.hostname === "") {
		ctx.addIssue({ code: "custom", message: "Origin has no host" });
		return;
	}
	if (parsed.username !== "" || parsed.password !== "") {
		ctx.addIssue({
			code: "custom",
			message: "Origin must not carry user information",
		});
		return;
	}
	if (parsed.search !== "" || parsed.hash !== "") {
		ctx.addIssue({
			code: "custom",
			message: "Origin must not carry a query or fragment",
		});
		return;
	}
	if (parsed.pathname !== "" && parsed.pathname !== "/") {
		ctx.addIssue({
			code: "custom",
			message: "Origin must not carry a path",
		});
	}
});

/**
 * A relying party id: a bare host name (no scheme, path, port or whitespace).
 *
 * Mirrors `validate_rp_id`. The length cap is on **bytes** in Rust
 * (`rp_id.len()`, not `chars().count()`), so it is measured the same way here.
 */
export const rpIdSchema = z.string().superRefine((value, ctx) => {
	if (value.length === 0) {
		ctx.addIssue({ code: "custom", message: "RP ID is empty" });
		return;
	}
	if (new TextEncoder().encode(value).length > MAX_RP_ID_CHARS) {
		ctx.addIssue({ code: "custom", message: "RP ID is too long" });
		return;
	}
	if (value.includes("://") || value.includes("/") || value.includes(":")) {
		ctx.addIssue({
			code: "custom",
			message: "RP ID must be a bare host name",
		});
		return;
	}
	// biome-ignore lint/suspicious/noControlCharactersInRegex: the control-character class is the rule being mirrored from Rust (`c.is_control()`).
	if (/\s/.test(value) || /[\u0000-\u001f\u007f]/.test(value)) {
		ctx.addIssue({
			code: "custom",
			message: "RP ID must not contain whitespace",
		});
	}
});

/** Relying party entity (`PublicKeyCredentialRpEntity`). */
export const rpEntitySchema = z.strictObject({
	id: rpIdSchema,
	name: z
		.string()
		.min(1, "RP name is required")
		.refine((value) => charCount(value) <= MAX_NAME_CHARS, {
			message: `RP name must be at most ${MAX_NAME_CHARS} characters`,
		}),
});

/** User entity (`PublicKeyCredentialUserEntity`); `id` is base64url. */
export const userEntitySchema = z.strictObject({
	id: base64UrlSchema.superRefine((value, ctx) => {
		const decoded = decodeBase64Url(value);
		if (decoded === undefined) {
			ctx.addIssue({
				code: "custom",
				message: "User id is not valid base64url",
			});
			return;
		}
		if (
			decoded.length < MIN_USER_HANDLE_BYTES ||
			decoded.length > MAX_USER_HANDLE_BYTES
		) {
			ctx.addIssue({
				code: "custom",
				message: `User id must decode to ${MIN_USER_HANDLE_BYTES}-${MAX_USER_HANDLE_BYTES} bytes`,
			});
		}
	}),
	name: z
		.string()
		.min(1, "User name is required")
		.refine((value) => charCount(value) <= MAX_NAME_CHARS, {
			message: `User name must be at most ${MAX_NAME_CHARS} characters`,
		}),
	// WebAuthn allows an empty display name; Rust only caps its length.
	displayName: z
		.string()
		.refine((value) => charCount(value) <= MAX_NAME_CHARS, {
			message: `User display name must be at most ${MAX_NAME_CHARS} characters`,
		}),
});

/** Accepted algorithm (`PublicKeyCredentialParameters`). */
export const pubKeyCredParamSchema = z.strictObject({
	type: z.literal(PUBLIC_KEY_TYPE),
	alg: z.number().int(),
});

/** Credential descriptor (`PublicKeyCredentialDescriptor`); `id` is base64url. */
export const credentialDescriptorSchema = z.strictObject({
	type: z.literal(PUBLIC_KEY_TYPE),
	id: base64UrlSchema,
});

/** Authenticator selection criteria; only discoverable credentials are issued. */
export const authenticatorSelectionSchema = z.strictObject({
	residentKey: z.literal("required", {
		message: 'residentKey must be "required" (only discoverable credentials)',
	}),
	userVerification: z.enum(["required", "preferred", "discouraged"]).optional(),
	authenticatorAttachment: z.enum(["platform", "cross-platform"]).optional(),
});

// ---------------------------------------------------------------------------
// Request schemas
// ---------------------------------------------------------------------------

/**
 * `passkey_create` request (`PublicKeyCredentialCreationOptions` subset).
 *
 * The two `.superRefine` cross-field rules are the ones Rust enforces across
 * members: ES256 must be among `pubKeyCredParams`, and `authenticatorSelection`
 * must exist with `residentKey: "required"` (it is optional in the interface
 * because the Rust struct is `Option`, but a request without it is refused —
 * the schema rejects it here so the UI fails fast).
 */
export const passkeyCreateRequestSchema = z
	.strictObject({
		rp: rpEntitySchema,
		user: userEntitySchema,
		challenge: challengeSchema,
		origin: originSchema,
		pubKeyCredParams: z.array(pubKeyCredParamSchema).min(1),
		authenticatorSelection: authenticatorSelectionSchema,
		excludeCredentials: z.array(credentialDescriptorSchema).optional(),
		attestation: z.literal("none").optional(),
	})
	.superRefine(
		(request, ctx) => {
			const hasEs256 = request.pubKeyCredParams.some(
				(param) => param.type === PUBLIC_KEY_TYPE && param.alg === ES256_ALG,
			);
			if (!hasEs256) {
				ctx.addIssue({
					code: "custom",
					path: ["pubKeyCredParams"],
					message: "Only ES256 is supported (alg -7)",
				});
			}
		},
		// The algorithm rule is independent of the per-field rules, so it is
		// reported alongside them instead of being hidden behind the first
		// field error (the default skips refinements after an aborting issue).
		{ when: (payload) => !payload.issues.some((issue) => issue.fatal) },
	);

/**
 * `passkey_assert` request (`PublicKeyCredentialRequestOptions` subset).
 *
 * `userVerification` is accepted and ignored by the backend (ruling Q14): the
 * assertion always sets the UV flag because the vault password/biometry was
 * verified by the ceremony service. `allowCredentials: []` means "no
 * restriction", exactly like an absent member.
 */
export const passkeyAssertRequestSchema = z.strictObject({
	rpId: rpIdSchema,
	challenge: challengeSchema,
	origin: originSchema,
	allowCredentials: z.array(credentialDescriptorSchema).optional(),
	credentialId: base64UrlSchema.optional(),
	userVerification: z.enum(["required", "preferred", "discouraged"]).optional(),
});

// ---------------------------------------------------------------------------
// Response / view schemas
// ---------------------------------------------------------------------------

/** `AuthenticatorAttestationResponse` in JSON form (binary members base64url). */
export const attestationResponseSchema = z.strictObject({
	clientDataJSON: base64UrlSchema,
	attestationObject: base64UrlSchema,
	transports: z.array(z.string()),
});

/** `AuthenticatorAssertionResponse` in JSON form (binary members base64url). */
export const assertionResponseSchema = z.strictObject({
	clientDataJSON: base64UrlSchema,
	authenticatorData: base64UrlSchema,
	signature: base64UrlSchema,
	userHandle: base64UrlSchema.optional(),
});

/** Response of `passkey_create` (`PublicKeyCredential` + attestation). */
export const passkeyCreateResponseSchema = z.strictObject({
	entryId: z.string().min(1),
	id: base64UrlSchema,
	rawId: base64UrlSchema,
	type: z.literal(PUBLIC_KEY_TYPE),
	response: attestationResponseSchema,
	authenticatorAttachment: z.string(),
	clientExtensionResults: z.record(z.string(), z.unknown()),
});

/** Response of `passkey_assert` (`PublicKeyCredential` + assertion). */
export const passkeyAssertResponseSchema = z.strictObject({
	entryId: z.string().min(1),
	id: base64UrlSchema,
	rawId: base64UrlSchema,
	type: z.literal(PUBLIC_KEY_TYPE),
	response: assertionResponseSchema,
	authenticatorAttachment: z.string(),
	clientExtensionResults: z.record(z.string(), z.unknown()),
});

/** Sanitized passkey summary returned by `passkey_list_for_rp`. */
export const passkeySummarySchema = z.strictObject({
	entryId: z.string().min(1),
	credentialId: base64UrlSchema,
	rpId: rpIdSchema,
	userName: z.string(),
	userDisplayName: z.string(),
	createdAt: z.string(),
	transports: z.array(z.string()),
});

/**
 * Read-only passkey entry view (`PasskeyView` as serialized by serde).
 *
 * Snake_case members: `PasskeyView` uses `rename_all = "snake_case"` (it is a
 * vault entry, not a WebAuthn options object), unlike the request schemas
 * above. There is deliberately **no** private-key member — the wire type has
 * none, so a key cannot be represented here either.
 */
export const passkeyEntrySchema = z.strictObject({
	id: z.string().min(1),
	entry_type: z.literal("passkey"),
	name: z.string(),
	created_at: z.string(),
	updated_at: z.string(),
	tags: z.array(z.string()),
	rp_id: rpIdSchema,
	rp_name: z.string(),
	credential_id: base64UrlSchema,
	user_handle: base64UrlSchema,
	user_name: z.string(),
	user_display_name: z.string(),
	algorithm: z.number().int(),
	sign_count: z.number().int().nonnegative(),
	discoverable: z.boolean(),
	transports: z.array(z.string()),
	aaguid: z.string(),
});

/**
 * Mutable subset of a passkey entry (T13 restricted edit form).
 *
 * The credential core (`rp_id`, `credential_id`, `user_handle`, `algorithm`, …)
 * is immutable: the backend write-merge keeps it. Only these four members may
 * be edited, and they are validated here before the update is dispatched.
 */
export const passkeyEditSchema = z.strictObject({
	name: z
		.string()
		.min(1, "Name is required")
		.refine((value) => charCount(value) <= MAX_ENTRY_NAME_CHARS, {
			message: `Name must be at most ${MAX_ENTRY_NAME_CHARS} characters`,
		}),
	tags: z.array(
		z
			.string()
			.min(1, "Tag cannot be empty")
			.refine((value) => charCount(value) <= MAX_TAG_CHARS, {
				message: `Tag must be at most ${MAX_TAG_CHARS} characters`,
			}),
	),
	user_name: z
		.string()
		.min(1, "User name is required")
		.refine((value) => charCount(value) <= MAX_NAME_CHARS, {
			message: `User name must be at most ${MAX_NAME_CHARS} characters`,
		}),
	user_display_name: z
		.string()
		.refine((value) => charCount(value) <= MAX_NAME_CHARS, {
			message: `User display name must be at most ${MAX_NAME_CHARS} characters`,
		}),
});

/**
 * One per-credential outcome of a CXF import that did not carry over in full
 * (T18 renders these).
 *
 * Mirrors `passkey::cxf::CxfSkipped` (`#[serde(rename_all = "camelCase")]`):
 * `itemTitle`, `credentialType`, `reason`. `reason` is a user-facing string the
 * backend composes; it never contains key material.
 */
export const cxfSkippedSchema = z.strictObject({
	itemTitle: z.string(),
	credentialType: z.string(),
	reason: z.string(),
});

/**
 * Report returned by `import_cxf` (T16), validated before the UI renders it.
 *
 * Mirrors `passkey::cxf::CxfImportReport` (`camelCase`): `imported`,
 * `duplicates`, `skipped[]`.
 *
 * ⚠️ `skipped` is **not** a failure list. It carries both *rejected*
 * credentials (not imported) and *imported but lossy* ones — the latter are
 * reported with `reason === EXTENSIONS_IGNORED_NOTE` (see
 * `interfaces/passkey.interface.ts` `CxfSkipped`). `imported + duplicates +
 * skipped.length` is therefore not the number of credentials in the document.
 *
 * `strictObject`: an unknown member is a rejection. The report is a backend
 * response, so an unexpected shape means the wire contract drifted and the UI
 * must not render numbers it cannot interpret.
 */
export const cxfImportReportSchema = z.strictObject({
	imported: z.number().int().nonnegative(),
	duplicates: z.number().int().nonnegative(),
	skipped: z.array(cxfSkippedSchema),
});

// ---------------------------------------------------------------------------
// Inferred types
// ---------------------------------------------------------------------------

export type PasskeyCreateRequestInput = z.infer<
	typeof passkeyCreateRequestSchema
>;
export type PasskeyAssertRequestInput = z.infer<
	typeof passkeyAssertRequestSchema
>;
export type PasskeySummaryInput = z.infer<typeof passkeySummarySchema>;
export type PasskeyEntryInput = z.infer<typeof passkeyEntrySchema>;
export type PasskeyEditInput = z.infer<typeof passkeyEditSchema>;
export type CxfSkippedInput = z.infer<typeof cxfSkippedSchema>;
export type CxfImportReportInput = z.infer<typeof cxfImportReportSchema>;
