/**
 * IPC contract test for the passkey command wrappers (T09 create, T10
 * assert/listForRp/delete).
 *
 * Two things are pinned here:
 *
 * 1. the **command name and argument shape** of every wrapper — a camelCase
 *    member (`filePath`) would type-check and fail at runtime with a serde
 *    error, so the assertions look at the payload, not the TS types;
 * 2. the **response shape** the Rust side produces, fed through the wrapper
 *    unchanged (the frontend must not have to reshape a `PublicKeyCredential`).
 *
 * The fixtures below are the JSON of `PasskeyCreateResponse` /
 * `PasskeyAssertResponse` / `PasskeySummary` as serialized by serde
 * (`src-tauri/src/passkey/types.rs`): `clientDataJSON` / `attestationObject` /
 * `authenticatorData` / `userHandle` keep their spec acronyms, `entryId` /
 * `rawId` / `rpId` / `credentialId` are camelCase.
 */

import { invoke } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
	PasskeyAssertRequest,
	PasskeyAssertResponse,
	PasskeyCreateRequest,
	PasskeyCreateResponse,
	PasskeySummary,
	VaultRef,
} from "../../interfaces/passkey.interface";
import PasskeyCommands from "../../services/passkey";

// The mock must be registered before the module under test is imported; the
// hoisted `vi.mock` call below is lifted above the imports by vitest.
vi.mock("@tauri-apps/api/core", () => ({
	invoke: vi.fn(),
}));

const mockInvoke = vi.mocked(invoke);

const LOCAL_REF: VaultRef = {
	kind: "local",
	file_path: "/home/user/personal.monark",
};

const CLOUD_REF: VaultRef = {
	kind: "cloud",
	vault_id: "file-123",
	provider_name: "google_drive",
};

