/**
 * IPC contract test for the passkey command wrappers (T09).
 *
 * Two things are pinned here:
 *
 * 1. the **command name and argument shape** of every wrapper — a camelCase
 *    member (`filePath`) would type-check and fail at runtime with a serde
 *    error, so the assertions look at the payload, not the TS types;
 * 2. the **response shape** the Rust side produces, fed through the wrapper
 *    unchanged (the frontend must not have to reshape a `PublicKeyCredential`).
 *
 * The fixture below is the JSON of `PasskeyCreateResponse` as serialized by
 * serde (`src-tauri/src/passkey/types.rs`): `clientDataJSON` /
 * `attestationObject` keep their spec acronyms, `entryId` is camelCase.
 */

import { invoke } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
	PasskeyCreateRequest,
	PasskeyCreateResponse,
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
