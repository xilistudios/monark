import type {
	CloudVaultMetadata,
	ProviderConfig,
} from "../interfaces/cloud-storage.interface";
import { StorageProviderType } from "../interfaces/cloud-storage.interface";
import type { Entry, VaultContent } from "../interfaces/vault.interface";
import {
	findEntryByPath,
	isGroupEntry,
	isPasskeyEntry,
} from "../interfaces/vault.interface";
import type { Vault } from "../redux/actions/vault";
import {
	addVault,
	clearSyncNotice,
	lockVault,
	removeStorageProvider,
	setCloudVaults,
	setCloudVaultsRefreshing,
	setDefaultStorageProvider,
	setOAuthState,
	setProviderStatus,
	setStorageProviders,
	setSyncNotice,
	setVaultCredential,
	setVaultEntries,
	setVaultLocked,
	syncCloudVault,
} from "../redux/actions/vault";
import type { AppDispatch, RootState } from "../redux/store";
import { findPathById } from "../utils/vaultNavigation";
import { deleteVaultPassword, storeVaultPassword } from "./biometric";
import { CloudStorageCommands } from "./cloudStorage";
import {
	isAuthFailure,
	isPasskeyNoKeyMaterialError,
} from "./cloudStorageErrors";
import VaultCommands from "./commands";
import PasskeyCommands, { vaultRefFor } from "./passkey";
import {
	getProviderAuthState,
	MANAGER_RETRY_POLICY,
	NO_RETRY_POLICY,
} from "./providerAuth";
import { mergeVaultEntries, reconcilePasskeysToCloud } from "./vaultMerge";
import { isVaultLocked } from "./vaultState";

/** i18n key of the actionable "sync this vault" message (namespace `home`). */
export const PASSKEY_WRITE_BLOCKED_KEY = "home:vault.passkeyWriteBlocked";

/**
 * The configured i18next instance, resolved on demand.
 *
 * Deliberately a dynamic import: `src/i18n` imports the Redux store, so a static
 * import here would make every consumer of this module (and every test that
 * mocks the store) load it. The bundler caches the module after the first call,
 * so the cost is one promise per process.
 *
 * @returns The shared i18next instance
 */
async function getI18n(): Promise<typeof import("../i18n").default> {
	const module = await import("../i18n");
	return module.default;
}

/**
 * The localised, actionable message of {@link PasskeyWriteBlockedError}.
 *
 * The configured i18next instance (`src/i18n`) is imported **lazily**, inside
 * the function: a static import would pull the Redux store into every module
 * that touches `vault.ts` (and break suites that mock the store). The lookup
 * runs at throw time, so a runtime language switch is honoured.
 *
 * The English literal is the i18next fallback for a missing key;
 * `src/i18n/locales/{en,es}.json` both carry `vault.passkeyWriteBlocked`.
 *
 * @returns The user-facing message in the active language
 */
async function passkeyWriteBlockedMessage(): Promise<string> {
	const i18n = await getI18n();
	return i18n.t(PASSKEY_WRITE_BLOCKED_KEY, {
		defaultValue:
			"A passkey in this vault is not present in the cloud copy this device could read (it may have been deleted on another device). Sync this vault to refresh the view, then try again.",
	});
}

/**
 * Raised when a cloud write cannot be completed because the vault view names a
 * passkey the cloud file no longer holds, and the one-shot reconciliation could
 * not heal it (MAYOR-1, layer 2).
 *
 * The message is the user-facing, actionable instruction, localised from the
 * `home:vault.passkeyWriteBlocked` key (see {@link PASSKEY_WRITE_BLOCKED_KEY}):
 * the raw backend message is never rendered (E13c) — it travels in {@link cause}
 * for debugging only.
 *
 * The wording deliberately says "not present in the cloud copy this device could
 * read" rather than "deleted on another device": the cloud read can also be a
 * stale offline cache (`docs/passkeys.md` §6), in which case nothing was deleted.
 */
export class PasskeyWriteBlockedError extends Error {
	/**
	 * Underlying failure, kept for debugging (`Error.cause`).
	 *
	 * Declared explicitly because the project targets ES2020, whose `Error` type
	 * has no `cause` member (same pattern as `PasskeyCeremonyError`).
	 */
	readonly cause?: unknown;

	/**
	 * @param message - User-facing, actionable message (never a raw payload).
	 * @param cause - Underlying failure, kept for debugging.
	 */
	constructor(message: string, cause?: unknown) {
		super(message);
		this.name = "PasskeyWriteBlockedError";
		if (cause !== undefined) {
			this.cause = cause;
		}
	}
}

export class VaultInstance {
	public readonly id: string;
	private vault: Vault;
	private dispatch: AppDispatch;
	private getState: () => RootState;

	constructor(vault: Vault, dispatch: AppDispatch, getState: () => RootState) {
		this.id = vault.id;
		this.vault = vault;
		this.dispatch = dispatch;
		this.getState = getState;
	}

	private async promptProviderReauth(providerName: string): Promise<void> {
		const state = this.getState();
		const oauthState = state.vault.oauthState ?? {
			providerName: null,
			authUrl: null,
			state: null,
			isOpen: false,
		};

		if (oauthState.isOpen && oauthState.providerName === providerName) {
			return;
		}

		this.dispatch(
			setProviderStatus({ providerId: providerName, status: "expired" }),
		);

		try {
			const { url, state: oauthStateValue } =
				await CloudStorageCommands.getGoogleDriveOAuthUrl(providerName);
			this.dispatch(
				setOAuthState({
					providerName,
					authUrl: url,
					state: oauthStateValue,
					isOpen: true,
				}),
			);
		} catch (error) {
			console.warn(`Failed to start re-auth flow for ${providerName}:`, error);
		}
	}


	async startProviderReauth(providerName: string): Promise<void> {
		await this.promptProviderReauth(providerName);
	}

