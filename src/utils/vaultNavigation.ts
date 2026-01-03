import { type Entry, isGroupEntry } from "../interfaces/vault.interface";

/**
 * Parses a navigation path string into an array of path segments, filtering out empty segments.
 * @param navigationPath - The navigation path string to parse.
 * @returns An array of path segments.
 */
export const parseNavigationPath = (navigationPath: string): string[] => {
	return navigationPath.split("/").filter((segment) => segment !== "");
};

/**
 * Recursively finds the path to an entry with the specified ID within a vault structure.
 * @param entries - The array of entries to search through.
 * @param targetId - The ID of the entry to find.
 * @param currentPath - The current path being built during recursion.
 * @returns The path to the entry as an array of IDs, or an empty array if not found.
 */
export const findPathById = (
	entries: Entry[],
	targetId: string,
	currentPath: string[] = [],
): string[] => {
	for (const entry of entries) {
		const newPath = [...currentPath, entry.id];

		if (entry.id === targetId) {
			return newPath;
		}

		if (isGroupEntry(entry) && entry.children) {
			const childPath = findPathById(entry.children, targetId, newPath);
			if (childPath.length > 0) {
				return childPath;
			}
		}
	}
	return [];
};

/**
 * Navigates through a vault structure to retrieve the entries at the specified path.
 * @param entries - The array of entries to navigate through.
 * @param path - The path to navigate to, as an array of IDs.
 * @returns The entries at the specified path, or an empty array if the path is invalid.
 */
export const getCurrentEntries = (
	entries: Entry[],
	path: string[],
): Entry[] => {
	if (path.length === 0) {
		return entries;
	}

	let currentLevel = entries;
	for (const id of path) {
		const parentEntry = currentLevel.find((e) => e.id === id);
		if (parentEntry && isGroupEntry(parentEntry) && parentEntry.children) {
			currentLevel = parentEntry.children;
		} else {
			return [];
		}
	}
	return currentLevel;
};
