/**
 * Tests for the passkey Zod schemas (T11) — the frontend half of the IPC trust
 * boundary.
 *
 * The point of these tests is **strictness**: a schema that accepts everything
 * is worse than no schema, because it advertises a guarantee it does not
 * provide. Every rejection case below is a request the Rust backend would
 * refuse (`commands/passkey.rs` / `passkey/webauthn.rs`), so the schema must
 * refuse it too — and the negative controls at the end prove the tests can
 * actually fail.
 *
 * Encoding note: `atob` (used by the schema decoder) is available in jsdom, and
 * `TextEncoder`/`Uint8Array` are global in the vitest environment.
 */

import { describe, expect, it } from "vitest";
import type {
	PasskeyAssertRequest,
	PasskeyCreateRequest,
} from "../../interfaces/passkey.interface";
import {
	decodeBase64Url,
	ES256_ALG,
	MAX_CHALLENGE_BYTES,
	MAX_NAME_CHARS,
	MAX_RP_ID_CHARS,
	MAX_USER_HANDLE_BYTES,
	MIN_CHALLENGE_BYTES,
	passkeyAssertRequestSchema,
	passkeyCreateRequestSchema,
	passkeyEditSchema,
	passkeyEntrySchema,
	passkeySummarySchema,
} from "../../utils/validation/passkeySchemas";

// ─── Helpers ───

/**
 * Encodes bytes as **unpadded** base64url, the only form Rust's
 * `URL_SAFE_NO_PAD` decoder accepts.
 */