	/**
	 * Unlocks the vault using the provided password
	 * Supports both local and cloud vaults
	 * @param password - The password to unlock the vault
	 * @throws Error if unlock fails
	 */
	async unlock(password: string): Promise<void> {
		try {
			let vaultContent: VaultContent;

			// Check if this is a cloud vault
			if (this.vault.storageType === "cloud") {
				if (!this.vault.providerId) {
					throw new Error(
						"Cloud vault is missing provider information. Cannot unlock.",
					);
				}
				const authState = await getProviderAuthState(
					this.vault.providerId,
					NO_RETRY_POLICY,
				);
				if (!authState.authenticated || authState.expired) {
					await this.promptProviderReauth(this.vault.providerId);
				}

				// Use cloud storage commands for cloud vaults
				const cloudFileId = this.vault.cloudMetadata?.fileId || this.vault.path;
				// Call with the object form to include the password for decryption
				vaultContent = await CloudStorageCommands.readCloudVault({
					vaultId: cloudFileId,
					password: password,
					providerName: this.vault.providerId,
				});
			} else {
				// Use local vault commands for local vaults
				vaultContent = await VaultCommands.read(this.vault.path, password);
			}

			// Dispatch setVaultCredential with the provided password
			this.dispatch(
				setVaultCredential({ vaultId: this.id, credential: password }),
			);

			// Dispatch setVaultEntries with the entries from the vault content
			this.dispatch(
				setVaultEntries({ vaultId: this.id, entries: vaultContent.entries }),
			);

			this.dispatch(setVaultLocked({ vaultId: this.id, isLocked: false }));

			this.vault = {
				...this.vault,
				isLocked: false,
			};

			// Note: Setting isLocked = false requires a reducer action that works by vault ID
			// This would typically be added to the vault slice reducers
		} catch (error) {
			const errorMessage =
				(error as any)?.message ||
				(error instanceof Error ? error.message : String(error));
			throw new Error(`Failed to unlock vault: ${errorMessage}`);
		}
	}

	/**
	 * Locks the vault and clears sensitive data from memory
	 */
	lock(): void {
		// Dispatch an action to clear the vault's volatile data (entries, credential, etc.)
		this.dispatch(lockVault(this.id));
		this.vault = {
			...this.vault,
			isLocked: true,
		};
	}

	/**
	 * Re-reads the vault from its backing store and refreshes the Redux entries.
	 *
	 * Needed after an **external** write: a passkey import (`import_cxf`, T16)
	 * happens inside the backend, which writes the vault file itself. The
	 * webview's `volatile.entries` is then stale — nothing in the Redux slice
	 * knows about the new passkeys until they are re-read.
	 *
	 * Unlike {@link unlock} this does **not** touch the credential or the locked
	 * flag: the caller is already unlocked and holds the session password, so
	 * re-deriving them would be a redundant state transition (and a second
	 * chance to flip `isLocked` on a transient read failure).
	 *
	 * - **local** vaults: `read_vault(path, credential)` then
	 *   `setVaultEntries` — the same read `unlock` performs.
	 * - **cloud** vaults: {@link syncWithCloud}, which re-reads the cloud file,
	 *   union-merges it with the local view and pushes the merged result back.
	 *   A plain re-read would drop entries created on this device since the last
	 *   push, so the merge is the correct refresh for cloud.
	 *
	 * @throws Error if the vault is locked — `isVaultLocked` is true when either
	 *   the `isLocked` flag is set or there is no session credential (locking
	 *   clears the credential, so both hold in practice) — or the read/sync
	 *   fails.
	 */
	async refreshEntries(): Promise<void> {
		const state = this.getState();
		const vault = state.vault.vaults.find((v) => v.id === this.id);

		if (!vault || isVaultLocked(vault)) {
			throw new Error("Vault must be unlocked to refresh entries");
		}
		const credential = vault.volatile?.credential;
		if (!credential) {
			// Unreachable: `isVaultLocked` already rejects a missing credential.
			// Kept so the type narrows without a cast.
			throw new Error("Vault must be unlocked to refresh entries");
		}

		if (vault.storageType === "cloud") {
			await this.syncWithCloud();
			return;
		}

		try {
			const vaultContent = await VaultCommands.read(vault.path, credential);
			this.dispatch(
				setVaultEntries({
					vaultId: this.id,
					entries: vaultContent.entries,
				}),
			);
		} catch (error) {
			const errorMessage =
				error instanceof Error ? error.message : String(error);
			throw new Error(`Failed to refresh vault entries: ${errorMessage}`);
		}
	}

	/**
	 * Adds a new entry to the vault at the specified path
	 * @param path - Array representing the path where to add the entry
	 * @param newEntry - The entry to add
	 * @throws Error if parent group not found or save fails
	 */
	async addEntry(path: string[], newEntry: Entry): Promise<void> {
		// Get the current entries from the Redux store using getState()
		const state = this.getState();
		const vault = state.vault.vaults.find((v) => v.id === this.id);
		const currentEntries = vault?.volatile?.entries ?? [];

		// Create a deep copy of the current entries
		const newEntries = structuredClone(currentEntries);

		if (path.length === 0) {
			// Add to root level
			newEntries.push(newEntry);
		} else {
			// Find the parent group using the path directly
			const parentEntry = findEntryByPath(newEntries, path);

			if (parentEntry && isGroupEntry(parentEntry)) {
				// Ensure children array exists
				if (!parentEntry.children) {
					parentEntry.children = [];
				}
				// Add the new entry to the parent's children
				parentEntry.children.push(newEntry);
			} else {
				throw new Error(`Parent group not found at path: ${path.join("/")}`);
			}
		}

		// Dispatch setVaultEntries with the new, updated entries
		this.dispatch(setVaultEntries({ vaultId: this.id, entries: newEntries }));

		// Call the private _saveVault() method to persist the changes
		await this._saveVault();
	}

