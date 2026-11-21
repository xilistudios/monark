/**
 * i18n parity for the passkey ceremony strings (T11).
 *
 * The ceremony service resolves its prompt text through i18n
 * (`home:passkey.uvPrompt` and friends), so a key that exists only in `en.json`
 * would render as the raw key path in a Spanish UI — a silent, user-visible
 * defect that no type checker can catch (the locale files are plain JSON).
 *
 * This test pins the whole `home.passkey` subtree: same keys in both locales,
 * same interpolation placeholders, no empty strings.
 *
 * The repo has a pre-existing parity gap outside this subtree
 * (`home.errors.passwordMismatch` exists in `en` only, present at HEAD before
 * T11); it is deliberately NOT asserted here — this test covers the keys T11
 * introduces, and widening it would make it fail on debt this task must not
 * fix.
 */

import { describe, expect, it } from "vitest";
import en from "../../i18n/locales/en.json";
import es from "../../i18n/locales/es.json";

/** Flattens a nested locale object into dotted key paths. */
function flatten(
	value: Record<string, unknown>,
	prefix = "",
): Record<string, string> {
	const out: Record<string, string> = {};
	for (const [key, child] of Object.entries(value)) {
		const path = prefix ? `${prefix}.${key}` : key;
		if (typeof child === "string") {
			out[path] = child;
		} else if (child && typeof child === "object") {
			Object.assign(out, flatten(child as Record<string, unknown>, path));
		}
	}
	return out;
}

/** Interpolation placeholders (`{{name}}`) used by a string. */
function placeholders(value: string): string[] {
	return [...value.matchAll(/\{\{(\w+)\}\}/g)].map((match) => match[1]).sort();
}

const enFlat = flatten(en as Record<string, unknown>);
const esFlat = flatten(es as Record<string, unknown>);

/** Keys of the subtree this task owns. */
const passkeyKeys = (flat: Record<string, string>): string[] =>
	Object.keys(flat)
		.filter((key) => key.startsWith("home.passkey."))
		.sort();

