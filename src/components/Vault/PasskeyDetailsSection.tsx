import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useSelector } from "react-redux";
import type { PasskeyEntry } from "../../interfaces/vault.interface";
import type { RootState } from "../../redux/store";
import { VaultManager } from "../../services/vault";
import { copySensitive } from "../../utils/clipboard";
import { Modal } from "../UI/Modal";

/**
 * Read-only detail view for a stored passkey (T13).
 *
 * A passkey entry has **no editable credential material on the client**: the
 * private key never crosses the IPC boundary (`PasskeyView` carries none, see
 * `interfaces/vault.interface.ts`). This component therefore renders every
 * member of the sanitized view as static text — there is deliberately no
 * `<input>`/`<textarea>` bound to `credential_id`, `user_handle`, `aaguid` or
 * any other field, so a future edit cannot accidentally round-trip key
 * material through a form.
 *
 * The only interactive controls are:
 * - a copy button for the credential id (via `copySensitive`, which clears the
 *   clipboard after 30 s like every other secret copy in the app), and
 * - the delete flow, which goes through `VaultInstance.deleteEntry` — the
 *   passkey branch of that method calls `passkey_delete`, the only way a
 *   passkey can be removed (the vault write-merge preserves passkeys it finds
 *   on disk, so a generic full-vault write would silently resurrect it).
 *
 * @param entry - The passkey to display (sanitized view, no secret material).
 * @param onDeleted - Called after the backend delete succeeded, so the caller
 *   can close the surrounding modal.
 */
export interface PasskeyDetailsSectionProps {
	entry: PasskeyEntry;
	onDeleted?: () => void;
}

/** Renders a `-7` COSE algorithm id as its WebAuthn name. */
function algorithmLabel(algorithm: number): string {
	// ES256 is the only algorithm Monark issues (ruling Q1); anything else in a
	// vault was not written by this app, so show the raw id instead of guessing.
	return algorithm === -7 ? "ES256 (P-256)" : `alg ${algorithm}`;
}

