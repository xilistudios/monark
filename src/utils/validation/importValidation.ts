/**
 * Lightweight validation for imported vault data.
 *
 * Unlike the form-level zod schemas (which validate UI state), this module
 * validates structured data coming from CSV/JSON parsers before it is written
 * to the vault.  Invalid entries are skipped with a console warning rather
 * than blocking the entire import.
 * @module importValidation
 */

import type { DataEntry, Field, FieldType } from "../../interfaces/vault.interface";

// ─── Constants ───────────────────────────────────────────────────────────────

const MAX_NAME_LENGTH = 200;
const MAX_FIELD_TITLE_LENGTH = 100;
const MAX_FIELD_VALUE_LENGTH = 10_000;

const VALID_FIELD_TYPES: ReadonlySet<string> = new Set<FieldType>([
  "text",
  "url",
  "note",
  "otp",
  "password",
  "ssh key",
]);

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Validates that a URL string uses http(s) protocol.
 * Returns true for empty strings (URL fields are optional).
 */
function isValidHttpUrl(url: string): boolean {
  if (!url || !url.trim()) return true; // empty is fine
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Sanitise a single field: trim, enforce length limits, validate type.
 * Returns the sanitised field or null if the field is irrecoverably invalid.
 */
function sanitiseField(field: Field): Field | null {
  if (!field || typeof field !== "object") return null;

  const title = (field.title ?? "").trim();
  const property = (field.property ?? "").trim().toLowerCase() as FieldType;
  const value = (field.value ?? "").trim();

  // Must have a title and a recognised property type
  if (!title) return null;
  if (!VALID_FIELD_TYPES.has(property)) return null;

  // Enforce length limits
  if (title.length > MAX_FIELD_TITLE_LENGTH) return null;
  if (value.length > MAX_FIELD_VALUE_LENGTH) return null;

  // URL fields must use http(s)
  if (property === "url" && !isValidHttpUrl(value)) return null;

  return {
    title,
    property,
    value,
    secret: Boolean(field.secret),
  };
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Validate and sanitise an array of DataEntry objects.
 *
 * - Trims all string fields.
 * - Rejects entries with no name, empty name, or no fields.
 * - Validates URL fields use http/https protocol.
 * - Enforces reasonable length limits.
 * - Logs warnings for skipped entries.
 *
 * @param entries  Raw entries parsed from import data.
 * @returns        Only the valid, sanitised entries.
 */
export function validateImportedEntries(entries: DataEntry[]): DataEntry[] {
  const valid: DataEntry[] = [];

  for (const entry of entries) {
    // ── Entry-level checks ───────────────────────────────────────────────
    const name = (entry.name ?? "").trim();

    if (!name) {
      console.warn("[importValidation] Skipping entry with empty name");
      continue;
    }

    if (name.length > MAX_NAME_LENGTH) {
      console.warn(
        `[importValidation] Skipping entry "${name.slice(0, 40)}…" — name exceeds ${MAX_NAME_LENGTH} chars`,
      );
      continue;
    }

    if (!Array.isArray(entry.fields) || entry.fields.length === 0) {
      console.warn(
        `[importValidation] Skipping entry "${name}" — no fields`,
      );
      continue;
    }

    // ── Field-level sanitisation ─────────────────────────────────────────
    const sanitisedFields: Field[] = [];

    for (const field of entry.fields) {
      const clean = sanitiseField(field);
      if (clean) {
        sanitisedFields.push(clean);
      } else {
        console.warn(
          `[importValidation] Dropping invalid field "${(field as Field)?.title ?? "?"}" in entry "${name}"`,
        );
      }
    }

    if (sanitisedFields.length === 0) {
      console.warn(
        `[importValidation] Skipping entry "${name}" — all fields invalid`,
      );
      continue;
    }

    // ── Assemble clean entry ─────────────────────────────────────────────
    const tags = Array.isArray(entry.tags)
      ? entry.tags.map((t) => t.trim()).filter(Boolean)
      : [];

    valid.push({
      ...entry,
      name,
      fields: sanitisedFields,
      tags,
    });
  }

  return valid;
}
