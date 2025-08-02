import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSelector } from "react-redux";
import type { DataEntry, Field } from "../../interfaces/vault.interface";
import type {  RootState } from "../../redux/store";
import { VaultManager } from "../../services/vault";
import { Modal } from "../UI/Modal";

/**
 * Props for the EditEntryModal component.
 */
interface EditEntryModalProps {
	isOpen: boolean;
	onClose: () => void;
	onSuccess?: () => void;
	entry: DataEntry;
	path: string[];
}

/**
 * Form field type extending Field with type safety.
 */
interface FormField extends Field {
	title: string;
	property: string;
	value: string;
	secret: boolean;
}

/**
 * Modal component for editing an existing vault data entry.
 * Allows modification of title, data type, fields, and tags.
 * Implements error checking and validation.
 */
export const EditEntryModal: React.FC<EditEntryModalProps> = ({
	isOpen,
	onClose,
	onSuccess,
	entry,
	path,
}) => { 
	const { t } = useTranslation("home");
	const currentVaultId = useSelector((state: RootState) => state.vault.currentVaultId); 

	const [entryTitle, setEntryTitle] = useState(entry.name);
	const [dataType, setDataType] = useState(entry.data_type);
	const [fields, setFields] = useState<FormField[]>(entry.fields);
	const [tags, setTags] = useState<string[]>(entry.tags);
	const [newTag, setNewTag] = useState("");
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);

	// Prefill form when entry changes
	useEffect(() => {
		setEntryTitle(entry.name);
		setDataType(entry.data_type);
		setFields(entry.fields.map((f) => ({ ...f })));
		setTags(entry.tags);
	}, [entry]);

	// Add new field
	const handleAddField = (): void => {
		setFields((prev) => [
			...prev,
			{ title: "", property: "", value: "", secret: false },
		]);
	};

	// Update specific field
	const handleUpdateField = (
		index: number,
		key: keyof FormField,
		value: string | boolean,
	): void => {
		setFields((prev) =>
			prev.map((field, i) =>
				i === index ? { ...field, [key]: value } : field,
			),
		);
	};

	// Remove field
	const handleRemoveField = (index: number): void => {
		setFields((prev) => prev.filter((_, i) => i !== index));
	};

	// Add tag
	const handleAddTag = (): void => {
		const trimmed = newTag.trim();
		if (trimmed && !tags.includes(trimmed)) {
			setTags((prev) => [...prev, trimmed]);
			setNewTag("");
		}
	};

	// Remove tag
	const handleRemoveTag = (tagToRemove: string): void => {
		setTags((prev) => prev.filter((tag) => tag !== tagToRemove));
	};

	// Submit updates
	const handleSubmit = async (): Promise<void> => {
		if (!entryTitle.trim()) {
			setError(t("editEntry.errors.titleRequired"));
			return;
		}

		const validFields = fields.filter(
			(field) => field.title.trim() && field.property.trim(),
		);

		if (validFields.length === 0) {
			setError(t("editEntry.errors.fieldsRequired"));
			return;
		}

		setError(null);
		setLoading(true);

		try {
			const updates: Partial<DataEntry> = {
				name: entryTitle.trim(),
				data_type: dataType.trim(),
				fields: validFields,
				tags,
				updated_at: new Date().toISOString(),
			};

			if (currentVaultId) {
				// Get the VaultInstance from VaultManager
				const vaultInstance = VaultManager.getInstance().getInstance(currentVaultId);
				if (vaultInstance) {
					// Debug: log the path being used
					console.log("Updating entry with path:", path);
					
					// Update the entry using VaultManager
					await vaultInstance.updateEntry(path, updates);
				}
			}

			onSuccess?.();
			onClose();
		} catch (err) {
			console.error("Error updating entry:", err);
			setError(err instanceof Error ? err.message : t("editEntry.errors.updateFailed"));
		} finally {
			setLoading(false);
		}
	};

	// Cancel and reset
	const handleCancel = (): void => {
		setError(null);
		onClose();
	};

	return (
		<Modal isOpen={isOpen} onClose={handleCancel}>
			<div className="space-y-4">
				<h3 className="font-bold text-lg">{t("editEntry.title")}</h3>

				{/* Entry Title */}
				<div className="form-control">
					<label className="label">
						<span className="label-text">{t("editEntry.entryTitle")} *</span>
					</label>
					<input
						type="text"
						placeholder={t("editEntry.entryTitlePlaceholder")}
						className="input input-bordered"
						value={entryTitle}
						onChange={(e) => setEntryTitle(e.target.value)}
					/>
				</div>

				{/* Data Type */}
				<div className="form-control">
					<label className="label">
						<span className="label-text">{t("editEntry.dataType")}</span>
					</label>
					<input
						type="text"
						placeholder={t("editEntry.dataTypePlaceholder")}
						className="input input-bordered"
						value={dataType}
						onChange={(e) => setDataType(e.target.value)}
					/>
				</div>

				

				{/* Fields */}
				<div className="form-control">
					<label className="label">
						<span className="label-text">{t("editEntry.fields")}</span>
					</label>
					<div className="space-y-2">
						{fields.map((field, index) => (
							<div key={index} className="flex gap-2 items-center">
								<input
									type="text"
									placeholder={t("editEntry.fieldTitle")}
									className="input input-bordered input-sm flex-1"
									value={field.title}
									onChange={(e) =>
										handleUpdateField(index, "title", e.target.value)
									}
								/>
								<input
									type="text"
									placeholder={t("editEntry.fieldProperty")}
									className="input input-bordered input-sm flex-1"
									value={field.property}
									onChange={(e) =>
										handleUpdateField(index, "property", e.target.value)
									}
								/>
								<input
									type={field.secret ? "password" : "text"}
									placeholder={t("editEntry.fieldValue")}
									className="input input-bordered input-sm flex-1"
									value={field.value}
									onChange={(e) =>
										handleUpdateField(index, "value", e.target.value)
									}
								/>
								<div className="form-control">
									<label className="cursor-pointer label">
										<input
											type="checkbox"
											className="checkbox checkbox-sm"
											checked={field.secret}
											onChange={(e) =>
												handleUpdateField(index, "secret", e.target.checked)
											}
										/>
										<span className="label-text text-xs ml-1">
											{t("editEntry.secret")}
										</span>
									</label>
								</div>
								<button
									type="button"
									className="btn btn-ghost btn-sm btn-circle"
									onClick={() => handleRemoveField(index)}
									disabled={fields.length <= 1}
								>
									✕
								</button>
							</div>
						))}
						<button
							type="button"
							className="btn btn-outline btn-sm"
							onClick={handleAddField}
						>
							+ {t("editEntry.addField")}
						</button>
					</div>
				</div>

				{/* Tags */}
				<div className="form-control">
					<label className="label">
						<span className="label-text">{t("editEntry.tags")}</span>
					</label>
					<div className="flex gap-2 mb-2">
						<input
							type="text"
							placeholder={t("editEntry.tagPlaceholder")}
							className="input input-bordered input-sm flex-1"
							value={newTag}
							onChange={(e) => setNewTag(e.target.value)}
							onKeyPress={(e) => e.key === "Enter" && handleAddTag()}
						/>
						<button
							type="button"
							className="btn btn-outline btn-sm"
							onClick={handleAddTag}
						>
							{t("editEntry.addTag")}
						</button>
					</div>
					{tags.length > 0 && (
						<div className="flex flex-wrap gap-1">
							{tags.map((tag, index) => (
								<div key={index} className="badge badge-primary gap-1">
									{tag}
									<button
										type="button"
										className="btn btn-ghost btn-xs"
										onClick={() => handleRemoveTag(tag)}
									>
										✕
									</button>
								</div>
							))}
						</div>
					)}
				</div>

				{error && (
					<div className="alert alert-error">
						<span>{error}</span>
					</div>
				)}

				<div className="modal-action">
					<button
						className="btn btn-primary"
						onClick={handleSubmit}
						disabled={loading}
					>
						{loading ? (
							<>
								<span className="loading loading-spinner loading-sm"></span>
								{t("editEntry.saving")}
							</>
						) : (
							t("editEntry.save")
						)}
					</button>
					<button className="btn" onClick={handleCancel} disabled={loading}>
						{t("editEntry.cancel")}
					</button>
				</div>
			</div>
		</Modal>
	);
};
