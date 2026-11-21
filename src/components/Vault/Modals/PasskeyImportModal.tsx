import { open } from "@tauri-apps/plugin-dialog";
import { readTextFile } from "@tauri-apps/plugin-fs";
import { useContext, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSelector } from "react-redux";
import type { CxfImportReport } from "../../../interfaces/passkey.interface";
import type { RootState } from "../../../redux/store";
import PasskeyCommands, { vaultRefFor } from "../../../services/passkey";
import {
	type ResolvedVault,
	resolveUnlockedVaultForCxf,
} from "../../../services/passkeyCeremony";
import { VaultManager } from "../../../services/vault";
import { cxfImportReportSchema } from "../../../utils/validation/passkeySchemas";
import { Modal } from "../../UI/Modal";
import { VaultModalContext } from "../VaultContext";

/**
 * Mirror of `passkey::cxf::EXTENSIONS_IGNORED_NOTE` (Rust).
 *
 * The import report has no separate "note" channel, so the reason string is the
 * only discriminator between a rejected credential and one that was imported
 * with data dropped. A drift would render every lossy row as "not imported"
 * while the passkey sits in the vault, so the value is pinned **against the
 * Rust source**: `src/test/components/Vault/PasskeyImportModal.test.tsx` reads
 * `src-tauri/src/passkey/cxf.rs` and asserts this literal matches the
 * `EXTENSIONS_IGNORED_NOTE` constant byte for byte.
 */
export const EXTENSIONS_IGNORED_NOTE =
	"extension data ignored (fido2Extensions)";

/** Last path segment, for display only. */
function basename(path: string): string {
	const parts = path.split(/[\\/]/);
	return parts[parts.length - 1] || path;
}

/**
 * CXF import modal (T18): the user-facing half of `import_cxf` (T16).
 *
 * ## Flow
 *
 * 1. **Pick a file** — `open` from `@tauri-apps/plugin-dialog` filtered to
 *    `json`/`cxf` (the same picker shape as `ImportCsvModal`), then
 *    `readTextFile` from `@tauri-apps/plugin-fs`.
 * 2. **Require an unlocked vault** — `resolveUnlockedVaultForCxf` reads the
 *    session credential from Redux; a locked vault shows a message and never
 *    reaches the command.
 * 3. **Import** — `PasskeyCommands.importCxf(vaultRefFor(vault), credential,
 *    content)`. The backend parses and validates the document before it touches
 *    the vault, so a malformed file costs no password derivation.
 * 4. **Validate the report** with `cxfImportReportSchema` before rendering it:
 *    the counts are what the user acts on, and an unexpected wire shape must
 *    not be rendered as numbers the UI cannot interpret.
 * 5. **Refresh** the Redux entries (`VaultInstance.refreshEntries`) — the
 *    import wrote the vault file inside the backend, so the webview's view is
 *    stale until it re-reads. The modal stays open showing the report; the user
 *    closes it, which is also when the entries are already visible behind it.
 *
 * ## Reading the report
 *
 * `skipped` is **not** a failure list. It carries two kinds of row:
 *
 * - **rejected** credentials (unsupported type, invalid field) — *not*
 *   imported;
 * - **imported but lossy** ones, whose only case today is dropped
 *   `fido2Extensions`, reported with `reason === EXTENSIONS_IGNORED_NOTE`.
 *
 * The report has no separate channel for the two, so this UI compares `reason`
 * against that constant and renders a lossy row as a warning ("imported, some
 * data ignored") instead of a failure. `skipped.length` is never rendered as
 * "N failed".
 *
 * ## Secrets
 *
 * The file content and the session password are never logged: the only
 * diagnostic is the sanitized message the backend produced (which never
 * contains key material — see `passkey_import.rs`). There is no input for
 * credential material anywhere in this modal.
 */