/** A valid registration request, exactly as the ceremony service builds it. */
function createRequest(): PasskeyCreateRequest {
	return {
		rp: { id: "example.com", name: "Example" },
		user: { id: "AQIDBA", name: "alice", displayName: "Alice" },
		challenge: "ERERERERERERERERERERERERERERERERERERERERERE",
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

/** The serialized `PasskeyCreateResponse` (serde output, camelCase + acronyms). */
const CREATE_RESPONSE: PasskeyCreateResponse = {
	entryId: "11111111-1111-1111-1111-111111111111",
	id: "QkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkI",
	rawId: "QkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkI",
	type: "public-key",
	response: {
		clientDataJSON: "eyJ0eXBlIjoid2ViYXV0aG4uY3JlYXRlIn0",
		attestationObject: "o2NmbXRkbm9uZQ",
		transports: ["internal"],
	},
	authenticatorAttachment: "platform",
	clientExtensionResults: {},
};

describe("PasskeyCommands.create (T09)", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("invokes passkey_create with { vault, password, request }", async () => {
		mockInvoke.mockResolvedValue(CREATE_RESPONSE);
		const request = createRequest();

		const result = await PasskeyCommands.create(
			LOCAL_REF,
			"vault-password",
			request,
		);

		expect(mockInvoke).toHaveBeenCalledTimes(1);
		expect(mockInvoke).toHaveBeenCalledWith("passkey_create", {
			vault: LOCAL_REF,
			password: "vault-password",
			request,
		});
		expect(result).toEqual(CREATE_RESPONSE);
	});

	it("forwards the request untouched (no camelCase/snake_case reshaping)", async () => {
		mockInvoke.mockResolvedValue(CREATE_RESPONSE);
		const request = createRequest();

		await PasskeyCommands.create(LOCAL_REF, "vault-password", request);

		const [, args] = mockInvoke.mock.calls[0] as [
			string,
			Record<string, unknown>,
		];
		// The Rust struct is `#[serde(rename_all = "camelCase")]` with the
		// WebAuthn acronyms pinned explicitly: the object must arrive verbatim.
		expect(args.request).toBe(request);
		expect(JSON.parse(JSON.stringify(args.request))).toEqual({
			rp: { id: "example.com", name: "Example" },
			user: { id: "AQIDBA", name: "alice", displayName: "Alice" },
			challenge: "ERERERERERERERERERERERERERERERERERERERERERE",
			origin: "https://example.com",
			pubKeyCredParams: [{ type: "public-key", alg: -7 }],
			authenticatorSelection: {
				residentKey: "required",
				userVerification: "required",
				authenticatorAttachment: "platform",
			},
			excludeCredentials: [{ type: "public-key", id: "AQID" }],
			attestation: "none",
		});
	});

	it("sends a cloud vault by reference (snake_case members)", async () => {
		mockInvoke.mockResolvedValue(CREATE_RESPONSE);

		await PasskeyCommands.create(CLOUD_REF, "vault-password", createRequest());

		const [, args] = mockInvoke.mock.calls[0] as [
			string,
			Record<string, unknown>,
		];
		expect(JSON.parse(JSON.stringify(args.vault))).toEqual({
			kind: "cloud",
			vault_id: "file-123",
			provider_name: "google_drive",
		});
		// The password travels as its own argument, never inside the request.
		expect(args.password).toBe("vault-password");
		expect(JSON.stringify(args.request)).not.toContain("vault-password");
	});

	it("returns the spec-shaped PublicKeyCredential unchanged", async () => {
		mockInvoke.mockResolvedValue(CREATE_RESPONSE);

		const result = await PasskeyCommands.create(
			LOCAL_REF,
			"vault-password",
			createRequest(),
		);

		// `id` and `rawId` are the same base64url credential id.
		expect(result.id).toBe(result.rawId);
		expect(result.type).toBe("public-key");
		expect(result.authenticatorAttachment).toBe("platform");
		expect(result.clientExtensionResults).toEqual({});
		expect(result.response.transports).toEqual(["internal"]);
		// The spec acronyms survive: a `clientDataJson` member would be invisible
		// to every relying party.
		expect(Object.keys(result.response).sort()).toEqual([
			"attestationObject",
			"clientDataJSON",
			"transports",
		]);
	});

	it("propagates a backend rejection", async () => {
		mockInvoke.mockRejectedValue("Validation Error: Only ES256 is supported");

		await expect(
			PasskeyCommands.create(LOCAL_REF, "vault-password", createRequest()),
		).rejects.toBe("Validation Error: Only ES256 is supported");
	});
});
/** A valid authentication request, exactly as the ceremony service builds it. */
function assertRequest(): PasskeyAssertRequest {
	return {
		rpId: "example.com",
		challenge: "ERERERERERERERERERERERERERERERERERERERERERE",
		origin: "https://example.com",
		allowCredentials: [{ type: "public-key", id: "AQID" }],
		credentialId: "AQID",
		userVerification: "required",
	};
}

/** The serialized `PasskeyAssertResponse` (serde output, camelCase + acronyms). */
const ASSERT_RESPONSE: PasskeyAssertResponse = {
	entryId: "11111111-1111-1111-1111-111111111111",
	id: "QkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkI",
	rawId: "QkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkI",
	type: "public-key",
	response: {
		clientDataJSON: "eyJ0eXBlIjoid2ViYXV0aG4uZ2V0In0",
		authenticatorData: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAUAAAAA",
		signature: "MEUCIQDf",
		userHandle: "AQIDBA",
	},
	authenticatorAttachment: "platform",
	clientExtensionResults: {},
};

/** The serialized `PasskeySummary` (serde output, camelCase). */
const SUMMARIES: PasskeySummary[] = [
	{
		entryId: "11111111-1111-1111-1111-111111111111",
		credentialId: "QkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkI",
		rpId: "example.com",
		userName: "alice",
		userDisplayName: "Alice",
		createdAt: "2026-11-19T00:00:00+00:00",
		transports: ["internal"],
	},
];

describe("PasskeyCommands.assert (T10)", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("invokes passkey_assert with { vault, password, request }", async () => {
		mockInvoke.mockResolvedValue(ASSERT_RESPONSE);
		const request = assertRequest();

		const result = await PasskeyCommands.assert(
			LOCAL_REF,
			"vault-password",
			request,
		);

		expect(mockInvoke).toHaveBeenCalledTimes(1);
		expect(mockInvoke).toHaveBeenCalledWith("passkey_assert", {
			vault: LOCAL_REF,
			password: "vault-password",
			request,
		});
		expect(result).toEqual(ASSERT_RESPONSE);
	});

	it("forwards the request untouched (camelCase WebAuthn members)", async () => {
		mockInvoke.mockResolvedValue(ASSERT_RESPONSE);
		const request = assertRequest();

		await PasskeyCommands.assert(LOCAL_REF, "vault-password", request);

		const [, args] = mockInvoke.mock.calls[0] as [
			string,
			Record<string, unknown>,
		];
		// The Rust struct is `#[serde(rename_all = "camelCase")]`: the object
		// must arrive verbatim, `rpId` and `credentialId` included.
		expect(args.request).toBe(request);
		expect(JSON.parse(JSON.stringify(args.request))).toEqual({
			rpId: "example.com",
			challenge: "ERERERERERERERERERERERERERERERERERERERERERE",
			origin: "https://example.com",
			allowCredentials: [{ type: "public-key", id: "AQID" }],
			credentialId: "AQID",
			userVerification: "required",
		});
	});

	it("returns the spec-shaped assertion unchanged", async () => {
		mockInvoke.mockResolvedValue(ASSERT_RESPONSE);

		const result = await PasskeyCommands.assert(
			LOCAL_REF,
			"vault-password",
			assertRequest(),
		);

		expect(result.id).toBe(result.rawId);
		expect(result.type).toBe("public-key");
		expect(result.authenticatorAttachment).toBe("platform");
		expect(result.clientExtensionResults).toEqual({});
		expect(result.response.userHandle).toBe("AQIDBA");
		// The spec acronyms survive: `clientDataJson` would be invisible to every
		// relying party.
		expect(Object.keys(result.response).sort()).toEqual([
			"authenticatorData",
			"clientDataJSON",
			"signature",
			"userHandle",
		]);
	});

	it("sends a cloud vault by reference and keeps the password out of the request", async () => {
		mockInvoke.mockResolvedValue(ASSERT_RESPONSE);

		await PasskeyCommands.assert(CLOUD_REF, "vault-password", assertRequest());

		const [, args] = mockInvoke.mock.calls[0] as [
			string,
			Record<string, unknown>,
		];
		expect(JSON.parse(JSON.stringify(args.vault))).toEqual({
			kind: "cloud",
			vault_id: "file-123",
			provider_name: "google_drive",
		});
		expect(args.password).toBe("vault-password");
		expect(JSON.stringify(args.request)).not.toContain("vault-password");
	});

	it("propagates a backend rejection (ambiguous selection)", async () => {
		mockInvoke.mockRejectedValue(
			"Validation Error: Multiple passkeys match; specify credential_id",
		);

		await expect(
			PasskeyCommands.assert(LOCAL_REF, "vault-password", assertRequest()),
		).rejects.toBe(
			"Validation Error: Multiple passkeys match; specify credential_id",
		);
	});
});

