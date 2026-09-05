/**
 * Cryptographically secure password generator.
 *
 * All randomness comes from the Web Crypto API (`crypto.getRandomValues`)
 * using rejection sampling so every character is drawn from a uniform
 * distribution with no modulo bias.
 */

/** Minimum allowed password length. */
export const PASSWORD_MIN_LENGTH = 8;

/** Maximum allowed password length. */
export const PASSWORD_MAX_LENGTH = 128;

/** Options controlling the password length and which character sets to include. */
export interface PasswordGeneratorOptions {
	length: number;
	includeUppercase: boolean;
	includeLowercase: boolean;
	includeNumbers: boolean;
	includeSymbols: boolean;
}

/** Default options: 16 characters using every character set. */
export const DEFAULT_PASSWORD_OPTIONS: PasswordGeneratorOptions = {
	length: 16,
	includeUppercase: true,
	includeLowercase: true,
	includeNumbers: true,
	includeSymbols: true,
};

const UPPERCASE_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const LOWERCASE_CHARS = "abcdefghijklmnopqrstuvwxyz";
const NUMBER_CHARS = "0123456789";
const SYMBOL_CHARS = "!@#$%^&*()_+-=[]{}|;:,.<>?";

/**
 * Returns a cryptographically secure random integer in [0, maxExclusive).
 *
 * Uses rejection sampling to avoid modulo bias: values greater than or equal
 * to the largest multiple of `maxExclusive` that fits in a uint32 are
 * discarded, so the remaining values map uniformly onto the output range.
 *
 * @param maxExclusive - Upper bound (must be a positive integer).
 * @returns A uniform random integer in [0, maxExclusive).
 */
function randomInt(maxExclusive: number): number {
	const limit = Math.floor(0x100000000 / maxExclusive) * maxExclusive;
	for (;;) {
		const buffer = new Uint32Array(1);
		crypto.getRandomValues(buffer);
		const value = buffer[0];
		if (value < limit) {
			return value % maxExclusive;
		}
	}
}

/**
 * Generates a cryptographically secure random password.
 *
 * The result always contains at least one character from every selected
 * character set; the remaining characters are drawn from the combined pool
 * of the selected sets. The final characters are shuffled with a crypto-based
 * Fisher-Yates so the guaranteed characters are not always at the start.
 *
 * @param options - Desired length and which character sets to include.
 * @returns The generated password.
 * @throws Error when no character set is selected.
 */
export function generatePassword(options: PasswordGeneratorOptions): string {
	const length = Math.min(
		Math.max(options.length, PASSWORD_MIN_LENGTH),
		PASSWORD_MAX_LENGTH,
	);

	const selectedSets: string[] = [];
	if (options.includeUppercase) {
		selectedSets.push(UPPERCASE_CHARS);
	}
	if (options.includeLowercase) {
		selectedSets.push(LOWERCASE_CHARS);
	}
	if (options.includeNumbers) {
		selectedSets.push(NUMBER_CHARS);
	}
	if (options.includeSymbols) {
		selectedSets.push(SYMBOL_CHARS);
	}

	if (selectedSets.length === 0) {
		throw new Error("At least one character set must be selected");
	}

	const pool = selectedSets.join("");
	const chars: string[] = [];

	// Guarantee at least one character from each selected set.
	for (const set of selectedSets) {
		chars.push(set[randomInt(set.length)]);
	}

	// Fill the remaining length from the combined pool.
	while (chars.length < length) {
		chars.push(pool[randomInt(pool.length)]);
	}

	// Fisher-Yates shuffle so the guaranteed characters are uniformly placed.
	for (let i = chars.length - 1; i > 0; i--) {
		const j = randomInt(i + 1);
		[chars[i], chars[j]] = [chars[j], chars[i]];
	}

	return chars.join("");
}

/**
 * Estimates the entropy of a password in bits.
 *
 * @param length - Number of characters in the password.
 * @param poolSize - Size of the character pool each character is drawn from.
 * @returns `length * log2(poolSize)` rounded to the nearest integer, or 0
 *   when `poolSize <= 1` or `length <= 0` (no entropy in either case).
 */
export function estimateEntropyBits(length: number, poolSize: number): number {
	if (poolSize <= 1 || length <= 0) {
		return 0;
	}
	return Math.round(length * Math.log2(poolSize));
}
