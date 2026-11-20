/**
 * Per-entry union merge for cloud vault sync.
 *
 * `syncWithCloud` used to be pull-only last-write-wins: whatever the cloud file
 * contained replaced the in-memory entries wholesale, so any entry created on
 * this device but not yet pushed was silently dropped. This module implements
 * the minimal union merge that replaced it (plan §2.7): no sync redesign, no
 * tombstones, no per-field conflict resolution.
 *
 * Merge rules:
 * - Recursive **union by entry id** over the tree. Groups are matched by id and
 *   their children are merged recursively; everything else is matched by id.
 * - Same id on both sides, **data/passkey entries** → the entry with the
 *   **newest `updated_at` wins wholesale** (no field-level merge).
 * - Same id on both sides, **groups** → the group's own metadata (`name`,
 *   `data_type`) is **cloud-authoritative**: the cloud copy always wins. This is
 *   not a preference, it is forced by the vault format: `Entry::Group` carries
 *   no `created_at`/`updated_at` (neither on disk nor in the IPC `EntryView`),
 *   so there is no timestamp to compare. Their children are still merged
 *   recursively, so entries living in a group whose metadata lost are not lost.
 *   Consequence, accepted and documented: renaming a group locally is reverted
 *   by the next sync (and, because the merged view is pushed back, reverted for
 *   every device). Giving groups timestamps would enable a real newest-wins rule
 *   but is a disk-format change — out of scope here.
 * - An id present on only one side is kept as-is.
 * - Deterministic output order: cloud order first, then local-only entries in
 *   local order. For a same-id conflict the winner keeps the cloud position.
 * - Inputs are never mutated: every entry that reaches the output is a fresh
 *   object, recursively — including `fields`/`tags` of data entries and the
 *   children of a group that exists on one side only (structural sharing is not
 *   used, so callers can safely mutate the result).
 * - Passkey views (`entry_type: "passkey"`) merge like any other entry. They
 *   carry no secret material — the backend write-merge re-attaches the private
 *   key from the stored vault by entry id — so nothing here needs to special
 *   case them.
 *
 * Deletion limitation (documented, accepted — plan §2.7):
 * union merge + preserve-on-write means a passkey deleted on device A can be
 * resurrected by a sync from device B that still holds it. Deletions propagate
 * reliably only when all devices sync after the delete. This is the
 * conservative trade: resurrection is recoverable (delete again); silent loss
 * of a passkey is a lockout at the RP. Tombstones are explicitly out of scope
 * (they would redesign sync).
 *
 * @module services/vaultMerge
 */

import type {
	DataEntry,
	Entry,
	Field,
	GroupEntry,
	PasskeyEntry,
} from "../interfaces/vault.interface";
import { isDataEntry, isGroupEntry } from "../interfaces/vault.interface";

/**
 * The entry kinds that carry `updated_at` on the wire (data entries and passkey
 * views). Groups are excluded by construction: the vault format gives them no
 * timestamp, so they can never take part in a newest-wins comparison.
 */
type TimestampedEntry = DataEntry | PasskeyEntry;

/**
 * Returns true when `candidate` should replace `incumbent` for the same id.
 *
 * Only ever called for entries that carry `updated_at` on the wire — data
 * entries and passkey views. Groups have no timestamp at all (see
 * `mergeGroupPair`), so they never reach this function.
 *
 * The comparison is on `updated_at` only: "newest wins wholesale". Ties (equal
 * timestamps, or two unparsable values) keep the incumbent, which is the cloud
 * entry, so the output stays deterministic and a sync never rewrites an entry
 * whose version is indistinguishable from the cloud copy.
 *
 * Timestamps that do not parse as dates fall back to lexicographic comparison,
 * which is correct for the ISO-8601 strings the backend emits (`DateTime<Utc>`
 * serializes as RFC 3339 with a `Z` suffix and fixed-width fields).
 */
function isNewer(
	candidate: TimestampedEntry,
	incumbent: TimestampedEntry,
): boolean {
	const candidateTime = Date.parse(candidate.updated_at);
	const incumbentTime = Date.parse(incumbent.updated_at);

	if (Number.isNaN(candidateTime) || Number.isNaN(incumbentTime)) {
		return candidate.updated_at > incumbent.updated_at;
	}

	return candidateTime > incumbentTime;
}

/**
 * Merges the children of two versions of the same group.
 *
 * The group's own metadata (`name`, `data_type`) is **cloud-authoritative**:
 * the cloud copy always wins, deterministically. The vault format gives groups
 * no `created_at`/`updated_at` (Rust `Entry::Group`), so there is no timestamp
 * to order them by — a "newest wins" rule for groups would be inert. The
 * children are the union of both sides, so a group whose metadata was taken
 * from the cloud never drops entries that only exist in the local copy.
 *
 * Known limitation (documented in `docs/cloud-storage-architecture.md` §8.3): a
 * local group rename is reverted by the next sync. Fixing that requires
 * timestamps on groups, i.e. a vault-format change — out of scope.
 */
