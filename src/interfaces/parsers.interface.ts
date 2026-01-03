import type { Field } from "./vault.interface";

// src/interfaces/parsers.interface.ts

export interface ParsedEntry {
	type: "group" | "entry";
	name: string;
	groupId?: string;
	groupParent?: string;
	fields: Field[];
	id: string;
}
