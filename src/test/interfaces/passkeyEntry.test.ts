/**
 * IPC contract test for the passkey view (T04).
 *
 * The Rust side pins the exact `PasskeyView` JSON shape in
 * `src-tauri/src/models.rs` (`passkey_view_serde_tag_flattening`); this file
 * pins the TypeScript mirror (`PasskeyEntry` in
 * `src/interfaces/vault.interface.ts`) against the *same* fixture, so the two
 * halves of the contract cannot drift apart.
 *
 * The fixture is also fed through the real `VaultCommands.read` wrapper with a
 * mocked `invoke`, which proves the wrapper hands the frontend a sanitized view
 * (no `private_key` key) without any transformation step.
 */

import { invoke } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	type Entry,
	findEntryByPath,
	flattenEntries,
	getEntryDepth,
	getParentPath,
	isDataEntry,
	isGroupEntry,
	isPasskeyEntry,
	type PasskeyEntry,
	type VaultContent,
} from "../../interfaces/vault.interface";
import VaultCommands from "../../services/commands";

// The mock must be registered before the module under test is imported; the
// hoisted `vi.mock` call below is lifted above the imports by vitest.
vi.mock("@tauri-apps/api/core", () => ({
	invoke: vi.fn(),
}));

const mockInvoke = vi.mocked(invoke);

/**
 * The canonical serialized `PasskeyView`, byte-for-byte the JSON produced by
 * the Rust pin test (`passkey_view_serde_tag_flattening` in `models.rs`):
 * fixed uuid `1111…`, credential id `deadbeef`, user handle `AQIDBA`, ES256.
 */
const PASSKEY_VIEW_JSON = JSON.stringify({
	entry_type: "passkey",
	id: "11111111-1111-1111-1111-111111111111",
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
});

const GROUP_VIEW_JSON = JSON.stringify({
	entry_type: "group",
	id: "33333333-3333-3333-3333-333333333333",
	name: "Root",
	data_type: "group",
	children: [],
});

const DATA_VIEW_JSON = JSON.stringify({
	entry_type: "entry",
	id: "22222222-2222-2222-2222-222222222222",
	name: "Mail",
	data_type: "login",
	created_at: "2026-01-02T03:04:05Z",
	updated_at: "2026-01-02T03:04:05Z",
	fields: [
		{ title: "Password", property: "password", value: "hunter2", secret: true },
	],
	tags: ["personal"],
});

const parsePasskey = (): PasskeyEntry =>
	JSON.parse(PASSKEY_VIEW_JSON) as PasskeyEntry;

describe("PasskeyEntry IPC contract", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("parses the Rust-pinned view fixture as a PasskeyEntry", () => {
		const entry = parsePasskey();

		expect(entry.entry_type).toBe("passkey");
		expect(entry.id).toBe("11111111-1111-1111-1111-111111111111");
		expect(entry.rp_id).toBe("github.com");
		expect(entry.rp_name).toBe("GitHub");
		expect(entry.credential_id).toBe("3q2-7w");
		expect(entry.user_handle).toBe("AQIDBA");
		expect(entry.user_name).toBe("octocat");
		expect(entry.user_display_name).toBe("The Octocat");
		expect(entry.algorithm).toBe(-7);
		expect(entry.sign_count).toBe(0);
		expect(entry.discoverable).toBe(true);
		expect(entry.transports).toEqual(["internal"]);
		expect(entry.aaguid).toBe("00000000-0000-0000-0000-000000000000");
		expect(entry.tags).toEqual(["work"]);
	});

	it("never carries a private key (negative control on the fixture)", () => {
		// The fixture is the sanitized view: no key field at all.
		expect(PASSKEY_VIEW_JSON).not.toContain("private_key");
		expect(parsePasskey()).not.toHaveProperty("private_key");

		// Negative control: a disk-shaped payload *does* carry the key, so the
		// assertion above is meaningful and not vacuous.
		const diskShaped = JSON.parse(PASSKEY_VIEW_JSON) as Record<string, unknown>;
		diskShaped.private_key = "MIIBVQIBADANBgkqhkiG9w0BAQEFAASCAT8wggE7";
		expect(JSON.stringify(diskShaped)).toContain("private_key");
	});

	it("isPasskeyEntry narrows the widened Entry union", () => {
		const passkey: Entry = parsePasskey();
		const group: Entry = JSON.parse(GROUP_VIEW_JSON) as Entry;
		const data: Entry = JSON.parse(DATA_VIEW_JSON) as Entry;

		expect(isPasskeyEntry(passkey)).toBe(true);
		expect(isPasskeyEntry(group)).toBe(false);
		expect(isPasskeyEntry(data)).toBe(false);

		// The other guards keep their meaning with the widened union.
		expect(isGroupEntry(group)).toBe(true);
		expect(isDataEntry(data)).toBe(true);
		expect(isDataEntry(passkey)).toBe(false);
		expect(isGroupEntry(passkey)).toBe(false);

		// Narrowing gives access to passkey-only fields.
		if (isPasskeyEntry(passkey)) {
			expect(passkey.rp_id).toBe("github.com");
		} else {
			throw new Error("isPasskeyEntry must narrow a passkey entry");
		}
	});

	it("flattens passkey leaves and keeps the tree helpers working", () => {
		const passkey = parsePasskey();
		const group: Entry = {
			entry_type: "group",
			id: "33333333-3333-3333-3333-333333333333",
			name: "Root",
			data_type: "group",
			created_at: "2026-01-02T03:04:05Z",
			updated_at: "2026-01-02T03:04:05Z",
			children: [passkey, JSON.parse(DATA_VIEW_JSON) as Entry],
		};
		const entries: Entry[] = [group, parsePasskey()];

		const flattened = flattenEntries(entries);
		expect(flattened).toHaveLength(4);
		expect(flattened.filter(isPasskeyEntry)).toHaveLength(2);

		expect(getEntryDepth(entries, passkey.id)).toBe(1);
		expect(getParentPath(passkey.id, entries)).toEqual([group.id]);
		expect(findEntryByPath(entries, [group.id, passkey.id])).toEqual(passkey);
		// A passkey leaf is not a group: it cannot be traversed into.
		expect(findEntryByPath(entries, [passkey.id, passkey.id])).toBeNull();
	});

	it("read_vault wrapper returns the sanitized view untouched", async () => {
		const vaultContent: VaultContent = {
			updated_at: "2026-01-02T03:04:05Z",
			hmac: "hmac-value",
			entries: [
				{
					entry_type: "group",
					id: "33333333-3333-3333-3333-333333333333",
					name: "Root",
					data_type: "group",
					created_at: "2026-01-02T03:04:05Z",
					updated_at: "2026-01-02T03:04:05Z",
					children: [parsePasskey()],
				},
			],
		};
		mockInvoke.mockResolvedValue(vaultContent);

		const result = await VaultCommands.read("/tmp/vault.monark", "password");

		expect(mockInvoke).toHaveBeenCalledWith("read_vault", {
			filePath: "/tmp/vault.monark",
			password: "password",
		});
		expect(result).toBe(vaultContent);
		expect(JSON.stringify(result)).not.toContain("private_key");
		expect(flattenEntries(result.entries).filter(isPasskeyEntry)).toHaveLength(
			1,
		);
	});
});
