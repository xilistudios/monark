import { 
	type Entry, 
	type GroupEntry, 
	isGroupEntry,
	type EntryPath,
	findEntryByPath,
	getParentPath,
	flattenEntries 
} from "../interfaces/vault.interface";

/**
 * Utility class for performing atomic updates on vault entries.
 * Handles nested group structures using direct nested objects.
 * Uses structuredClone for immutable updates.
 * Supports path-based operations for deep nesting.
 */
export class VaultUpdater {
	private entries: Entry[];

	/**
	 * Creates a new VaultUpdater with a deep clone of the provided entries.
	 * @param entries The current vault entries array
	 */
	constructor(entries: Entry[]) {
		this.entries = structuredClone(entries);
	}

	/**
	 * Finds an entry by ID in the nested structure
	 * @param entries Array of entries to search
	 * @param entryId ID of the entry to find
	 * @returns The found entry or null
	 */
	private findEntry(entries: Entry[], entryId: string): Entry | null {
		for (const entry of entries) {
			if (entry.id === entryId) {
				return entry;
			}
			if (isGroupEntry(entry)) {
				const found = this.findEntry(entry.children, entryId);
				if (found) return found;
			}
		}
		return null;
	}

	/**
	 * Finds the parent group of an entry
	 * @param entries Array of entries to search
	 * @param entryId ID of the entry whose parent to find
	 * @returns The parent group or null if entry is at root level
	 */
	private findParentGroup(entries: Entry[], entryId: string): GroupEntry | null {
		for (const entry of entries) {
			if (isGroupEntry(entry)) {
				if (entry.children.some((child: Entry) => child.id === entryId)) {
					return entry;
				}
				const found = this.findParentGroup(entry.children, entryId);
				if (found) return found;
			}
		}
		return null;
	}

	/**
	 * Finds an entry by its path from root
	 * @param path Array of IDs representing the path to the entry
	 * @returns The found entry or null
	 */
	public findEntryByPath(path: string[]): Entry | null {
		return findEntryByPath(this.entries, path);
	}

	/**
	 * Gets the path from root to the specified entry
	 * @param entryId ID of the entry
	 * @returns Array of IDs representing the path
	 */
	public getEntryPath(entryId: string): string[] {
		return getParentPath(entryId, this.entries);
	}

	/**
	 * Gets all entries in a flattened structure
	 * @returns Array of all entries including nested ones
	 */
	public getAllEntries(): Entry[] {
		return flattenEntries(this.entries);
	}

	/**
	 * Gets the depth of an entry in the hierarchy
	 * @param entryId ID of the entry
	 * @returns Depth level (0 for root entries)
	 */
	public getEntryDepth(entryId: string): number {
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
		
		return findDepth(this.entries, entryId, 0);
	}

	/**
	 * Adds a new entry to the vault, optionally under a parent group.
	 * @param parentId ID of the parent group, or null for root level
	 * @param newEntry The new entry to add
	 * @returns this for chaining
	 */
	public addEntry(parentId: string | null, newEntry: Entry): this {
		if (this.findEntry(this.entries, newEntry.id)) {
			throw new Error(`Entry with id ${newEntry.id} already exists`);
		}

		if (parentId) {
			const parent = this.findEntry(this.entries, parentId);
			if (!parent || !isGroupEntry(parent)) {
				throw new Error(`Invalid parent group id: ${parentId}`);
			}
			parent.children.push(newEntry);
		} else {
			this.entries.push(newEntry);
		}

		return this;
	}

	/**
	 * Adds a new entry at a specific path
	 * @param path Path where to add the entry
	 * @param newEntry The new entry to add
	 * @returns this for chaining
	 */
	public addEntryAtPath(path: string[], newEntry: Entry): this {
		if (path.length === 0) {
			this.entries.push(newEntry);
			return this;
		}

		const parentPath = path.slice(0, -1);
		const parent = this.findEntryByPath(parentPath);
		
		if (!parent || !isGroupEntry(parent)) {
			throw new Error(`Invalid parent path: ${parentPath.join('/')}`);
		}

		if (parent.children.some(child => child.id === newEntry.id)) {
			throw new Error(`Entry with id ${newEntry.id} already exists at this location`);
		}

		parent.children.push(newEntry);
		return this;
	}