function b64url(bytes: Uint8Array): string {
	let binary = "";
	for (const byte of bytes) {
		binary += String.fromCharCode(byte);
	}
	return btoa(binary)
		.replace(/\+/g, "-")
		.replace(/\//g, "_")
		.replace(/=+$/, "");
}

/** `count` bytes of `fill`, base64url-encoded. */
function b64urlOfLength(count: number, fill = 0x11): string {
	return b64url(new Uint8Array(count).fill(fill));
}

/** The canonical, valid registration request (accepted by Rust). */
function validCreateRequest(): PasskeyCreateRequest {
	return {
		rp: { id: "example.com", name: "Example" },
		user: { id: "AQIDBA", name: "alice", displayName: "Alice" },
		challenge: b64urlOfLength(32),
		origin: "https://example.com",
		pubKeyCredParams: [{ type: "public-key", alg: -7 }],
		authenticatorSelection: {
			residentKey: "required",
			userVerification: "required",
			authenticatorAttachment: "platform",
		},
		excludeCredentials: [{ type: "public-key", id: "AQID" }],
		attestation: "none",
	};
}

/** The canonical, valid authentication request (accepted by Rust). */
function validAssertRequest(): PasskeyAssertRequest {
	return {
		rpId: "example.com",
		challenge: b64urlOfLength(32),
		origin: "https://example.com",
		allowCredentials: [{ type: "public-key", id: "AQID" }],
		credentialId: "AQID",
		userVerification: "required",
	};
}

/** A canonical `PasskeyView` as serde serializes it (snake_case, no key). */
function validPasskeyEntry() {
	return {
		id: "11111111-1111-1111-1111-111111111111",
		entry_type: "passkey",
		name: "alice@example.com",
		created_at: "2026-01-02T03:04:05Z",
		updated_at: "2026-01-02T03:04:05Z",
		tags: ["work"],
		rp_id: "example.com",
		rp_name: "Example",
		credential_id: b64urlOfLength(32, 0x42),
		user_handle: "AQIDBA",
		user_name: "alice",
		user_display_name: "Alice",
		algorithm: -7,
		sign_count: 0,
		discoverable: true,
		transports: ["internal"],
		aaguid: "00000000-0000-0000-0000-000000000000",
	};
}

// ─── base64url decoder ───

describe("decodeBase64Url", () => {
	it("decodes unpadded base64url", () => {
		expect(decodeBase64Url("AQIDBA")).toEqual(new Uint8Array([1, 2, 3, 4]));
	});

	it("decodes the URL-safe alphabet (- and _)", () => {
		// 0xfb 0xff -> "+/8" in standard base64, "-_8" in url-safe.
		expect(decodeBase64Url("-_8")).toEqual(new Uint8Array([0xfb, 0xff]));
	});

	it("rejects padding, standard-alphabet characters and impossible lengths", () => {
		expect(decodeBase64Url("AQID==")).toBeUndefined();
		expect(decodeBase64Url("AQ+D")).toBeUndefined();
		expect(decodeBase64Url("AQ/D")).toBeUndefined();
		expect(decodeBase64Url("A")).toBeUndefined();
		expect(decodeBase64Url("")).toBeUndefined();
	});
});

// ─── Happy path ───

describe("passkeyCreateRequestSchema — accepts the canonical request", () => {
	it("parses the valid request unchanged", () => {
		const request = validCreateRequest();
		const result = passkeyCreateRequestSchema.safeParse(request);

		expect(result.success).toBe(true);
		expect(result.data).toEqual(request);
	});

	it("accepts a request without the optional members", () => {
		const request = validCreateRequest();
		const minimal = {
			rp: request.rp,
			user: request.user,
			challenge: request.challenge,
			origin: request.origin,
			pubKeyCredParams: request.pubKeyCredParams,
			authenticatorSelection: { residentKey: "required" as const },
		};

		expect(passkeyCreateRequestSchema.safeParse(minimal).success).toBe(true);
	});

	it("accepts an http origin and an origin with an explicit port", () => {
		const request = validCreateRequest();

		expect(
			passkeyCreateRequestSchema.safeParse({
				...request,
				origin: "http://localhost:8080",
			}).success,
		).toBe(true);
		expect(
			passkeyCreateRequestSchema.safeParse({
				...request,
				origin: "https://example.com:8443/",
			}).success,
		).toBe(true);
	});

	it("accepts a challenge at both length bounds", () => {
		const request = validCreateRequest();

		expect(
			passkeyCreateRequestSchema.safeParse({
				...request,
				challenge: b64urlOfLength(MIN_CHALLENGE_BYTES),
			}).success,
		).toBe(true);
		expect(
			passkeyCreateRequestSchema.safeParse({
				...request,
				challenge: b64urlOfLength(MAX_CHALLENGE_BYTES),
			}).success,
		).toBe(true);
	});

	it("accepts a user id at both length bounds", () => {
		const request = validCreateRequest();

		expect(
			passkeyCreateRequestSchema.safeParse({
				...request,
				user: { ...request.user, id: b64urlOfLength(1) },
			}).success,
		).toBe(true);
		expect(
			passkeyCreateRequestSchema.safeParse({
				...request,
				user: { ...request.user, id: b64urlOfLength(MAX_USER_HANDLE_BYTES) },
			}).success,
		).toBe(true);
	});
});

// ─── Rejections: the Rust validation rules ───

describe("passkeyCreateRequestSchema — rejects what Rust rejects", () => {
	/** Asserts the schema refuses `request` and mentions `messageFragment`. */
	function expectRejected(request: unknown, messageFragment?: string): void {
		const result = passkeyCreateRequestSchema.safeParse(request);
		expect(result.success).toBe(false);
		if (!result.success && messageFragment) {
			expect(JSON.stringify(result.error.issues)).toContain(messageFragment);
		}
	}

	it("rejects alg -8 (only ES256 is implemented)", () => {
		expectRejected(
			{
				...validCreateRequest(),
				pubKeyCredParams: [{ type: "public-key", alg: -8 }],
			},
			"Only ES256 is supported",
		);
	});

	it("rejects an empty pubKeyCredParams array", () => {
		expectRejected({ ...validCreateRequest(), pubKeyCredParams: [] });
	});

	it("rejects residentKey discouraged", () => {
		expectRejected({
			...validCreateRequest(),
			authenticatorSelection: { residentKey: "discouraged" },
		});
	});

	it("rejects a missing authenticatorSelection (discoverable is mandatory)", () => {
		const { authenticatorSelection: _omitted, ...withoutSelection } =
			validCreateRequest();
		expectRejected(withoutSelection);
	});

	it("rejects authenticatorSelection without residentKey", () => {
		expectRejected({
			...validCreateRequest(),
			authenticatorSelection: { userVerification: "required" },
		});
	});

	it("rejects attestation direct", () => {
		expectRejected(
			{ ...validCreateRequest(), attestation: "direct" },
			"Invalid input",
		);
	});

	it("rejects a challenge of 15 bytes (below the 16-byte floor)", () => {
		expectRejected(
			{ ...validCreateRequest(), challenge: b64urlOfLength(15) },
			"Challenge must decode to 16-1024 bytes",
		);
	});

	it("rejects a challenge above 1024 bytes", () => {
		expectRejected({
			...validCreateRequest(),
			challenge: b64urlOfLength(MAX_CHALLENGE_BYTES + 1),
		});
	});

	it("rejects a padded challenge (Rust decodes with URL_SAFE_NO_PAD)", () => {
		expectRejected({
			...validCreateRequest(),
			challenge: `${b64urlOfLength(32)}=`,
		});
	});

	it("rejects an ftp origin", () => {
		expectRejected(
			{ ...validCreateRequest(), origin: "ftp://example.com" },
			"Origin must use http or https",
		);
	});

	it("rejects an origin with a path", () => {
		expectRejected(
			{ ...validCreateRequest(), origin: "https://example.com/login" },
			"Origin must not carry a path",
		);
	});

	it("rejects an origin with a query", () => {
		expectRejected({
			...validCreateRequest(),
			origin: "https://example.com?x=1",
		});
	});

	it("rejects an origin with a fragment", () => {
		expectRejected({
			...validCreateRequest(),
			origin: "https://example.com#frag",
		});
	});

	it("rejects an origin with userinfo", () => {
		expectRejected({
			...validCreateRequest(),
			origin: "https://user:pass@example.com",
		});
	});

	it("rejects an rp.id carrying a scheme", () => {
		expectRejected(
			{
				...validCreateRequest(),
				rp: { id: "https://example.com", name: "Example" },
			},
			"RP ID must be a bare host name",
		);
	});

	it("rejects an rp.id carrying a port", () => {
		expectRejected({
			...validCreateRequest(),
			rp: { id: "example.com:8443", name: "Example" },
		});
	});

	it("rejects an rp.id carrying a path", () => {
		expectRejected({
			...validCreateRequest(),
			rp: { id: "example.com/login", name: "Example" },
		});
	});

	it("rejects an rp.id with whitespace", () => {
		expectRejected({
			...validCreateRequest(),
			rp: { id: "example .com", name: "Example" },
		});
	});

	it("rejects an rp.id longer than 253 bytes", () => {
		expectRejected({
			...validCreateRequest(),
			rp: { id: "a".repeat(MAX_RP_ID_CHARS + 1), name: "Example" },
		});
	});

	it("rejects an rp.name longer than 256 characters", () => {
		expectRejected({
			...validCreateRequest(),
			rp: { id: "example.com", name: "x".repeat(MAX_NAME_CHARS + 1) },
		});
	});

	it("rejects a user id decoding to more than 64 bytes", () => {
		expectRejected(
			{
				...validCreateRequest(),
				user: {
					id: b64urlOfLength(MAX_USER_HANDLE_BYTES + 1),
					name: "alice",
					displayName: "Alice",
				},
			},
			"User id must decode to 1-64 bytes",
		);
	});

	it("rejects an empty user name", () => {
		expectRejected({
			...validCreateRequest(),
			user: { id: "AQIDBA", name: "", displayName: "Alice" },
		});
	});

	it("rejects a user displayName longer than 256 characters", () => {
		expectRejected({
			...validCreateRequest(),
			user: {
				id: "AQIDBA",
				name: "alice",
				displayName: "x".repeat(MAX_NAME_CHARS + 1),
			},
		});
	});

	it("rejects an excludeCredentials descriptor of the wrong type", () => {
		expectRejected({
			...validCreateRequest(),
			excludeCredentials: [{ type: "other", id: "AQID" }],
		});
	});
});

// ─── Strictness: unknown keys are rejections, not noise ───

describe("strict objects", () => {
	it("rejects an unknown top-level key", () => {
		const result = passkeyCreateRequestSchema.safeParse({
			...validCreateRequest(),
			// A snake_case leak from the Rust struct would silently vanish
			// otherwise, leaving the backend with a request missing a member.
			pub_key_cred_params: [{ type: "public-key", alg: -7 }],
		});

		expect(result.success).toBe(false);
	});

	it("rejects an unknown key inside rp / user / authenticatorSelection", () => {
		const request = validCreateRequest();

		expect(
			passkeyCreateRequestSchema.safeParse({
				...request,
				rp: { ...request.rp, extra: true },
			}).success,
		).toBe(false);
		expect(
			passkeyCreateRequestSchema.safeParse({
				...request,
				user: { ...request.user, display_name: "Alice" },
			}).success,
		).toBe(false);
		expect(
			passkeyCreateRequestSchema.safeParse({
				...request,
				authenticatorSelection: {
					residentKey: "required",
					resident_key: "required",
				},
			}).success,
		).toBe(false);
	});

	it("rejects an unknown key inside a credential descriptor", () => {
		const result = passkeyCreateRequestSchema.safeParse({
			...validCreateRequest(),
			excludeCredentials: [{ type: "public-key", id: "AQID", transports: [] }],
		});

		expect(result.success).toBe(false);
	});
});

// ─── Assert request ───

describe("passkeyAssertRequestSchema", () => {
	it("accepts the canonical request", () => {
		const request = validAssertRequest();
		const result = passkeyAssertRequestSchema.safeParse(request);

		expect(result.success).toBe(true);
		expect(result.data).toEqual(request);
	});

	it("accepts an empty allowCredentials list (means no restriction)", () => {
		expect(
			passkeyAssertRequestSchema.safeParse({
				...validAssertRequest(),
				allowCredentials: [],
			}).success,
		).toBe(true);
	});

	it("accepts the minimal request (no optional members)", () => {
		expect(
			passkeyAssertRequestSchema.safeParse({
				rpId: "example.com",
				challenge: b64urlOfLength(32),
				origin: "https://example.com",
			}).success,
		).toBe(true);
	});

	it("rejects an rpId with a scheme", () => {
		expect(
			passkeyAssertRequestSchema.safeParse({
				...validAssertRequest(),
				rpId: "https://example.com",
			}).success,
		).toBe(false);
	});

	it("rejects a short challenge", () => {
		expect(
			passkeyAssertRequestSchema.safeParse({
				...validAssertRequest(),
				challenge: b64urlOfLength(15),
			}).success,
		).toBe(false);
	});

	it("rejects a non-base64url credentialId", () => {
		expect(
			passkeyAssertRequestSchema.safeParse({
				...validAssertRequest(),
				credentialId: "not base64url!",
			}).success,
		).toBe(false);
	});

	it("rejects an unknown userVerification value and an unknown key", () => {
		expect(
			passkeyAssertRequestSchema.safeParse({
				...validAssertRequest(),
				userVerification: "sometimes",
			}).success,
		).toBe(false);
		expect(
			passkeyAssertRequestSchema.safeParse({
				...validAssertRequest(),
				user_verification: "required",
			}).success,
		).toBe(false);
	});
});

// ─── View schemas ───

describe("passkeySummarySchema", () => {
	it("accepts a canonical summary", () => {
		const summary = {
			entryId: "11111111-1111-1111-1111-111111111111",
			credentialId: b64urlOfLength(32, 0x42),
			rpId: "example.com",
			userName: "alice",
			userDisplayName: "Alice",
			createdAt: "2026-01-02T03:04:05Z",
			transports: ["internal"],
		};

		expect(passkeySummarySchema.safeParse(summary).success).toBe(true);
	});

	it("rejects a summary with an unknown key", () => {
		expect(
			passkeySummarySchema.safeParse({
				entryId: "id",
				credentialId: "AQID",
				rpId: "example.com",
				userName: "alice",
				userDisplayName: "Alice",
				createdAt: "2026-01-02T03:04:05Z",
				transports: [],
				privateKey: "leak",
			}).success,
		).toBe(false);
	});
});

describe("passkeyEntrySchema", () => {
	it("accepts a canonical PasskeyView", () => {
		expect(passkeyEntrySchema.safeParse(validPasskeyEntry()).success).toBe(
			true,
		);
	});

	it("rejects a view carrying a private key (the wire type has none)", () => {
		expect(
			passkeyEntrySchema.safeParse({
				...validPasskeyEntry(),
				private_key: "leak",
			}).success,
		).toBe(false);
	});

	it("rejects a negative sign_count", () => {
		expect(
			passkeyEntrySchema.safeParse({
				...validPasskeyEntry(),
				sign_count: -1,
			}).success,
		).toBe(false);
	});
});

describe("passkeyEditSchema", () => {
	it("accepts the four mutable members", () => {
		expect(
			passkeyEditSchema.safeParse({
				name: "alice@example.com",
				tags: ["work"],
				user_name: "alice",
				user_display_name: "Alice",
			}).success,
		).toBe(true);
	});

	it("rejects an attempt to edit an immutable member", () => {
		expect(
			passkeyEditSchema.safeParse({
				name: "renamed",
				tags: [],
				user_name: "alice",
				user_display_name: "Alice",
				credential_id: "AQID",
			}).success,
		).toBe(false);
	});

	it("rejects an empty name and a name over 100 characters", () => {
		const base = {
			tags: [],
			user_name: "alice",
			user_display_name: "Alice",
		};

		expect(passkeyEditSchema.safeParse({ ...base, name: "" }).success).toBe(
			false,
		);
		expect(
			passkeyEditSchema.safeParse({ ...base, name: "x".repeat(101) }).success,
		).toBe(false);
	});

	it("rejects a tag over 30 characters", () => {
		expect(
			passkeyEditSchema.safeParse({
				name: "alice",
				tags: ["x".repeat(31)],
				user_name: "alice",
				user_display_name: "Alice",
			}).success,
		).toBe(false);
	});
});

// ─── Negative controls ───

describe("NEGATIVE CONTROLS (the schemas are not vacuous)", () => {
	/**
	 * A known-bad request: every member is individually plausible, so a schema
	 * that only checks presence would accept it. It is rejected on four
	 * independent grounds (alg -8, residentKey discouraged, attestation direct,
	 * 15-byte challenge) — the assertion pins that at least those four rules
	 * fire, which is what makes "the schema is strict" a measured fact.
	 */
	const knownBad: PasskeyCreateRequest = {
		rp: { id: "https://example.com:8443/login", name: "Example" },
		user: { id: b64urlOfLength(65), name: "alice", displayName: "Alice" },
		challenge: b64urlOfLength(15),
		origin: "ftp://example.com/path?x=1",
		pubKeyCredParams: [{ type: "public-key", alg: -8 }],
		authenticatorSelection: { residentKey: "discouraged" },
		attestation: "direct",
	};

	it("a known-bad request is rejected on every rule at once", () => {
		const result = passkeyCreateRequestSchema.safeParse(knownBad);

		expect(result.success).toBe(false);
		if (result.success) {
			return;
		}
		const paths = result.error.issues.map((issue) =>
			issue.path.map(String).join("."),
		);
		expect(paths).toEqual(
			expect.arrayContaining([
				"pubKeyCredParams",
				"authenticatorSelection.residentKey",
				"attestation",
				"challenge",
				"origin",
				"rp.id",
				"user.id",
			]),
		);
	});

	it("the same request with the four core fixes parses (proves the rejection was rule-driven)", () => {
		const fixed: PasskeyCreateRequest = {
			...knownBad,
			rp: { id: "example.com", name: "Example" },
			user: { id: b64urlOfLength(64), name: "alice", displayName: "Alice" },
			challenge: b64urlOfLength(16),
			origin: "https://example.com",
			pubKeyCredParams: [{ type: "public-key", alg: ES256_ALG }],
			authenticatorSelection: { residentKey: "required" },
			attestation: "none",
		};

		expect(passkeyCreateRequestSchema.safeParse(fixed).success).toBe(true);
	});
});