function mergeGroupPair(local: GroupEntry, cloud: GroupEntry): GroupEntry {
	return {
		id: cloud.id,
		entry_type: "group",
		name: cloud.name,
		data_type: cloud.data_type,
		children: mergeVaultEntries(local.children, cloud.children),
	};
}

/**
 * Copies an entry that has no counterpart on the other side (and the winning
 * side of a wholesale conflict).
 *
 * The copy is **deep**: `fields`/`tags` of a data entry, `tags`/`transports` of
 * a passkey view and `children` of a group are copied too. A shallow copy would
 * alias those arrays (and their objects) into the merged tree, so a later
 * mutation of the result would write through into the source (Redux state or the
 * freshly read cloud view).
 *
 * Array copies are defensive (`Array.isArray`): the merge is a pure data
 * transform and must not throw on an entry whose optional arrays are missing,
 * which is what a legacy or hand-written vault file can contain.
 */
function cloneEntry(entry: Entry): Entry {
	if (isGroupEntry(entry)) {
		return {
			...entry,
			children: Array.isArray(entry.children)
				? entry.children.map(cloneEntry)
				: [],
		};
	}

	if (isDataEntry(entry)) {
		return {
			...entry,
			fields: cloneFieldArray(entry.fields),
			tags: cloneStringArray(entry.tags),
		};
	}

	// Passkey view: `tags` and `transports` are the only arrays it carries.
	return {
		...entry,
		tags: cloneStringArray(entry.tags),
		transports: cloneStringArray(entry.transports),
	};
}

/**
 * Copies a `Field[]`, element by element. Field objects are flat
 * (`title`/`property`/`value`/`secret`), so a one-level element copy is a full
 * deep copy.
 *
 * Defensive about a missing array: the merge is a pure data transform and must
 * not throw on an entry whose optional arrays are absent, which is what a legacy
 * or hand-written vault file can contain.
 */
function cloneFieldArray(fields: Field[]): Field[] {
	if (!Array.isArray(fields)) {
		return [];
	}

	return fields.map((field) => ({ ...field }));
}

/** Copies a `string[]`, defensively (see `cloneFieldArray`). */
function cloneStringArray(values: string[]): string[] {
	return Array.isArray(values) ? [...values] : [];
}

/**
 * Merges two copies of the same id. Groups recurse into their children;
 * everything else is a wholesale winner-takes-all replacement.
 */
function mergeEntryPair(local: Entry, cloud: Entry): Entry {
	if (isGroupEntry(local) && isGroupEntry(cloud)) {
		return mergeGroupPair(local, cloud);
	}

	// Wholesale: the newest side wins, including its entry_type. A mismatch
	// (e.g. an id that is a group in one vault and a data entry in the other)
	// cannot be reconciled field-by-field, so the newest version is taken as a
	// whole rather than producing a hybrid entry.
	if (isGroupEntry(local) || isGroupEntry(cloud)) {
		// One side is a group and the other is not: there is no timestamp on the
		// group side to compare, so fall back to the cloud copy — the same
		// cloud-authoritative rule groups follow among themselves.
		return cloneEntry(isGroupEntry(cloud) ? cloud : local);
	}

	return cloneEntry(isNewer(local, cloud) ? local : cloud);
}

/**
 * Merges local and cloud vault entries into a single tree.
 *
 * Pure function: it never mutates `local` or `cloud` and always returns newly
 * allocated objects for the entries it emits.
 *
 * @param local - Entries currently held in Redux for this vault (may be empty).
 * @param cloud - Entries just read from the cloud vault file (may be empty).
 * @returns The union tree, cloud order first with local-only entries appended.
 */
export function mergeVaultEntries(local: Entry[], cloud: Entry[]): Entry[] {
	const localById = new Map<string, Entry>();
	for (const entry of local) {
		localById.set(entry.id, entry);
	}

	const merged: Entry[] = [];
	const consumedLocalIds = new Set<string>();

	// Cloud order first: every cloud entry keeps its position, either as-is or
	// replaced by the newer local copy.
	for (const cloudEntry of cloud) {
		const localEntry = localById.get(cloudEntry.id);
		if (localEntry === undefined) {
			merged.push(cloneEntry(cloudEntry));
			continue;
		}

		consumedLocalIds.add(cloudEntry.id);
		merged.push(mergeEntryPair(localEntry, cloudEntry));
	}

	// Local-only entries are appended in local order.
	for (const localEntry of local) {
		if (consumedLocalIds.has(localEntry.id)) {
			continue;
		}

		// A duplicate id inside `local` itself would otherwise be emitted twice;
		// the map above already keeps the last occurrence, so skip earlier ones.
		if (localById.get(localEntry.id) !== localEntry) {
			continue;
		}

		merged.push(cloneEntry(localEntry));
	}

	return merged;
}
