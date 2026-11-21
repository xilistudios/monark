import { save } from "@tauri-apps/plugin-dialog";
import { writeTextFile } from "@tauri-apps/plugin-fs";
import { useContext, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSelector } from "react-redux";
import type { RootState } from "../../../redux/store";
import PasskeyCommands, { vaultRefFor } from "../../../services/passkey";
import {
	type ResolvedVault,
	resolveUnlockedVaultForCxf,
} from "../../../services/passkeyCeremony";
import { Modal } from "../../UI/Modal";
import { VaultModalContext } from "../VaultContext";

/** Default file name offered by the save dialog. */
export const DEFAULT_EXPORT_FILE_NAME = "monark-passkeys.cxf.json";

/**
 * CXF export modal (T18): the user-facing half of `export_cxf` (T17).
 *
 * ## Why the consent gate exists
 *
 * The exported document contains the passkeys' **private keys in plain text**.
 * Anyone holding the file can sign in as the user on every relying party the
 * vault covers. `export_cxf` therefore refuses to run unless `consent === true`
 * — a hard gate in Rust, checked before the vault is even opened — and this
 * modal is where that consent is *informed*: the warning is always visible, the
 * Export button is **disabled** until the acknowledgement checkbox is ticked,
 * and `handleExport` itself returns early while `consent` is false, so the
 * command can only be reached through a consented click. The `disabled`
 * attribute is the affordance; the guard inside the handler is the gate (a
 * future markup change cannot make the export unconditional).
 *
 * ## Flow
 *
 * 1. checkbox ticked → Export enabled;
 * 2. `exportCxf(vaultRef, credential, true)` → the CXF JSON string;
 * 3. `save` dialog (default name `monark-passkeys.cxf.json`) → the user picks
 *    the destination;
 * 4. `writeTextFile(path, content)` → the file is written;
 * 5. success message + a reminder to delete the file after use.
 *
 * **Cancel at any step writes nothing.** The save dialog runs *before* the
 * export call: a cancelled dialog returns `null` and the command is never
 * invoked, so no key material is ever produced for a file the user did not
 * choose. Closing the modal is blocked while an export is in flight
 * (`handleClose` returns early on `loading`), so a close cannot race the write
 * and swallow the "delete the file" reminder.
 *
 * ## Secrets
 *
 * The exported string is never logged, never put in an error message and never
 * stored in component state longer than the write needs it. Errors shown to the
 * user come from the backend (sanitized) or from this modal's own i18n keys.
 */
export function PasskeyExportModal() {
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
	const { isPasskeyExportModalOpen, closePasskeyExport } = context;

	const [consent, setConsent] = useState(false);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [exportedPath, setExportedPath] = useState<string | null>(null);

	const resetState = (): void => {
		setConsent(false);
		setError(null);
		setExportedPath(null);
	};

	const handleClose = (): void => {
		// A close while the export is in flight would reset `exportedPath` and
		// hide the "delete the file" reminder for a file that is about to be
		// written anyway. The ✕ and the backdrop stay live in `UI/Modal.tsx`,
		// so the guard has to live here.
		if (loading) {
			return;
		}
		resetState();
		closePasskeyExport();
	};

	const handleExport = async (): Promise<void> => {
		// Consent is a handler-level gate, not just the button's `disabled`
		// attribute (review MENOR-1): a future refactor of the markup must not
		// be able to make the export unconditional. The backend refuses
		// `consent !== true` too, so this is the UI half of the same rule.
		if (!consent) {
			return;
		}
		// Re-entrancy: `setLoading(true)` is a state update, so two clicks in the
		// same tick would both get past it and open two save dialogs.
		if (loading) {
			return;
		}
		setError(null);
		setExportedPath(null);
		setLoading(true);
		try {
			let resolved: ResolvedVault | null = null;
			try {
				resolved = currentVaultId
					? resolveUnlockedVaultForCxf(currentVaultId)
					: null;
			} catch {
				resolved = null;
			}
			if (!resolved) {
				setError(t("passkey.export.errors.locked"));
				return;
			}
			const { vault, credential } = resolved;

			// Ask for the destination FIRST: a cancelled dialog must not even
			// produce the plaintext document.
			const destination = await save({
				defaultPath: DEFAULT_EXPORT_FILE_NAME,
				filters: [{ name: "CXF", extensions: ["json", "cxf"] }],
			});
			if (typeof destination !== "string") {
				return;
			}

			const content = await PasskeyCommands.exportCxf(
				vaultRefFor(vault),
				credential,
				true,
			);
			await writeTextFile(destination, content);
			setExportedPath(destination);
			// The acknowledgement covered *this* export only: a second one
			// re-exports the whole key set, so it must be re-consented.
			setConsent(false);
		} catch (err) {
			setError(
				err instanceof Error && err.message
					? err.message
					: t("passkey.export.errors.exportFailed"),
			);
		} finally {
			setLoading(false);
		}
	};

	return (
		<Modal isOpen={isPasskeyExportModalOpen} onClose={handleClose}>
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
						{t("passkey.export.title")}
					</h3>
				</div>

				<div className="alert alert-warning text-sm py-2">
					<span>{t("passkey.export.warning")}</span>
				</div>

				<label className="flex items-start gap-3 cursor-pointer">
					<input
						type="checkbox"
						className="checkbox checkbox-warning mt-0.5"
						checked={consent}
						onChange={(event) => setConsent(event.target.checked)}
						disabled={loading}
					/>
					<span className="text-sm text-base-content/85">
						{t("passkey.export.consent")}
					</span>
				</label>

				{exportedPath && (
					<div className="alert alert-success text-sm py-2">
						<div className="space-y-1">
							<p className="font-semibold">
								{t("passkey.export.success", { fileName: exportedPath })}
							</p>
							<p className="text-xs">{t("passkey.export.deleteReminder")}</p>
						</div>
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
						onClick={handleExport}
						disabled={!consent || loading}
					>
						{loading ? (
							<>
								<span className="loading loading-spinner loading-sm"></span>
								{t("passkey.export.exporting")}
							</>
						) : (
							t("passkey.export.export")
						)}
					</button>
					<button
						type="button"
						className="btn btn-ghost flex-1 sm:flex-initial"
						onClick={handleClose}
						disabled={loading}
					>
						{t("passkey.export.close")}
					</button>
				</div>
			</div>
		</Modal>
	);
}
