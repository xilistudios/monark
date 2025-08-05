export type EntryType = "group" | "entry";

// Base interface for all vault items
export interface BaseEntry {
	id: string; // UUID v4 string from Rust
	entry_type: EntryType;
	name: string;
	data_type: string;
	created_at: string; // ISO 8601 string
	updated_at: string; // ISO 8601 string
}

// Group entry interface with nested children
export interface GroupEntry extends BaseEntry {
	entry_type: "group";
	children: Entry[]; // Nested entry structure
}

// Data entry interface with additional fields
export interface DataEntry extends BaseEntry {
	entry_type: "entry";
	fields: Field[];
	tags: string[];
}

// Union type for all possible entries
export type Entry = GroupEntry | DataEntry;

export interface VaultContent {
	updated_at: string; // ISO 8601 string from Rust DateTime<Utc>
	hmac: string;
	entries: Entry[]; // Root level entries
}

// Field interface for data entries
export interface Field {
	title: string;
	property: string;
	value: string;
	secret: boolean;
}

// Type guards for unified entry system
export function isDataEntry(entry: Entry): entry is DataEntry {
	return entry.entry_type === "entry";
}

export function isGroupEntry(entry: Entry): entry is GroupEntry {
	return entry.entry_type === "group";
}

// Utility functions for nested vault operations
export interface EntryPath {
	entryId: string;
	parentIds: string[]; // Path from root to parent
}

// Helper function to find entry by path
export function findEntryByPath(entries: Entry[], path: string[]): Entry | null {
	if (path.length === 0) return null;
	
	let currentEntries = entries;
	let foundEntry: Entry | null = null;
	
	for (const id of path) {
		foundEntry = currentEntries.find(entry => entry.id === id) || null;
		if (!foundEntry) return null;
		
		if (isGroupEntry(foundEntry)) {
			currentEntries = foundEntry.children;
		} else if (path.indexOf(id) < path.length - 1) {
			// If we're not at the last ID but the entry is not a group, it's invalid
			return null;
		}
	}
	
	return foundEntry;
}

// Helper function to get all nested entries (flattened)
export function flattenEntries(entries: Entry[]): Entry[] {
	const result: Entry[] = [];
	
	function traverse(entryList: Entry[]) {
		for (const entry of entryList) {
			result.push(entry);
			if (isGroupEntry(entry)) {
				traverse(entry.children);
			}
		}
	}
	
	traverse(entries);
	return result;
}

// Helper function to get entry depth
export function getEntryDepth(entries: Entry[], targetId: string): number {
	function findDepth(entryList: Entry[], id: string, currentDepth: number): number {
		for (const entry of entryList) {
			if (entry.id === id) {
				return currentDepth;
			}
			if (isGroupEntry(entry)) {
				const depth = findDepth(entry.children, id, currentDepth + 1);
				if (depth !== -1) return depth;
			}
		}
		return -1;
	}
	
	return findDepth(entries, targetId, 0);
}

// Helper function to get parent path
export function getParentPath(entryId: string, entries: Entry[]): string[] {
	const path: string[] = [];
	
	function findPath(entryList: Entry[], id: string, currentPath: string[]): boolean {
		for (const entry of entryList) {
			if (entry.id === id) {
				path.push(...currentPath);
				return true;
			}
			if (isGroupEntry(entry)) {
				const newPath = [...currentPath, entry.id];
				if (findPath(entry.children, id, newPath)) {
					return true;
				}
			}
		}
		return false;
	}
	
	findPath(entries, entryId, []);
	return path;
}