	/**
	 * Adds multiple entries to the vault in bulk for better performance
	 * @param entriesWithPaths Array of objects containing path and entry data
	 */
	async addEntries(
		entriesWithPaths: Array<{ path: string[]; entry: Entry }>,
	): Promise<void> {
		if (entriesWithPaths.length === 0) {
			return;
		}

		// Get the current entries from the Redux store using getState()
		const state = this.getState();
		const vault = state.vault.vaults.find((v) => v.id === this.id);
		const currentEntries = vault?.volatile?.entries ?? [];

		// Create a deep copy of the current entries
		const newEntries = structuredClone(currentEntries);

		// Process all entries in a single operation
		for (const { path, entry } of entriesWithPaths) {
			if (path.length === 0) {
				// Add to root level
				newEntries.push(entry);
			} else {
				// Find the parent group using the path directly
				const parentEntry = findEntryByPath(newEntries, path);

				if (parentEntry && isGroupEntry(parentEntry)) {
					// Ensure children array exists
					if (!parentEntry.children) {
						parentEntry.children = [];
					}
					// Add the new entry to the parent's children
					parentEntry.children.push(entry);
				} else {
					throw new Error(`Parent group not found at path: ${path.join("/")}`);
				}
			}
		}

		// Dispatch setVaultEntries once with all new entries
		this.dispatch(setVaultEntries({ vaultId: this.id, entries: newEntries }));

		// Call the private _saveVault() method once to persist all changes
		await this._saveVault();
	}

	/**
	 * Updates an existing entry at the specified path
	 * @param path - Array representing the path to the entry
	 * @param updates - Partial entry data to update
	 * @throws Error if entry not found or save fails
	 */
	async updateEntry(path: string[], updates: Partial<Entry>): Promise<void> {
		// Get the current entries from the Redux store using getState()
		const state = this.getState();
		const vault = state.vault.vaults.find((v) => v.id === this.id);
		const currentEntries = vault?.volatile?.entries ?? [];

		// Create a deep copy of the current entries
		const newEntries = structuredClone(currentEntries);

		// Find the target entry
		const targetEntry = findEntryByPath(newEntries, path);

		if (targetEntry) {
			// Update the entry properties. `updated_at` is stamped only on the
			// entry kinds that carry it on the wire: a group has no timestamp in
			// the vault format (Rust `Entry::Group`), so stamping one here would
			// put a field into the persisted file that the type does not have and
			// the backend would drop on the next read.
			Object.assign(
				targetEntry,
				updates,
				isGroupEntry(targetEntry) ? {} : { updated_at: new Date().toISOString() },
			);

			// Dispatch setVaultEntries with the new, updated entries
			this.dispatch(setVaultEntries({ vaultId: this.id, entries: newEntries }));

			// Call the private _saveVault() method to persist the changes
			await this._saveVault();
		} else {
			throw new Error(`Entry not found at path: ${path.join("/")}`);
		}
	}

	/**
	 * Updates an entry by its unique ID, resolving the absolute path from the
	 * vault root automatically.  Callers should prefer this over
	 * {@link updateEntry} whenever they only have the entry ID and a
	 * potentially-wrong view path (e.g. mobile sidebar save, edit modals).
	 * @param entryId - The unique ID of the entry to update
	 * @param updates - Partial entry data to apply
	 * @throws Error if the entry does not exist in the vault
	 */
	async updateEntryById(entryId: string, updates: Partial<Entry>): Promise<void> {
		const state = this.getState();
		const vault = state.vault.vaults.find((v) => v.id === this.id);
		const entries = vault?.volatile?.entries ?? [];

		const path = findPathById(entries, entryId);
		if (path.length === 0) {
			throw new Error(`Entry not found: ${entryId}`);
		}

		await this.updateEntry(path, updates);
	}

	/**
	 * Deletes an entry at the specified path.
	 *
	 * Two deletion paths, chosen by the entry kind:
	 *
	 * - **passkey** → `passkey_delete` (T13). The backend write-merge preserves
	 *   every passkey it finds on disk, so a generic full-vault write that omits
	 *   one does NOT remove it: the explicit command is the only way to delete a
	 *   passkey. The disk is already updated when the command returns, so this
	 *   path deliberately returns **without** `_saveVault()`.
	 * - **data entry / group** → edit the in-memory tree and persist it with
	 *   `_saveVault()` (unchanged behaviour).
	 *
	 * @param path - Array representing the path to the entry to delete
	 * @throws Error if entry not found, the vault is locked, or the delete fails
	 */
	async deleteEntry(path: string[]): Promise<void> {
		// Get the current entries from the Redux store using getState()
		const state = this.getState();
		const vault = state.vault.vaults.find((v) => v.id === this.id);
		const currentEntries = vault?.volatile?.entries ?? [];

		// Create a deep copy of the current entries
		const newEntries = structuredClone(currentEntries);

		if (path.length === 0) {
			throw new Error("Cannot delete root entry");
		}

		const entryId = path[path.length - 1];
		const parentPath = path.slice(0, -1);

		// Passkey branch: resolve the target first, because the deletion has to go
		// through `passkey_delete` instead of a full-vault write.
		const target = findEntryByPath(newEntries, path);
		if (target && isPasskeyEntry(target)) {
			const credential = vault?.volatile?.credential;
			if (!vault || !credential) {
				throw new Error("No credential available for vault");
			}
			await PasskeyCommands.delete(vaultRefFor(vault), credential, entryId);

			// The vault file is already updated by the backend; only the in-memory
			// view has to follow. Returning here (instead of falling through to
			// `_saveVault`) is what keeps the delete from being a no-op: the
			// write-merge would re-attach the passkey we just removed.
			if (parentPath.length === 0) {
				this.dispatch(
					setVaultEntries({
						vaultId: this.id,
						entries: newEntries.filter((entry) => entry.id !== entryId),
					}),
				);
			} else {
				const parentEntry = findEntryByPath(newEntries, parentPath);
				if (parentEntry && isGroupEntry(parentEntry)) {
					parentEntry.children = parentEntry.children.filter(
						(child) => child.id !== entryId,
					);
					this.dispatch(
						setVaultEntries({ vaultId: this.id, entries: newEntries }),
					);
				} else {
					throw new Error(
						`Parent group not found at path: ${parentPath.join("/")}`,
					);
				}
			}
			return;
		}

		if (parentPath.length === 0) {
			// Delete from root level
			const filteredEntries = newEntries.filter(
				(entry) => entry.id !== entryId,
			);
			this.dispatch(
				setVaultEntries({ vaultId: this.id, entries: filteredEntries }),
			);
		} else {
			// Find the parent group
			const parentEntry = findEntryByPath(newEntries, parentPath);

			if (parentEntry && isGroupEntry(parentEntry)) {
				// Filter the parent's children to remove the entry
				parentEntry.children = parentEntry.children.filter(
					(child) => child.id !== entryId,
				);

				// Dispatch setVaultEntries with the new, updated entries
				this.dispatch(
					setVaultEntries({ vaultId: this.id, entries: newEntries }),
				);
			} else {
				throw new Error(
					`Parent group not found at path: ${parentPath.join("/")}`,
				);
			}
		}

		// Call the private _saveVault() method to persist the changes
		await this._saveVault();
	}

