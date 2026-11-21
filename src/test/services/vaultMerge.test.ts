import { describe, expect, it } from "vitest";
import type {
	DataEntry,
	Entry,
	GroupEntry,
	PasskeyEntry,
} from "../../interfaces/vault.interface";
import {
	mergeVaultEntries,
	reconcilePasskeysToCloud,
} from "../../services/vaultMerge";

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

/**
 * Builds a group entry in the shape the backend actually emits.
 *
 * Deliberately takes **no** timestamp: `Entry::Group` in Rust has no
 * `created_at`/`updated_at`, so a fixture that stamps them would be testing data
 * no client can ever receive (review core MAJOR-1). If you find yourself wanting
 * to pass a timestamp here, the merge rule you are testing is the wrong one.
 */
function groupEntry(
	id: string,
	children: Entry[] = [],
	overrides: Partial<GroupEntry> = {},
): GroupEntry {
	return {
		id,
		entry_type: "group",
		name: `Group ${id}`,
		data_type: "group",
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
			groupEntry("group", [dataEntry("local-child", "2026-01-02T00:00:00Z")]),
		];
		const cloud = [
			groupEntry("group", [dataEntry("cloud-child", "2026-01-02T00:00:00Z")]),
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
		const localOnly = groupEntry("local-group", [
			dataEntry("nested", "2026-01-02T00:00:00Z"),
		]);
		const cloudOnly = groupEntry("cloud-group", [
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
			groupEntry("outer", [
				groupEntry("inner", [dataEntry("local-leaf", "2026-01-02T00:00:00Z")]),
			]),
		];
		const cloud = [
			groupEntry("outer", [
				groupEntry("inner", [dataEntry("cloud-leaf", "2026-01-02T00:00:00Z")]),
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
		// The group was renamed in the cloud, but the local copy holds an entry
		// the cloud does not know about. Taking the cloud metadata must not drop
		// it.
		const local = [
			groupEntry("group", [dataEntry("local-child", "2026-01-02T00:00:00Z")], {
				name: "old name",
			}),
		];
		const cloud = [
			groupEntry("group", [dataEntry("cloud-child", "2026-01-02T00:00:00Z")], {
				name: "new name",
			}),
		];

		const merged = mergeVaultEntries(local, cloud);
		const group = merged[0] as GroupEntry;

		expect(group.name).toBe("new name");
		expect(group.children.map((child) => child.id)).toEqual([
			"cloud-child",
			"local-child",
		]);
	});

	// Group metadata is cloud-authoritative: `Entry::Group` has no timestamps on
	// the wire, so there is nothing to order two copies of a group by. These two
	// tests pin the real rule in both directions — the local group is "newer" in
	// every sense a fixture could express (its children carry later timestamps)
	// and its metadata still loses. A test asserting the opposite could only pass
	// on data the backend cannot produce (review core MAJOR-1).
	it("takes the cloud group metadata even when the local children are newer", () => {
		const local = [
			groupEntry(
				"group",
				[dataEntry("child", "2026-06-01T00:00:00Z", { name: "local" })],
				{ name: "local name", data_type: "local-type" },
			),
		];
		const cloud = [
			groupEntry(
				"group",
				[dataEntry("child", "2026-01-01T00:00:00Z", { name: "cloud" })],
				{ name: "cloud name", data_type: "cloud-type" },
			),
		];

		const merged = mergeVaultEntries(local, cloud);
		const group = merged[0] as GroupEntry;

		expect(group.name).toBe("cloud name");
		expect(group.data_type).toBe("cloud-type");
		// The children still resolve by their own timestamps: local wins there.
		expect(group.children[0].name).toBe("local");
	});

	it("takes the cloud group metadata when only the local group was renamed", () => {
		const local = [groupEntry("group", [], { name: "renamed locally" })];
		const cloud = [groupEntry("group", [], { name: "cloud name" })];

		const merged = mergeVaultEntries(local, cloud);

		expect((merged[0] as GroupEntry).name).toBe("cloud name");
	});

	it("emits group metadata with exactly the wire fields", () => {
		// Pins the shape the merge emits against the Rust `EntryView::Group`
		// member set. If a timestamp ever appears here, the type and the backend
		// have diverged again.
		const local = [groupEntry("group", [], { name: "local name" })];
		const cloud = [groupEntry("group", [], { name: "cloud name" })];

		const merged = mergeVaultEntries(local, cloud);

		expect(Object.keys(merged[0]).sort()).toEqual([
			"children",
			"data_type",
			"entry_type",
			"id",
			"name",
		]);
	});

	it("resolves a same-id child conflict inside a group", () => {
		const local = [
			groupEntry("group", [
				dataEntry("child", "2026-01-05T00:00:00Z", { name: "local" }),
			]),
		];
		const cloud = [
			groupEntry("group", [
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
			groupEntry("group", [
				passkeyEntry("pk", "2026-01-05T00:00:00Z", { name: "local name" }),
			]),
		];
		const cloud = [
			groupEntry("group", [
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
			groupEntry("g", [passkeyEntry("pk", "2026-01-02T00:00:00Z")]),
		];

		expect(mergeVaultEntries(x, x)).toEqual(x);
	});

	it("mergeVaultEntries(merge(a, b), b) deep-equals merge(a, b)", () => {
		const a: Entry[] = [
			dataEntry("local-only", "2026-01-02T00:00:00Z"),
			dataEntry("shared", "2026-01-06T00:00:00Z", { name: "local wins" }),
			groupEntry("g", [dataEntry("a-child", "2026-01-02T00:00:00Z")]),
		];
		const b: Entry[] = [
			dataEntry("cloud-only", "2026-01-02T00:00:00Z"),
			dataEntry("shared", "2026-01-03T00:00:00Z", { name: "cloud loses" }),
			groupEntry("g", [dataEntry("b-child", "2026-01-02T00:00:00Z")]),
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
			groupEntry("g", [
				dataEntry("a-child", "2026-01-02T00:00:00Z"),
				passkeyEntry("pk", "2026-01-04T00:00:00Z"),
			]),
		];
		const cloud: Entry[] = [
			dataEntry("cloud-only", "2026-01-02T00:00:00Z"),
			dataEntry("shared", "2026-01-03T00:00:00Z", { name: "cloud loses" }),
			groupEntry("g", [dataEntry("b-child", "2026-01-02T00:00:00Z")]),
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
			groupEntry("g", [dataEntry("child", "2026-01-02T00:00:00Z")]),
		];
		const cloud = [groupEntry("g", [])];

		const merged = mergeVaultEntries(local, cloud);
		const group = merged[0] as GroupEntry;

		expect(group.children[0]).not.toBe(local[0].children[0]);
	});

	// MENOR-4 / E13a: `cloneEntry` used to be `{...entry}`, so a data entry's
	// `fields` and `tags` arrays (and the field objects inside them) were shared
	// with the input. The module claims "no aliasing"; these tests make the claim
	// true and keep it true.
	it("does not alias fields/tags of a cloud-only data entry", () => {
		const cloud = [
			dataEntry("cloud-only", "2026-01-02T00:00:00Z", {
				tags: ["cloud-tag"],
				fields: [
					{ title: "user", property: "text", value: "octocat", secret: false },
				],
			}),
		];
		const cloudSnapshot = structuredClone(cloud);

		const merged = mergeVaultEntries([], cloud);
		const entry = merged[0] as DataEntry;

		expect(entry.fields).not.toBe(cloud[0].fields);
		expect(entry.fields[0]).not.toBe(cloud[0].fields[0]);
		expect(entry.tags).not.toBe(cloud[0].tags);

		entry.fields[0].value = "mutated";
		entry.tags.push("mutated");

		expect(cloud).toEqual(cloudSnapshot);
	});

	it("does not alias fields/tags of a local-only data entry", () => {
		const local = [
			dataEntry("local-only", "2026-01-02T00:00:00Z", {
				tags: ["local-tag"],
				fields: [
					{ title: "user", property: "text", value: "octocat", secret: false },
				],
			}),
		];
		const localSnapshot = structuredClone(local);

		const merged = mergeVaultEntries(local, []);
		const entry = merged[0] as DataEntry;

		entry.fields[0].value = "mutated";
		entry.tags.push("mutated");

		expect(local).toEqual(localSnapshot);
	});

	it("does not alias fields/tags of the winning side of a conflict", () => {
		const local = [
			dataEntry("shared", "2026-01-06T00:00:00Z", {
				tags: ["local-tag"],
				fields: [
					{ title: "user", property: "text", value: "local", secret: false },
				],
			}),
		];
		const cloud = [
			dataEntry("shared", "2026-01-02T00:00:00Z", {
				tags: ["cloud-tag"],
				fields: [
					{ title: "user", property: "text", value: "cloud", secret: false },
				],
			}),
		];
		const localSnapshot = structuredClone(local);

		const merged = mergeVaultEntries(local, cloud);
		const entry = merged[0] as DataEntry;

		expect(entry.name).toBe("Entry shared");
		entry.fields[0].value = "mutated";
		entry.tags.push("mutated");

		expect(local).toEqual(localSnapshot);
	});

	it("does not alias tags/transports of a passkey view", () => {
		const cloud = [
			passkeyEntry("pk", "2026-01-02T00:00:00Z", {
				tags: ["cloud-tag"],
				transports: ["internal"],
			}),
		];
		const cloudSnapshot = structuredClone(cloud);

		const merged = mergeVaultEntries([], cloud);
		const entry = merged[0] as PasskeyEntry;

		entry.tags.push("mutated");
		entry.transports.push("mutated");

		expect(cloud).toEqual(cloudSnapshot);
	});

	it("does not alias nested children of a group that exists on one side only", () => {
		// Negative control for the shallow-copy path: a group kept "whole" must
		// still have its children copied, or a later mutation of the merged tree
		// would write through into the input.
		const nested = groupEntry("inner", [
			dataEntry("leaf", "2026-01-02T00:00:00Z"),
		]);
		const local = [groupEntry("outer", [nested])];
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
/**
 * `reconcilePasskeysToCloud` — the MAYOR-1 sync policy step.
 *
 * The cloud file is the only authority on passkey *existence* (key material
 * never crosses IPC and the backend write-merge fails closed on an unknown id),
 * so a passkey view the fresh cloud read does not contain is a phantom and must
 * not be pushed. Everything else — Data entries, groups, cloud-present
 * passkeys — must survive untouched.
 */
describe("reconcilePasskeysToCloud", () => {
	it("T2a: drops a root-level passkey the cloud file does not contain", () => {
		const merged = [
			passkeyEntry("phantom", "2026-01-02T00:00:00Z"),
			dataEntry("data-1", "2026-01-02T00:00:00Z"),
		];

		const { entries, dropped } = reconcilePasskeysToCloud(merged, [
			dataEntry("data-1", "2026-01-02T00:00:00Z"),
		]);

		expect(entries.map((entry) => entry.id)).toEqual(["data-1"]);
		expect(dropped.map((passkey) => passkey.id)).toEqual(["phantom"]);
	});

	it("T2b: drops a nested phantom and keeps the (now empty) group", () => {
		const merged = [
			groupEntry("group-1", [passkeyEntry("phantom", "2026-01-02T00:00:00Z")]),
		];

		const { entries, dropped } = reconcilePasskeysToCloud(merged, []);

		expect(entries).toHaveLength(1);
		const group = entries[0] as GroupEntry;
		expect(group.entry_type).toBe("group");
		expect(group.id).toBe("group-1");
		expect(group.children).toEqual([]);
		expect(dropped.map((passkey) => passkey.id)).toEqual(["phantom"]);
	});

	it("T2c: keeps a cloud-present passkey even when the local copy is newer", () => {
		const merged = [
			passkeyEntry("pk", "2026-01-05T00:00:00Z", { name: "local name" }),
		];
		const cloud = [
			passkeyEntry("pk", "2026-01-02T00:00:00Z", { name: "cloud name" }),
		];

		const { entries, dropped } = reconcilePasskeysToCloud(merged, cloud);

		expect(dropped).toEqual([]);
		expect(entries).toHaveLength(1);
		expect(entries[0]).toMatchObject({ id: "pk", name: "local name" });
	});

	it("T2d: keeps local-only Data entries and local-only groups", () => {
		const merged = [
			dataEntry("local-data", "2026-01-02T00:00:00Z"),
			groupEntry("local-group", [
				dataEntry("nested-data", "2026-01-02T00:00:00Z"),
			]),
		];

		const { entries, dropped } = reconcilePasskeysToCloud(merged, []);

		expect(dropped).toEqual([]);
		expect(entries.map((entry) => entry.id)).toEqual([
			"local-data",
			"local-group",
		]);
		const group = entries[1] as GroupEntry;
		expect(group.children.map((entry) => entry.id)).toEqual(["nested-data"]);
	});

	it("T2e: keeps cloud-present passkeys that are already in the merged tree", () => {
		// Reconciliation never *adds* entries: pulling cloud-only passkeys in is
		// the union merge's job (it runs first). What matters here is that a
		// passkey the cloud holds is never dropped, whether it sits at the root
		// or inside a group.
		const cloud = [
			passkeyEntry("cloud-pk", "2026-01-02T00:00:00Z"),
			groupEntry("group-1", [
				passkeyEntry("nested-cloud-pk", "2026-01-02T00:00:00Z"),
			]),
		];
		const merged = mergeVaultEntries([], cloud);

		const { entries, dropped } = reconcilePasskeysToCloud(merged, cloud);

		expect(dropped).toEqual([]);
		expect(entries.map((entry) => entry.id)).toEqual(["cloud-pk", "group-1"]);
		const group = entries[1] as GroupEntry;
		expect(group.children.map((entry) => entry.id)).toEqual([
			"nested-cloud-pk",
		]);
	});

	it("T2f: returns the dropped views (id + name) in tree order", () => {
		const merged = [
			passkeyEntry("first", "2026-01-02T00:00:00Z", { name: "First" }),
			groupEntry("group-1", [
				passkeyEntry("second", "2026-01-02T00:00:00Z", { name: "Second" }),
				passkeyEntry("kept", "2026-01-02T00:00:00Z", { name: "Kept" }),
			]),
			passkeyEntry("third", "2026-01-02T00:00:00Z", { name: "Third" }),
		];
		const cloud = [passkeyEntry("kept", "2026-01-02T00:00:00Z")];

		const { dropped } = reconcilePasskeysToCloud(merged, cloud);

		expect(dropped.map((passkey) => [passkey.id, passkey.name])).toEqual([
			["first", "First"],
			["second", "Second"],
			["third", "Third"],
		]);
	});

	it("T2g: does not mutate the inputs and emits fresh objects", () => {
		const merged = [
			groupEntry("group-1", [
				passkeyEntry("phantom", "2026-01-02T00:00:00Z"),
				dataEntry("data-1", "2026-01-02T00:00:00Z", {
					fields: [
						{
							title: "user",
							property: "text",
							value: "octocat",
							secret: false,
						},
					],
					tags: ["work"],
				}),
			]),
			passkeyEntry("kept", "2026-01-02T00:00:00Z"),
		];
		const cloud = [passkeyEntry("kept", "2026-01-02T00:00:00Z")];
		const mergedSnapshot = structuredClone(merged);
		const cloudSnapshot = structuredClone(cloud);

		const { entries } = reconcilePasskeysToCloud(merged, cloud);

		// Inputs untouched.
		expect(merged).toEqual(mergedSnapshot);
		expect(cloud).toEqual(cloudSnapshot);

		// No aliasing: mutating the result must not write through into the input.
		const group = entries[0] as GroupEntry;
		expect(group).not.toBe(merged[0]);
		const data = group.children[0] as DataEntry;
		expect(data).not.toBe((merged[0] as GroupEntry).children[1]);
		expect(data.fields).not.toBe((merged[0] as GroupEntry).children[1]);
		data.name = "mutated";
		data.fields.push({
			title: "extra",
			property: "text",
			value: "x",
			secret: false,
		});
		data.tags.push("mutated");

		const original = (merged[0] as GroupEntry).children[1] as DataEntry;
		expect(original.name).toBe("Entry data-1");
		expect(original.fields).toHaveLength(1);
		expect(original.tags).toEqual(["work"]);
	});

	it("T2h: is idempotent", () => {
		const merged = [
			passkeyEntry("phantom", "2026-01-02T00:00:00Z"),
			groupEntry("group-1", [
				passkeyEntry("nested-phantom", "2026-01-02T00:00:00Z"),
				dataEntry("data-1", "2026-01-02T00:00:00Z"),
			]),
		];
		const cloud = [dataEntry("data-1", "2026-01-02T00:00:00Z")];

		const once = reconcilePasskeysToCloud(merged, cloud);
		const twice = reconcilePasskeysToCloud(once.entries, cloud);

		expect(twice.entries).toEqual(once.entries);
		expect(twice.dropped).toEqual([]);
	});

	/**
	 * NC (negative control) for T2: the *union merge alone* still keeps the
	 * local-only passkey. This pins that the reconciliation — not a change to
	 * the merge's contract — is the piece doing the drop. If someone "fixes"
	 * MAYOR-1 by making `mergeVaultEntries` drop local-only passkeys, this goes
	 * red (and so do the merge's own union tests).
	 */
	it("NC: the union merge alone still keeps the local-only passkey", () => {
		const phantom = passkeyEntry("phantom", "2026-01-02T00:00:00Z");

		const merged = mergeVaultEntries([phantom], []);

		expect(merged.map((entry) => entry.id)).toEqual(["phantom"]);
	});
});
