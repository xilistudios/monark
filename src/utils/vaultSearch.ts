import {
	type DataEntry,
	type Entry,
	isDataEntry,
	isGroupEntry,
} from "../interfaces/vault.interface";

/**
 * Flattens a hierarchical structure of vault entries into a flat array.
 * Only includes DataEntry objects, skipping GroupEntry objects.
 * For each DataEntry, includes the entry itself and the path to its parent group.
 *
 * @param entries - Array of Entry objects to flatten
 * @param basePath - The current path in the hierarchy (used in recursion)
 * @returns Array of objects containing DataEntry and its path
 *
 * @example
 * // For entry in /groupA/groupB, path would be ['groupA', 'groupB']
 * const flattened = flattenEntries(entries);
 */
export function flattenEntries(
	entries: Entry[],
	basePath: string[] = [],
): { entry: DataEntry; path: string[] }[] {
	const result: { entry: DataEntry; path: string[] }[] = [];

	for (const entry of entries) {
		if (isDataEntry(entry)) {
			// For DataEntry, add to result with current path
			result.push({ entry, path: basePath });
		} else if (isGroupEntry(entry)) {
			// For  recursively process children with updated path
			const newPath = [...basePath, entry.id];
			result.push(...flattenEntries(entry.children, newPath));
		}
	}

	return result;
}
