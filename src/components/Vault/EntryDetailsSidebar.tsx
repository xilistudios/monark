// EntryDetailsSidebar.tsx
import { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import type { DataEntry, GroupEntry } from '../../interfaces/vault.interface';
import { EmptyState } from './EmptyState';
import { EntryDetailsHeader } from './EntryDetailsHeader';
import { EntryBasicInfo } from './EntryBasicInfo';
import { EntryFieldsSection } from './EntryFieldsSection';
import { EntryTagsSection } from './EntryTagsSection';
import { writeText } from '@tauri-apps/plugin-clipboard-manager';

interface EntryDetailsSidebarProps {
  entry: DataEntry | GroupEntry | null;
  mode?: 'view' | 'edit';
  onEdit?: () => void;
  onSave?: (updated: DataEntry | GroupEntry) => void;
  onCancel?: () => void;
  className?: string;
}

export function EntryDetailsSidebar({
  entry,
  mode = 'view',
  onEdit,
  onSave,
  onCancel,
  className = '',
}: EntryDetailsSidebarProps) {
  const { t } = useTranslation('home');
  const [editMode, setEditMode] = useState(mode === 'edit');
  const [entryTitle, setEntryTitle] = useState(entry?.name || '');
  const [dataType, setDataType] = useState(entry?.data_type || '');
  const nextFieldId = useRef(0);
  const [fields, setFields] = useState<any[]>( // Using any[] as FormField is in EntryFieldsSection
    isDataEntry(entry)
      ? entry.fields.map((f) => ({
          ...f,
          id: f.property || `field-${nextFieldId.current++}`,
        }))
      : []
  );
  const [tags, setTags] = useState<string[]>(
    isDataEntry(entry) ? entry.tags : []
  );
  const [newTag, setNewTag] = useState('');
  const [revealed, setRevealed] = useState<Record<string, boolean>>({});
  const [copyError, setCopyError] = useState<string | null>(null);
  const [copySuccess, setCopySuccess] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setEditMode(mode === 'edit');
  }, [mode]);

  useEffect(() => {
    if (entry) {
      setEntryTitle(entry.name);
      setDataType(entry.data_type);
      if (isDataEntry(entry)) {
        setFields(
          entry.fields.map((f) => ({
            ...f,
            id: f.property || `field-${nextFieldId.current++}`,
          }))
        );
        setTags(entry.tags);
      }
    }
  }, [entry]);

  function isDataEntry(e: DataEntry | GroupEntry | null): e is DataEntry {
    return !!e && (e as DataEntry).fields !== undefined;
  }
  function isGroupEntry(e: DataEntry | GroupEntry | null): e is GroupEntry {
    return !!e && (e as GroupEntry).entry_type === 'group';
  }

  const toggleReveal = (property: string) => {
    setRevealed((prev) => ({
      ...prev,
      [property]: !(prev[property] ?? false),
    }));
  };

  const handleCopy = async (value: string, fieldName?: string) => {
    setCopyError(null);
    setCopySuccess(null);
    try {
      await writeText(value);
      setCopySuccess(
        fieldName
          ? `${fieldName} ${t('vault.manager.copied')}`
          : t('vault.manager.copied')
      );
      setTimeout(() => setCopySuccess(null), 2000);
    } catch (err) {
      console.error('Failed to copy to clipboard:', err);
      setCopyError(t('vault.manager.copyFailed'));
      setTimeout(() => setCopyError(null), 3000);
    }
  };

  const handleAddField = () => {
    setFields((prev) => [
      ...prev,
      {
        id: `new-${nextFieldId.current++}`,
        title: '',
        property: '',
        value: '',
        secret: false,
      },
    ]);
  };

  const handleUpdateField = (
    index: number,
    key: string,
    value: string | boolean
  ) => {
    setFields((prev) =>
      prev.map((field, i) => (i === index ? { ...field, [key]: value } : field))
    );
  };

  const handleRemoveField = (index: number) => {
    setFields((prev) => prev.filter((_, i) => i !== index));
  };

  const handleAddTag = () => {
    const trimmed = newTag.trim();
    if (trimmed && !tags.includes(trimmed)) {
      setTags((prev) => [...prev, trimmed]);
      setNewTag('');
    }
  };

  const handleRemoveTag = (tag: string) => {
    setTags((prev) => prev.filter((t) => t !== tag));
  };

  const handleSave = () => {
    setLoading(true);
    setError(null);
    if (!entryTitle.trim()) {
      setError(t('editEntry.validation.titleRequired'));
      setLoading(false);
      return;
    }
    if (isDataEntry(entry)) {
      const updated: DataEntry = {
        ...entry,
        name: entryTitle,
        data_type: dataType,
        fields: fields.map(({ id, ...rest }) => rest),
        tags,
      };
      onSave?.(updated);
    } else if (isGroupEntry(entry)) {
      const updated: GroupEntry = {
        ...entry,
        name: entryTitle,
        data_type: dataType,
      };
      onSave?.(updated);
    }
    setLoading(false);
    setEditMode(false);
  };

  const handleCancel = () => {
    setEditMode(false);
    onCancel?.();
  };

  if (!entry) {
    return <EmptyState className={className} />;
  }

  return (
    <aside
      className={`w-full h-full bg-base-100 flex flex-col overflow-hidden ${className}`}
    >
      {editMode ? (
        <>
          <EntryDetailsHeader
            entry={entry}
            editMode={editMode}
            isDataEntry={isDataEntry}
          />

          <div className="flex-1 overflow-y-auto px-6 py-4 space-y-6">
            <EntryBasicInfo
              entryTitle={entryTitle}
              setEntryTitle={setEntryTitle}
              dataType={dataType}
              setDataType={setDataType}
            />

            {isDataEntry(entry) && (
              <>
                <EntryFieldsSection
                  fields={fields}
                  revealed={revealed}
                  editMode={editMode}
                  toggleReveal={toggleReveal}
                  handleCopy={handleCopy}
                  handleAddField={handleAddField}
                  handleUpdateField={handleUpdateField}
                  handleRemoveField={handleRemoveField}
                />

                <EntryTagsSection
                  tags={tags}
                  newTag={newTag}
                  setNewTag={setNewTag}
                  editMode={editMode}
                  handleAddTag={handleAddTag}
                  handleRemoveTag={handleRemoveTag}
                />
              </>
            )}
          </div>

          {(error || copyError || copySuccess) && (
            <div className="px-6 py-2">
              {error && <div className="text-error text-sm">{error}</div>}
              {copyError && (
                <div className="text-error text-sm">{copyError}</div>
              )}
              {copySuccess && (
                <div className="text-success text-sm">{copySuccess}</div>
              )}
            </div>
          )}

          <div className="border-t bg-base-100 px-6 py-4">
            <div className="flex flex-col sm:flex-row gap-3">
              <button
                className="btn flex-1 sm:flex-none inline-flex justify-center items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-primary hover:bg-primary-focus focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary disabled:opacity-50"
                onClick={handleSave}
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
                    {t(
                      isDataEntry(entry)
                        ? 'editEntry.saving'
                        : 'editGroup.saving'
                    )}
                  </>
                ) : (
                  <>
                    <svg
                      className="w-4 h-4 mr-2"
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
                    {t(
                      isDataEntry(entry) ? 'editEntry.save' : 'editGroup.save'
                    )}
                  </>
                )}
              </button>
              <button
                className="btn flex-1 sm:flex-none inline-flex justify-center items-center px-4 py-2 border border-base-300 text-sm font-medium rounded-md text-base-content bg-base-100 hover:bg-base-200 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary"
                onClick={handleCancel}
                disabled={loading}
              >
                <svg
                  className="w-4 h-4 mr-2"
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
                {t(
                  isDataEntry(entry) ? 'editEntry.cancel' : 'editGroup.cancel'
                )}
              </button>
            </div>
          </div>
        </>
      ) : (
        <>
          <EntryDetailsHeader
            entry={entry}
            editMode={editMode}
            isDataEntry={isDataEntry}
          />

          <div className="flex-1 overflow-y-auto px-6 py-4 space-y-6">
            {isDataEntry(entry) && entry.fields.length > 0 && (
              <EntryFieldsSection
                fields={entry.fields.map((f, idx) => ({
                  ...f,
                  id: f.property || `view-${idx}`,
                  title: f.title || f.property,
                  property: f.property,
                  value: f.value,
                  secret: f.secret,
                }))}
                revealed={revealed}
                editMode={editMode}
                toggleReveal={toggleReveal}
                handleCopy={handleCopy}
                handleAddField={handleAddField} // Not used in view mode, but passed for consistency
                handleUpdateField={handleUpdateField} // Not used in view mode, but passed for consistency
                handleRemoveField={handleRemoveField} // Not used in view mode, but passed for consistency
              />
            )}

            {isDataEntry(entry) && (
              <EntryTagsSection
                tags={entry.tags}
                newTag={newTag} // Not used in view mode, but passed for consistency
                setNewTag={setNewTag} // Not used in view mode, but passed for consistency
                editMode={editMode}
                handleAddTag={handleAddTag} // Not used in view mode, but passed for consistency
                handleRemoveTag={handleRemoveTag} // Not used in view mode, but passed for consistency
              />
            )}
          </div>

          {(copyError || copySuccess) && (
            <div className="px-6 py-2">
              {copyError && (
                <div className="text-error text-sm">{copyError}</div>
              )}
              {copySuccess && (
                <div className="text-success text-sm">{copySuccess}</div>
              )}
            </div>
          )}

          <div className="border-t bg-base-100 px-6 py-4">
            <div className="flex flex-col sm:flex-row gap-3">
              {onEdit && (
                <button
                  className="btn flex-1 sm:flex-none inline-flex justify-center items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-primary hover:bg-primary-focus focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary"
                  onClick={() => {
                    setEditMode(true);
                    onEdit();
                  }}
                >
                  <svg
                    className="w-4 h-4 mr-2"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
                    />
                  </svg>
                  Edit
                </button>
              )}
              {onCancel && (
                <button
                  className="btn flex-1 sm:flex-none inline-flex justify-center items-center px-4 py-2 border border-base-300 text-sm font-medium rounded-md text-base-content bg-base-100 hover:bg-base-200 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary"
                  onClick={onCancel}
                >
                  <svg
                    className="w-4 h-4 mr-2"
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
                  Close
                </button>
              )}
            </div>
          </div>
        </>
      )}
    </aside>
  );
}