	/**
	 * Updates an existing entry with the provided partial updates.
	 * @param entryId ID of the entry to update
	 * @param updates Partial updates to apply
	 * @returns this for chaining
	 */
	public updateEntry(entryId: string, updates: Partial<Entry>): this {
		const entry = this.findEntry(this.entries, entryId);
		if (!entry) {
			throw new Error(`Entry with id ${entryId} not found`);
		}
		
		// Handle name updates for groups
		if (updates.name && isGroupEntry(entry)) {
			entry.name = updates.name;
		}
		
		Object.assign(entry, updates);
		return this;
	}

	/**
	 * Updates an entry at a specific path
	 * @param path Path to the entry
	 * @param updates Partial updates to apply
	 * @returns this for chaining
	 */
	public updateEntryAtPath(path: string[], updates: Partial<Entry>): this {
		const entry = this.findEntryByPath(path);
		if (!entry) {
			throw new Error(`Entry at path ${path.join('/')} not found`);
		}
		
		Object.assign(entry, updates);
		return this;
	}

	/**
	 * Moves an entry to a new location with full path support
	 * @param entryId ID of the entry to move
	 * @param newParentId New parent ID, or null for root level
	 * @returns this for chaining
	 */
	public moveEntry(entryId: string, newParentId: string | null): this {
		const entry = this.findEntry(this.entries, entryId);
		if (!entry) {
			throw new Error(`Entry with id ${entryId} not found`);
		}

		// Prevent moving a group into itself or its descendants
		if (isGroupEntry(entry) && newParentId) {
			const descendants = this.getGroupDescendants(entryId);
			if (descendants.some(desc => desc.id === newParentId)) {
				throw new Error(`Cannot move group into its own descendant`);
			}
		}

		// Remove from current location
		this.deleteEntry(entryId);

		// Add to new location
		this.addEntry(newParentId, entry);
		
		return this;
	}

	/**
	 * Moves an entry to a new location using path-based addressing
	 * @param sourcePath Current path of the entry
	 * @param targetPath New path where the entry should be moved
	 * @returns this for chaining
	 */
	public moveEntryByPath(sourcePath: string[], targetPath: string[]): this {
		const entry = this.findEntryByPath(sourcePath);
		if (!entry) {
			throw new Error(`Entry at path ${sourcePath.join('/')} not found`);
		}

		// Remove from source
		this.deleteEntryAtPath(sourcePath);

		// Add to target
		this.addEntryAtPath(targetPath, entry);
		
		return this;
	}

	/**
	 * Deletes an entry and its children if it's a group.
	 * Recursively deletes nested entries and removes references from parents.
	 * @param entryId ID of the entry to delete
	 * @returns this for chaining
	 */
	public deleteEntry(entryId: string): this {
		const entry = this.findEntry(this.entries, entryId);
		if (!entry) return this;

		// Find parent and remove from parent's children
		const parent = this.findParentGroup(this.entries, entryId);
		if (parent) {
			parent.children = parent.children.filter(child => child.id !== entryId);
		} else {
			// Entry is at root level
			this.entries = this.entries.filter(e => e.id !== entryId);
		}

		return this;
	}

	/**
	 * Recursively deletes an entry and all its descendants
	 * @param entryId ID of the entry to delete
	 * @returns this for chaining
	 */
	public deleteEntryRecursive(entryId: string): this {
		const entry = this.findEntry(this.entries, entryId);
		if (!entry) return this;

		// If it's a group, delete all children first
		if (isGroupEntry(entry)) {
			// Create a copy of children array to avoid modification during iteration
			const childrenToDelete = [...entry.children];
			for (const child of childrenToDelete) {
				this.deleteEntryRecursive(child.id);
			}
		}

		// Delete the entry itself
		return this.deleteEntry(entryId);
	}