export function PasskeyImportModal() {
	const { t } = useTranslation("home");
	const currentVaultId = useSelector(
		(state: RootState) => state.vault.currentVaultId,
	);
	const context = useContext(VaultModalContext);
	if (!context) {
		throw new Error(
			"VaultModalContext must be used within a VaultModalProvider",
		);
	}
	const { isPasskeyImportModalOpen, closePasskeyImport } = context;

	const [fileName, setFileName] = useState<string | null>(null);
	const [report, setReport] = useState<CxfImportReport | null>(null);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);

	/** Resets the modal-local state (a second import must not show stale counts). */
	const resetState = (): void => {
		setFileName(null);
		setReport(null);
		setError(null);
	};

	const handleClose = (): void => {
		// Same guard as the export modal: closing mid-flight would reset the
		// state the in-flight import is about to fill (report, file name) and
		// leave the user with no feedback at all.
		if (loading) {
			return;
		}
		resetState();
		closePasskeyImport();
	};

	const handlePickAndImport = async (): Promise<void> => {
		// Re-entrancy: `setLoading(true)` is a state update, so two clicks in the
		// same tick would both get past it and open two file pickers.
		if (loading) {
			return;
		}
		setError(null);
		setReport(null);
		setLoading(true);
		try {
			const selected = await open({
				multiple: false,
				directory: false,
				filters: [{ name: "CXF", extensions: ["json", "cxf"] }],
			});
			// The user cancelled the picker: nothing to do, nothing to report.
			if (typeof selected !== "string") {
				return;
			}

			let resolved: ResolvedVault | null = null;
			try {
				resolved = currentVaultId
					? resolveUnlockedVaultForCxf(currentVaultId)
					: null;
			} catch {
				resolved = null;
			}
			if (!resolved) {
				setError(t("passkey.import.errors.locked"));
				return;
			}
			const { vault, credential } = resolved;

			const content = await readTextFile(selected);
			const rawReport = await PasskeyCommands.importCxf(
				vaultRefFor(vault),
				credential,
				content,
			);

			const parsed = cxfImportReportSchema.safeParse(rawReport);
			if (!parsed.success) {
				// Deliberate: the backend DID write the vault, but a report we
				// cannot interpret is not a basis for a refresh decision, and the
				// i18n copy tells the user to reopen the vault to see the result.
				setError(t("passkey.import.errors.unexpectedReport"));
				return;
			}

			setReport(parsed.data);
			setFileName(basename(selected));

			// The import already wrote the vault file: re-read it so the tree
			// shows the new passkeys. A refresh failure must not hide the report —
			// the passkeys ARE in the vault — so it is surfaced as a separate,
			// non-fatal message.
			const vaultInstance = currentVaultId
				? VaultManager.getInstance().getInstance(currentVaultId)
				: null;
			try {
				await vaultInstance?.refreshEntries();
			} catch {
				setError(t("passkey.import.errors.refreshFailed"));
			}
		} catch (err) {
			// The backend's message is sanitized (no key material); the file
			// content and the password are never interpolated into it.
			setError(
				err instanceof Error && err.message
					? err.message
					: t("passkey.import.errors.importFailed"),
			);
		} finally {
			setLoading(false);
		}
	};

	const lossyRows =
		report?.skipped.filter((row) => row.reason === EXTENSIONS_IGNORED_NOTE) ??
		[];
	const rejectedRows =
		report?.skipped.filter((row) => row.reason !== EXTENSIONS_IGNORED_NOTE) ??
		[];

	return (
		<Modal isOpen={isPasskeyImportModalOpen} onClose={handleClose}>
			<div className="space-y-4">
				<div className="flex items-center gap-3 pb-3 border-b border-base-300/40">
					<div className="p-2.5 rounded-xl bg-info/10 text-info">
						<svg
							className="w-5 h-5"
							fill="none"
							stroke="currentColor"
							viewBox="0 0 24 24"
							aria-hidden="true"
						>
							<path
								strokeLinecap="round"
								strokeLinejoin="round"
								strokeWidth={2}
								d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z"
							/>
						</svg>
					</div>
					<h3 className="font-bold text-xl text-base-content">
						{t("passkey.import.title")}
					</h3>
				</div>

				<p className="text-sm text-base-content/70">
					{t("passkey.import.description")}
				</p>

				{fileName && (
					<p className="text-xs text-base-content/60">
						{t("passkey.import.selectedFile", { fileName })}
					</p>
				)}

				{report && (
					<div className="space-y-3">
						<div className="stats shadow">
							<div className="stat">
								<div className="stat-title">{t("passkey.import.imported")}</div>
								<div className="stat-value text-primary">{report.imported}</div>
							</div>
							<div className="stat">
								<div className="stat-title">
									{t("passkey.import.duplicates")}
								</div>
								<div className="stat-value text-secondary">
									{report.duplicates}
								</div>
							</div>
						</div>

						{report.imported === 0 && report.duplicates === 0 && (
							<p className="text-xs text-base-content/60">
								{t("passkey.import.nothingImported")}
							</p>
						)}

						{lossyRows.length > 0 && (
							<div className="alert alert-warning text-sm py-2">
								<div className="space-y-1">
									<p className="font-semibold">
										{t("passkey.import.lossy.title", {
											count: lossyRows.length,
										})}
									</p>
									<ul className="text-xs space-y-0.5">
										{lossyRows.map((row) => (
											<li key={`lossy-${row.itemTitle}-${row.reason}`}>
												{t("passkey.import.lossy.row", {
													itemTitle: row.itemTitle,
													reason: row.reason,
												})}
											</li>
										))}
									</ul>
								</div>
							</div>
						)}

						{rejectedRows.length > 0 && (
							<div className="space-y-1">
								<p className="text-xs font-semibold text-base-content/70">
									{t("passkey.import.skipped.title", {
										count: rejectedRows.length,
									})}
								</p>
								<div className="max-h-60 overflow-auto">
									<div className="space-y-2">
										{rejectedRows.map((row) => (
											<div
												key={`skipped-${row.itemTitle}-${row.credentialType}-${row.reason}`}
												className="card bg-base-200 shadow-sm"
											>
												<div className="card-body p-3">
													<p className="text-sm font-semibold text-base-content">
														{row.itemTitle}
													</p>
													<p className="text-xs text-base-content/60">
														{t("passkey.import.skipped.row", {
															credentialType: row.credentialType,
															reason: row.reason,
														})}
													</p>
												</div>
											</div>
										))}
									</div>
								</div>
							</div>
						)}
					</div>
				)}

				{error && (
					<div className="alert alert-error text-sm py-2">
						<span>{error}</span>
					</div>
				)}

				<div className="modal-action mt-6 gap-2">
					<button
						type="button"
						className="btn btn-primary flex-1 sm:flex-initial"
						onClick={handlePickAndImport}
						disabled={loading}
					>
						{loading ? (
							<>
								<span className="loading loading-spinner loading-sm"></span>
								{t("passkey.import.importing")}
							</>
						) : (
							t("passkey.import.selectFile")
						)}
					</button>
					<button
						type="button"
						className="btn btn-ghost flex-1 sm:flex-initial"
						onClick={handleClose}
						disabled={loading}
					>
						{t("passkey.import.close")}
					</button>
				</div>
			</div>
		</Modal>
	);
}
