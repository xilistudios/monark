import { useTranslation } from "react-i18next";
import type { DataEntry, GroupEntry } from "../../interfaces/vault.interface";

interface EntryDetailsHeaderProps {
	entry: DataEntry | GroupEntry;
	editMode: boolean;
	isDataEntry: (e: DataEntry | GroupEntry | null) => e is DataEntry;
	onSave?: () => void;
	onCancel?: () => void;
	loading?: boolean;
}

export function EntryDetailsHeader({
	entry,
	editMode,
	isDataEntry,
	onSave,
	onCancel,
	loading = false,
}: EntryDetailsHeaderProps) {
	const { t } = useTranslation("home");

	return (
		<div className="bg-base-100 px-6 py-4">
			<div className="flex items-center justify-between">
				<div>
					<h2 className="text-xl font-semibold text-base-content">
						{editMode
							? t(isDataEntry(entry) ? "editEntry.title" : "editGroup.title")
							: entry.name}
					</h2>
					<div className="flex items-center mt-1">
						<span
							className={`badge ${
								editMode ? "badge-primary" : "badge-neutral"
							}`}
						>
							{isDataEntry(entry)
								? t("vault.entry.type.entry")
								: t("vault.entry.type.group")}
						</span>
					</div>
				</div>
				{editMode && (
					<div className="flex gap-2">
						<button
							className="btn btn-sm btn-outline btn-error"
							onClick={onCancel}
							disabled={loading}
						>
							<svg
								className="w-4 h-4 mr-1"
								fill="none"
								stroke="currentColor"
								viewBox="0 0 24 24"
							>
								<path
									strokeLinecap="round"
									strokeLinejoin="round"
									strokeWidth={2}
									d="M6 18L18 6M6 6l12 12"
								/>
							</svg>
							{t(isDataEntry(entry) ? "editEntry.cancel" : "editGroup.cancel")}
						</button>
						<button
							className="btn btn-sm btn-primary"
							onClick={onSave}
							disabled={loading}
						>
							{loading ? (
								<>
									<svg
										className="animate-spin -ml-1 mr-2 h-4 w-4 text-white"
										fill="none"
										viewBox="0 0 24 24"
									>
										<circle
											className="opacity-25"
											cx="12"
											cy="12"
											r="10"
											stroke="currentColor"
											strokeWidth="4"
										></circle>
										<path
											className="opacity-75"
											fill="currentColor"
											d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
										></path>
									</svg>
									{t(isDataEntry(entry) ? "editEntry.saving" : "editGroup.saving")}
								</>
							) : (
								<>
									<svg
										className="w-4 h-4 mr-1"
										fill="none"
										stroke="currentColor"
										viewBox="0 0 24 24"
									>
										<path
											strokeLinecap="round"
											strokeLinejoin="round"
											strokeWidth={2}
											d="M5 13l4 4L19 7"
										/>
									</svg>
									{t(isDataEntry(entry) ? "editEntry.save" : "editGroup.save")}
								</>
							)}
						</button>
					</div>
				)}
			</div>
		</div>
	);
}
