import { describe, expect, it } from "vitest";
import type {
	DataEntry,
	Entry,
	GroupEntry,
	PasskeyEntry,
} from "../../interfaces/vault.interface";
import { mergeVaultEntries } from "../../services/vaultMerge";

/**
 * Contract tests for the per-entry sync union merge (plan §2.7 / T12).
 *
 * The merge is pure, so every case is expressed as plain data in / plain data
 * out. `structuredClone` is used for the no-mutation control: it snapshots the
 * inputs before the call and compares them afterwards.
 */

function dataEntry(
	id: string,
	updatedAt: string,
	overrides: Partial<DataEntry> = {},
): DataEntry {
	return {
		id,
		entry_type: "entry",
		name: `Entry ${id}`,
		data_type: "password",
		created_at: "2026-01-01T00:00:00Z",
		updated_at: updatedAt,
		fields: [],
		tags: [],
		...overrides,
	};
}

function groupEntry(
	id: string,
	updatedAt: string,
	children: Entry[] = [],
	overrides: Partial<GroupEntry> = {},
): GroupEntry {
	return {
		id,
		entry_type: "group",
		name: `Group ${id}`,
		data_type: "group",
		created_at: "2026-01-01T00:00:00Z",
		updated_at: updatedAt,
		children,
		...overrides,
	};
}

function passkeyEntry(
	id: string,
	updatedAt: string,
	overrides: Partial<PasskeyEntry> = {},
): PasskeyEntry {
	return {
		id,
		entry_type: "passkey",
		name: "GitHub",
		created_at: "2026-01-01T00:00:00Z",
		updated_at: updatedAt,
		tags: [],
		rp_id: "github.com",
		rp_name: "GitHub",
		credential_id: "cred-1",
		user_handle: "AQIDBA",
		user_name: "octocat",
		user_display_name: "The Octocat",
		algorithm: -7,
		sign_count: 0,
		discoverable: true,
		transports: ["internal"],
		aaguid: "00000000-0000-0000-0000-000000000000",
		...overrides,
	};
}

describe("mergeVaultEntries — union", () => {
	it("keeps local-only and cloud-only entries", () => {
		const local = [dataEntry("local-only", "2026-01-02T00:00:00Z")];
		const cloud = [dataEntry("cloud-only", "2026-01-02T00:00:00Z")];

		const merged = mergeVaultEntries(local, cloud);

		expect(merged.map((entry) => entry.id)).toEqual([
			"cloud-only",
			"local-only",
		]);
	});

	it("returns the cloud entries when local is empty", () => {
		const cloud = [
			dataEntry("a", "2026-01-02T00:00:00Z"),
			dataEntry("b", "2026-01-02T00:00:00Z"),
		];

		expect(mergeVaultEntries([], cloud)).toEqual(cloud);
	});

	it("returns the local entries when cloud is empty", () => {
		const local = [
			dataEntry("a", "2026-01-02T00:00:00Z"),
			dataEntry("b", "2026-01-02T00:00:00Z"),
		];

		expect(mergeVaultEntries(local, [])).toEqual(local);
	});

	it("returns an empty tree when both sides are empty", () => {
		expect(mergeVaultEntries([], [])).toEqual([]);
	});
});

describe("mergeVaultEntries — same-id conflict", () => {
	it("takes the cloud version when the cloud copy is newer", () => {
		const local = [
			dataEntry("shared", "2026-01-02T00:00:00Z", { name: "local" }),
		];
		const cloud = [
			dataEntry("shared", "2026-01-03T00:00:00Z", { name: "cloud" }),
		];

		const merged = mergeVaultEntries(local, cloud);

		expect(merged).toHaveLength(1);
		expect(merged[0].name).toBe("cloud");
		expect(merged[0].updated_at).toBe("2026-01-03T00:00:00Z");
	});

	it("takes the local version when the local copy is newer", () => {
		const local = [
			dataEntry("shared", "2026-01-04T00:00:00Z", { name: "local" }),
		];
		const cloud = [
			dataEntry("shared", "2026-01-03T00:00:00Z", { name: "cloud" }),
		];

		const merged = mergeVaultEntries(local, cloud);

		expect(merged).toHaveLength(1);
		expect(merged[0].name).toBe("local");
		expect(merged[0].updated_at).toBe("2026-01-04T00:00:00Z");
	});

	it("keeps the cloud copy on an exact timestamp tie", () => {
		const local = [
			dataEntry("shared", "2026-01-03T00:00:00Z", { name: "local" }),
		];
		const cloud = [
			dataEntry("shared", "2026-01-03T00:00:00Z", { name: "cloud" }),
		];

		expect(mergeVaultEntries(local, cloud)[0].name).toBe("cloud");
	});

	it("wins wholesale: no field-level merge happens", () => {
		const local = [
			dataEntry("shared", "2026-01-04T00:00:00Z", {
				name: "local",
				tags: ["local-tag"],
				fields: [
					{ title: "user", property: "text", value: "local", secret: false },
				],
			}),
		];
		const cloud = [
			dataEntry("shared", "2026-01-03T00:00:00Z", {
				name: "cloud",
				tags: ["cloud-tag"],
				fields: [
					{ title: "user", property: "text", value: "cloud", secret: false },
				],
			}),
		];

		const merged = mergeVaultEntries(local, cloud);

		expect(merged[0]).toMatchObject({
			name: "local",
			tags: ["local-tag"],
			fields: [
				{ title: "user", property: "text", value: "local", secret: false },
			],
		});
	});

	it("compares timestamps as instants, not as strings", () => {
		// Same instant, different offset notation: no winner, cloud is kept.
		const local = [
			dataEntry("shared", "2026-01-03T01:00:00+01:00", { name: "local" }),
		];
		const cloud = [
			dataEntry("shared", "2026-01-03T00:00:00Z", { name: "cloud" }),
		];

		expect(mergeVaultEntries(local, cloud)[0].name).toBe("cloud");
	});
});

