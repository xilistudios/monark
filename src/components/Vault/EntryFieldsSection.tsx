import { useTranslation } from "react-i18next";
import type { Field, FieldType } from "../../interfaces/vault.interface";
import { OtpFieldView } from "./OtpFieldView";
import { PasswordFieldInput } from "./PasswordFieldInput";
import { PasswordFieldView } from "./PasswordFieldView";

interface FormField extends Field {
	id: string;
}

const FIELD_TYPE_OPTIONS: { value: FieldType; label: string }[] = [
	{ value: "text", label: "Text" },
	{ value: "url", label: "URL" },
	{ value: "note", label: "Note" },
	{ value: "otp", label: "OTP" },
	{ value: "password", label: "Password" },
	{ value: "ssh key", label: "SSH Key" },
];

interface EntryFieldsSectionProps {
	fields: FormField[];
	revealed: Record<string, boolean>;
	editMode: boolean;
	toggleReveal: (property: string) => void;
	handleCopy: (value: string, fieldName?: string) => Promise<void>;
	handleAddField: () => void;
	handleUpdateField: (
		index: number,
		key: keyof FormField,
		value: string | boolean,
	) => void;
	handleRemoveField: (index: number) => void;
}

/**
 * Validates URL format
 */
const isValidUrl = (url: string): boolean => {
	try {
		const parsed = new URL(url);
		return parsed.protocol === 'http:' || parsed.protocol === 'https:';
	} catch {
		return false;
	}
};

/**
 * Renders the appropriate input component based on field type
 */
const renderFieldInput = (
	field: FormField,
	idx: number,
	editMode: boolean,
	handleUpdateField: (
		index: number,
		key: keyof FormField,
		value: string | boolean,
	) => void,
	t: (key: string) => string,
	onCopy: (value: string, fieldName?: string) => Promise<void>,
) => {
	const baseClasses =
		"w-full px-3 py-2 text-sm border border-base-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary";
	const readOnlyClasses = editMode ? "" : "bg-base-100";

	if (!editMode) {
		// View mode rendering
		return renderFieldValue(field, onCopy);
	}

	switch (field.property) {
		case "url":
			return (
				<div className="space-y-1">
					<input
						type="url"
						className={`input ${baseClasses} ${readOnlyClasses} ${
							field.value && !isValidUrl(field.value) ? "border-error" : ""
						}`}
						placeholder="https://example.com"
						value={field.value}
						onChange={(e) => handleUpdateField(idx, "value", e.target.value)}
						maxLength={512}
						readOnly={!editMode}
					/>
					{field.value && !isValidUrl(field.value) && (
						<p className="text-xs text-error">Please enter a valid URL</p>
					)}
				</div>
			);

		case "note":
			return (
				<textarea
					className={`textarea ${baseClasses} ${readOnlyClasses} min-h-[80px] resize-y`}
					placeholder={t("vault.fields.valuePlaceholder")}
					value={field.value}
					onChange={(e) => handleUpdateField(idx, "value", e.target.value)}
					maxLength={1000}
					readOnly={!editMode}
				/>
			);

		case "password":
			return (
				<PasswordFieldInput
					value={field.value}
					onChange={(value) => handleUpdateField(idx, "value", value)}
					readOnly={!editMode}
				/>
			);

		case "text":
		case "otp":
		case "ssh key":
		default:
			return (
				<input
					type="text"
					className={`input ${baseClasses} ${readOnlyClasses} ${field.property === "otp" || field.property === "ssh key" ? "font-mono" : ""}`}
					placeholder={t("vault.fields.valuePlaceholder")}
					value={field.value}
					onChange={(e) => handleUpdateField(idx, "value", e.target.value)}
					maxLength={field.property === "ssh key" ? 2048 : 128}
					readOnly={!editMode}
				/>
			);
	}
};

/**
 * Renders the appropriate view component based on field type
 */
