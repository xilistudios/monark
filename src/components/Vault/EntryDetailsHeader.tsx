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
  const { t } = useTranslation('home');

  return (
    <div className="bg-base-100 px-6 py-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold text-base-content">
            {editMode
              ? t(isDataEntry(entry) ? 'editEntry.title' : 'editGroup.title')
              : entry.name}
          </h2>
          <div className="flex items-center mt-1">
            <span
              className={`badge ${
                editMode ? 'badge-primary' : 'badge-neutral'
              }`}
            >
              {isDataEntry(entry)
                ? t('vault.entry.type.entry')
                : t('vault.entry.type.group')}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