	/**
	 * Saves the vault to storage (local or cloud)
	 * @private
	 * @throws Error if save fails
	 */
	private async _saveVault(): Promise<void> {
		// Get the vault's path and credential from the Redux store
		const state = this.getState();
		const vault = state.vault.vaults.find((v) => v.id === this.id);

		if (!vault?.volatile?.credential) {
			throw new Error("No credential available for vault");
		}

		const password = vault.volatile.credential;
		const entries = vault.volatile.entries ?? [];

		// Create the Vault object that matches the backend Rust struct
		const vaultContent = {
			updated_at: new Date().toISOString(),
			hmac: "",
			entries: entries,
		};

		// Check if this is a cloud vault
		// Cloud vaults must never fall through to the local write path: their
		// "path" is a cloud file identifier, not a filesystem path.
		if (vault.storageType === "cloud") {
			if (!vault.providerId) {
				throw new Error(
					"Cloud vault is missing provider information. Cannot save to cloud storage.",
				);
			}

			// Pass the vault ID (stored in vault.path) to update the existing vault
			const cloudFileId = vault.cloudMetadata?.fileId || vault.path;
			if (!cloudFileId) {
				throw new Error(
					"Cloud vault is missing its cloud file identifier. Cannot save to cloud storage.",
				);
			}

			await this._writeCloudVaultWithPasskeyRecovery({
				vaultId: cloudFileId,
				vaultName: vault.name,
				password: password,
				// Already in the backend's snake_case `VaultView` shape. Passkey
				// secrets are absent by design: the backend re-attaches them from
				// the stored vault by entry id.
				vaultContent: vaultContent,
				providerName: vault.providerId,
			});

			// Update sync timestamp
			this.dispatch(syncCloudVault(this.id));
		} else {
			// Use local vault commands for local vaults
			await VaultCommands.write(vault.path, password, vaultContent);
		}
	}

	/**
	 * Pushes a cloud vault, recovering **once** from the fail-closed passkey
	 * rejection (MAYOR-1, layer 2).
	 *
	 * The backend write-merge refuses a view that names a passkey id the stored
	 * cloud file no longer holds (`restore_passkey`, `merge.rs:231-240`) — the
	 * signature of a passkey deleted on another device. Layer 1
	 * ({@link syncWithCloud}) reconciles that away during a sync, but a Data edit
	 * pushed *before* the first sync after the remote delete, or a delete that
	 * lands between our cloud read and our push (TOCTOU), still hits it. This
	 * wrapper turns that one failure into a self-heal:
	 *
	 * 1. re-read the cloud file (the authority) — a read failure propagates;
	 * 2. reconcile the **current** Redux view against it, which drops only
	 *    cloud-absent passkeys and keeps the user's just-saved Data edits;
	 * 3. if nothing was dropped the error is not ours: re-throw it (no blind
	 *    retry);
	 * 4. otherwise dispatch the reconciled view + the notice and retry the write
	 *    **directly** (never `_saveVault`, so there is no recursion). A second
	 *    failure propagates.
	 *
	 * Every other failure (auth, quota, IO) is re-thrown untouched, so the D1
	 * auth routing in `syncWithCloud` keeps working. When the recovery cannot
	 * apply, the caller gets the actionable i18n error with the original as
	 * `cause` — never the raw backend message (E13c).
	 *
	 * @param request - The exact `writeCloudVault` payload built by `_saveVault`.
	 * @throws Error the actionable "sync this vault" error, or the original one
	 */
	private async _writeCloudVaultWithPasskeyRecovery(request: {
		vaultId: string;
		vaultName: string;
		password: string;
		vaultContent: { updated_at: string; hmac: string; entries: Entry[] };
		providerName: string;
	}): Promise<void> {
		try {
			await CloudStorageCommands.writeCloudVault(request);
			return;
		} catch (error) {
			if (!isPasskeyNoKeyMaterialError(error)) {
				throw error;
			}

			try {
				const fresh = await CloudStorageCommands.readCloudVault({
					vaultId: request.vaultId,
					password: request.password,
					providerName: request.providerName,
				});

				const current =
					this.getState().vault.vaults.find((v) => v.id === this.id)?.volatile
						?.entries ?? [];
				const { entries: reconciled, dropped } = reconcilePasskeysToCloud(
					current,
					fresh.entries ?? [],
				);

				// Nothing to heal ⇒ this is not the cross-device case; a retry
				// would send the identical payload and fail identically. The user
				// still gets the actionable message (same situation from their
				// point of view, just unhealable) instead of the raw JSON blob.
				if (dropped.length === 0) {
					throw new PasskeyWriteBlockedError(
						await passkeyWriteBlockedMessage(),
						error,
					);
				}

				this.dispatch(
					setVaultEntries({ vaultId: this.id, entries: reconciled }),
				);
				this.dispatch(
					setSyncNotice({
						vaultId: this.id,
						passkeys: dropped.map((passkey) => ({
							id: passkey.id,
							name: passkey.name,
						})),
					}),
				);

				await CloudStorageCommands.writeCloudVault({
					...request,
					vaultContent: { ...request.vaultContent, entries: reconciled },
				});
			} catch (recoveryError) {
				// Already mapped above (the unhealable branch): do not re-wrap.
				if (recoveryError instanceof PasskeyWriteBlockedError) {
					throw recoveryError;
				}
				// The original fail-closed error is the interesting one when the
				// recovery could not apply; keep it as the cause either way.
				throw new PasskeyWriteBlockedError(
					await passkeyWriteBlockedMessage(),
					recoveryError === error ? error : recoveryError,
				);
			}
		}
	}

