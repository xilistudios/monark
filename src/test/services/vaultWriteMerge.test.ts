import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Entry, PasskeyEntry } from "../../interfaces/vault.interface";
import VaultCommands from "../../services/commands";

// The invoke mock must be registered before the module under test is imported
// (see the `vi.mock` hoisting note in the vitest docs): `commands.ts` captures
// `invoke` at import time.
vi.mock("@tauri-apps/api/core", () => ({
	invoke: vi.fn(),
}));

const { invoke } = await import("@tauri-apps/api/core");
const mockInvoke = vi.mocked(invoke);

/**
 * A passkey entry exactly as the backend `PasskeyView` serializes it: no
 * `private_key` field, base64url identifiers, snake_case keys.
 */
const passkeyEntry: PasskeyEntry = {
	id: "11111111-1111-1111-1111-111111111111",
	entry_type: "passkey",
	name: "GitHub",
	created_at: "2026-01-02T03:04:05Z",
	updated_at: "2026-01-02T03:04:05Z",
	tags: ["work"],
	rp_id: "github.com",
	rp_name: "GitHub",
	credential_id: "3q2-7w",
	user_handle: "AQIDBA",
	user_name: "octocat",
	user_display_name: "The Octocat",
	algorithm: -7,
	sign_count: 0,
	discoverable: true,
	transports: ["internal"],
	aaguid: "00000000-0000-0000-0000-000000000000",
};

const groupWithPasskey: Entry = {
	id: "33333333-3333-3333-3333-333333333333",
	entry_type: "group",
	name: "Root",
	data_type: "group",
	children: [passkeyEntry],
};

const vaultContent = {
	updated_at: "2026-01-02T03:04:05Z",
	hmac: "",
	entries: [groupWithPasskey],
};

describe("write-path payload (T05)", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("sends the passkey view to write_vault without any key field", async () => {
		mockInvoke.mockResolvedValue(undefined);

		await VaultCommands.write(
			"/path/to/vault.monark",
			"password",
			vaultContent,
		);

		expect(mockInvoke).toHaveBeenCalledTimes(1);
		const [command, payload] = mockInvoke.mock.calls[0];
		expect(command).toBe("write_vault");

		const sent = payload as { vaultContent: typeof vaultContent };
		const serialized = JSON.stringify(sent.vaultContent);

		expect(serialized).not.toContain("private_key");
		expect(serialized).not.toContain("privateKey");
		// The non-secret WebAuthn identifiers do travel (the backend needs them
		// to match the entry against the stored one).
		expect(serialized).toContain("3q2-7w");
		expect(serialized).toContain('"entry_type":"passkey"');
	});

	it("sends snake_case updated_at on the cloud branch", async () => {
		mockInvoke.mockResolvedValue("cloud-file-id");

		await VaultCommands.writeVault(
			"cloud-file-id",
			"password",
			vaultContent,
			"google-drive",
			"Cloud Vault",
		);

		expect(mockInvoke).toHaveBeenCalledTimes(1);
		const [command, payload] = mockInvoke.mock.calls[0];
		expect(command).toBe("write_cloud_vault");

		const sent = payload as {
			vaultContent: Record<string, unknown>;
			vaultId: string;
			providerName: string;
		};
		expect(sent.vaultId).toBe("cloud-file-id");
		expect(sent.providerName).toBe("google-drive");
		// The backend `VaultView` is snake_case: a camelCase `updatedAt` would be
		// rejected by serde (the latent bug this task fixes).
		expect(sent.vaultContent).toHaveProperty(
			"updated_at",
			vaultContent.updated_at,
		);
		expect(sent.vaultContent).not.toHaveProperty("updatedAt");
		expect(sent.vaultContent.entries).toEqual(vaultContent.entries);
		expect(JSON.stringify(sent.vaultContent)).not.toContain("private_key");
	});
});
