/**
 * Tests for the passkey ceremony service (T11) — the user-verification gate in
 * front of `passkey_create` / `passkey_assert`.
 *
 * The service is tested against **fakes of its three collaborators**, never the
 * real ones:
 *
 * - `./biometric` (availability + prompt),
 * - `./passkey` (the IPC wrappers — the assertion target for "was the command
 *   called at all?"),
 * - `./vault` (`VaultManager`, the Redux accessor).
 *
 * All three are registered with `vi.mock` **before** the module under test is
 * imported (vitest hoists the calls above the imports), which is the only way
 * to keep the real `invoke` out of the picture: `services/passkey.ts` binds
 * `invoke` at import time, so a late mock would leave a live IPC call behind.
 *
 * The behavioural contract pinned here:
 *
 * | biometry | prompt | command | outcome |
 * | --- | --- | --- | --- |
 * | available | `true` | called once, session password | resolves |
 * | available | `false` | **not called** | throws |
 * | available | throws | **not called** | throws (no bypass) |
 * | unavailable | — | called once | resolves (documented fallback) |
 * | availability check throws | — | **not called** | throws (no bypass) |
 * | vault locked / missing | — | **not called** | throws before any IPC |
 *
 * `waitFor` from testing-library is not used anywhere: it does not work under
 * bun + jsdom in this repo. Every assertion awaits the promise directly.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
	PasskeyAssertRequest,
	PasskeyAssertResponse,
	PasskeyCreateRequest,
	PasskeyCreateResponse,
} from "../../interfaces/passkey.interface";
import type { Vault } from "../../redux/actions/vault";

// ─── Mocks (registered before the module under test is imported) ───

const mockBiometric = vi.hoisted(() => ({
	checkBiometricAvailability: vi.fn(),
	authenticate: vi.fn(),
}));

const mockPasskeyCommands = vi.hoisted(() => ({
	create: vi.fn(),
	assert: vi.fn(),
}));

const mockVaultManager = vi.hoisted(() => ({
	getState: vi.fn(),
	// `redux/store.tsx` initializes the manager at import time (reached through
	// `i18n`), so the fake must expose the same entry point.
	initialize: vi.fn(),
}));

vi.mock("../../services/biometric", () => mockBiometric);
vi.mock("../../services/passkey", () => ({
	default: mockPasskeyCommands,
	// `vaultRefFor` is a pure mapper and is NOT mocked: the ceremony must send
	// the real wire shape, and a fake here would hide a mapping regression.
	vaultRefFor: (vault: Vault) =>
		vault.storageType === "cloud"
			? {
					kind: "cloud",
					vault_id: vault.cloudMetadata?.fileId || vault.path,
					provider_name: vault.providerId,
				}
			: { kind: "local", file_path: vault.path },
}));
vi.mock("../../services/vault", () => ({
	VaultManager: {
		getInstance: () => mockVaultManager,
	},
}));

import {
	assertPasskeyCeremony,
	createPasskeyCeremony,
	PasskeyCeremonyError,
	UV_PROMPT_KEY,
} from "../../services/passkeyCeremony";

// ─── Fixtures ───

const VAULT_ID = "vault-1";
const SESSION_PASSWORD = "correct horse battery staple";

/** A local, unlocked vault as it sits in Redux. */
function unlockedVault(overrides: Partial<Vault> = {}): Vault {
	return {
		id: VAULT_ID,
		name: "Personal",
		path: "/home/user/personal.monark",
		isLocked: false,
		storageType: "local",
		biometricEnabled: true,
		volatile: { credential: SESSION_PASSWORD, entries: [] },
		...overrides,
	};
}

/** Installs `vaults` as the Redux state the service will read. */
function setVaults(vaults: Vault[]): void {
	mockVaultManager.getState.mockReturnValue({
		vault: { vaults },
	});
}

/** A valid registration request (the canonical one from the wrapper tests). */
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

/** A valid authentication request. */
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