const renderFieldValue = (
	field: FormField,
	onCopy: (value: string, fieldName?: string) => Promise<void>,
) => {
	if (!field.value) {
		return <p className="text-base-content/40 italic text-xs">No value</p>;
	}

	switch (field.property) {
		case "url":
			return isValidUrl(field.value) ? (
				<a
					href={field.value}
					target="_blank"
					rel="noopener noreferrer"
					className="text-primary hover:text-primary-focus hover:underline break-all inline-flex items-center gap-1 text-sm font-semibold"
				>
					{field.value}
					<svg
						className="w-3.5 h-3.5 flex-shrink-0"
						fill="none"
						stroke="currentColor"
						viewBox="0 0 24 24"
					>
						<path
							strokeLinecap="round"
							strokeLinejoin="round"
							strokeWidth={2}
							d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
						/>
					</svg>
				</a>
			) : (
				<p className="text-base-content break-all text-sm font-medium">
					{field.value}
				</p>
			);

		case "note":
			return (
				<div className="text-base-content whitespace-pre-wrap break-words bg-base-300/30 px-3.5 py-2.5 rounded-xl border border-base-300/40 text-xs font-normal leading-relaxed">
					{field.value}
				</div>
			);

		case "password":
			return <PasswordFieldView value={field.value} />;

		case "otp":
			return <OtpFieldView secret={field.value} onCopy={onCopy} />;

		case "ssh key":
			return (
				<pre className="bg-base-300/40 p-3.5 rounded-xl border border-base-300/30 font-mono text-[11px] leading-relaxed text-base-content/85 overflow-x-auto whitespace-pre-wrap break-all max-h-[140px] w-full">
					{field.value}
				</pre>
			);

		case "text":
		default:
			return (
				<p className="text-base-content break-all text-sm font-medium">
					{field.value}
				</p>
			);
	}
};

