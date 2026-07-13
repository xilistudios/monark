import { useTranslation } from 'react-i18next';
import type { DataEntry, GroupEntry } from '../../interfaces/vault.interface';

interface EntryDetailsHeaderProps {
  entry: DataEntry | GroupEntry;
  editMode: boolean;
  isDataEntry: (e: DataEntry | GroupEntry | null) => e is DataEntry;
}

export function EntryDetailsHeader({
	entry,
	editMode,
	isDataEntry,
}: EntryDetailsHeaderProps) {
	const { t } = useTranslation("home");

	const getBadgeClasses = () => {
		if (editMode) return "bg-primary/10 text-primary border-primary/20";
		if (!isDataEntry(entry)) return "bg-warning/10 text-warning border-warning/20";

		switch (entry.data_type?.toLowerCase()) {
			case "login":
				return "bg-primary/10 text-primary border-primary/20";
			case "credit card":
				return "bg-secondary/10 text-secondary border-secondary/20";
			case "api key":
				return "bg-accent/10 text-accent border-accent/20";
			case "ssh key":
				return "bg-info/10 text-info border-info/20";
			case "note":
				return "bg-neutral-content/10 text-neutral-content border-neutral-content/20";
			default:
				return "bg-success/10 text-success border-success/20";
		}
	};

	const getBadgeText = () => {
		if (!isDataEntry(entry)) return t("vault.entry.type.group");
		return entry.data_type ? entry.data_type.toUpperCase() : t("vault.entry.type.entry");
	};

	return (
		<div className="bg-base-100 px-6 py-5 border-b border-base-300/40">
			<div className="flex items-center justify-between">
				<div>
					<h2 className="text-2xl font-bold tracking-tight text-base-content">
						{editMode
							? t(isDataEntry(entry) ? "editEntry.title" : "editGroup.title")
							: entry.name}
					</h2>
					<div className="flex items-center mt-1.5">
						<span
							className={`badge badge-sm font-semibold tracking-wide py-2.5 px-3 border ${getBadgeClasses()}`}
						>
							{getBadgeText()}
						</span>
					</div>
				</div>
			</div>
		</div>
	);
}