describe("mergeVaultEntries — nested groups", () => {
	it("merges the children of a group present on both sides", () => {
		const local = [
			groupEntry("group", "2026-01-02T00:00:00Z", [
				dataEntry("local-child", "2026-01-02T00:00:00Z"),
			]),
		];
		const cloud = [
			groupEntry("group", "2026-01-02T00:00:00Z", [
				dataEntry("cloud-child", "2026-01-02T00:00:00Z"),
			]),
		];

		const merged = mergeVaultEntries(local, cloud);

		expect(merged).toHaveLength(1);
		const group = merged[0] as GroupEntry;
		expect(group.entry_type).toBe("group");
		expect(group.children.map((child) => child.id)).toEqual([
			"cloud-child",
			"local-child",
		]);
	});

	it("keeps a group that exists only on one side, whole", () => {
		const localOnly = groupEntry("local-group", "2026-01-02T00:00:00Z", [
			dataEntry("nested", "2026-01-02T00:00:00Z"),
		]);
		const cloudOnly = groupEntry("cloud-group", "2026-01-02T00:00:00Z", [
			dataEntry("nested-cloud", "2026-01-02T00:00:00Z"),
		]);

		const merged = mergeVaultEntries([localOnly], [cloudOnly]);

		expect(merged.map((entry) => entry.id)).toEqual([
			"cloud-group",
			"local-group",
		]);
		expect((merged[0] as GroupEntry).children.map((c) => c.id)).toEqual([
			"nested-cloud",
		]);
		expect((merged[1] as GroupEntry).children.map((c) => c.id)).toEqual([
			"nested",
		]);
	});

	it("recurses through several levels", () => {
		const local = [
			groupEntry("outer", "2026-01-02T00:00:00Z", [
				groupEntry("inner", "2026-01-02T00:00:00Z", [
					dataEntry("local-leaf", "2026-01-02T00:00:00Z"),
				]),
			]),
		];
		const cloud = [
			groupEntry("outer", "2026-01-02T00:00:00Z", [
				groupEntry("inner", "2026-01-02T00:00:00Z", [
					dataEntry("cloud-leaf", "2026-01-02T00:00:00Z"),
				]),
			]),
		];

		const merged = mergeVaultEntries(local, cloud);
		const inner = (merged[0] as GroupEntry).children[0] as GroupEntry;

		expect(inner.children.map((child) => child.id)).toEqual([
			"cloud-leaf",
			"local-leaf",
		]);
	});

	it("keeps the losing group's children when the group metadata conflicts", () => {
		// The group was renamed in the cloud (newer), but the local copy holds an
		// entry the cloud does not know about. Renaming must not drop it.
		const local = [
			groupEntry(
				"group",
				"2026-01-02T00:00:00Z",
				[dataEntry("local-child", "2026-01-02T00:00:00Z")],
				{ name: "old name" },
			),
		];
		const cloud = [
			groupEntry(
				"group",
				"2026-01-03T00:00:00Z",
				[dataEntry("cloud-child", "2026-01-02T00:00:00Z")],
				{ name: "new name" },
			),
		];

		const merged = mergeVaultEntries(local, cloud);
		const group = merged[0] as GroupEntry;

		expect(group.name).toBe("new name");
		expect(group.children.map((child) => child.id)).toEqual([
			"cloud-child",
			"local-child",
		]);
	});

	it("resolves a same-id child conflict inside a group", () => {
		const local = [
			groupEntry("group", "2026-01-02T00:00:00Z", [
				dataEntry("child", "2026-01-05T00:00:00Z", { name: "local" }),
			]),
		];
		const cloud = [
			groupEntry("group", "2026-01-02T00:00:00Z", [
				dataEntry("child", "2026-01-03T00:00:00Z", { name: "cloud" }),
			]),
		];

		const merged = mergeVaultEntries(local, cloud);
		const group = merged[0] as GroupEntry;

		expect(group.children).toHaveLength(1);
		expect(group.children[0].name).toBe("local");
	});
});

