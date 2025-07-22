export type EntryType = 'group' | 'entry';

// Base interface for all vault items
export interface BaseEntry {
    id: string; // UUID v4 string from Rust
    entry_type: EntryType;
    name: string;
    data_type: string;
}

// Group entry interface
export interface GroupEntry extends BaseEntry {
    entry_type: 'group';
    children: string[]; // Array of child entry IDs
}

// Data entry interface with additional fields
export interface DataEntry extends BaseEntry {
    entry_type: 'entry';
    created_at: string; // ISO 8601 string
    updated_at: string; // ISO 8601 string
    fields: Field[];
    tags: string[];
}

// Union type for all possible entries
export type Entry = GroupEntry | DataEntry;

export interface VaultContent {
  updated_at: string; // ISO 8601 string from Rust DateTime<Utc>
  hmac: string;
  entries: Entry[];
}

// Field interface for data entries
export interface Field {
    title: string;
    property: string;
    value: string;
    secret: boolean;
}

// Legacy interface for backwards compatibility
export interface EntryData {
    title: string;
    created_at: string; // ISO 8601 string
    updated_at: string; // ISO 8601 string
    fields: Field[];
    tags: string[];
}
// Type guards for unified entry system
export function isDataEntry(entry: Entry): entry is DataEntry {
	return entry.entry_type === 'entry'
}

export function isGroupEntry(entry: Entry): entry is GroupEntry {
	return entry.entry_type === 'group'
}
