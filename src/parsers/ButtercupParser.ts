// ButtercupParser implements ICsvParser for Buttercup CSV import logic

import type { Field } from '../interfaces/vault.interface';
import type { ParsedEntry } from '../interfaces/parsers.interface';
import type { ICsvParser } from '../interfaces/csv.interface';
import type { GroupEntry, DataEntry } from '../interfaces/vault.interface';
import { parseCSV } from '../utils/csv';
export class ButtercupParser implements ICsvParser {
  getName() {
    return 'Buttercup';
  }

  detect(csvRows: Record<string, string>[]): boolean {
    const headers = Object.keys(csvRows[0] || {});
    return (
      headers.includes('!type') &&
      (headers.includes('!group_name') || headers.includes('title'))
    );
  }

  parse(csvText: string): ParsedEntry[] {
    const csvRows = parseCSV(csvText);

    const entries: ParsedEntry[] = [];

    for (const row of csvRows) {
      const type = row['!type']?.toLowerCase() as 'group' | 'entry';
      if (!type || (type !== 'group' && type !== 'entry')) continue;

      const name =
        row['!group_name'] || row['title'] || row['name'] || 'Unnamed';
      const groupId = row['!group_id'];
      const groupParent = row['!group_parent'];

      const fields: Field[] = [];
      for (const [key, value] of Object.entries(row)) {
        if (typeof value === 'string' && !key.startsWith('!') && value.trim()) {
          const secretFields = [
            'password',
            'pin',
            'puk',
            'token',
            'priv key',
            'private key',
            'secret_key',
            'recovery',
            'recovery key',
          ];
          const isSecret = secretFields.some((secretField) =>
            key.toLowerCase().includes(secretField.toLowerCase())
          );
          if (['title', 'id'].includes(key)) continue; // Skip title and id as they're used for name

          fields.push({
            title: key.charAt(0).toUpperCase() + key.slice(1),
            property: key.toLowerCase().replace(/\s+/g, '_'),
            value: value.trim(),
            secret: isSecret,
          });
        }
      }

      entries.push({
        type,
        name: name.trim(),
        groupId,
        groupParent,
        fields,
        id: crypto.randomUUID(),
      });
    }
    console.log(entries);

    return entries;
  }

  /**
   * Build a hierarchy of groups and entries from flat parsed entries.
   */
  private buildHierarchy(entries: ParsedEntry[]): (GroupEntry | DataEntry)[] {
    const groupMap = new Map<string, GroupEntry>();
    const result: (GroupEntry | DataEntry)[] = [];
    const orphanEntries: (GroupEntry | DataEntry)[] = [];

    // First pass: create all groups
    for (const entry of entries) {
      if (entry.type === 'group') {
        const groupEntry: GroupEntry = {
          id: entry.id,
          entry_type: 'group',
          name: entry.name,
          data_type: 'group',
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          children: [],
        };

        if (entry.groupId) {
          groupMap.set(entry.groupId, groupEntry);
        }

        // If no parent, add to root
        if (!entry.groupParent) {
          result.push(groupEntry);
        } else {
          orphanEntries.push(groupEntry);
        }
      }
    }

    // Second pass: create data entries and place them
    for (const entry of entries) {
      if (entry.type === 'entry') {
        const dataEntry: DataEntry = {
          id: entry.id,
          entry_type: 'entry',
          name: entry.name,
          data_type: 'login',
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          fields: entry.fields,
          tags: [],
        };

        if (entry.groupId && groupMap.has(entry.groupId)) {
          const parentGroup = groupMap.get(entry.groupId)!;
          parentGroup.children.push(dataEntry);
        } else {
          result.push(dataEntry);
        }
      }
    }

    // Third pass: place orphaned groups
    for (const orphanEntry of orphanEntries) {
      if (orphanEntry.entry_type === 'group') {
        const groupEntry = orphanEntry as GroupEntry;
        const parentId = entries.find(
          (e) => e.id === groupEntry.id
        )?.groupParent;

        if (parentId && groupMap.has(parentId)) {
          const parentGroup = groupMap.get(parentId)!;
          parentGroup.children.push(groupEntry);
        } else {
          result.push(groupEntry);
        }
      }
    }

    return result;
  }

  /**
   * Flatten a hierarchy of groups and entries into path-based arrays.
   */
  private flattenHierarchy(
    entries: (GroupEntry | DataEntry)[],
    basePath: string[] = []
  ): {
    groups: Array<{ path: string[]; entry: GroupEntry }>;
    entries: Array<{ path: string[]; entry: DataEntry }>;
  } {
    const groups: Array<{ path: string[]; entry: GroupEntry }> = [];
    const dataEntries: Array<{ path: string[]; entry: DataEntry }> = [];

    for (const entry of entries) {
      if (entry.entry_type === 'group') {
        const groupEntry = entry as GroupEntry;
        const currentPath = [...basePath];

        // Create a clean group entry without children for adding to vault
        const cleanGroupEntry: GroupEntry = {
          ...groupEntry,
          children: [],
        };

        groups.push({ path: currentPath, entry: cleanGroupEntry });

        // Recursively process children with updated path
        const childPath = [...basePath, groupEntry.id];
        const childResults = this.flattenHierarchy(
          groupEntry.children || [],
          childPath
        );
        groups.push(...childResults.groups);
        dataEntries.push(...childResults.entries);
      } else {
        const dataEntry = entry as DataEntry;
        dataEntries.push({ path: basePath, entry: dataEntry });
      }
    }

    return { groups, entries: dataEntries };
  }

  /**
   * Public method to process parsed entries into hierarchical and flattened structures.
   */
  public processHierarchy(
    parsedEntries: ParsedEntry[],
    path: string[]
  ): {
    groups: Array<{ path: string[]; entry: GroupEntry }>;
    entries: Array<{ path: string[]; entry: DataEntry }>;
  } {
    const hierarchicalEntries = this.buildHierarchy(parsedEntries);
    return this.flattenHierarchy(hierarchicalEntries, path);
  }
}