export function EntryFieldsSection({
	fields,
	revealed: _revealed,
	editMode,
	toggleReveal: _toggleReveal,
	handleCopy,
	handleAddField,
	handleUpdateField,
	handleRemoveField,
}: EntryFieldsSectionProps) {
	const { t } = useTranslation("home");

	if (!editMode) {
		return (
			<div className="space-y-4">
				<h3 className="text-xs font-bold text-base-content/40 uppercase tracking-widest px-1">
					{t("vault.fields.title")}
				</h3>
				<div className="space-y-3">
					{fields.map((field) => (
						<div
							key={field.id}
							className="flex items-center justify-between p-4 bg-base-200/40 hover:bg-base-200/80 border border-base-300/30 rounded-2xl transition-all duration-200 group relative"
						>
							<div className="flex-1 min-w-0 pr-4 space-y-1">
								<span className="text-[10px] font-bold text-base-content/40 tracking-wider uppercase block">
									{field.title || field.property}
								</span>
								<div className="text-sm font-semibold text-base-content break-all">
									{renderFieldValue(field, handleCopy)}
								</div>
							</div>
							{field.property !== "otp" && (
								<div className="flex items-center gap-1.5 opacity-100 sm:opacity-0 group-hover:opacity-100 transition-opacity duration-200 flex-shrink-0">
									<button
										type="button"
										className="btn btn-ghost btn-sm btn-circle text-base-content/50 hover:text-primary hover:bg-primary/10 transition-colors"
										onClick={() =>
											handleCopy(field.value, field.title || field.property)
										}
										title={t("vault.fields.copyButton", {
											fieldName: field.title || field.property,
										})}
									>
										<svg
											className="w-4 h-4"
											fill="none"
											stroke="currentColor"
											viewBox="0 0 24 24"
										>
											<path
												strokeLinecap="round"
												strokeLinejoin="round"
												strokeWidth={2}
												d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
											/>
										</svg>
									</button>
								</div>
							)}
						</div>
					))}
				</div>
			</div>
		);
	}

	return (
		<div className="bg-base-100 rounded-lg">
			<div className="p-4">
				<div className="flex items-center justify-between">
					<h3 className="text-sm font-semibold text-base-content uppercase tracking-wide">
						{t("vault.fields.title")}
					</h3>
					{editMode && (
						<button
							className="btn inline-flex items-center px-3 py-1.5 border border-transparent text-xs font-medium rounded-md text-white bg-primary hover:bg-primary-focus focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary"
							onClick={handleAddField}
							type="button"
						>
							<svg
								className="w-3 h-3 mr-1"
								fill="none"
								stroke="currentColor"
								viewBox="0 0 24 24"
							>
								<path
									strokeLinecap="round"
									strokeLinejoin="round"
									strokeWidth={2}
									d="M12 6v6m0 0v6m0-6h6m-6 0H6"
								/>
							</svg>
							{t("vault.fields.addButton")}
						</button>
					)}
				</div>
			</div>

			<div className="p-4 space-y-4">
				{fields.map((field, idx) => (
					<div key={field.id} className="bg-base-200 rounded-lg p-4">
						<div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
							<div>
								<label className="block text-xs font-medium text-base-content mb-1 uppercase tracking-wide">
									{t("vault.fields.titleLabel")}
								</label>
								<input
									type="text"
									className="input w-full px-3 py-2 text-sm border border-base-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
									placeholder={t("vault.fields.titlePlaceholder")}
									value={field.title}
									onChange={(e) =>
										handleUpdateField(idx, "title", e.target.value)
									}
									maxLength={32}
									readOnly={!editMode}
								/>
							</div>
							{editMode && (
								<div>
									<label className="block text-xs font-medium text-base-content mb-1 uppercase tracking-wide">
										{t("vault.fields.propertyLabel")}
									</label>
									<select
										className="select w-full px-3 py-2 text-sm border border-base-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
										value={field.property}
										onChange={(e) =>
											handleUpdateField(
												idx,
												"property",
												e.target.value as FieldType,
											)
										}
									>
										{FIELD_TYPE_OPTIONS.map((option) => (
											<option key={option.value} value={option.value}>
												{option.label}
											</option>
										))}
									</select>
								</div>
							)}
						</div>

						<div className="mb-4">
							<label className="block text-xs font-medium text-base-content mb-1 uppercase tracking-wide">
								{t("vault.fields.valueLabel")}
							</label>
							<div className="flex gap-2">
								<div className="flex-1">
									{renderFieldInput(
										field,
										idx,
										editMode,
										handleUpdateField,
										t,
										handleCopy,
									)}
								</div>
								<button
									className="btn px-3 py-2 text-white bg-primary rounded-md hover:bg-primary-focus focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary"
									onClick={() => handleCopy(field.value, field.title)}
									type="button"
									title={t("vault.fields.copyButton", {
										fieldName: field.title,
									})}
								>
									<svg
										className="w-4 h-4"
										fill="none"
										stroke="currentColor"
										viewBox="0 0 24 24"
									>
										<path
											strokeLinecap="round"
											strokeLinejoin="round"
											strokeWidth={2}
											d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
										/>
									</svg>
								</button>
							</div>
						</div>

						{editMode && field.property !== "password" && (
							<div className="flex items-center justify-between">
								<label className="flex items-center">
									<input
										type="checkbox"
										className="checkbox h-4 w-4 text-primary border-base-300 rounded focus:ring-primary"
										checked={field.secret}
										onChange={(e) =>
											handleUpdateField(idx, "secret", e.target.checked)
										}
									/>
									<span className="ml-2 text-sm text-base-content">
										{t("vault.fields.secretLabel")}
									</span>
								</label>
								<button
									className="btn inline-flex items-center px-2 py-1 border border-error text-xs font-medium rounded text-error bg-base-100 hover:bg-error-focus focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-error"
									onClick={() => handleRemoveField(idx)}
									type="button"
								>
									<svg
										className="w-3 h-3 mr-1"
										fill="none"
										stroke="currentColor"
										viewBox="0 0 24 24"
									>
										<path
											strokeLinecap="round"
											strokeLinejoin="round"
											strokeWidth={2}
											d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
										/>
									</svg>
									{t("vault.fields.removeButton")}
								</button>
							</div>
						)}
						{editMode && field.property === "password" && (
							<div className="flex justify-end">
								<button
									className="btn inline-flex items-center px-2 py-1 border border-error text-xs font-medium rounded text-error bg-base-100 hover:bg-error-focus focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-error"
									onClick={() => handleRemoveField(idx)}
									type="button"
								>
									<svg
										className="w-3 h-3 mr-1"
										fill="none"
										stroke="currentColor"
										viewBox="0 0 24 24"
									>
										<path
											strokeLinecap="round"
											strokeLinejoin="round"
											strokeWidth={2}
											d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
										/>
									</svg>
									{t("vault.fields.removeButton")}
								</button>
							</div>
						)}
					</div>
				))}
			</div>
		</div>
	);
}