describe("mergeVaultEntries — passkey views", () => {
	it("keeps a cloud-only passkey without any key material", () => {
		const cloud = [passkeyEntry("pk", "2026-01-02T00:00:00Z")];

		const merged = mergeVaultEntries([], cloud);

		expect(merged).toHaveLength(1);
		expect(merged[0].entry_type).toBe("passkey");
		const serialized = JSON.stringify(merged[0]);
		expect(serialized).not.toContain("private_key");
		expect(serialized).not.toContain("privateKey");
		expect(serialized).toContain("cred-1");
	});

	it("keeps locally edited passkey metadata when the local copy is newer", () => {
		const local = [
			passkeyEntry("pk", "2026-01-05T00:00:00Z", {
				name: "GitHub work",
				tags: ["work"],
				user_name: "octocat-work",
			}),
		];
		const cloud = [
			passkeyEntry("pk", "2026-01-03T00:00:00Z", {
				name: "GitHub",
				tags: [],
				user_name: "octocat",
			}),
		];

		const merged = mergeVaultEntries(local, cloud);

		expect(merged).toHaveLength(1);
		expect(merged[0]).toMatchObject({
			entry_type: "passkey",
			name: "GitHub work",
			tags: ["work"],
			user_name: "octocat-work",
		});
	});

	it("merges a passkey nested in a group like any other entry", () => {
		const local = [
			groupEntry("group", "2026-01-02T00:00:00Z", [
				passkeyEntry("pk", "2026-01-05T00:00:00Z", { name: "local name" }),
			]),
		];
		const cloud = [
			groupEntry("group", "2026-01-02T00:00:00Z", [
				passkeyEntry("pk", "2026-01-03T00:00:00Z", { name: "cloud name" }),
			]),
		];

		const merged = mergeVaultEntries(local, cloud);
		const group = merged[0] as GroupEntry;

		expect(group.children).toHaveLength(1);
		expect(group.children[0].name).toBe("local name");
	});
});

describe("mergeVaultEntries — idempotence", () => {
	it("mergeVaultEntries(x, x) deep-equals x", () => {
		const x: Entry[] = [
			dataEntry("a", "2026-01-02T00:00:00Z"),
			groupEntry("g", "2026-01-02T00:00:00Z", [
				passkeyEntry("pk", "2026-01-02T00:00:00Z"),
			]),
		];

		expect(mergeVaultEntries(x, x)).toEqual(x);
	});

	it("mergeVaultEntries(merge(a, b), b) deep-equals merge(a, b)", () => {
		const a: Entry[] = [
			dataEntry("local-only", "2026-01-02T00:00:00Z"),
			dataEntry("shared", "2026-01-06T00:00:00Z", { name: "local wins" }),
			groupEntry("g", "2026-01-02T00:00:00Z", [
				dataEntry("a-child", "2026-01-02T00:00:00Z"),
			]),
		];
		const b: Entry[] = [
			dataEntry("cloud-only", "2026-01-02T00:00:00Z"),
			dataEntry("shared", "2026-01-03T00:00:00Z", { name: "cloud loses" }),
			groupEntry("g", "2026-01-02T00:00:00Z", [
				dataEntry("b-child", "2026-01-02T00:00:00Z"),
			]),
		];

		const once = mergeVaultEntries(a, b);
		const twice = mergeVaultEntries(once, b);

		expect(twice).toEqual(once);
	});
});

