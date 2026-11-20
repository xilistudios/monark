/**
 * Passkey ceremony orchestration (T11) — the **user-verification gate** in front
 * of every passkey command.
 *
 * ## Why a gate at all
 *
 * The Rust commands (`passkey_create`, `passkey_assert`) unlock the vault with
 * the password they are given and then sign. They cannot tell *who* is at the
 * keyboard: a process that already holds the session password could mint or use
 * a passkey silently. The approved design puts the user-verification (UV) step
 * in the frontend, where the OS biometric prompt lives:
 *
 * ```
 * resolve vault (Redux) ──▶ locked? ──▶ throw (before any IPC)
 *        │
 *        ▼
 * checkBiometricAvailability()
 *        ├── available ──▶ authenticate(uvPrompt) ──▶ false ──▶ throw (no bypass)
 *        │                                          └▶ true  ──▶ command
 *        └── unavailable ─────────────────────────────────────▶ command
 * ```
 *
 * ## The fallback, stated honestly
 *
 * When biometry is **unavailable** (no sensor, no enrolled biometric, plugin
 * missing) the ceremony proceeds: the vault is already unlocked, so the user
 * proved knowledge of the vault password moments ago — that password is the
 * documented fallback UV. This is a real weakening of the guarantee (a stolen
 * *unlocked* session can create passkeys without a fresh prompt) and it is
 * accepted deliberately: refusing to work on hardware without biometrics would
 * make the feature unusable there.
 *
 * When biometry is **available and fails** (cancel, lockout, sensor error) the
 * ceremony **throws**. It does not fall back to the password and it does not
 * retry: a failed prompt is a failed UV, and the user retries the action.
 *
 * ## What never happens here
 *
 * - The vault password is never logged, never put in an error message and never
 *   copied into the request object; it travels as its own IPC argument.
 * - No key material exists client-side (the private key never leaves Rust), so
 *   there is nothing secret to leak in a thrown error.
 * - The request is validated with the strict Zod schema **before** the prompt,
 *   so a malformed request never interrupts the user with a biometric dialog.
 *
 * @module passkeyCeremony
 */

import i18n from "../i18n";
import type {
	PasskeyAssertRequest,
	PasskeyAssertResponse,
	PasskeyCreateRequest,
	PasskeyCreateResponse,
} from "../interfaces/passkey.interface";
import type { Vault } from "../redux/actions/vault";
import {
	passkeyAssertRequestSchema,
	passkeyCreateRequestSchema,
} from "../utils/validation/passkeySchemas";
import { authenticate, checkBiometricAvailability } from "./biometric";
import PasskeyCommands, { vaultRefFor } from "./passkey";
import { VaultManager } from "./vault";
import { isVaultLocked } from "./vaultState";

/** i18n key of the biometric prompt shown before a passkey ceremony. */
export const UV_PROMPT_KEY = "home:passkey.uvPrompt";

/**
 * Error raised when the ceremony cannot run at all (vault missing/locked, user
 * verification failed, biometric subsystem broken).
 *
 * The message is user-facing: it is rendered by the caller as-is. It never
 * contains the vault password or any request member.
 */
export class PasskeyCeremonyError extends Error {
	/**
	 * Underlying failure, kept for debugging (`Error.cause`).
	 *
	 * Declared explicitly because the project targets ES2020, whose `Error` type
	 * has no `cause` member.
	 */
	readonly cause?: unknown;

	/**
	 * @param message - User-facing message (never secret material).
	 * @param cause - Underlying failure, kept for debugging.
	 */
	constructor(message: string, cause?: unknown) {
		super(message);
		this.name = "PasskeyCeremonyError";
		if (cause !== undefined) {
			this.cause = cause;
		}
	}
}

/** A vault resolved from Redux, ready for a passkey command. */
interface ResolvedVault {
	/** The Redux vault record (used by {@link vaultRefFor}). */
	vault: Vault;
	/** The session password (`volatile.credential`) — never logged. */
	credential: string;
}

/**
 * Resolves the vault from Redux state and requires it to be unlocked.
 *
 * Reads the same way `VaultInstance._saveVault` does
 * (`state.vault.vaults.find(v => v.id === vaultId)`), through the singleton
 * `VaultManager`'s state accessor so there is one wiring point for the store.
 *
 * @throws {PasskeyCeremonyError} when the manager is not initialized, the vault
 *   does not exist, or the vault is locked / has no session credential.
 */
function resolveUnlockedVault(vaultId: string): ResolvedVault {
	let state: ReturnType<
		ReturnType<typeof VaultManager.getInstance>["getState"]
	>;
	try {
		state = VaultManager.getInstance().getState();
	} catch (error) {
		throw new PasskeyCeremonyError(
			"Vault state is not available. Please reload the application.",
			error,
		);
	}

	const vault = state.vault.vaults.find(
		(candidate) => candidate.id === vaultId,
	);
	if (!vault) {
		throw new PasskeyCeremonyError("Vault not found.");
	}
	if (isVaultLocked(vault)) {
		throw new PasskeyCeremonyError("Vault must be unlocked.");
	}

	// `isVaultLocked` already guarantees the credential exists; the second read
	// narrows the type without a cast.
	const credential = vault.volatile?.credential;
	if (!credential) {
		throw new PasskeyCeremonyError("Vault must be unlocked.");
	}

	return { vault, credential };
}