	/**
	 * Deletes an entry at a specific path
	 * @param path Path to the entry to delete
	 * @returns this for chaining
	 */
	public deleteEntryAtPath(path: string[]): this {
		if (path.length === 0) return this;

		const parentPath = path.slice(0, -1);
		const entryId = path[path.length - 1];
		
		if (parentPath.length === 0) {
			// Root level entry
			this.entries = this.entries.filter(e => e.id !== entryId);
		} else {
			const parent = this.findEntryByPath(parentPath);
			if (parent && isGroupEntry(parent)) {
				parent.children = parent.children.filter(child => child.id !== entryId);
			}
		}
		
		return this;
	}

	/**
	 * Gets all descendants of a group entry
	 * @param groupId ID of the group
	 * @returns Array of all descendant entries
	 */
	public getGroupDescendants(groupId: string): Entry[] {
		const group = this.findEntry(this.entries, groupId);
		if (!group || !isGroupEntry(group)) {
			return [];
		}
		
		return flattenEntries([group]).slice(1); // Exclude the group itself
	}

	/**
	 * Validates the vault structure (no circular references, valid IDs)
	 * @returns true if structure is valid, false otherwise
	 */
	public validateStructure(): boolean {
		const allIds = new Set<string>();
		const allEntries = this.getAllEntries();
		
		// Check for duplicate IDs
		for (const entry of allEntries) {
			if (allIds.has(entry.id)) {
				return false;
			}
			allIds.add(entry.id);
		}
		
		// Check for circular references
		return !this.hasCircularReferences();
	}

	/**
	 * Checks for circular references in the vault structure
	 * @returns true if circular references exist, false otherwise
	 */
	private hasCircularReferences(): boolean {
		const visited = new Set<string>();
		const recursionStack = new Set<string>();

		const checkCircular = (entries: Entry[], parentPath: string[]): boolean => {
			for (const entry of entries) {
				if (visited.has(entry.id)) {
					// If we've seen this ID in the current path, it's a circular reference
					if (recursionStack.has(entry.id)) {
						return true;
					}
					continue;
				}

				visited.add(entry.id);
				recursionStack.add(entry.id);

				if (isGroupEntry(entry)) {
					const newPath = [...parentPath, entry.id];
					if (checkCircular(entry.children, newPath)) {
						return true;
					}
				}

				recursionStack.delete(entry.id);
			}
			return false;
		};

		return checkCircular(this.entries, []);
	}

	/**
	 * Gets the total count of entries including all nested entries
	 * @returns Total number of entries in the vault
	 */
	public getTotalEntryCount(): number {
		return this.getAllEntries().length;
	}

	/**
	 * Gets statistics about the vault structure
	 * @returns Object containing vault statistics
	 */
	public getVaultStats(): {
		totalEntries: number;
		totalGroups: number;
		totalDataEntries: number;
		maxDepth: number;
	} {
		const allEntries = this.getAllEntries();
		const groups = allEntries.filter(entry => isGroupEntry(entry));
		const dataEntries = allEntries.filter(entry => !isGroupEntry(entry));
		
		let maxDepth = 0;
		for (const entry of allEntries) {
			const depth = this.getEntryDepth(entry.id);
			if (depth > maxDepth) {
				maxDepth = depth;
			}
		}

		return {
			totalEntries: allEntries.length,
			totalGroups: groups.length,
			totalDataEntries: dataEntries.length,
			maxDepth,
		};
	}

	/**
	 * Returns the updated entries array after all operations.
	 * @returns Updated entries array
	 */
	public getEntries(): Entry[] {
		return this.entries;
	}
}
