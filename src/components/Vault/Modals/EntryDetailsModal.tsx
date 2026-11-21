import { useContext, useState } from "react";
import { useTranslation } from "react-i18next";
import type { Field } from "../../../interfaces/vault.interface";
import {
	isDataEntry,
	isGroupEntry,
	isPasskeyEntry,
} from "../../../interfaces/vault.interface";
import { copySensitive } from "../../../utils/clipboard";
import { Modal } from "../../UI/Modal";
import { PasskeyDetailsSection } from "../PasskeyDetailsSection";
import { VaultModalContext } from "../VaultContext";

/**
 * Modal component for viewing details of a vault entry.
 * Displays entry information with options to reveal secret fields and copy values.
 * Includes error checking for clipboard operations.
 *
 * Entry kinds are discriminated with the shared type guards from
 * `interfaces/vault.interface.ts` (T13). Before that, this modal used a local
 * `(entry as DataEntry).fields !== undefined` heuristic, which classified a
 * passkey as a data entry and rendered the generic fields block for it.
 *
 * A passkey renders {@link PasskeyDetailsSection} instead: a read-only view
 * with no editor for credential material, plus the explicit delete flow.
 */
export const EntryDetailsModal: React.FC = () => {
	const { t } = useTranslation("home");
	// Hooks must run unconditionally at the top level: resolve the context
	// first, then bail out (the early return below is after every hook).
	const context = useContext(VaultModalContext);
	const [revealed, setRevealed] = useState<Record<string, boolean>>({});
	const [copyError, setCopyError] = useState<string | null>(null);

	if (!context)
		throw new Error(
			"VaultModalContext must be used within a VaultModalProvider",
		);

	const {
		isDetailsModalOpen,
		selectedEntry,
		closeAllModals,
		openEditEntry,
		openEditGroup,
	} = context;

	// Early return if no entry is selected or modal is not open
	if (!isDetailsModalOpen || !selectedEntry) {
		return null;
	}

	// Toggle visibility for a specific field
	const toggleReveal = (property: string): void => {
		setRevealed((prev) => ({
			...prev,
			[property]: !(prev[property] ?? false),
		}));
	};

	// Copy value to clipboard with error handling
	const handleCopy = async (value: string): Promise<void> => {
		setCopyError(null);
		try {
			await copySensitive(value);
			// For feedback, using alert as placeholder; replace with toast if available
			alert(t("vault.manager.copied"));
		} catch (error) {
			console.error("Failed to copy to clipboard:", error);
			setCopyError(t("vault.manager.copyFailed"));
		}
	};

	const isPasskey = isPasskeyEntry(selectedEntry);
	// Only data entries and groups carry a `data_type`; a passkey entry has none
	// on the wire (`PasskeyView` mirrors this interface field-for-field).
	const dataType = isPasskey ? null : selectedEntry.data_type;

	return (
		<Modal isOpen={isDetailsModalOpen} onClose={closeAllModals}>
			<div className="space-y-4">
				<h3 className="font-bold text-lg">{selectedEntry.name}</h3>

				{/* Data Type — not applicable to passkeys */}
				{dataType !== null && (
					<div className="form-control">
						<label className="label" htmlFor="entry-details-data-type">
							<span className="label-text">{t("vault.entry.dataType")}</span>
						</label>
						<input
							id="entry-details-data-type"
							type="text"
							className="input input-bordered"
							value={dataType}
							readOnly
						/>
					</div>
				)}

				{isPasskey ? (
					<PasskeyDetailsSection
						entry={selectedEntry}
						onDeleted={closeAllModals}
					/>
				) : (
					<>
						{/* Created At */}
						<div className="form-control">
							<label className="label" htmlFor="entry-details-created-at">
								<span className="label-text">{t("vault.entry.createdAt")}</span>
							</label>
							<input
								id="entry-details-created-at"
								type="text"
								className="input input-bordered"
								value={
									isDataEntry(selectedEntry) ? selectedEntry.created_at : ""
								}
								placeholder={t("vault.entry.notTracked")}
								readOnly
							/>
						</div>

						{/* Updated At */}
						<div className="form-control">
							<label className="label" htmlFor="entry-details-updated-at">
								<span className="label-text">{t("vault.entry.updatedAt")}</span>
							</label>
							<input
								id="entry-details-updated-at"
								type="text"
								className="input input-bordered"
								value={
									isDataEntry(selectedEntry) ? selectedEntry.updated_at : ""
								}
								placeholder={t("vault.entry.notTracked")}
								readOnly
							/>
						</div>

						{/* Tags */}
						<div className="form-control">
							<span className="label">
								<span className="label-text">{t("vault.entry.tags")}</span>
							</span>
							<div className="flex flex-wrap gap-1">
								{isDataEntry(selectedEntry) && selectedEntry.tags.length > 0 ? (
									selectedEntry.tags.map((tag) => (
										<div key={tag} className="badge badge-primary">
											{tag}
										</div>
									))
								) : (
									<p className="text-base-content/60">
										{t("vault.entry.noTags")}
									</p>
								)}
							</div>
						</div>

						{/* Fields */}
						<div className="form-control">
							<span className="label">
								<span className="label-text">{t("vault.entry.fields")}</span>
							</span>
							{isDataEntry(selectedEntry) &&
								selectedEntry.fields.map((field: Field) => (
									<div key={field.property} className="mb-4">
										<div className="flex justify-between items-center mb-1">
											<span className="font-medium">{field.title}</span>
											<div className="flex gap-2">
												{field.secret && (
													<button
														type="button"
														className="btn btn-xs btn-ghost"
														onClick={() => toggleReveal(field.property)}
													>
														{revealed[field.property] ? t("hide") : t("show")}
													</button>
												)}
												<button
													type="button"
													className="btn btn-xs btn-outline"
													onClick={() => handleCopy(field.value)}
												>
													{t("copy")}
												</button>
											</div>
										</div>
										<input
											type="text"
											className="input input-bordered w-full"
											value={
												field.secret && !revealed[field.property]
													? "********"
													: field.value
											}
											readOnly
										/>
									</div>
								))}
						</div>
					</>
				)}

				{copyError && (
					<div className="alert alert-error">
						<span>{copyError}</span>
					</div>
				)}

				<div className="modal-action">
					<button
						type="button"
						className="btn btn-primary"
						onClick={() => {
							if (isDataEntry(selectedEntry)) {
								openEditEntry(selectedEntry);
							} else if (isGroupEntry(selectedEntry)) {
								openEditGroup(selectedEntry);
							} else if (isPasskeyEntry(selectedEntry)) {
								// The edit modal renders the restricted passkey form.
								openEditEntry(selectedEntry);
							}
						}}
					>
						{t("edit")}
					</button>
					<button type="button" className="btn" onClick={closeAllModals}>
						{t("close")}
					</button>
				</div>
			</div>
		</Modal>
	);
};
