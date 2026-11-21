import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useSelector } from "react-redux";
import type { PasskeyEntry } from "../../../interfaces/vault.interface";
import type { RootState } from "../../../redux/store";
import { VaultManager } from "../../../services/vault";
import { passkeyEditSchema } from "../../../utils/validation/passkeySchemas";

/**
 * Restricted edit form for a stored passkey (T13).
 *
 * Only the four **mutable** members of a passkey entry can be edited:
 * `name`, `tags`, `user_name` and `user_display_name`. Everything else —
 * `rp_id`, `credential_id`, `user_handle`, `algorithm`, `sign_count`,
 * `discoverable`, `transports`, `aaguid` — is the credential core, which the
 * backend write-merge keeps as-is; there is no input for it here, and no
 * private key exists client-side to edit in the first place.
 *
 * The payload is validated by `passkeyEditSchema` (T11) before the update is
 * dispatched, so a too-long name or an empty user name fails here with a field
 * error instead of round-tripping to the backend.
 *
 * `updated_at` is deliberately NOT sent: `VaultInstance.updateEntry` stamps it
 * for every non-group entry (see `services/vault.ts`), and sending our own
 * would be a redundant, racy second source of truth.
 *
 * @param entry - The passkey being edited.
 * @param onClose - Closes the surrounding modal (on save and on cancel).
 */
export interface EditPasskeyFormProps {
	entry: PasskeyEntry;
	onClose: () => void;
}

export function EditPasskeyForm({ entry, onClose }: EditPasskeyFormProps) {
	const { t } = useTranslation("home");
	const currentVaultId = useSelector(
		(state: RootState) => state.vault.currentVaultId,
	);

	const [name, setName] = useState(entry.name);
	const [userName, setUserName] = useState(entry.user_name);
	const [userDisplayName, setUserDisplayName] = useState(
		entry.user_display_name,
	);
	const [tags, setTags] = useState<string[]>(entry.tags);
	const [newTag, setNewTag] = useState("");
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const handleAddTag = (): void => {
		const trimmed = newTag.trim();
		if (trimmed && !tags.includes(trimmed)) {
			setTags((prev) => [...prev, trimmed]);
			setNewTag("");
		}
	};

	const handleRemoveTag = (tagToRemove: string): void => {
		setTags((prev) => prev.filter((tag) => tag !== tagToRemove));
	};

	const handleSubmit = async (): Promise<void> => {
		const parsed = passkeyEditSchema.safeParse({
			name: name.trim(),
			tags,
			user_name: userName.trim(),
			user_display_name: userDisplayName.trim(),
		});
		if (!parsed.success) {
			const first = parsed.error.issues[0];
			setError(first?.message ?? t("passkey.edit.errors.validationFailed"));
			return;
		}

		setError(null);
		setLoading(true);
		try {
			if (!currentVaultId) {
				throw new Error(t("errors.vaultNotAvailable"));
			}
			const vaultInstance =
				VaultManager.getInstance().getInstance(currentVaultId);
			if (!vaultInstance) {
				throw new Error(t("errors.vaultNotAvailable"));
			}
			// No `updated_at`: `updateEntry` stamps it for non-group entries.
			await vaultInstance.updateEntryById(entry.id, {
				name: parsed.data.name,
				tags: parsed.data.tags,
				user_name: parsed.data.user_name,
				user_display_name: parsed.data.user_display_name,
			});
			onClose();
		} catch (err) {
			setError(
				err instanceof Error
					? err.message
					: t("passkey.edit.errors.saveFailed"),
			);
		} finally {
			setLoading(false);
		}
	};

	return (
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
					{t("passkey.edit.title")}
				</h3>
			</div>

			{/* Name */}
			<div className="form-control">
				<label className="label" htmlFor="edit-passkey-name">
					<span className="label-text font-semibold text-sm text-base-content/85">
						{t("passkey.edit.name")} *
					</span>
				</label>
				<input
					id="edit-passkey-name"
					type="text"
					className="input input-bordered w-full"
					value={name}
					onChange={(e) => setName(e.target.value)}
				/>
			</div>

			{/* User name */}
			<div className="form-control">
				<label className="label" htmlFor="edit-passkey-user-name">
					<span className="label-text font-semibold text-sm text-base-content/85">
						{t("passkey.edit.userName")} *
					</span>
				</label>
				<input
					id="edit-passkey-user-name"
					type="text"
					className="input input-bordered w-full"
					value={userName}
					onChange={(e) => setUserName(e.target.value)}
				/>
			</div>

			{/* User display name */}
			<div className="form-control">
				<label className="label" htmlFor="edit-passkey-user-display-name">
					<span className="label-text font-semibold text-sm text-base-content/85">
						{t("passkey.edit.userDisplayName")}
					</span>
				</label>
				<input
					id="edit-passkey-user-display-name"
					type="text"
					className="input input-bordered w-full"
					value={userDisplayName}
					onChange={(e) => setUserDisplayName(e.target.value)}
				/>
			</div>

			{/* Tags */}
			<div className="form-control">
				<label className="label" htmlFor="edit-passkey-tags-input">
					<span className="label-text font-semibold text-sm text-base-content/85">
						{t("passkey.edit.tags")}
					</span>
				</label>
				<div className="flex gap-2 mb-2">
					<input
						id="edit-passkey-tags-input"
						type="text"
						placeholder={t("passkey.edit.tagPlaceholder")}
						className="input input-bordered input-sm flex-1"
						value={newTag}
						onChange={(e) => setNewTag(e.target.value)}
						onKeyDown={(e) => {
							if (e.key === "Enter") {
								e.preventDefault();
								handleAddTag();
							}
						}}
					/>
					<button
						type="button"
						className="btn btn-outline btn-sm"
						onClick={handleAddTag}
					>
						{t("passkey.edit.addTag")}
					</button>
				</div>
				{tags.length > 0 && (
					<div className="flex flex-wrap gap-1">
						{tags.map((tag) => (
							<div key={tag} className="badge badge-primary gap-1 p-2.5">
								{tag}
								<button
									type="button"
									className="btn btn-ghost btn-xs p-0 min-h-0 h-4 w-4 rounded-full flex items-center justify-center text-[10px]"
									onClick={() => handleRemoveTag(tag)}
									aria-label={t("passkey.edit.removeTag", { tag })}
								>
									✕
								</button>
							</div>
						))}
					</div>
				)}
			</div>

			<p className="text-xs text-base-content/60">
				{t("passkey.edit.immutableNotice")}
			</p>

			{error && (
				<div className="alert alert-error text-sm py-2">
					<span>{error}</span>
				</div>
			)}

			<div className="modal-action mt-6 gap-2">
				<button
					type="button"
					className="btn btn-primary flex-1 sm:flex-initial"
					onClick={handleSubmit}
					disabled={loading}
				>
					{loading ? (
						<>
							<span className="loading loading-spinner loading-sm"></span>
							{t("passkey.edit.saving")}
						</>
					) : (
						t("passkey.edit.save")
					)}
				</button>
				<button
					type="button"
					className="btn btn-ghost flex-1 sm:flex-initial"
					onClick={onClose}
					disabled={loading}
				>
					{t("passkey.edit.cancel")}
				</button>
			</div>
		</div>
	);
}