const ASSERT_RESPONSE: PasskeyAssertResponse = {
	entryId: "11111111-1111-1111-1111-111111111111",
	id: "QkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkI",
	rawId: "QkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkI",
	type: "public-key",
	response: {
		clientDataJSON: "eyJ0eXBlIjoid2ViYXV0aG4uZ2V0In0",
		authenticatorData: "SZYN5YgOjGh0NBcPZHZgW4_krrmihjLHmVzzuoMdl2MFAAAAAA",
		signature: "MEUCIQDsignature",
		userHandle: "AQIDBA",
	},
	authenticatorAttachment: "platform",
	clientExtensionResults: {},
};

/** Biometry present and the prompt will return `result`. */
function biometryAvailable(result: boolean): void {
	mockBiometric.checkBiometricAvailability.mockResolvedValue({
		isAvailable: true,
		biometryType: 2,
	});
	mockBiometric.authenticate.mockResolvedValue(result);
}

/** No biometric sensor / nothing enrolled. */
function biometryUnavailable(): void {
	mockBiometric.checkBiometricAvailability.mockResolvedValue({
		isAvailable: false,
		biometryType: 0,
	});
}

beforeEach(() => {
	vi.clearAllMocks();
	setVaults([unlockedVault()]);
	mockPasskeyCommands.create.mockResolvedValue(CREATE_RESPONSE);
	mockPasskeyCommands.assert.mockResolvedValue(ASSERT_RESPONSE);
});

// ─── Happy path ───

describe("createPasskeyCeremony — user verification succeeds", () => {
	it("calls passkey_create with the session password and the vault ref", async () => {
		biometryAvailable(true);
		const request = createRequest();

		const result = await createPasskeyCeremony(VAULT_ID, request);

		expect(result).toEqual(CREATE_RESPONSE);
		expect(mockPasskeyCommands.create).toHaveBeenCalledTimes(1);
		expect(mockPasskeyCommands.create).toHaveBeenCalledWith(
			{ kind: "local", file_path: "/home/user/personal.monark" },
			SESSION_PASSWORD,
			request,
		);
	});

	it("prompts with the i18n uvPrompt key and allows the device credential", async () => {
		biometryAvailable(true);

		await createPasskeyCeremony(VAULT_ID, createRequest());

		expect(mockBiometric.authenticate).toHaveBeenCalledTimes(1);
		const [reason, options] = mockBiometric.authenticate.mock.calls[0] as [
			string,
			Record<string, unknown>,
		];
		// The prompt text comes from i18n, not from a hardcoded English string.
		expect(reason).toBe("Verify your identity to use a passkey");
		expect(UV_PROMPT_KEY).toBe("home:passkey.uvPrompt");
		expect(options.allowDeviceCredential).toBe(true);
		// The vault name reaches the subtitle; the password never does.
		expect(options.subtitle).toContain("Personal");
		expect(JSON.stringify(options)).not.toContain(SESSION_PASSWORD);
	});

	it("verifies the user BEFORE calling the command", async () => {
		biometryAvailable(true);
		const order: string[] = [];
		mockBiometric.authenticate.mockImplementation(async () => {
			order.push("prompt");
			return true;
		});
		mockPasskeyCommands.create.mockImplementation(async () => {
			order.push("command");
			return CREATE_RESPONSE;
		});

		await createPasskeyCeremony(VAULT_ID, createRequest());

		expect(order).toEqual(["prompt", "command"]);
	});

	it("sends a cloud vault by reference", async () => {
		biometryAvailable(true);
		setVaults([
			unlockedVault({
				storageType: "cloud",
				path: "/Monark/personal.monark",
				providerId: "google_drive",
				cloudMetadata: {
					fileId: "file-123",
					provider: "google_drive",
					lastSync: "2026-01-02T03:04:05Z",
				},
			}),
		]);

		await createPasskeyCeremony(VAULT_ID, createRequest());

		expect(mockPasskeyCommands.create).toHaveBeenCalledWith(
			{
				kind: "cloud",
				vault_id: "file-123",
				provider_name: "google_drive",
			},
			SESSION_PASSWORD,
			expect.anything(),
		);
	});
});

