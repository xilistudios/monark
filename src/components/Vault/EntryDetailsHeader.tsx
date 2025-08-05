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
    <div className="bg-white px-6 py-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold text-gray-800">
            {editMode
              ? t(isDataEntry(entry) ? 'editEntry.title' : 'editGroup.title')
              : entry.name}
          </h2>
          <div className="flex items-center mt-1">
            <span
              className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${
                editMode
                  ? 'bg-blue-100 text-blue-800'
                  : 'bg-gray-100 text-gray-800'
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