describe("home.passkey i18n parity (T11 + T13)", () => {
	it("defines the same keys in en and es", () => {
		expect(passkeyKeys(esFlat)).toEqual(passkeyKeys(enFlat));
	});

	it("defines the ceremony keys the service resolves", () => {
		expect(passkeyKeys(enFlat)).toEqual(
			expect.arrayContaining([
				"home.passkey.uvPrompt",
				"home.passkey.uvPromptTitle",
				"home.passkey.uvPromptSubtitle",
				"home.passkey.uvPromptCancel",
				"home.passkey.uvFailed",
			]),
		);
	});

	it("defines the T13 UI keys the detail view and edit form resolve", () => {
		// A missing key renders as the raw key path in the UI (i18next's
		// fallback), which no type checker can catch: pin the ones T13 uses.
		expect(passkeyKeys(enFlat)).toEqual(
			expect.arrayContaining([
				"home.passkey.badge",
				"home.passkey.details.title",
				"home.passkey.details.relyingParty",
				"home.passkey.details.userName",
				"home.passkey.details.userDisplayName",
				"home.passkey.details.credentialId",
				"home.passkey.details.algorithm",
				"home.passkey.details.signCount",
				"home.passkey.details.discoverable",
				"home.passkey.details.transports",
				"home.passkey.details.delete",
				"home.passkey.details.deleteConfirmTitle",
				"home.passkey.details.deleteConfirm",
				"home.passkey.details.deleteConfirmAction",
				"home.passkey.details.deleting",
				"home.passkey.details.deleteFailed",
				"home.passkey.edit.title",
				"home.passkey.edit.name",
				"home.passkey.edit.userName",
				"home.passkey.edit.userDisplayName",
				"home.passkey.edit.tags",
				"home.passkey.edit.save",
				"home.passkey.edit.cancel",
				"home.passkey.edit.errors.validationFailed",
				"home.passkey.edit.errors.saveFailed",
			]),
		);
	});

	it("defines the T18 import/export keys the CXF modals resolve", () => {
		// Same reason as above: a missing key renders as the raw key path, and
		// the export warning in particular must never be a raw path — the user
		// consents to what it says.
		expect(passkeyKeys(enFlat)).toEqual(
			expect.arrayContaining([
				"home.passkey.import.title",
				"home.passkey.import.description",
				"home.passkey.import.selectFile",
				"home.passkey.import.importing",
				"home.passkey.import.close",
				"home.passkey.import.selectedFile",
				"home.passkey.import.imported",
				"home.passkey.import.duplicates",
				"home.passkey.import.nothingImported",
				"home.passkey.import.lossy.title",
				"home.passkey.import.lossy.row",
				"home.passkey.import.skipped.title",
				"home.passkey.import.skipped.row",
				"home.passkey.import.errors.locked",
				"home.passkey.import.errors.importFailed",
				"home.passkey.import.errors.unexpectedReport",
				"home.passkey.import.errors.refreshFailed",
				"home.passkey.export.title",
				"home.passkey.export.warning",
				"home.passkey.export.consent",
				"home.passkey.export.export",
				"home.passkey.export.exporting",
				"home.passkey.export.close",
				"home.passkey.export.success",
				"home.passkey.export.deleteReminder",
				"home.passkey.export.errors.locked",
				"home.passkey.export.errors.exportFailed",
			]),
		);
	});

	it("defines the T18 keys that live outside the passkey subtree", () => {
		// `home.addEntry.templates.passkey` (the template card) and
		// `home.vault.manager.exportPasskeys` (the toolbar button) sit outside
		// `home.passkey.*`, so the subtree parity test above cannot see them.
		const outsideKeys = [
			"home.addEntry.templates.passkey",
			"home.vault.manager.exportPasskeys",
		];
		for (const key of outsideKeys) {
			expect(Object.keys(enFlat), `en ${key}`).toContain(key);
			expect(Object.keys(esFlat), `es ${key}`).toContain(key);
			expect(enFlat[key].trim(), `en ${key}`).not.toBe("");
			expect(esFlat[key].trim(), `es ${key}`).not.toBe("");
		}
	});

	it("the export warning says the file is unencrypted (T18 consent copy)", () => {
		// The consent checkbox is only informed if the warning states the two
		// facts it is consenting to. Pin them in both locales so a translation
		// edit cannot quietly soften the warning.
		expect(enFlat["home.passkey.export.warning"]).toContain("UNENCRYPTED");
		expect(esFlat["home.passkey.export.warning"]).toContain("SIN CIFRAR");
	});

	it("uses the same interpolation placeholders in both locales", () => {
		for (const key of passkeyKeys(enFlat)) {
			expect(placeholders(esFlat[key]), `placeholders of ${key}`).toEqual(
				placeholders(enFlat[key]),
			);
		}
	});

	it("has no empty translations", () => {
		for (const key of passkeyKeys(enFlat)) {
			expect(enFlat[key].trim(), `en ${key}`).not.toBe("");
			expect(esFlat[key].trim(), `es ${key}`).not.toBe("");
		}
	});

	it("the badge and delete-confirm keys are not raw key paths", () => {
		// `{{name}}` interpolation must survive translation: a locale that drops
		// it would render a confirmation that does not say what is deleted.
		expect(enFlat["home.passkey.badge"]).toBe("PASSKEY");
		expect(esFlat["home.passkey.badge"]).toBe("PASSKEY");
		expect(enFlat["home.passkey.details.deleteConfirm"]).toContain("{{name}}");
		expect(esFlat["home.passkey.details.deleteConfirm"]).toContain("{{name}}");
	});

	it("the uvPrompt key is not the raw key path (i18n actually resolves it)", () => {
		// A missing key makes i18next return the key itself; this catches a
		// namespace typo (`home:passkey.uvPrompt` vs. the JSON nesting).
		expect(enFlat["home.passkey.uvPrompt"]).not.toContain("passkey.");
		expect(esFlat["home.passkey.uvPrompt"]).not.toContain("passkey.");
	});
});
