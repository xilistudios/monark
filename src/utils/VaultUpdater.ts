import { Entry, isGroupEntry } from '../interfaces/vault.interface';

/**
 * Utility class for performing atomic updates on vault entries.
 * Handles nested group structures using a flat entries array with ID references.
 * Uses structuredClone for immutable updates.
 */
export class VaultUpdater {
  private entries: Entry[];
  private entryMap: Map<string, Entry>;

  /**
   * Creates a new VaultUpdater with a deep clone of the provided entries.
   * @param entries The current vault entries array
   */
  constructor(entries: Entry[]) {
    this.entries = structuredClone(entries);
    this.entryMap = new Map(this.entries.map(e => [e.id, e]));
  }

  /**
   * Adds a new entry to the vault, optionally under a parent group.
   * @param parentId ID of the parent group, or null for root level
   * @param newEntry The new entry to add
   * @returns this for chaining
   */
  public addEntry(parentId: string | null, newEntry: Entry): this {
    if (this.entryMap.has(newEntry.id)) {
      throw new Error(`Entry with id ${newEntry.id} already exists`);
    }

    this.entries.push(newEntry);
    this.entryMap.set(newEntry.id, newEntry);

    if (parentId) {
      const parent = this.entryMap.get(parentId);
      if (!parent || !isGroupEntry(parent)) {
        throw new Error(`Invalid parent group id: ${parentId}`);
      }
      parent.children.push(newEntry.id);
    }

    return this;
  }

  /**
   * Updates an existing entry with the provided partial updates.
   * @param entryId ID of the entry to update
   * @param updates Partial updates to apply
   * @returns this for chaining
   */
  public updateEntry(entryId: string, updates: Partial<Entry>): this {
    const entry = this.entryMap.get(entryId);
    if (!entry) {
      throw new Error(`Entry with id ${entryId} not found`);
    }
    Object.assign(entry, updates);
    return this;
  }

  /**
   * Deletes an entry and its children if it's a group.
   * Recursively deletes nested entries and removes references from parents.
   * @param entryId ID of the entry to delete
   * @returns this for chaining
   */
  public deleteEntry(entryId: string): this {
    const entry = this.entryMap.get(entryId);
    if (!entry) return this;

    // Recursively delete children if group
    if (isGroupEntry(entry)) {
      for (const childId of [...entry.children]) {
        this.deleteEntry(childId);
      }
    }

    // Remove from parent's children
    for (const possibleParent of this.entries) {
      if (isGroupEntry(possibleParent)) {
        const childIndex = possibleParent.children.indexOf(entryId);
        if (childIndex !== -1) {
          possibleParent.children.splice(childIndex, 1);
          break; // Assume single parent
        }
      }
    }

    // Remove from entries and map
    this.entries = this.entries.filter(e => e.id !== entryId);
    this.entryMap.delete(entryId);

    return this;
  }

  /**
   * Returns the updated entries array after all operations.
   * @returns Updated entries array
   */
  public getEntries(): Entry[] {
    return this.entries;
  }
} 