describe("PasskeyCommands.listForRp (T10)", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("invokes passkey_list_for_rp with { vault, password, rpId }", async () => {
		mockInvoke.mockResolvedValue(SUMMARIES);

		const result = await PasskeyCommands.listForRp(
			LOCAL_REF,
			"vault-password",
			"example.com",
		);

		expect(mockInvoke).toHaveBeenCalledTimes(1);
		// `rpId` is camelCase on purpose: the Rust command parameter is `rp_id`
		// and Tauri maps it to the camelCase argument name.
		expect(mockInvoke).toHaveBeenCalledWith("passkey_list_for_rp", {
			vault: LOCAL_REF,
			password: "vault-password",
			rpId: "example.com",
		});
		expect(result).toEqual(SUMMARIES);
	});

	it("returns the summaries unchanged, with no key material", async () => {
		mockInvoke.mockResolvedValue(SUMMARIES);

		const result = await PasskeyCommands.listForRp(
			LOCAL_REF,
			"vault-password",
			"example.com",
		);

		expect(result[0].entryId).toBe("11111111-1111-1111-1111-111111111111");
		expect(result[0].rpId).toBe("example.com");
		expect(result[0].userDisplayName).toBe("Alice");
		const serialized = JSON.stringify(result);
		expect(serialized).not.toContain("privateKey");
		expect(serialized).not.toContain("private_key");
		expect(serialized).not.toContain("userHandle");
	});

	it("passes an empty list through (no passkey for that RP is not an error)", async () => {
		mockInvoke.mockResolvedValue([]);

		const result = await PasskeyCommands.listForRp(
			LOCAL_REF,
			"vault-password",
			"nobody.example",
		);

		expect(result).toEqual([]);
	});
});

describe("PasskeyCommands.delete (T10)", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("invokes passkey_delete with { vault, password, entryId }", async () => {
		mockInvoke.mockResolvedValue(undefined);

		await PasskeyCommands.delete(
			LOCAL_REF,
			"vault-password",
			"11111111-1111-1111-1111-111111111111",
		);

		expect(mockInvoke).toHaveBeenCalledTimes(1);
		// `entryId` is camelCase on purpose: the Rust command parameter is
		// `entry_id` and Tauri maps it to the camelCase argument name.
		expect(mockInvoke).toHaveBeenCalledWith("passkey_delete", {
			vault: LOCAL_REF,
			password: "vault-password",
			entryId: "11111111-1111-1111-1111-111111111111",
		});
	});

	it("resolves with no value (the command returns unit)", async () => {
		mockInvoke.mockResolvedValue(null);

		await expect(
			PasskeyCommands.delete(
				CLOUD_REF,
				"vault-password",
				"11111111-1111-1111-1111-111111111111",
			),
		).resolves.toBeNull();
	});

	it("propagates a backend rejection (not a passkey entry)", async () => {
		mockInvoke.mockRejectedValue(
			"Validation Error: Only passkey entries can be deleted here",
		);

		await expect(
			PasskeyCommands.delete(
				LOCAL_REF,
				"vault-password",
				"11111111-1111-1111-1111-111111111111",
			),
		).rejects.toBe(
			"Validation Error: Only passkey entries can be deleted here",
		);
	});
});
