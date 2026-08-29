// Unit tests for the cryptographically secure password generator

import { describe, expect, it } from "vitest";
import {
	DEFAULT_PASSWORD_OPTIONS,
	estimateEntropyBits,
	generatePassword,
	PASSWORD_MAX_LENGTH,
	PASSWORD_MIN_LENGTH,
} from "../../utils/passwordGenerator";

const UPPERCASE = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const LOWERCASE = "abcdefghijklmnopqrstuvwxyz";
const NUMBERS = "0123456789";
const SYMBOLS = "!@#$%^&*()_+-=[]{}|;:,.<>?";

const ALL_OPTIONS = {
	...DEFAULT_PASSWORD_OPTIONS,
	length: 16,
};

/** Returns the characters of `password` that belong to `set`. */
function charsIn(password: string, set: string): string[] {
	return [...password].filter((char) => set.includes(char));
}

describe("generatePassword", () => {
	it("returns a string of exactly the requested length", () => {
		expect(generatePassword({ ...ALL_OPTIONS, length: 16 })).toHaveLength(16);
		expect(generatePassword({ ...ALL_OPTIONS, length: 32 })).toHaveLength(32);
	});

	it("clamps length below PASSWORD_MIN_LENGTH and above PASSWORD_MAX_LENGTH", () => {
		expect(
			generatePassword({ ...ALL_OPTIONS, length: PASSWORD_MIN_LENGTH - 1 }),
		).toHaveLength(PASSWORD_MIN_LENGTH);
		expect(generatePassword({ ...ALL_OPTIONS, length: 0 })).toHaveLength(
			PASSWORD_MIN_LENGTH,
		);
		expect(
			generatePassword({ ...ALL_OPTIONS, length: PASSWORD_MAX_LENGTH + 1 }),
		).toHaveLength(PASSWORD_MAX_LENGTH);
	});

	it("contains at least one char from each selected set", () => {
		for (let run = 0; run < 20; run++) {
			const password = generatePassword(ALL_OPTIONS);
			expect(charsIn(password, UPPERCASE).length).toBeGreaterThanOrEqual(1);
			expect(charsIn(password, LOWERCASE).length).toBeGreaterThanOrEqual(1);
			expect(charsIn(password, NUMBERS).length).toBeGreaterThanOrEqual(1);
			expect(charsIn(password, SYMBOLS).length).toBeGreaterThanOrEqual(1);
		}
	});

	it("excludes characters from unselected sets", () => {
		const password = generatePassword({
			...ALL_OPTIONS,
			includeUppercase: false,
			includeSymbols: false,
		});

		expect(password).not.toMatch(/[A-Z]/);
		expect(password).not.toMatch(/[!@#$%^&*()_+\-=[\]{}|;:,.<>?]/);
		expect(password).toMatch(/[a-z]/);
		expect(password).toMatch(/[0-9]/);
	});

	it("throws when all four character sets are disabled", () => {
		expect(() =>
			generatePassword({
				length: 16,
				includeUppercase: false,
				includeLowercase: false,
				includeNumbers: false,
				includeSymbols: false,
			}),
		).toThrow("At least one character set must be selected");
	});

	it("only uses characters from the union of the selected sets", () => {
		const union = UPPERCASE + LOWERCASE + NUMBERS + SYMBOLS;
		for (let run = 0; run < 20; run++) {
			const password = generatePassword(ALL_OPTIONS);
			for (const char of password) {
				expect(union.includes(char)).toBe(true);
			}
		}
	});

	it("produces different passwords on consecutive calls", () => {
		const first = generatePassword(ALL_OPTIONS);
		const second = generatePassword(ALL_OPTIONS);
		expect(first).not.toBe(second);
	});

	it("works correctly with a single character set", () => {
		const password = generatePassword({
			length: 16,
			includeUppercase: false,
			includeLowercase: false,
			includeNumbers: false,
			includeSymbols: true,
		});
		expect(password).toHaveLength(16);
		for (const char of password) {
			expect(SYMBOLS.includes(char)).toBe(true);
		}
	});
});

describe("estimateEntropyBits", () => {
	it("estimates entropy as length * log2(poolSize)", () => {
		expect(estimateEntropyBits(16, 26)).toBe(Math.round(16 * Math.log2(26)));
		expect(estimateEntropyBits(8, 94)).toBe(Math.round(8 * Math.log2(94)));
	});

	it("returns 0 when poolSize is 1 or smaller", () => {
		expect(estimateEntropyBits(16, 1)).toBe(0);
		expect(estimateEntropyBits(16, 0)).toBe(0);
	});

	it("returns 0 when length is zero or negative", () => {
		expect(estimateEntropyBits(0, 94)).toBe(0);
		expect(estimateEntropyBits(-4, 94)).toBe(0);
	});
});
