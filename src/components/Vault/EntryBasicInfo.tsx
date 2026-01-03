import { useTranslation } from "react-i18next";

interface EntryBasicInfoProps {
	entryTitle: string;
	setEntryTitle: (title: string) => void;
	dataType: string;
	setDataType: (type: string) => void;
}

export function EntryBasicInfo({
	entryTitle,
	setEntryTitle,
	dataType,
	setDataType,
}: EntryBasicInfoProps) {
	const { t } = useTranslation("home");

	return (
		<div className="bg-base-100 rounded-lg p-4">
			<h3 className="text-sm font-semibold text-base-content mb-4 uppercase tracking-wide">
				{t("vault.basicInfo.title")}
			</h3>
			<div className="space-y-4">
				<div>
					<label className="block text-sm font-medium text-base-content mb-1">
						{t("vault.entry.name")}
					</label>
					<input
						type="text"
						className="input w-full px-3 py-2 input-bordered rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
						value={entryTitle}
						onChange={(e) => setEntryTitle(e.target.value)}
						maxLength={64}
						placeholder={t("vault.entry.name.placeholder")}
					/>
				</div>
				<div>
					<label className="block text-sm font-medium text-base-content mb-1">
						{t("vault.entry.dataType")}
					</label>
					<input
						type="text"
						className="input w-full px-3 py-2 input-bordered rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
						value={dataType}
						onChange={(e) => setDataType(e.target.value)}
						maxLength={32}
						placeholder={t("vault.entry.dataType.placeholder")}
					/>
				</div>
			</div>
		</div>
	);
}
