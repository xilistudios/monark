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
 * - Same id on both sides → the entry with the **newest `updated_at` wins
 *   wholesale** (no field-level merge). Groups are subject to the same rule for
 *   their own metadata, but their children are still merged recursively so that
 *   entries living in a group whose metadata lost the conflict are not lost.
 * - An id present on only one side is kept as-is.
 * - Deterministic output order: cloud order first, then local-only entries in
 *   local order. For a same-id conflict the winner keeps the cloud position.
 * - Inputs are never mutated: every entry that reaches the output is a fresh
 *   object, recursively — including the children of a group that exists on one
 *   side only (structural sharing is not used, so callers can safely mutate the
 *   result).
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

import type { Entry, GroupEntry } from "../interfaces/vault.interface";
import { isGroupEntry } from "../interfaces/vault.interface";

/**
 * Returns true when `candidate` should replace `incumbent` for the same id.
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
function isNewer(candidate: Entry, incumbent: Entry): boolean {
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
 * The winner's copy supplies the group metadata; its children are the union of
 * both sides' children, so a newer group rename never drops entries that only
 * exist in the losing copy.
 */
function mergeGroupPair(local: GroupEntry, cloud: GroupEntry): GroupEntry {
	const winner = isNewer(local, cloud) ? local : cloud;

	return {
		...winner,
		children: mergeVaultEntries(local.children, cloud.children),
	};
}

/**
 * Copies an entry that has no counterpart on the other side.
 *
 * Groups are copied recursively: a shallow copy would alias the input's
 * `children` array and its entries into the merged tree, so a later mutation of
 * the result would write through into the source (Redux state or the freshly
 * read cloud view).
 */
function cloneEntry(entry: Entry): Entry {
	if (isGroupEntry(entry)) {
		return { ...entry, children: entry.children.map(cloneEntry) };
	}

	return { ...entry };
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
