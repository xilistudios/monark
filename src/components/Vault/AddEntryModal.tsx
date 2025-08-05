import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useSelector } from "react-redux";
import { z } from "zod";
import type { DataEntry, Field } from "../../interfaces/vault.interface";
import type { RootState } from "../../redux/store";
import { VaultManager } from "../../services/vault";
import { Modal } from "../UI/Modal";
import { addEntryFormSchema, tagSchema } from "../../utils/validation/vaultSchemas";

interface AddEntryModalProps {
	isOpen: boolean;
	onClose: () => void;
	onSuccess?: () => void;
	path: string[];
}

interface FormField {
	title: string;
	property: string;
	value: string;
	secret: boolean;
}

export const AddEntryModal = ({
	isOpen,
	onClose,
	onSuccess,
	path,
}: AddEntryModalProps) => {
	const { t } = useTranslation("home");
	const currentVaultId = useSelector((state: RootState) => state.vault.currentVaultId);

	const [entryTitle, setEntryTitle] = useState("");
	const [fields, setFields] = useState<FormField[]>([
		{ title: "Username", property: "username", value: "", secret: false },
		{ title: "Password", property: "password", value: "", secret: true },
	]);
	const [tags, setTags] = useState<string[]>([]);
	const [newTag, setNewTag] = useState("");
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState("");

	const generateEntryId = () => {
		return crypto.randomUUID();
	};

	const handleAddField = () => {
		setFields((prev) => [
			...prev,
			{ title: "", property: "", value: "", secret: false },
		]);
	};

	const handleUpdateField = (
		index: number,
		key: keyof FormField,
		value: string | boolean,
	) => {
		setFields((prev) =>
			prev.map((field, i) =>
				i === index ? { ...field, [key]: value } : field,
			),
		);
	};

	const handleRemoveField = (index: number) => {
		setFields((prev) => prev.filter((_, i) => i !== index));
	};

	const handleAddTag = () => {
		try {
			const validatedTag = tagSchema.parse(newTag.trim());
			if (!tags.includes(validatedTag)) {
				setTags((prev) => [...prev, validatedTag]);
				setNewTag("");
			}
		} catch (err) {
			if (err instanceof z.ZodError) {
				setError(err.issues[0]?.message || "Invalid tag");
			}
		}
	};

	const handleRemoveTag = (tagToRemove: string) => {
		setTags((prev) => prev.filter((tag) => tag !== tagToRemove));
	};

	const handleSubmit = async () => {
		try {
			// Validar el formulario con Zod
			const formData = {
				entryTitle,
				fields,
				tags,
			};

			const validatedData = addEntryFormSchema.parse(formData);

			setError("");
			setLoading(true);

			// Convert form fields to vault fields format
			const vaultFields: Field[] = validatedData.fields.map((field) => ({
				title: field.title.trim(),
				property: field.property.trim(),
				value: field.value,
				secret: field.secret,
			}));

			const newEntry: DataEntry = {
				id: generateEntryId(),
				entry_type: "entry",
				name: validatedData.entryTitle.trim(),
				data_type: "login", // Default type
				created_at: new Date().toISOString(),
				updated_at: new Date().toISOString(),
				fields: vaultFields,
				tags: validatedData.tags,
			};

			// Use VaultManager to add entry and save
			if (currentVaultId) {
				// Get the VaultInstance from VaultManager
				const vaultInstance = VaultManager.getInstance().getInstance(currentVaultId);
				if (vaultInstance) {
					// Add the entry using VaultManager
					await vaultInstance.addEntry(path, newEntry);
				}
			}

			// Reset form
			setEntryTitle("");
			setFields([
				{ title: "Username", property: "username", value: "", secret: false },
				{ title: "Password", property: "password", value: "", secret: true },
			]);
			setTags([]);
			setNewTag("");

			onSuccess?.();
			onClose();
		} catch (err) {
			if (err instanceof z.ZodError) {
				// Manejar errores de validación de Zod
				const errorMessages = err.issues.map(issue => issue.message).join(', ');
				setError(errorMessages);
			} else {
				console.error("Error adding entry:", err);
				setError(t("addEntry.errors.addFailed"));
			}
		} finally {
			setLoading(false);
		}
	};

	const handleCancel = () => {
		setEntryTitle("");
		setFields([
			{ title: "Username", property: "username", value: "", secret: false },
			{ title: "Password", property: "password", value: "", secret: true },
		]);
		setTags([]);
		setNewTag("");
		setError("");
		onClose();
	};

	return (
		<Modal isOpen={isOpen} onClose={handleCancel}>
			<div className="space-y-4">
				<h3 className="font-bold text-lg">{t("addEntry.title")}</h3>

				{/* Entry Title */}
				<div className="form-control">
					<label className="label">
						<span className="label-text">{t("addEntry.entryTitle")} *</span>
					</label>
					<input
						type="text"
						placeholder={t("addEntry.entryTitlePlaceholder")}
						className="input input-bordered"
						value={entryTitle}
						onChange={(e) => setEntryTitle(e.target.value)}
					/>
				</div>

				{/* Fields */}
				<div className="form-control">
					<label className="label">
						<span className="label-text">{t("addEntry.fields")}</span>
					</label>
					<div className="space-y-2">
						{fields.map((field, index) => (
							<div key={index} className="flex gap-2 items-center">
								<input
									type="text"
									placeholder={t("addEntry.fieldTitle")}
									className="input input-bordered input-sm flex-1"
									value={field.title}
									onChange={(e) =>
										handleUpdateField(index, "title", e.target.value)
									}
								/>
								<input
									type="text"
									placeholder={t("addEntry.fieldProperty")}
									className="input input-bordered input-sm flex-1"
									value={field.property}
									onChange={(e) =>
										handleUpdateField(index, "property", e.target.value)
									}
								/>
								<input
									type={field.secret ? "password" : "text"}
									placeholder={t("addEntry.fieldValue")}
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
											{t("addEntry.secret")}
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
							+ {t("addEntry.addField")}
						</button>
					</div>
				</div>

				{/* Tags */}
				<div className="form-control">
					<label className="label">
						<span className="label-text">{t("addEntry.tags")}</span>
					</label>
					<div className="flex gap-2 mb-2">
						<input
							type="text"
							placeholder={t("addEntry.tagPlaceholder")}
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
							{t("addEntry.addTag")}
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
								{t("addEntry.adding")}
							</>
						) : (
							t("addEntry.addEntry")
						)}
					</button>
					<button className="btn" onClick={handleCancel} disabled={loading}>
						{t("addEntry.cancel")}
					</button>
				</div>
			</div>
		</Modal>
	);
};