	/**
	 * Forces a sync with cloud storage for cloud vaults
	 * @throws Error if vault is not a cloud vault or sync fails
	 */
	async syncWithCloud(): Promise<void> {
		if (this.vault.storageType !== "cloud" || !this.vault.providerId) {
			throw new Error("Cannot sync non-cloud vault");
		}

		const state = this.getState();
		const vault = state.vault.vaults.find((v) => v.id === this.id);

		if (!vault?.volatile?.credential) {
			throw new Error("Vault must be unlocked to sync");
		}

		if (vault.providerId) {
			const authState = await getProviderAuthState(
				vault.providerId,
				NO_RETRY_POLICY,
			);
			if (!authState.authenticated || authState.expired) {
				await this.promptProviderReauth(vault.providerId);
			}
		}

		try {
			// Re-read from cloud to get latest version
			const cloudFileId = vault.cloudMetadata?.fileId || vault.path;
			const vaultContent = await CloudStorageCommands.readCloudVault({
				vaultId: cloudFileId,
				password: vault.volatile.credential,
				providerName: vault.providerId,
			});

			// Union merge instead of pull-only last-write-wins: entries created
			// locally since the last push survive the sync. Same-id data/passkey
			// conflicts go to the newest `updated_at`; same-id group conflicts are
			// cloud-authoritative for the group's own metadata (groups carry no
			// timestamp in the vault format) while their children are unioned.
			// See `services/vaultMerge.ts` for the rules.
			const merged = mergeVaultEntries(
				vault.volatile.entries ?? [],
				vaultContent.entries ?? [],
			);

			// Layer 1 of the MAYOR-1 fix: the cloud file is the authority on which
			// passkeys exist (key material never crosses IPC, and the backend
			// write-merge fails closed on an id the file lacks). The union merge
			// deliberately keeps local-only ids, so a passkey deleted on another
			// device would otherwise survive here and make the push below fail —
			// wedging every write on this device. Reconcile against the same fresh
			// read before pushing: only cloud-absent passkey views are dropped
			// (Data entries and groups are untouched), and the user is told.
			const { entries: reconciled, dropped } = reconcilePasskeysToCloud(
				merged,
				vaultContent.entries ?? [],
			);
			this.dispatch(setVaultEntries({ vaultId: this.id, entries: reconciled }));
			if (dropped.length > 0) {
				this.dispatch(
					setSyncNotice({
						vaultId: this.id,
						passkeys: dropped.map((passkey) => ({
							id: passkey.id,
							name: passkey.name,
						})),
					}),
				);
			} else {
				// Symmetric with layer 2: a drop-free sync dismisses a stale
				// banner instead of leaving it up until the user closes it.
				this.dispatch(clearSyncNotice());
			}

			// Push the merged view back so the cloud file converges with this
			// device. The backend write-merge re-attaches passkey secrets from the
			// stored cloud vault by entry id; the view carries no key material.
			// If this fails the error propagates: Redux keeps the merged entries
			// and the next sync retries the push.
			//
			// `_saveVault` also dispatches `syncCloudVault` (the sync timestamp),
			// so it must not be dispatched again here.
			await this._saveVault();
		} catch (error) {
			const errorMessage =
				(error as any)?.message ||
				(error instanceof Error ? error.message : String(error));

			// Auth-shaped failures ONLY (D1): dispatch the "error" status AND open
			// the re-auth prompt inside a single guard. Non-auth failures (quota,
			// permission, operation) leave the provider status untouched — the
			// pre-refactor behaviour of `isAuthRelatedCloudError`, preserved.
			if (this.vault.providerId && isAuthFailure(error)) {
				this.dispatch(
					setProviderStatus({
						providerId: this.vault.providerId,
						status: "error",
					}),
				);
				void this.promptProviderReauth(this.vault.providerId);
			}

			throw new Error(`Failed to sync with cloud: ${errorMessage}`);
		}
	}

	/**
	 * Changes the vault password and re-encrypts the vault with the new password
	 * Supports both local and cloud vaults
	 * @param newPassword - The new password to set
	 * @throws Error if password change fails
	 */
	async changePassword(newPassword: string): Promise<void> {
		// Get the current vault state
		const state = this.getState();
		const vault = state.vault.vaults.find((v) => v.id === this.id);

		if (!vault?.volatile?.credential) {
			throw new Error("Vault must be unlocked to change password");
		}

		if (!newPassword || newPassword.length === 0) {
			throw new Error("New password is required");
		}

		const oldPassword = vault.volatile.credential;

		try {
			if (vault.storageType === "cloud") {
				if (!vault.providerId) {
					throw new Error(
						"Cloud vault is missing provider information. Cannot change password.",
					);
				}
				// For cloud vaults, use the dedicated password change command
				const cloudFileId = vault.cloudMetadata?.fileId || vault.path;

				// Use the new changeCloudVaultPassword command
				await CloudStorageCommands.changeCloudVaultPassword(
					cloudFileId,
					oldPassword, // Use the old password to decrypt
					newPassword, // Use the new password to encrypt
					vault.providerId,
				);

				// Update sync timestamp
				this.dispatch(syncCloudVault(this.id));
			} else {
				// For local vaults, re-wrap the master key under the new password.
				// `write_vault` cannot do this: it derives the master key from the
				// supplied password, which fails against the old-password-wrapped
				// credentials (and would silently create a fresh vault if the file
				// were missing).
				await VaultCommands.changePassword(
					vault.path,
					oldPassword,
					newPassword,
				);
			}

			// Update the stored credential with the new password
			this.dispatch(
				setVaultCredential({ vaultId: this.id, credential: newPassword }),
			);

			// After successful password change, re-store biometric data if enabled
			if (this.vault.biometricEnabled) {
				try {
					await storeVaultPassword(this.vault.id, newPassword);
				} catch (e) {
					console.error("Failed to re-store biometric data after password change:", e);
					// If re-store fails, disable biometric to avoid stale data
					await deleteVaultPassword(this.vault.id);
				}
			}
		} catch (error) {
			const errorMessage =
				(error as any)?.message ||
				(error instanceof Error ? error.message : String(error));
			throw new Error(`Failed to change vault password: ${errorMessage}`);
		}
	}