/** Formats an ISO timestamp for display; falls back to the raw value. */
function formatTimestamp(value: string): string {
	const date = new Date(value);
	return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

export function PasskeyDetailsSection({
	entry,
	onDeleted,
}: PasskeyDetailsSectionProps) {
	const { t } = useTranslation("home");
	const currentVaultId = useSelector(
		(state: RootState) => state.vault.currentVaultId,
	);
	const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">(
		"idle",
	);
	const [isConfirmOpen, setIsConfirmOpen] = useState(false);
	const [isDeleting, setIsDeleting] = useState(false);
	const [deleteError, setDeleteError] = useState<string | null>(null);

	const handleCopyCredentialId = async (): Promise<void> => {
		try {
			await copySensitive(entry.credential_id);
			setCopyState("copied");
		} catch {
			// Never log the value: it is credential material.
			setCopyState("failed");
		}
	};

	const handleDelete = async (): Promise<void> => {
		setDeleteError(null);
		setIsDeleting(true);
		try {
			if (!currentVaultId) {
				throw new Error(t("errors.vaultNotAvailable"));
			}
			const vaultInstance =
				VaultManager.getInstance().getInstance(currentVaultId);
			if (!vaultInstance) {
				throw new Error(t("errors.vaultNotAvailable"));
			}
			// The passkey branch of deleteEntry calls `passkey_delete` and skips
			// the generic vault write (see `services/vault.ts`).
			await vaultInstance.deleteEntry([entry.id]);
			setIsConfirmOpen(false);
			onDeleted?.();
		} catch (error) {
			setDeleteError(
				error instanceof Error
					? error.message
					: t("passkey.details.deleteFailed"),
			);
		} finally {
			setIsDeleting(false);
		}
	};

	const hasTags = entry.tags.length > 0;

	return (
		<section aria-labelledby="passkey-details-heading" className="space-y-4">
			<div className="flex items-center justify-between">
				<h4
					id="passkey-details-heading"
					className="text-xs font-bold text-base-content/40 uppercase tracking-widest"
				>
					{t("passkey.details.title")}
				</h4>
				<span className="badge badge-sm font-semibold tracking-wide py-2.5 px-3 border bg-info/10 text-info border-info/20">
					{t("passkey.badge")}
				</span>
			</div>

			<dl className="space-y-3">
				<div>
					<dt className="text-xs font-semibold text-base-content/60 uppercase">
						{t("passkey.details.relyingParty")}
					</dt>
					<dd className="text-sm text-base-content break-words">
						{entry.rp_name}
					</dd>
					<dd className="text-xs font-mono text-base-content/70 break-all">
						{entry.rp_id}
					</dd>
				</div>

				<div>
					<dt className="text-xs font-semibold text-base-content/60 uppercase">
						{t("passkey.details.userName")}
					</dt>
					<dd className="text-sm text-base-content break-words">
						{entry.user_name}
					</dd>
				</div>

				<div>
					<dt className="text-xs font-semibold text-base-content/60 uppercase">
						{t("passkey.details.userDisplayName")}
					</dt>
					<dd className="text-sm text-base-content break-words">
						{entry.user_display_name || "—"}
					</dd>
				</div>

				<div>
					<dt className="text-xs font-semibold text-base-content/60 uppercase">
						{t("passkey.details.credentialId")}
					</dt>
					<dd className="flex items-start gap-2">
						<code className="font-mono text-xs break-all flex-1 text-base-content/85">
							{entry.credential_id}
						</code>
						<button
							type="button"
							className="btn btn-xs btn-outline flex-shrink-0"
							onClick={handleCopyCredentialId}
						>
							{t("copy")}
						</button>
					</dd>
					{copyState === "copied" && (
						<p className="text-xs text-success mt-1">
							{t("passkey.details.copied")}
						</p>
					)}
					{copyState === "failed" && (
						<p className="text-xs text-error mt-1">
							{t("passkey.details.copyFailed")}
						</p>
					)}
				</div>

				<div className="grid grid-cols-2 gap-3">
					<div>
						<dt className="text-xs font-semibold text-base-content/60 uppercase">
							{t("passkey.details.algorithm")}
						</dt>
						<dd className="text-sm text-base-content">
							{algorithmLabel(entry.algorithm)}
						</dd>
					</div>
					<div>
						<dt className="text-xs font-semibold text-base-content/60 uppercase">
							{t("passkey.details.signCount")}
						</dt>
						<dd className="text-sm text-base-content">{entry.sign_count}</dd>
					</div>
				</div>

				<div>
					<dt className="text-xs font-semibold text-base-content/60 uppercase">
						{t("passkey.details.discoverable")}
					</dt>
					<dd>
						<span
							className={`badge badge-sm ${
								entry.discoverable
									? "bg-success/10 text-success border-success/20"
									: "bg-base-200 text-base-content/60 border-base-300"
							}`}
						>
							{entry.discoverable
								? t("passkey.details.discoverableYes")
								: t("passkey.details.discoverableNo")}
						</span>
					</dd>
				</div>

				<div>
					<dt className="text-xs font-semibold text-base-content/60 uppercase">
						{t("passkey.details.transports")}
					</dt>
					<dd className="flex flex-wrap gap-1">
						{entry.transports.length > 0 ? (
							entry.transports.map((transport) => (
								<span
									key={transport}
									className="badge badge-sm bg-base-200 border-base-300 text-base-content/80"
								>
									{transport}
								</span>
							))
						) : (
							<span className="text-sm text-base-content/60">
								{t("passkey.details.noTransports")}
							</span>
						)}
					</dd>
				</div>

				<div className="grid grid-cols-2 gap-3">
					<div>
						<dt className="text-xs font-semibold text-base-content/60 uppercase">
							{t("vault.entry.createdAt")}
						</dt>
						<dd className="text-sm text-base-content">
							{formatTimestamp(entry.created_at)}
						</dd>
					</div>
					<div>
						<dt className="text-xs font-semibold text-base-content/60 uppercase">
							{t("vault.entry.updatedAt")}
						</dt>
						<dd className="text-sm text-base-content">
							{formatTimestamp(entry.updated_at)}
						</dd>
					</div>
				</div>

				<div>
					<dt className="text-xs font-semibold text-base-content/60 uppercase">
						{t("vault.entry.tags")}
					</dt>
					<dd className="flex flex-wrap gap-1">
						{hasTags ? (
							entry.tags.map((tag) => (
								<span key={tag} className="badge badge-primary badge-sm">
									{tag}
								</span>
							))
						) : (
							<span className="text-sm text-base-content/60">
								{t("vault.entry.noTags")}
							</span>
						)}
					</dd>
				</div>
			</dl>

			{deleteError && (
				<div className="alert alert-error text-sm py-2">
					<span>{deleteError}</span>
				</div>
			)}

			<div className="pt-2 border-t border-base-300/40">
				<button
					type="button"
					className="btn btn-error btn-sm btn-outline"
					onClick={() => setIsConfirmOpen(true)}
				>
					{t("passkey.details.delete")}
				</button>
			</div>

			{/* Confirm step — same shape as the VaultTree delete confirmation. */}
			<Modal isOpen={isConfirmOpen} onClose={() => setIsConfirmOpen(false)}>
				<div className="p-6">
					<h3 className="text-lg font-bold">
						{t("passkey.details.deleteConfirmTitle")}
					</h3>
					<p className="py-4">
						{t("passkey.details.deleteConfirm", { name: entry.name })}
					</p>
					<div className="flex justify-end gap-2">
						<button
							type="button"
							className="btn btn-ghost"
							onClick={() => setIsConfirmOpen(false)}
							disabled={isDeleting}
						>
							{t("passkey.details.deleteCancel")}
						</button>
						<button
							type="button"
							className="btn btn-error"
							onClick={handleDelete}
							disabled={isDeleting}
						>
							{isDeleting ? (
								<>
									<span className="loading loading-spinner loading-xs"></span>
									{t("passkey.details.deleting")}
								</>
							) : (
								t("passkey.details.deleteConfirmAction")
							)}
						</button>
					</div>
				</div>
			</Modal>
		</section>
	);
}
