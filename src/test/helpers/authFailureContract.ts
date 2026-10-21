/**
 * Loader for the shared cloud-storage failure-contract fixture (issue #28, T11).
 *
 * The fixture (`fixtures/auth-failure-contract.json`, schema in D4) is the
 * single cross-language source of truth for:
 * - the 4 `AuthFailureClass` message **templates** (`src-tauri/src/commands/
 *   errors.rs`), and
 * - the 6 Google Drive **context** strings (`src-tauri/src/commands/storage.rs`),
 *
 * plus a curated set of `cases`, each pinning an exact rendered `message` byte
 * string together with the `CloudStorageErrorType` / retry class the frontend
 * (`classifyCloudFailure`, `src/services/cloudStorageErrors.ts`) must derive
 * from it.
 *
 * This module is the ONLY TypeScript entry point to the JSON fixture: tests
 * never `import` the JSON directly, so the (relatively brittle) path to the
 * repo-root `fixtures/` directory exists in exactly one place. It is a **test
 * helper**, never imported by a production module (`tsconfig.json` excludes
 * `src/test` from `tsc`/`build`).
 *
 * The types below are hand-written mirrors of the fixture's schema (not
 * derived from the JSON via `typeof`, so the contract is explicit). NOTE:
 * `tsconfig.json` excludes `src/test` from `tsc` and vitest does not
 * typecheck, so this file is never compile-checked — the schema below is
 * therefore enforced at module load by {@link validateContract}: an
 * out-of-domain value in the JSON trips the first test that imports this
 * helper (the rendered `message` bytes themselves are pinned by the T12/T13
 * consumer tests).
 *
 * @module authFailureContract
 */

import fixture from "../../../fixtures/auth-failure-contract.json";
import { CloudStorageErrorType } from "../../interfaces/cloud-storage.interface";

/** The 4 `AuthFailureClass` message templates, keyed by template name. */
export interface ContractTemplates {
	readonly AuthRejection: string;
	readonly Transient: string;
	readonly Other: string;
	/** `into_command_error_local_storage`'s distinct 4th template (m4). */
	readonly TransientLocalStorage: string;
}

/** The 6 Google Drive context strings, keyed by context name. */
export interface ContractContexts {
	readonly refresh: string;
	readonly codeExchange: string;
	readonly tokenParse: string;
	readonly oauthState: string;
	readonly loadConfig: string;
	readonly tokenPersistence: string;
}

/** Retry class, mirroring `CloudFailureClass` in `cloudStorageErrors.ts`. */
export type ContractFailureClass = "transient" | "terminal";

/** The frontend classification a fixture `message` must map to. */
export interface ContractFrontend {
	readonly errorType: CloudStorageErrorType;
	readonly failureClass: ContractFailureClass;
}

/** One rendered message plus the classification it must produce. */
export interface ContractCase {
	readonly id: string;
	readonly description: string;
	/** The Rust `AuthFailureClass` that rendered the message. */
	readonly rustClass: "AuthRejection" | "Transient" | "Other";
	/** Key into {@link CONTRACT.templates}. */
	readonly template: keyof ContractTemplates;
	/** Key into {@link CONTRACT.contexts}. */
	readonly context: keyof ContractContexts;
	/** The sanitized/redacted cause interpolated into the template. */
	readonly cause: string;
	/** The exact rendered bytes (derived by printing from Rust, never hand-typed). */
	readonly message: string;
	readonly frontend: ContractFrontend;
}

/** The full fixture document. */
export interface AuthFailureContract {
	readonly version: number;
	readonly description: string;
	readonly templates: ContractTemplates;
	readonly contexts: ContractContexts;
	readonly cases: readonly ContractCase[];
}

/**
 * The typed, shared fixture instance.
 *
 * The JSON import is widened to `string` by `resolveJsonModule`, so the cast
 * bridges to the hand-written schema; {@link validateContract} below makes it
 * safe by checking every constrained value at module load.
 */
const TYPED_CONTRACT = fixture as unknown as AuthFailureContract;

const RUST_CLASSES: ReadonlySet<string> = new Set([
	"AuthRejection",
	"Transient",
	"Other",
]);
const FAILURE_CLASSES: ReadonlySet<string> = new Set(["transient", "terminal"]);
const ERROR_TYPES: ReadonlySet<string> = new Set(
	Object.values(CloudStorageErrorType),
);

/**
 * Validate the loaded fixture against the hand-written schema at module load.
 *
 * @param contract - The cast fixture document
 * @throws `Error` when any constrained value is outside its domain
 */