	/**
	 * Gets cloud metadata for cloud vaults
	 * @returns CloudVaultMetadata or null if not a cloud vault
	 */
	getCloudMetadata(): CloudVaultMetadata | null {
		if (this.vault.storageType !== "cloud" || !this.vault.cloudMetadata) {
			return null;
		}

		// Get provider type from state or default to google_drive
		const state = this.getState();
		const provider = state.vault.providers.find(
			(p) => p.name === this.vault.cloudMetadata?.provider,
		);
		const providerType =
			provider?.provider_type || StorageProviderType.GOOGLE_DRIVE;

		return {
			id: this.vault.cloudMetadata.fileId,
			name: this.vault.name,
			providerName: this.vault.cloudMetadata.provider,
			providerType,
			createdAt: this.vault.cloudMetadata.lastSync || "",
			modifiedAt: this.vault.cloudMetadata.lastSync || "",
			path: this.vault.path,
			isFolder: false,
			mimeType: "application/json",
			parentId: undefined,
			metadata: {},
		};
	}
}

export class VaultManager {
	private static instance: VaultManager;
	private _instances: Map<string, VaultInstance>;
	private _dispatch: AppDispatch | null = null;
	private _getState: (() => RootState) | null = null;

	private constructor() {
		this._instances = new Map();
	}

	private async promptProviderReauth(providerName: string): Promise<void> {
		if (!this._dispatch || !this._getState) {
			return;
		}

		const state = this._getState();
		const oauthState = state.vault.oauthState;
		const currentStatus = state.vault.providerStatus[providerName];

		if (oauthState.isOpen && oauthState.providerName === providerName) {
			return;
		}

		if (currentStatus === "authenticating") {
			return;
		}

		this._dispatch(
			setProviderStatus({ providerId: providerName, status: "expired" }),
		);

		try {
			const { url, state: oauthStateValue } =
				await CloudStorageCommands.getGoogleDriveOAuthUrl(providerName);
			this._dispatch(
				setOAuthState({
					providerName,
					authUrl: url,
					state: oauthStateValue,
					isOpen: true,
				}),
			);
		} catch (error) {
			console.warn(`Failed to start re-auth flow for ${providerName}:`, error);
		}
	}

	static getInstance(): VaultManager {
		if (!VaultManager.instance) {
			VaultManager.instance = new VaultManager();
		}
		return VaultManager.instance;
	}

	/**
	 * Initializes the VaultManager with Redux dispatch and getState functions
	 * @param dispatch - Redux dispatch function
	 * @param getState - Redux getState function
	 */
	initialize(dispatch: AppDispatch, getState: () => RootState): void {
		this._dispatch = dispatch;
		this._getState = getState;
	}

	/**
	 * Reads the current Redux state through the manager's store binding.
	 *
	 * The single accessor for services that need vault records but are not a
	 * `VaultInstance` (e.g. `services/passkeyCeremony.ts`, which resolves the
	 * session credential for a passkey command). It throws the same error
	 * `getInstance` throws when the manager was never initialized, so callers
	 * have one failure mode to handle.
	 *
	 * @throws Error if the manager has not been initialized.
	 */
	getState(): RootState {
		if (!this._getState) {
			throw new Error("VaultManager not initialized. Call initialize() first.");
		}
		return this._getState();
	}

	/**
	 * Gets a VaultInstance for the specified vault ID
	 * Creates a new instance if one doesn't exist
	 * @param vaultId - ID of the vault to get instance for
	 * @returns VaultInstance or undefined if vault not found
	 */
	getInstance(vaultId: string): VaultInstance | undefined {
		// Check if instance already exists
		if (this._instances.has(vaultId)) {
			return this._instances.get(vaultId);
		}

		// If it doesn't exist, create a new one if we have the required dependencies
		if (!this._dispatch || !this._getState) {
			throw new Error("VaultManager not initialized. Call initialize() first.");
		}

		// Get the vault from the Redux store
		const state = this._getState();
		const vault = state.vault.vaults.find((v) => v.id === vaultId);

		if (!vault) {
			return undefined;
		}

		// Ensure cloud vaults have a provider (cloudMetadata is optional; the
		// cloud file identifier falls back to vault.path when missing)
		if (vault.storageType === "cloud" && !vault.providerId) {
			console.warn(`Cloud vault ${vaultId} is missing provider information`);
			return undefined;
		}

		// Create new instance, store it, and return it
		const newInstance = new VaultInstance(
			vault,
			this._dispatch,
			this._getState,
		);
		this._instances.set(vaultId, newInstance);
		return newInstance;
	}

	/**
	 * Removes a VaultInstance from the manager
	 * @param vaultId - ID of the vault instance to remove
	 */
	removeInstance(vaultId: string): void {
		this._instances.delete(vaultId);
	}

	async startProviderReauth(providerName: string): Promise<void> {
		if (!this._dispatch || !this._getState) {
			throw new Error("VaultManager not initialized. Call initialize() first.");
		}

		await this.promptProviderReauth(providerName);
	}