describe("assertPasskeyCeremony — user verification succeeds", () => {
	it("calls passkey_assert with the session password and the vault ref", async () => {
		biometryAvailable(true);
		const request = assertRequest();

		const result = await assertPasskeyCeremony(VAULT_ID, request);

		expect(result).toEqual(ASSERT_RESPONSE);
		expect(mockPasskeyCommands.assert).toHaveBeenCalledTimes(1);
		expect(mockPasskeyCommands.assert).toHaveBeenCalledWith(
			{ kind: "local", file_path: "/home/user/personal.monark" },
			SESSION_PASSWORD,
			request,
		);
	});
});

// ─── Negative control: a failed prompt must NOT reach the command ───

describe("createPasskeyCeremony — user verification fails", () => {
	it("NEGATIVE CONTROL: a failed prompt throws and the command is never invoked", async () => {
		biometryAvailable(false);

		await expect(
			createPasskeyCeremony(VAULT_ID, createRequest()),
		).rejects.toBeInstanceOf(PasskeyCeremonyError);

		// The whole point of the gate: invoke count is exactly 0.
		expect(mockPasskeyCommands.create).toHaveBeenCalledTimes(0);
		// And no silent password fallback: the prompt is not retried either.
		expect(mockBiometric.authenticate).toHaveBeenCalledTimes(1);
	});

	it("reports the i18n uvFailed message, not the raw prompt result", async () => {
		biometryAvailable(false);

		await expect(
			createPasskeyCeremony(VAULT_ID, createRequest()),
		).rejects.toThrow("User verification failed. Please try again.");
	});

	it("propagates a throwing prompt as a ceremony error without invoking", async () => {
		mockBiometric.checkBiometricAvailability.mockResolvedValue({
			isAvailable: true,
			biometryType: 2,
		});
		// `authenticate` is documented as never throwing, but a plugin regression
		// must not become a UV bypass.
		mockBiometric.authenticate.mockRejectedValue(new Error("plugin crashed"));

		await expect(
			createPasskeyCeremony(VAULT_ID, createRequest()),
		).rejects.toBeInstanceOf(PasskeyCeremonyError);
		expect(mockPasskeyCommands.create).toHaveBeenCalledTimes(0);
	});
});

describe("assertPasskeyCeremony — user verification fails", () => {
	it("NEGATIVE CONTROL: a failed prompt throws and the command is never invoked", async () => {
		biometryAvailable(false);

		await expect(
			assertPasskeyCeremony(VAULT_ID, assertRequest()),
		).rejects.toBeInstanceOf(PasskeyCeremonyError);

		expect(mockPasskeyCommands.assert).toHaveBeenCalledTimes(0);
	});
});

// ─── Availability check failures ───

describe("biometric availability check failure", () => {
	it("throws with context and does not invoke the command", async () => {
		mockBiometric.checkBiometricAvailability.mockRejectedValue(
			new Error("plugin:biometry|status unavailable"),
		);

		const error = await createPasskeyCeremony(VAULT_ID, createRequest()).catch(
			(caught: unknown) => caught,
		);

		expect(error).toBeInstanceOf(PasskeyCeremonyError);
		expect((error as PasskeyCeremonyError).message).toBe(
			"Could not verify your identity. Please try again.",
		);
		// The underlying failure is preserved for debugging.
		expect((error as PasskeyCeremonyError).cause).toBeInstanceOf(Error);
		expect(mockPasskeyCommands.create).toHaveBeenCalledTimes(0);
		// A broken subsystem is not "unavailable": no prompt, no fallback.
		expect(mockBiometric.authenticate).not.toHaveBeenCalled();
	});
});

// ─── Documented password fallback ───

describe("biometry unavailable (documented password fallback)", () => {
	it("proceeds without a prompt and calls the command", async () => {
		biometryUnavailable();

		const result = await createPasskeyCeremony(VAULT_ID, createRequest());

		expect(result).toEqual(CREATE_RESPONSE);
		expect(mockBiometric.authenticate).not.toHaveBeenCalled();
		expect(mockPasskeyCommands.create).toHaveBeenCalledTimes(1);
	});

	it("proceeds for the assert ceremony too", async () => {
		biometryUnavailable();

		await assertPasskeyCeremony(VAULT_ID, assertRequest());

		expect(mockBiometric.authenticate).not.toHaveBeenCalled();
		expect(mockPasskeyCommands.assert).toHaveBeenCalledTimes(1);
	});
});

