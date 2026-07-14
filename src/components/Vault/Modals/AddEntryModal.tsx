import { useContext, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSelector } from "react-redux";
import { z } from "zod";
import type { DataEntry, Field, FieldType } from "../../../interfaces/vault.interface";
import type { RootState } from "../../../redux/store";
import { VaultManager } from "../../../services/vault";
import { addEntryFormSchema, tagSchema } from "../../../utils/validation/vaultSchemas";
import { Modal } from "../../UI/Modal";
import { VaultModalContext } from "../VaultContext";

interface FormField {
	title: string;
	property: string;
	value: string;
	secret: boolean;
}

export const AddEntryModal = () => {
	const { t } = useTranslation("home");
	const currentVaultId = useSelector((state: RootState) => state.vault.currentVaultId);
	const context = useContext(VaultModalContext);
	if (!context) {
		throw new Error("VaultModalContext must be used within a VaultModalProvider");
	}
	const { isAddEntryModalOpen, closeAddEntryModal, addEntryPath, addEntryOnSuccess } = context;

	const [selectedTemplate, setSelectedTemplate] = useState<string | null>(null);
	const [entryTitle, setEntryTitle] = useState("");
	const [fields, setFields] = useState<FormField[]>([]);
	const [tags, setTags] = useState<string[]>([]);
	const [newTag, setNewTag] = useState("");
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState("");
	const [revealed, setRevealed] = useState<Record<number, boolean>>({});

	const TEMPLATE_CARDS = [
		{
			id: "login",
			name: t("addEntry.templates.login"),
			desc: "Username, password, and website URL.",
			color: "bg-primary/10 text-primary border-primary/20",
			icon: (
				<svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
					<title>{t("addEntry.templates.login")}</title>
					<path
						strokeLinecap="round"
						strokeLinejoin="round"
						strokeWidth={2}
						d="M15 7a2 2 0 012 2m-2 4a2 2 0 012 2m-2-4a2 2 0 11-4 0 2 2 0 014 0zM7 10H4a2 2 0 00-2 2v7a2 2 0 002 2h3a2 2 0 002-2v-7a2 2 0 00-2-2zM14 5a2 2 0 00-2 2v10a2 2 0 002 2h3a2 2 0 002-2V7a2 2 0 00-2-2h-3z"
					/>
				</svg>
			),
		},
		{
			id: "creditCard",
			name: t("addEntry.templates.creditCard"),
			desc: "Credit and debit card information.",
			color: "bg-secondary/10 text-secondary border-secondary/20",
			icon: (
				<svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
					<title>{t("addEntry.templates.creditCard")}</title>
					<path
						strokeLinecap="round"
						strokeLinejoin="round"
						strokeWidth={2}
						d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z"
					/>
				</svg>
			),
		},
		{
			id: "sshKey",
			name: t("addEntry.templates.sshKey"),
			desc: "Monospace private keys and passphrases.",
			color: "bg-info/10 text-info border-info/20",
			icon: (
				<svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
					<title>{t("addEntry.templates.sshKey")}</title>
					<path
						strokeLinecap="round"
						strokeLinejoin="round"
						strokeWidth={2}
						d="M15 7a2 2 0 012 2m-2 4a2 2 0 012 2m-2-4a2 2 0 11-4 0 2 2 0 014 0zM7 10H4a2 2 0 00-2 2v7a2 2 0 002 2h3a2 2 0 002-2v-7a2 2 0 00-2-2zM14 5a2 2 0 00-2 2v10a2 2 0 002 2h3a2 2 0 002-2V7a2 2 0 00-2-2h-3z"
					/>
				</svg>
			),
		},
		{
			id: "apiKey",
			name: t("addEntry.templates.apiKey"),
			desc: "Tokens and passwords for external APIs.",
			color: "bg-accent/10 text-accent border-accent/20",
			icon: (
				<svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
					<title>{t("addEntry.templates.apiKey")}</title>
					<path
						strokeLinecap="round"
						strokeLinejoin="round"
						strokeWidth={2}
						d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4"
					/>
				</svg>
			),
		},
		{
			id: "note",
			name: t("addEntry.templates.note"),
			desc: "Multi-line notes and rich text.",
			color: "bg-neutral-content/10 text-neutral-content border-neutral-content/20",
			icon: (
				<svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
					<title>{t("addEntry.templates.note")}</title>
					<path
						strokeLinecap="round"
						strokeLinejoin="round"
						strokeWidth={2}
						d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
					/>
				</svg>
			),
		},
		{
			id: "custom",
			name: t("addEntry.templates.custom"),
			desc: "Add custom fields and tag values.",
			color: "bg-success/10 text-success border-success/20",
			icon: (
				<svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
					<title>{t("addEntry.templates.custom")}</title>
					<path
						strokeLinecap="round"
						strokeLinejoin="round"
						strokeWidth={2}
						d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4"
					/>
				</svg>
			),
		},
	];

	const handleSelectTemplate = (templateName: string) => {
		setSelectedTemplate(templateName);
		switch (templateName) {
			case "login":
				setFields([
					{ title: "Username", property: "text", value: "", secret: false },
					{ title: "Password", property: "password", value: "", secret: true },
					{ title: "Website", property: "url", value: "", secret: false },
				]);
				break;
			case "creditCard":
				setFields([
					{ title: "Cardholder Name", property: "text", value: "", secret: false },
					{ title: "Card Number", property: "text", value: "", secret: true },
					{ title: "Expiration Date", property: "text", value: "", secret: false },
					{ title: "Verification Number (CVV)", property: "password", value: "", secret: true },
				]);
				break;
			case "sshKey":
				setFields([
					{ title: "Private Key", property: "ssh key", value: "", secret: true },
					{ title: "Passphrase", property: "password", value: "", secret: true },
				]);
				break;
			case "apiKey":
				setFields([
					{ title: "API Key", property: "password", value: "", secret: true },
					{ title: "Endpoint URL", property: "url", value: "", secret: false },
				]);
				break;
			case "note":
				setFields([{ title: "Note", property: "note", value: "", secret: false }]);
				break;
			case "custom":
			default:
				setFields([{ title: "Custom Field", property: "text", value: "", secret: false }]);
				break;
		}
	};

	const generateEntryId = () => {
		return crypto.randomUUID();
	};

	const handleAddField = () => {
		setFields((prev) => [...prev, { title: "", property: "text", value: "", secret: false }]);
	};

	const handleUpdateField = (index: number, key: keyof FormField, value: string | boolean) => {
		setFields((prev) => prev.map((field, i) => (i === index ? { ...field, [key]: value } : field)));
	};

	const handleRemoveField = (index: number) => {
		setFields((prev) => prev.filter((_, i) => i !== index));
		setRevealed((prev) => {
			const updated = { ...prev };
			delete updated[index];
			return updated;
		});
	};

	const toggleFieldReveal = (index: number) => {
		setRevealed((prev) => ({
			...prev,
			[index]: !prev[index],
		}));
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

	const resetFormState = () => {
		setEntryTitle("");
		setFields([]);
		setTags([]);
		setNewTag("");
		setError("");
		setSelectedTemplate(null);
		setRevealed({});
	};

	const closeAndReset = () => {
		closeAddEntryModal();
		setTimeout(resetFormState, 300);
	};

	const handleCancel = () => {
		closeAndReset();
	};

	const handleSubmit = async () => {
		try {
			const formData = {
				entryTitle,
				fields,
				tags,
			};

			const validatedData = addEntryFormSchema.parse(formData);

			setError("");
			setLoading(true);

			const vaultFields: Field[] = validatedData.fields.map((field) => ({
				title: field.title.trim(),
				property: field.property.trim() as FieldType,
				value: field.value,
				secret: field.secret,
			}));

			const newEntry: DataEntry = {
				id: generateEntryId(),
				entry_type: "entry",
				name: validatedData.entryTitle.trim(),
				data_type: selectedTemplate || "login",
				created_at: new Date().toISOString(),
				updated_at: new Date().toISOString(),
				fields: vaultFields,
				tags: validatedData.tags,
			};

			if (currentVaultId) {
				const vaultInstance = VaultManager.getInstance().getInstance(currentVaultId);
				if (vaultInstance) {
					await vaultInstance.addEntry(addEntryPath, newEntry);
				}
			}

			addEntryOnSuccess?.();
			closeAddEntryModal();
			setTimeout(resetFormState, 300);
		} catch (err) {
			if (err instanceof z.ZodError) {
				const errorMessages = err.issues.map((issue) => issue.message).join(", ");
				setError(errorMessages);
			} else {
				console.error("Error adding entry:", err);
				setError(t("addEntry.errors.addFailed"));
			}
		} finally {
			setLoading(false);
		}
	};

	return (
		<Modal isOpen={isAddEntryModalOpen} onClose={handleCancel}>
			{selectedTemplate === null ? (
				<div className="space-y-6">
					<div className="flex items-start gap-4 pb-3 border-b border-base-300/40">
						<div className="p-2.5 rounded-xl bg-primary/10 text-primary">
							<svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
								<title>{t("addEntry.templates.title")}</title>
								<path
									strokeLinecap="round"
									strokeLinejoin="round"
									strokeWidth={2}
									d="M12 9v3m0 0v3m0-3h3m-3 0H9m12 0a9 9 0 11-18 0 9 9 0 0118 0z"
								/>
							</svg>
						</div>
						<div>
							<h3 className="font-bold text-xl text-base-content">
								{t("addEntry.templates.title")}
							</h3>
							<p className="text-xs text-base-content/60 mt-1">
								Choose a template to get started with your new item.
							</p>
						</div>
					</div>

					<div className="grid grid-cols-1 md:grid-cols-2 gap-4">
						{TEMPLATE_CARDS.map((card) => (
							<button
								key={card.id}
								type="button"
								className="flex items-start text-left gap-4 p-4 bg-base-200/40 hover:bg-base-200/80 border border-base-300/50 hover:border-primary/45 rounded-2xl transition-all duration-200 group cursor-pointer active:scale-98"
								onClick={() => handleSelectTemplate(card.id)}
							>
								<div
									className={`p-3 rounded-xl border transition-all group-hover:scale-105 ${card.color}`}
								>
									{card.icon}
								</div>
								<div className="space-y-1">
									<h4 className="font-bold text-base text-base-content group-hover:text-primary transition-colors">
										{card.name}
									</h4>
									<p className="text-xs text-base-content/60 leading-normal">{card.desc}</p>
								</div>
							</button>
						))}
					</div>

					<div className="modal-action mt-6">
						<button
							type="button"
							className="btn btn-ghost w-full sm:w-auto active:scale-95 transition-all duration-150"
							onClick={handleCancel}
						>
							{t("addEntry.cancel")}
						</button>
					</div>
				</div>
			) : (
				<div className="space-y-4">
				<div className="flex items-center justify-between pb-3 border-b border-base-300/40">
					<div className="flex items-center gap-3">
						<div className="p-2.5 rounded-xl bg-primary/10 text-primary">
							<svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
								<title>{t("addEntry.title")}</title>
								<path
									strokeLinecap="round"
									strokeLinejoin="round"
									strokeWidth={2}
									d="M12 9v3m0 0v3m0-3h3m-3 0H9m12 0a9 9 0 11-18 0 9 9 0 0118 0z"
								/>
							</svg>
						</div>
						<h3 className="font-bold text-xl text-base-content">{t("addEntry.title")}</h3>
					</div>
					<button
						type="button"
						className="btn btn-ghost btn-xs gap-1 text-base-content/60 hover:text-base-content active:scale-95 transition-all"
						onClick={() => setSelectedTemplate(null)}
					>
						← {t("addEntry.back")}
					</button>
				</div>

				{/* Entry Title */}
				<div className="form-control">
					<label className="label" htmlFor="new-entry-title">
						<span className="label-text font-semibold text-sm text-base-content/85">
							{t("addEntry.entryTitle")} *
						</span>
					</label>
					<input
						id="new-entry-title"
						type="text"
						placeholder={t("addEntry.entryTitlePlaceholder")}
						className="input input-bordered w-full"
						value={entryTitle}
						onChange={(e) => setEntryTitle(e.target.value)}
					/>
				</div>

				{/* Fields */}
				<div className="form-control">
					<label className="label">
						<span className="label-text font-semibold text-sm text-base-content/85">
							{t("addEntry.fields")}
						</span>
					</label>
					<div className="space-y-3">
						{fields.map((field, index) => (
							<div
								key={index}
								className="bg-base-200 rounded-xl p-3.5 border border-base-300 space-y-2 relative"
							>
								{/* Header Row: Title input, Type dropdown, and Delete button */}
								<div className="flex gap-2 items-center">
									<div className="flex-1">
										<label className="label py-0.5" htmlFor={`add-field-title-${index}`}>
											<span className="label-text-alt text-[10px] font-semibold text-base-content/60 uppercase">
												{t("addEntry.fieldTitle")}
											</span>
										</label>
										<input
											id={`add-field-title-${index}`}
											type="text"
											placeholder={t("addEntry.fieldTitle")}
											className="input input-bordered input-sm w-full"
											value={field.title}
											onChange={(e) => handleUpdateField(index, "title", e.target.value)}
										/>
									</div>

									<div className="w-1/3 min-w-[100px]">
										<label className="label py-0.5" htmlFor={`add-field-type-${index}`}>
											<span className="label-text-alt text-[10px] font-semibold text-base-content/60 uppercase">
												{t("addEntry.fieldType")}
											</span>
										</label>
										<select
											id={`add-field-type-${index}`}
											className="select select-bordered select-sm w-full"
											value={field.property}
											onChange={(e) => {
												const val = e.target.value;
												handleUpdateField(index, "property", val);
												if (val === "password" || val === "ssh key") {
													handleUpdateField(index, "secret", true);
												} else {
													handleUpdateField(index, "secret", false);
												}
											}}
										>
											<option value="text">Text</option>
											<option value="password">Password</option>
											<option value="url">URL</option>
											<option value="note">Note</option>
											<option value="ssh key">SSH Key</option>
											<option value="otp">OTP</option>
										</select>
									</div>

									<button
										type="button"
										className="btn btn-ghost btn-sm btn-circle mt-5 self-end"
										onClick={() => handleRemoveField(index)}
										disabled={fields.length <= 1}
									>
										✕
									</button>
								</div>

								{/* Value Row: Renders appropriate input based on property (type) */}
								<div className="space-y-1">
									<label className="label py-0.5" htmlFor={`add-field-val-${index}`}>
										<span className="label-text-alt text-[10px] font-semibold text-base-content/60 uppercase">
											{t("addEntry.fieldValue")}
										</span>
									</label>
									<div className="relative flex items-center w-full">
										{field.property === "note" || field.property === "ssh key" ? (
											<textarea
												id={`add-field-val-${index}`}
												placeholder={t("addEntry.fieldValue")}
												className={`textarea textarea-bordered w-full text-sm min-h-[70px] ${
													field.property === "ssh key" ? "font-mono text-xs" : ""
												}`}
												value={field.value}
												onChange={(e) => handleUpdateField(index, "value", e.target.value)}
											/>
										) : (
											<>
												<input
													id={`add-field-val-${index}`}
													type={
														field.property === "password"
															? revealed[index]
																? "text"
																: "password"
															: field.property === "url"
																? "url"
																: "text"
													}
													placeholder={t("addEntry.fieldValue")}
													className={`input input-bordered input-sm w-full pr-10 ${
														field.property === "otp" ? "font-mono" : ""
													}`}
													value={field.value}
													onChange={(e) => handleUpdateField(index, "value", e.target.value)}
												/>
												{field.property === "password" && (
													<button
														type="button"
														className="absolute right-2 text-base-content/50 hover:text-base-content p-1 cursor-pointer"
														onClick={() => toggleFieldReveal(index)}
													>
														{revealed[index] ? (
															<svg
																className="w-4 h-4"
																fill="none"
																stroke="currentColor"
																viewBox="0 0 24 24"
															>
																<title>Hide</title>
																<path
																	strokeLinecap="round"
																	strokeLinejoin="round"
																	strokeWidth={2}
																	d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l18 18"
																/>
															</svg>
														) : (
															<svg
																className="w-4 h-4"
																fill="none"
																stroke="currentColor"
																viewBox="0 0 24 24"
															>
																<title>Show</title>
																<path
																	strokeLinecap="round"
																	strokeLinejoin="round"
																	strokeWidth={2}
																	d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
																/>
																<path
																	strokeLinecap="round"
																	strokeLinejoin="round"
																	strokeWidth={2}
																	d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"
																/>
															</svg>
														)}
													</button>
												)}
											</>
										)}
									</div>
								</div>

								{/* Secret Switch (Only if type is NOT password) */}
								{field.property !== "password" && (
									<div className="flex items-center pt-1">
										<label className="cursor-pointer label py-0 flex gap-2">
											<input
												type="checkbox"
												className="checkbox checkbox-xs checkbox-primary"
												checked={field.secret}
												onChange={(e) => handleUpdateField(index, "secret", e.target.checked)}
											/>
											<span className="label-text text-xs text-base-content/75">
												{t("addEntry.secret")}
											</span>
										</label>
									</div>
								)}
							</div>
						))}
						<button
							type="button"
							className="btn btn-outline btn-sm w-full sm:w-auto active:scale-95 transition-all duration-150"
							onClick={handleAddField}
						>
							+ {t("addEntry.addField")}
						</button>
					</div>
				</div>

				{/* Tags */}
				<div className="form-control">
					<label className="label" htmlFor="new-entry-tags-input">
						<span className="label-text font-semibold text-sm text-base-content/85">
							{t("addEntry.tags")}
						</span>
					</label>
					<div className="flex gap-2 mb-2">
						<input
							id="new-entry-tags-input"
							type="text"
							placeholder={t("addEntry.tagPlaceholder")}
							className="input input-bordered input-sm flex-1"
							value={newTag}
							onChange={(e) => setNewTag(e.target.value)}
							onKeyPress={(e) => e.key === "Enter" && handleAddTag()}
						/>
						<button
							type="button"
							className="btn btn-outline btn-sm active:scale-95 transition-all duration-150"
							onClick={handleAddTag}
						>
							{t("addEntry.addTag")}
						</button>
					</div>
					{tags.length > 0 && (
						<div className="flex flex-wrap gap-1">
							{tags.map((tag, index) => (
								<div key={index} className="badge badge-primary gap-1 p-2.5">
									{tag}
									<button
										type="button"
										className="btn btn-ghost btn-xs p-0 min-h-0 h-4 w-4 rounded-full flex items-center justify-center text-[10px]"
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
					<div className="alert alert-error text-sm py-2">
						<span>{error}</span>
					</div>
				)}

				<div className="modal-action mt-6 gap-2">
					<button
						type="button"
						className="btn btn-primary flex-1 sm:flex-initial active:scale-95 transition-all duration-150 font-semibold"
						onClick={handleSubmit}
						disabled={loading}
					>
						{loading ? (
							<>
								<span className="loading loading-spinner loading-sm" />
								{t("addEntry.adding")}
							</>
						) : (
							t("addEntry.addEntry")
						)}
					</button>
					<button
						type="button"
						className="btn btn-ghost flex-1 sm:flex-initial active:scale-95 transition-all duration-150"
						onClick={handleCancel}
						disabled={loading}
					>
						{t("addEntry.cancel")}
					</button>
				</div>
			</div>
			)}
		</Modal>
	);
};