	/**
	 * Loads storage providers from backend and updates Redux state
	 */
	async loadProviders(): Promise<void> {
		if (!this._dispatch) {
			throw new Error("VaultManager not initialized. Call initialize() first.");
		}

		try {
			const providers = await CloudStorageCommands.listProviders();
			this._dispatch(setStorageProviders(providers));

			// Check authentication status for each provider
			for (const provider of providers) {
				try {
					const authState = await getProviderAuthState(
						provider.name,
						MANAGER_RETRY_POLICY,
					);

					// Update provider status based on authentication state
					this._dispatch(
						setProviderStatus({
							providerId: provider.name,
							status: authState.expired
								? "expired"
								: authState.authenticated
									? "authenticated"
									: "idle",
						}),
					);
				} catch (error) {
					console.error(
						`Failed to check auth status for provider ${provider.name}:`,
						error,
					);
					// Set to idle if we can't determine the status
					this._dispatch(
						setProviderStatus({
							providerId: provider.name,
							status: "idle",
						}),
					);
				}
			}
		} catch (error) {
			const errorMessage =
				(error as any)?.message ||
				(error instanceof Error ? error.message : String(error));
			throw new Error(`Failed to load providers: ${errorMessage}`);
		}
	}

	/**
	 * Adds a new storage provider configuration
	 * @param request - Provider request with name and configuration
	 */
	async addProvider(request: {
		name: string;
		config: ProviderConfig;
	}): Promise<void> {
		if (!this._dispatch) {
			throw new Error("VaultManager not initialized. Call initialize() first.");
		}

		try {
			await CloudStorageCommands.addProvider(request);

			// Reload providers to get updated list
			await this.loadProviders();
		} catch (error) {
			// Handle CloudStorageError objects specifically
			const errorMessage =
				(error as any)?.message ||
				(error instanceof Error ? error.message : String(error));
			throw new Error(`Failed to add provider: ${errorMessage}`);
		}
	}

	/**
	 * Removes a storage provider configuration
	 * @param providerId - ID of the provider to remove
	 */
	async removeProvider(providerId: string): Promise<void> {
		if (!this._dispatch) {
			throw new Error("VaultManager not initialized. Call initialize() first.");
		}

		try {
			await CloudStorageCommands.removeProvider(providerId);
			this._dispatch(removeStorageProvider(providerId));
		} catch (error) {
			const errorMessage =
				(error as any)?.message ||
				(error instanceof Error ? error.message : String(error));
			throw new Error(`Failed to remove provider: ${errorMessage}`);
		}
	}

	/**
	 * Sets the default storage provider
	 * @param providerId - ID of the provider to set as default
	 */
	async setDefaultProvider(providerId: string): Promise<void> {
		if (!this._dispatch) {
			throw new Error("VaultManager not initialized. Call initialize() first.");
		}

		try {
			await CloudStorageCommands.setDefaultProvider(providerId);
			this._dispatch(setDefaultStorageProvider(providerId));
		} catch (error) {
			const errorMessage =
				(error as any)?.message ||
				(error instanceof Error ? error.message : String(error));
			throw new Error(`Failed to set default provider: ${errorMessage}`);
		}
	}

	/**
	 * Authenticates with a storage provider
	 * @param providerId - ID of the provider to authenticate
	 */
	async authenticateProvider(providerId: string): Promise<void> {
		if (!this._dispatch) {
			throw new Error("VaultManager not initialized. Call initialize() first.");
		}

		try {
			this._dispatch(
				setProviderStatus({ providerId, status: "authenticating" }),
			);
			await CloudStorageCommands.authenticateProvider(providerId);
			this._dispatch(
				setProviderStatus({ providerId, status: "authenticated" }),
			);
		} catch (error) {
			this._dispatch(setProviderStatus({ providerId, status: "error" }));
			const errorMessage =
				(error as any)?.message ||
				(error instanceof Error ? error.message : String(error));
			throw new Error(`Failed to authenticate provider: ${errorMessage}`);
		}
	}

	/**
	 * Gets authentication URL for a provider
	 * @param providerId - ID of the provider to get auth URL for
	 * @returns Authentication URL
	 */
	async getAuthenticationUrl(providerId: string): Promise<string> {
		if (!this._dispatch) {
			throw new Error("VaultManager not initialized. Call initialize() first.");
		}

		try {
			// For now, return a mock URL - in a real implementation this would call the backend
			// to generate a proper OAuth URL with state and other parameters
			const authUrl = `https://accounts.google.com/oauth/authorize?client_id=mock_client_id&redirect_uri=http://localhost:1420/auth/callback&response_type=code&scope=https://www.googleapis.com/auth/drive.file&state=${providerId}_${Date.now()}`;
			return authUrl;
		} catch (error) {
			const errorMessage =
				(error as any)?.message ||
				(error instanceof Error ? error.message : String(error));
			throw new Error(`Failed to get authentication URL: ${errorMessage}`);
		}
	}

	/**
	 * Lists cloud vaults from storage providers
	 * @param providerId - Optional provider ID to filter by
	 * @returns Array of vault objects
	 */
	async listCloudVaults(providerId?: string): Promise<Vault[]> {
		if (!this._dispatch) {
			throw new Error("VaultManager not initialized. Call initialize() first.");
		}

		try {
			const cloudVaultsMetadata =
				await CloudStorageCommands.listCloudVaults(providerId);

			// Convert CloudVaultMetadata to Vault objects
			const vaults: Vault[] = cloudVaultsMetadata.map((metadata) => ({
				id: metadata.id,
				name: metadata.name,
				path: metadata.id, // Use cloud file ID as path
				storageType: "cloud" as const,
				providerId: metadata.providerName,
				cloudMetadata: {
					fileId: metadata.id,
					provider: metadata.providerName,
					lastSync: metadata.modifiedAt,
				},
				biometricEnabled: false,
				isLocked: true,
				volatile: {
					entries: [],
					credential: "",
					navigationPath: "/",
					encryptedData: undefined,
				},
			}));

			return vaults;
		} catch (error) {
			const errorMessage =
				(error as any)?.message ||
				(error instanceof Error ? error.message : String(error));
			throw new Error(`Failed to list cloud vaults: ${errorMessage}`);
		}
	}

