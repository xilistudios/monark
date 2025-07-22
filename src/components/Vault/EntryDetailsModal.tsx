import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { DataEntry, Field } from "../../interfaces/vault.interface";
import { Modal } from "../UI/Modal";

/**
 * Props for the EntryDetailsModal component.
 */
interface EntryDetailsModalProps {
	isOpen: boolean;
	onClose: () => void;
	entry: DataEntry;
	onEdit: () => void;
}

/**
 * Modal component for viewing details of a vault entry.
 * Displays entry information with options to reveal secret fields and copy values.
 * Includes error checking for clipboard operations.
 */
export const EntryDetailsModal: React.FC<EntryDetailsModalProps> = ({
	isOpen,
	onClose,
	entry,
	onEdit,
}) => {
	const { t } = useTranslation("home");
	const [revealed, setRevealed] = useState<Record<string, boolean>>({});
	const [copyError, setCopyError] = useState<string | null>(null);

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
			await writeText(value);
			// For feedback, using alert as placeholder; replace with toast if available
			alert(t("vault.manager.copied"));
		} catch (error) {
			console.error("Failed to copy to clipboard:", error);
			setCopyError(t("vault.manager.copyFailed"));
		}
	};

	return (
		<Modal isOpen={isOpen} onClose={onClose}>
			<div className="space-y-4">
				<h3 className="font-bold text-lg">{entry.name}</h3>

				{/* Data Type */}
				<div className="form-control">
					<label className="label">
						<span className="label-text">{t("vault.entry.dataType")}</span>
					</label>
					<input
						type="text"
						className="input input-bordered"
						value={entry.data_type}
						readOnly
					/>
				</div>

				{/* Created At */}
				<div className="form-control">
					<label className="label">
						<span className="label-text">{t("vault.entry.createdAt")}</span>
					</label>
					<input
						type="text"
						className="input input-bordered"
						value={entry.created_at}
						readOnly
					/>
				</div>

				{/* Updated At */}
				<div className="form-control">
					<label className="label">
						<span className="label-text">{t("vault.entry.updatedAt")}</span>
					</label>
					<input
						type="text"
						className="input input-bordered"
						value={entry.updated_at}
						readOnly
					/>
				</div>

				{/* Tags */}
				<div className="form-control">
					<label className="label">
						<span className="label-text">{t("vault.entry.tags")}</span>
					</label>
					<div className="flex flex-wrap gap-1">
						{entry.tags.length > 0 ? (
							entry.tags.map((tag) => (
								<div key={tag} className="badge badge-primary">
									{tag}
								</div>
							))
						) : (
							<p className="text-base-content/60">{t("vault.entry.noTags")}</p>
						)}
					</div>
				</div>

				{/* Fields */}
				<div className="form-control">
					<label className="label">
						<span className="label-text">{t("vault.entry.fields")}</span>
					</label>
					{entry.fields.map((field: Field) => (
						<div key={field.property} className="mb-4">
							<div className="flex justify-between items-center mb-1">
								<span className="font-medium">{field.title}</span>
								<div className="flex gap-2">
									{field.secret && (
										<button
											className="btn btn-xs btn-ghost"
											onClick={() => toggleReveal(field.property)}
										>
											{revealed[field.property] ? t("hide") : t("show")}
										</button>
									)}
									<button
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

				{copyError && (
					<div className="alert alert-error">
						<span>{copyError}</span>
					</div>
				)}

				<div className="modal-action">
					<button className="btn btn-primary" onClick={onEdit}>
						{t("edit")}
					</button>
					<button className="btn" onClick={onClose}>
						{t("close")}
					</button>
				</div>
			</div>
		</Modal>
	);
};