/**
 * Runs the user-verification step.
 *
 * @param vaultName - Vault name, used in the prompt title (never the password).
 * @throws {PasskeyCeremonyError} when biometry is available and the prompt did
 *   not succeed, or when the availability check itself fails.
 */
async function assertUserVerification(vaultName: string): Promise<void> {
	let isAvailable: boolean;
	try {
		const status = await checkBiometricAvailability();
		isAvailable = status.isAvailable;
	} catch (error) {
		// A broken biometric subsystem is not "unavailable": silently proceeding
		// would turn a configuration error into a UV bypass.
		throw new PasskeyCeremonyError(
			"Could not verify your identity. Please try again.",
			error,
		);
	}

	if (!isAvailable) {
		// Documented fallback: the vault is unlocked, so the password the user
		// just typed is the UV. See the module docs.
		return;
	}

	const verified = await authenticate(i18n.t(UV_PROMPT_KEY), {
		allowDeviceCredential: true,
		title: i18n.t("home:passkey.uvPromptTitle"),
		subtitle: i18n.t("home:passkey.uvPromptSubtitle", { vaultName }),
		cancelTitle: i18n.t("home:passkey.uvPromptCancel"),
	}).catch((error: unknown) => {
		// `authenticate` is documented as never throwing (`false` on failure), but
		// a plugin regression must not surface as an untyped rejection — and above
		// all must not be mistaken for success.
		throw new PasskeyCeremonyError(
			"Could not verify your identity. Please try again.",
			error,
		);
	});

	if (!verified) {
		// `authenticate` never throws: `false` covers cancel, failure and lockout.
		// No password fallback here on purpose — the user retries the action.
		throw new PasskeyCeremonyError(i18n.t("home:passkey.uvFailed"));
	}
}

/**
 * Creates a passkey (registration ceremony) behind the UV gate.
 *
 * @param vaultId - Id of the vault the passkey is stored in.
 * @param request - `PublicKeyCredentialCreationOptions` subset; validated here
 *   with {@link passkeyCreateRequestSchema} before the prompt is shown.
 * @returns The spec-shaped registration response plus the vault entry id.
 * @throws {PasskeyCeremonyError} for a missing/locked vault, an invalid request,
 *   a failed UV prompt or a backend rejection (wrapped with context).
 */
export async function createPasskeyCeremony(
	vaultId: string,
	request: PasskeyCreateRequest,
): Promise<PasskeyCreateResponse> {
	const { vault, credential } = resolveUnlockedVault(vaultId);

	const parsed = passkeyCreateRequestSchema.safeParse(request);
	if (!parsed.success) {
		throw new PasskeyCeremonyError(
			`Invalid passkey registration request: ${parsed.error.issues[0]?.message ?? "unknown error"}`,
			parsed.error,
		);
	}

	await assertUserVerification(vault.name);

	try {
		return await PasskeyCommands.create(
			vaultRefFor(vault),
			credential,
			parsed.data as PasskeyCreateRequest,
		);
	} catch (error) {
		throw new PasskeyCeremonyError(
			`Passkey registration failed: ${describeFailure(error)}`,
			error,
		);
	}
}

/**
 * Asserts a passkey (authentication ceremony) behind the UV gate.
 *
 * @param vaultId - Id of the vault holding the passkey.
 * @param request - `PublicKeyCredentialRequestOptions` subset; validated here
 *   with {@link passkeyAssertRequestSchema} before the prompt is shown.
 * @returns The spec-shaped assertion plus the vault entry id.
 * @throws {PasskeyCeremonyError} for a missing/locked vault, an invalid request,
 *   a failed UV prompt or a backend rejection (wrapped with context).
 */
export async function assertPasskeyCeremony(
	vaultId: string,
	request: PasskeyAssertRequest,
): Promise<PasskeyAssertResponse> {
	const { vault, credential } = resolveUnlockedVault(vaultId);

	const parsed = passkeyAssertRequestSchema.safeParse(request);
	if (!parsed.success) {
		throw new PasskeyCeremonyError(
			`Invalid passkey authentication request: ${parsed.error.issues[0]?.message ?? "unknown error"}`,
			parsed.error,
		);
	}

	await assertUserVerification(vault.name);

	try {
		return await PasskeyCommands.assert(
			vaultRefFor(vault),
			credential,
			parsed.data as PasskeyAssertRequest,
		);
	} catch (error) {
		throw new PasskeyCeremonyError(
			`Passkey authentication failed: ${describeFailure(error)}`,
			error,
		);
	}
}

/**
 * Renders a backend rejection for the user.
 *
 * The Rust `CommandError` enum serializes to a string (`"Validation Error: …"`,
 * `"Invalid Password or Corrupted Vault"`), so a string is passed through
 * unchanged; an `Error` contributes its message. Anything else becomes a
 * generic sentence rather than `[object Object]`.
 */
function describeFailure(error: unknown): string {
	if (typeof error === "string" && error.length > 0) {
		return error;
	}
	if (error instanceof Error && error.message.length > 0) {
		return error.message;
	}
	return "the vault could not be unlocked or the request was refused";
}