// ─── Vault resolution: throw before any IPC ───

describe("vault resolution", () => {
	it("throws for an unknown vault without touching biometry or the command", async () => {
		biometryAvailable(true);

		await expect(
			createPasskeyCeremony("missing-vault", createRequest()),
		).rejects.toThrow("Vault not found.");

		expect(mockBiometric.checkBiometricAvailability).not.toHaveBeenCalled();
		expect(mockPasskeyCommands.create).toHaveBeenCalledTimes(0);
	});

	it("throws for a locked vault even when the credential is present", async () => {
		biometryAvailable(true);
		setVaults([unlockedVault({ isLocked: true })]);

		await expect(
			createPasskeyCeremony(VAULT_ID, createRequest()),
		).rejects.toThrow("Vault must be unlocked.");

		expect(mockPasskeyCommands.create).toHaveBeenCalledTimes(0);
	});

	it("throws for a vault with no session credential", async () => {
		biometryAvailable(true);
		setVaults([unlockedVault({ volatile: { credential: "", entries: [] } })]);

		await expect(
			assertPasskeyCeremony(VAULT_ID, assertRequest()),
		).rejects.toThrow("Vault must be unlocked.");

		expect(mockPasskeyCommands.assert).toHaveBeenCalledTimes(0);
	});

	it("throws when the vault manager was never initialized", async () => {
		biometryAvailable(true);
		mockVaultManager.getState.mockImplementation(() => {
			throw new Error("VaultManager not initialized. Call initialize() first.");
		});

		await expect(
			createPasskeyCeremony(VAULT_ID, createRequest()),
		).rejects.toThrow("Vault state is not available");

		expect(mockPasskeyCommands.create).toHaveBeenCalledTimes(0);
	});
});

// ─── Request validation happens before the prompt ───

describe("request validation", () => {
	it("rejects an invalid request before prompting the user", async () => {
		biometryAvailable(true);
		const bad = { ...createRequest(), attestation: "direct" };

		await expect(
			createPasskeyCeremony(VAULT_ID, bad as PasskeyCreateRequest),
		).rejects.toThrow(/Invalid passkey registration request/);

		// A malformed request must not interrupt the user with a biometric dialog.
		expect(mockBiometric.authenticate).not.toHaveBeenCalled();
		expect(mockPasskeyCommands.create).toHaveBeenCalledTimes(0);
	});

	it("rejects an invalid assert request before prompting the user", async () => {
		biometryAvailable(true);
		const bad = { ...assertRequest(), origin: "ftp://example.com" };

		await expect(
			assertPasskeyCeremony(VAULT_ID, bad as PasskeyAssertRequest),
		).rejects.toThrow(/Invalid passkey authentication request/);

		expect(mockBiometric.authenticate).not.toHaveBeenCalled();
		expect(mockPasskeyCommands.assert).toHaveBeenCalledTimes(0);
	});
});

// ─── Backend rejections are wrapped with ceremony context ───

describe("backend rejection", () => {
	it("wraps a Rust Validation string with the ceremony context", async () => {
		biometryAvailable(true);
		mockPasskeyCommands.create.mockRejectedValue(
			"Validation Error: Only ES256 is supported",
		);

		const error = await createPasskeyCeremony(VAULT_ID, createRequest()).catch(
			(caught: unknown) => caught,
		);

		expect(error).toBeInstanceOf(PasskeyCeremonyError);
		expect((error as PasskeyCeremonyError).message).toBe(
			"Passkey registration failed: Validation Error: Only ES256 is supported",
		);
	});

	it("wraps an assert rejection and never leaks the password", async () => {
		biometryAvailable(true);
		mockPasskeyCommands.assert.mockRejectedValue(
			"Not Found: No passkey for this relying party",
		);

		const error = await assertPasskeyCeremony(VAULT_ID, assertRequest()).catch(
			(caught: unknown) => caught,
		);

		expect((error as PasskeyCeremonyError).message).toContain(
			"Passkey authentication failed",
		);
		expect((error as PasskeyCeremonyError).message).not.toContain(
			SESSION_PASSWORD,
		);
	});
});
