// ICsvParser interface for modular CSV import

import type { ParsedEntry } from './parsers.interface';

export interface ICsvParser {
  getName(): string;
  detect(csvRows: Record<string, string>[]): boolean;
  parse(csvText: string): ParsedEntry[];
}