describe("mergeVaultEntries — no mutation", () => {
	it("leaves both inputs deep-equal to their pre-call snapshots", () => {
		const local: Entry[] = [
			dataEntry("local-only", "2026-01-02T00:00:00Z"),
			dataEntry("shared", "2026-01-06T00:00:00Z", { name: "local wins" }),
			groupEntry("g", "2026-01-02T00:00:00Z", [
				dataEntry("a-child", "2026-01-02T00:00:00Z"),
				passkeyEntry("pk", "2026-01-04T00:00:00Z"),
			]),
		];
		const cloud: Entry[] = [
			dataEntry("cloud-only", "2026-01-02T00:00:00Z"),
			dataEntry("shared", "2026-01-03T00:00:00Z", { name: "cloud loses" }),
			groupEntry("g", "2026-01-05T00:00:00Z", [
				dataEntry("b-child", "2026-01-02T00:00:00Z"),
			]),
		];
		const localSnapshot = structuredClone(local);
		const cloudSnapshot = structuredClone(cloud);

		mergeVaultEntries(local, cloud);

		expect(local).toEqual(localSnapshot);
		expect(cloud).toEqual(cloudSnapshot);
	});

	it("does not alias input objects into the output", () => {
		const local = [dataEntry("a", "2026-01-02T00:00:00Z")];
		const cloud = [dataEntry("b", "2026-01-02T00:00:00Z")];

		const merged = mergeVaultEntries(local, cloud);

		expect(merged[0]).not.toBe(cloud[0]);
		expect(merged[1]).not.toBe(local[0]);
		// Mutating the output must not leak back into the inputs.
		merged[0].name = "mutated";
		expect(cloud[0].name).toBe("Entry b");
	});

	it("does not alias group children into the output", () => {
		const local = [
			groupEntry("g", "2026-01-02T00:00:00Z", [
				dataEntry("child", "2026-01-02T00:00:00Z"),
			]),
		];
		const cloud = [groupEntry("g", "2026-01-02T00:00:00Z", [])];

		const merged = mergeVaultEntries(local, cloud);
		const group = merged[0] as GroupEntry;

		expect(group.children[0]).not.toBe(local[0].children[0]);
	});

	it("does not alias nested children of a group that exists on one side only", () => {
		// Negative control for the shallow-copy path: a group kept "whole" must
		// still have its children copied, or a later mutation of the merged tree
		// would write through into the input.
		const nested = groupEntry("inner", "2026-01-02T00:00:00Z", [
			dataEntry("leaf", "2026-01-02T00:00:00Z"),
		]);
		const local = [groupEntry("outer", "2026-01-02T00:00:00Z", [nested])];
		const localSnapshot = structuredClone(local);

		const merged = mergeVaultEntries(local, []);
		const outer = merged[0] as GroupEntry;
		const inner = outer.children[0] as GroupEntry;

		expect(inner).not.toBe(nested);
		expect(inner.children[0]).not.toBe(nested.children[0]);

		(inner.children[0] as DataEntry).name = "mutated";
		expect(local).toEqual(localSnapshot);
	});
});

describe("mergeVaultEntries — deterministic order", () => {
	it("puts cloud entries first and appends local-only entries in local order", () => {
		const local = [
			dataEntry("local-1", "2026-01-02T00:00:00Z"),
			dataEntry("shared", "2026-01-02T00:00:00Z"),
			dataEntry("local-2", "2026-01-02T00:00:00Z"),
		];
		const cloud = [
			dataEntry("cloud-1", "2026-01-02T00:00:00Z"),
			dataEntry("shared", "2026-01-02T00:00:00Z"),
			dataEntry("cloud-2", "2026-01-02T00:00:00Z"),
		];

		expect(mergeVaultEntries(local, cloud).map((entry) => entry.id)).toEqual([
			"cloud-1",
			"shared",
			"cloud-2",
			"local-1",
			"local-2",
		]);
	});

	it("keeps the cloud position when the local copy wins the conflict", () => {
		const local = [
			dataEntry("local-1", "2026-01-02T00:00:00Z"),
			dataEntry("shared", "2026-01-09T00:00:00Z", { name: "local" }),
		];
		const cloud = [
			dataEntry("shared", "2026-01-02T00:00:00Z", { name: "cloud" }),
			dataEntry("cloud-2", "2026-01-02T00:00:00Z"),
		];

		const merged = mergeVaultEntries(local, cloud);

		expect(merged.map((entry) => entry.id)).toEqual([
			"shared",
			"cloud-2",
			"local-1",
		]);
		expect(merged[0].name).toBe("local");
	});

	it("is stable across repeated calls with the same inputs", () => {
		const local = [
			dataEntry("l1", "2026-01-02T00:00:00Z"),
			dataEntry("l2", "2026-01-02T00:00:00Z"),
		];
		const cloud = [
			dataEntry("c1", "2026-01-02T00:00:00Z"),
			dataEntry("c2", "2026-01-02T00:00:00Z"),
		];

		expect(mergeVaultEntries(local, cloud)).toEqual(
			mergeVaultEntries(local, cloud),
		);
	});
});