function validateContract(contract: AuthFailureContract): void {
	const problem = (detail: string): never => {
		throw new Error(`auth-failure-contract.json: ${detail}`);
	};
	const templateKeys = Object.keys(contract.templates) as string[];
	const contextKeys = Object.keys(contract.contexts) as string[];
	if (contract.version !== 1) {
		problem(`unexpected version ${String(contract.version)}`);
	}
	const mandatoryIds = [
		"refresh-network-transient",
		"refresh-5xx-transient",
		"refresh-local-storage-transient",
		"refresh-revoked-rejection",
		"code-exchange-invalid-grant",
		"token-persistence-other",
		"oauth-state-other",
		"load-config-other",
	];
	for (const mandatoryId of mandatoryIds) {
		if (
			!contract.cases.some((contractEntry) => contractEntry.id === mandatoryId)
		) {
			problem(`missing mandatory case ${mandatoryId}`);
		}
	}
	for (const contractEntry of contract.cases) {
		if (!RUST_CLASSES.has(contractEntry.rustClass)) {
			problem(
				`case ${contractEntry.id}: bad rustClass ${contractEntry.rustClass}`,
			);
		}
		if (!templateKeys.includes(contractEntry.template)) {
			problem(
				`case ${contractEntry.id}: unknown template ${contractEntry.template}`,
			);
		}
		if (!contextKeys.includes(contractEntry.context)) {
			problem(
				`case ${contractEntry.id}: unknown context ${contractEntry.context}`,
			);
		}
		if (!ERROR_TYPES.has(contractEntry.frontend.errorType)) {
			problem(
				`case ${contractEntry.id}: bad errorType ${contractEntry.frontend.errorType}`,
			);
		}
		if (!FAILURE_CLASSES.has(contractEntry.frontend.failureClass)) {
			problem(
				`case ${contractEntry.id}: bad failureClass ${contractEntry.frontend.failureClass}`,
			);
		}
	}
}

validateContract(TYPED_CONTRACT);

export const CONTRACT: AuthFailureContract = TYPED_CONTRACT;

/** The 4 message templates (`AuthFailureClass::{message, …local_storage}`). */
export const TEMPLATES: ContractTemplates = CONTRACT.templates;

/** The 6 Google Drive context strings. */
export const CONTEXTS: ContractContexts = CONTRACT.contexts;

/** The pinned `cases` of the fixture. */
export const CONTRACT_CASES: readonly ContractCase[] = CONTRACT.cases;

/** Every case id, for `it.each`-style loops over the contract. */
export const CONTRACT_CASE_IDS: readonly string[] = CONTRACT_CASES.map(
	(contractCase) => contractCase.id,
);

/**
 * Look up a fixture case by its id.
 *
 * Fails loudly (rather than returning `undefined`) when the id is unknown, so
 * a typo in a test surfaces as a clear error instead of a silent `undefined`
 * read.
 *
 * @param caseId - One of the ids in {@link CONTRACT_CASE_IDS}
 * @returns The matching {@link ContractCase}
 * @throws `Error` when no case has that id
 */
export function contractCase(caseId: string): ContractCase {
	const found = CONTRACT_CASES.find(
		(contractCaseEntry) => contractCaseEntry.id === caseId,
	);
	if (!found) {
		throw new Error(
			`unknown auth-failure-contract case id: ${JSON.stringify(caseId)} (expected one of ${CONTRACT_CASE_IDS.join(", ")})`,
		);
	}
	return found;
}

/**
 * Every {@link ContractCase}, for table-driven tests.
 *
 * @returns The pinned cases, in fixture order
 */
export function contractCases(): readonly ContractCase[] {
	return CONTRACT_CASES;
}

/**
 * The exact rendered `message` bytes of a fixture case — the string the Rust
 * side produces and the frontend must classify identically.
 *
 * @param caseId - One of the ids in {@link CONTRACT_CASE_IDS}
 * @returns The case's `message`
 * @throws `Error` when no case has that id
 */
export function contractMessage(caseId: string): string {
	return contractCase(caseId).message;
}

/**
 * Render a message from the fixture's templates/contexts/causes, for tests
 * that need a variant of a pinned case (e.g. a different `cause`) without
 * hard-coding the template wording again. Mirrors `AuthFailureClass::message`
 * / `into_command_error_local_storage` (`src-tauri/src/commands/errors.rs`).
 *
 * NOTE this does NOT reproduce the backend's routing-keyword redaction
 * (`redact_routing_keywords`) or cause sanitisation (whitespace collapse +
 * truncation); it interpolates the given cause verbatim. Use it for clean
 * causes the tests control, and reach for the pinned `message` itself (via
 * {@link contractMessage}) when redaction matters (e.g. `oauth-state-other`).
 *
 * @param template - Key into {@link TEMPLATES}
 * @param context - Key into {@link CONTEXTS}
 * @param cause - The cause text to interpolate
 * @returns The rendered message string
 */
export function renderContractMessage(
	template: keyof ContractTemplates,
	context: keyof ContractContexts,
	cause: string,
): string {
	// Replacement FUNCTIONS on purpose: a plain-string replacement would
	// interpret `$&`/`$'`/`$``/`$$` in the cause as `String.replace`
	// patterns and corrupt it.
	return TEMPLATES[template]
		.replace("{context}", () => CONTEXTS[context])
		.replace("{cause}", () => cause);
}