	/**
	 * Refreshes cloud vault list in Redux state
	 * Only refreshes vaults from actual cloud providers (not local)
	 * Preserves cached vaults on network errors
	 */
	async refreshCloudVaults(): Promise<void> {
		if (!this._dispatch || !this._getState) {
			throw new Error("VaultManager not initialized. Call initialize() first.");
		}

		this._dispatch(setCloudVaultsRefreshing(true));

		try {
			// Get providers from state and filter only cloud providers
			const state = this._getState();
			if (!state?.vault?.providers) {
				// No providers configured yet, that's okay — leave cached vaults untouched
				return;
			}

			const cloudProviders = state.vault.providers.filter(
				(p) => p.provider_type !== StorageProviderType.LOCAL,
			);

			if (cloudProviders.length === 0) {
				return;
			}

			// Collect vaults from all cloud providers
			const allCloudVaults: Vault[] = [];
			let hadNetworkErrors = false;
			let hadGenuineAuthErrors = false;

			for (const provider of cloudProviders) {
				try {
					const authState = await getProviderAuthState(
						provider.name,
						MANAGER_RETRY_POLICY,
					);

					// Handle transient errors returned from retry logic (not thrown)
					if (authState.transientError) {
						hadNetworkErrors = true;
						console.warn(
							`Transient auth error for provider ${provider.name} after retries, skipping`,
						);
						continue;
					}

					if (!authState.authenticated || authState.expired) {
						// Genuine auth expiration — prompt re-auth
						hadGenuineAuthErrors = true;
						this._dispatch(
							setProviderStatus({
								providerId: provider.name,
								status: "expired",
							}),
						);
						await this.promptProviderReauth(provider.name);
						continue;
					}

					const providerVaults = await this.listCloudVaults(provider.name);
					allCloudVaults.push(...providerVaults);
				} catch (error) {
					if (isAuthFailure(error)) {
						// Auth-related genuine error — prompt re-auth
						hadGenuineAuthErrors = true;
						this._dispatch(
							setProviderStatus({
								providerId: provider.name,
								status: "expired",
							}),
						);
						await this.promptProviderReauth(provider.name);
					} else {
						// Network or other transient error — don't trigger re-auth
						hadNetworkErrors = true;
						console.warn(
							`Transient error fetching vaults for provider ${provider.name}, keeping cached data`,
						);
					}
				}
			}

			// Only update Redux state if we actually got results or had genuine auth errors.
			// If allProviders failed due to network errors, keep the cached vaults intact.
			if (allCloudVaults.length > 0) {
				this._dispatch(setCloudVaults(allCloudVaults));
			} else if (hadGenuineAuthErrors && !hadNetworkErrors) {
				// All providers were genuinely unauthenticated — clear cloud vaults
				this._dispatch(setCloudVaults([]));
			}
			// Otherwise (all network errors, no results) — leave cached vaults in Redux untouched
		} catch (error) {
			const errorMessage =
				(error as any)?.message ||
				(error instanceof Error ? error.message : String(error));
			throw new Error(`Failed to refresh cloud vaults: ${errorMessage}`);
		} finally {
			this._dispatch(setCloudVaultsRefreshing(false));
		}
	}

	/**
	 * Creates a new vault
	 * @param name - Vault name
	 * @param password - Vault password
	 * @param storageType - Storage type (local or cloud)
	 * @param providerId - Cloud provider ID (required for cloud vaults)
	 * @param path - Optional path for local vaults
	 * @param parentId - Optional parent folder ID for cloud vaults
	 * @returns Created vault ID
	 */
	async createVault(
		name: string,
		password: string,
		storageType: "local" | "cloud",
		providerId?: string,
		path?: string,
		parentId?: string,
	): Promise<string> {
		if (!this._dispatch) {
			throw new Error("VaultManager not initialized. Call initialize() first.");
		}

		// Input validation
		if (!name || name.trim().length === 0) {
			throw new Error("Vault name is required");
		}
		if (!password || password.length === 0) {
			throw new Error("Password is required");
		}
		if (storageType === "cloud" && !providerId) {
			throw new Error("Provider ID is required for cloud vaults");
		}

		try {
			const vaultId = `vault_${crypto.randomUUID()}`;
			let vaultPath: string;
			let cloudMetadata: Vault["cloudMetadata"] | undefined;

			if (storageType === "cloud") {
				// Create cloud vault
				const vaultContent = {
					updated_at: new Date().toISOString(),
					hmac: "",
					entries: [],
				};

				// Use request object form to create a new vault with vaultName and password
				const cloudVaultId = await CloudStorageCommands.writeCloudVault({
					vaultName: name,
					password: password,
					vaultContent: vaultContent, // Use snake_case format directly
					providerName: providerId!,
					parentId: parentId,
				} as any);

				vaultPath = cloudVaultId;
				cloudMetadata = {
					fileId: cloudVaultId,
					provider: providerId!,
					lastSync: new Date().toISOString(),
				};
			} else {
				// Create local vault
				const vaultContent = {
					updated_at: new Date().toISOString(),
					hmac: "",
					entries: [],
				};

				// Use provided path or generate default
				vaultPath = path || `${name}.vault`;

				// Create the vault file using VaultCommands
				await VaultCommands.write(vaultPath, password, vaultContent);
			}

			const vault: Vault = {
				id: vaultId,
				name,
				path: vaultPath,
				storageType,
				providerId: storageType === "cloud" ? providerId : undefined,
				cloudMetadata,
				biometricEnabled: false,
				isLocked: true,
				lastAccessed: new Date().toISOString(),
				volatile: {
					entries: [],
					credential: "",
					navigationPath: "/",
					encryptedData: undefined,
				},
			};

			this._dispatch(addVault(vault));
			return vaultId;
		} catch (error) {
			const errorMessage =
				(error as any)?.message ||
				(error instanceof Error ? error.message : String(error));
			throw new Error(`Failed to create vault: ${errorMessage}`);
		}
	}

	/**
	 * Changes the password for an existing vault
	 * @param vaultId - ID of the vault to change password for
	 * @param newPassword - The new password to set
	 * @throws Error if vault not found or password change fails
	 */
	async changeVaultPassword(
		vaultId: string,
		newPassword: string,
	): Promise<void> {
		const vaultInstance = this.getInstance(vaultId);
		if (!vaultInstance) {
			throw new Error("Vault not found");
		}

		await vaultInstance.changePassword(newPassword);
	}
}
