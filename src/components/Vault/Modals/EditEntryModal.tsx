import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSelector } from 'react-redux';
import type { DataEntry, Field, FieldType } from '../../../interfaces/vault.interface';
import type { RootState } from '../../../redux/store';
import { VaultManager } from '../../../services/vault';
import { Modal } from '../../UI/Modal';
import { useContext } from 'react';
import { VaultModalContext } from '../VaultContext';
import { parseNavigationPath } from '../../../utils/vaultNavigation';

/**
 * Modal component for editing an existing vault data entry.
 * Allows modification of title, data type, fields, and tags.
 * Implements error checking and validation.
 */

/**
 * Form field type extending Field with type safety.
 */
interface FormField {
  title: string;
  property: string; // Will be converted to FieldType when updating
  value: string;
  secret: boolean;
}

/**
 * Modal component for editing an existing vault data entry.
 * Allows modification of title, data type, fields, and tags.
 * Implements error checking and validation.
 */
export const EditEntryModal: React.FC = () => {
  const { t } = useTranslation('home');
  const currentVaultId = useSelector(
    (state: RootState) => state.vault.currentVaultId
  );
  const currentVault = useSelector((state: RootState) =>
    state.vault.vaults.find((v) => v.id === currentVaultId)
  );
  const navigationPath = currentVault?.volatile?.navigationPath || '/';
  const currentPath = parseNavigationPath(navigationPath);
  const context = useContext(VaultModalContext);
  if (!context)
    throw new Error(
      'VaultModalContext must be used within a VaultModalProvider'
    );
  const { isEditEntryModalOpen, selectedEntry, closeAllModals } = context;

  // Type assertion to ensure selectedEntry is a DataEntry
  const entry = selectedEntry as DataEntry;

  const [entryTitle, setEntryTitle] = useState(entry?.name || '');
  const [dataType, setDataType] = useState(entry?.data_type || '');
  const [fields, setFields] = useState<FormField[]>(entry?.fields || []);
  const [tags, setTags] = useState<string[]>(entry?.tags || []);
  const [newTag, setNewTag] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [revealed, setRevealed] = useState<Record<number, boolean>>({});

  const toggleFieldReveal = (index: number) => {
    setRevealed((prev) => ({
      ...prev,
      [index]: !prev[index],
    }));
  };

  // Prefill form when entry changes
  useEffect(() => {
    if (entry) {
      setEntryTitle(entry.name);
      setDataType(entry.data_type);
      setFields(entry.fields.map((f) => ({
        title: f.title,
        property: f.property, // This will be a FieldType value
        value: f.value,
        secret: f.secret
      })));
      setTags(entry.tags);
      setRevealed({});
    }
  }, [entry]);

  // Add new field
  const handleAddField = (): void => {
    setFields((prev) => [
      ...prev,
      { title: '', property: '', value: '', secret: false },
    ]);
  };

  // Update specific field
  const handleUpdateField = (
    index: number,
    key: keyof FormField,
    value: string | boolean
  ): void => {
    setFields((prev) =>
      prev.map((field, i) => (i === index ? { ...field, [key]: value } : field))
    );
  };

  // Remove field
  const handleRemoveField = (index: number): void => {
    setFields((prev) => prev.filter((_, i) => i !== index));
    setRevealed((prev) => {
      const updated = { ...prev };
      delete updated[index];
      return updated;
    });
  };

  // Add tag
  const handleAddTag = (): void => {
    const trimmed = newTag.trim();
    if (trimmed && !tags.includes(trimmed)) {
      setTags((prev) => [...prev, trimmed]);
      setNewTag('');
    }
  };

  // Remove tag
  const handleRemoveTag = (tagToRemove: string): void => {
    setTags((prev) => prev.filter((tag) => tag !== tagToRemove));
  };

  // Submit updates
  const handleSubmit = async (): Promise<void> => {
    if (!entryTitle.trim()) {
      setError(t('editEntry.errors.titleRequired'));
      return;
    }

    const validFields = fields.filter(
      (field) => field.title.trim() && field.property.trim()
    );

    if (validFields.length === 0) {
      setError(t('editEntry.errors.fieldsRequired'));
      return;
    }

    setError(null);
    setLoading(true);

    try {
      // Convert form fields to vault fields format
      const vaultFields: Field[] = validFields.map((field) => ({
        title: field.title.trim(),
        property: field.property.trim() as FieldType, // Type assertion to convert string to FieldType
        value: field.value,
        secret: field.secret,
      }));

      const updates: Partial<DataEntry> = {
        name: entryTitle.trim(),
        data_type: dataType.trim(),
        fields: vaultFields,
        tags,
        updated_at: new Date().toISOString(),
      };

      if (currentVaultId) {
        // Get the VaultInstance from VaultManager
        const vaultInstance =
          VaultManager.getInstance().getInstance(currentVaultId);
        if (!vaultInstance) {
          throw new Error(t('errors.vaultNotAvailable'));
        }
        // Debug: log the path being used
        // Get the path from the selected entry's parent
        const path = [...currentPath, entry.id];
        console.log('Updating entry with path:', path);

        // Update the entry using VaultManager
        await vaultInstance.updateEntry(path, updates);
      }

      closeAllModals();
    } catch (err) {
      console.error('Error updating entry:', err);
      setError(
        err instanceof Error ? err.message : t('editEntry.errors.updateFailed')
      );
    } finally {
      setLoading(false);
    }
  };

  // Cancel and reset
  const handleCancel = (): void => {
    setError(null);
    setRevealed({});
    closeAllModals();
  };

  return (
    <Modal isOpen={isEditEntryModalOpen} onClose={handleCancel}>
      <div className="space-y-4">
        <div className="flex items-center gap-3 pb-3 border-b border-base-300/40">
          <div className="p-2.5 rounded-xl bg-primary/10 text-primary">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
            </svg>
          </div>
          <h3 className="font-bold text-xl text-base-content">{t('editEntry.title')}</h3>
        </div>

        {/* Entry Title */}
        <div className="form-control">
          <label className="label" htmlFor="edit-entry-title">
            <span className="label-text font-semibold text-sm text-base-content/85">{t('editEntry.entryTitle')} *</span>
          </label>
          <input
            id="edit-entry-title"
            type="text"
            placeholder={t('editEntry.entryTitlePlaceholder')}
            className="input input-bordered w-full"
            value={entryTitle}
            onChange={(e) => setEntryTitle(e.target.value)}
          />
        </div>

        {/* Data Type */}
        <div className="form-control">
          <label className="label" htmlFor="edit-entry-datatype">
            <span className="label-text font-semibold text-sm text-base-content/85">{t('editEntry.dataType')}</span>
          </label>
          <input
            id="edit-entry-datatype"
            type="text"
            placeholder={t('editEntry.dataTypePlaceholder')}
            className="input input-bordered w-full"
            value={dataType}
            onChange={(e) => setDataType(e.target.value)}
            disabled
          />
        </div>

        {/* Fields */}
        <div className="form-control">
          <label className="label">
            <span className="label-text font-semibold text-sm text-base-content/85">{t('editEntry.fields')}</span>
          </label>
          <div className="space-y-3">
            {fields.map((field, index) => (
              <div key={index} className="bg-base-200 rounded-xl p-3.5 border border-base-300 space-y-2 relative">
                {/* Header Row: Title input, Type dropdown, and Delete button */}
                <div className="flex gap-2 items-center">
                  <div className="flex-1">
                    <label className="label py-0.5" htmlFor={`edit-field-title-${index}`}>
                      <span className="label-text-alt text-[10px] font-semibold text-base-content/60 uppercase">{t('editEntry.fieldTitle')}</span>
                    </label>
                    <input
                      id={`edit-field-title-${index}`}
                      type="text"
                      placeholder={t('editEntry.fieldTitle')}
                      className="input input-bordered input-sm w-full"
                      value={field.title}
                      onChange={(e) =>
                        handleUpdateField(index, 'title', e.target.value)
                      }
                    />
                  </div>
                  
                  <div className="w-1/3 min-w-[100px]">
                    <label className="label py-0.5" htmlFor={`edit-field-type-${index}`}>
                      <span className="label-text-alt text-[10px] font-semibold text-base-content/60 uppercase">{t('editEntry.fieldType')}</span>
                    </label>
                    <select
                      id={`edit-field-type-${index}`}
                      className="select select-bordered select-sm w-full"
                      value={field.property}
                      onChange={(e) => {
                        const val = e.target.value;
                        handleUpdateField(index, 'property', val);
                        if (val === 'password' || val === 'ssh key') {
                          handleUpdateField(index, 'secret', true);
                        } else {
                          handleUpdateField(index, 'secret', false);
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
                  <label className="label py-0.5" htmlFor={`edit-field-val-${index}`}>
                    <span className="label-text-alt text-[10px] font-semibold text-base-content/60 uppercase">{t('editEntry.fieldValue')}</span>
                  </label>
                  <div className="relative flex items-center w-full">
                    {field.property === 'note' || field.property === 'ssh key' ? (
                      <textarea
                        id={`edit-field-val-${index}`}
                        placeholder={t('editEntry.fieldValue')}
                        className={`textarea textarea-bordered w-full text-sm min-h-[70px] ${
                          field.property === 'ssh key' ? 'font-mono text-xs' : ''
                        }`}
                        value={field.value}
                        onChange={(e) =>
                          handleUpdateField(index, 'value', e.target.value)
                        }
                      />
                    ) : (
                      <>
                        <input
                          id={`edit-field-val-${index}`}
                          type={
                            field.property === 'password'
                              ? (revealed[index] ? 'text' : 'password')
                              : field.property === 'url'
                              ? 'url'
                              : 'text'
                          }
                          placeholder={t('editEntry.fieldValue')}
                          className={`input input-bordered input-sm w-full pr-10 ${
                            field.property === 'otp' ? 'font-mono' : ''
                          }`}
                          value={field.value}
                          onChange={(e) =>
                            handleUpdateField(index, 'value', e.target.value)
                          }
                        />
                        {field.property === 'password' && (
                          <button
                            type="button"
                            className="absolute right-2 text-base-content/50 hover:text-base-content p-1 cursor-pointer"
                            onClick={() => toggleFieldReveal(index)}
                          >
                            {revealed[index] ? (
                              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l18 18" />
                              </svg>
                            ) : (
                              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                              </svg>
                            )}
                          </button>
                        )}
                      </>
                    )}
                  </div>
                </div>

                {/* Secret Switch (Only if type is NOT password) */}
                {field.property !== 'password' && (
                  <div className="flex items-center pt-1">
                    <label className="cursor-pointer label py-0 flex gap-2">
                      <input
                        type="checkbox"
                        className="checkbox checkbox-xs checkbox-primary"
                        checked={field.secret}
                        onChange={(e) =>
                          handleUpdateField(index, 'secret', e.target.checked)
                        }
                      />
                      <span className="label-text text-xs text-base-content/75">
                        {t('editEntry.secret')}
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
              + {t('editEntry.addField')}
            </button>
          </div>
        </div>

        {/* Tags */}
        <div className="form-control">
          <label className="label" htmlFor="edit-entry-tags-input">
            <span className="label-text font-semibold text-sm text-base-content/85">{t('editEntry.tags')}</span>
          </label>
          <div className="flex gap-2 mb-2">
            <input
              id="edit-entry-tags-input"
              type="text"
              placeholder={t('editEntry.tagPlaceholder')}
              className="input input-bordered input-sm flex-1"
              value={newTag}
              onChange={(e) => setNewTag(e.target.value)}
              onKeyPress={(e) => e.key === 'Enter' && handleAddTag()}
            />
            <button
              type="button"
              className="btn btn-outline btn-sm active:scale-95 transition-all duration-150"
              onClick={handleAddTag}
            >
              {t('editEntry.addTag')}
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
                <span className="loading loading-spinner loading-sm"></span>
                {t('editEntry.saving')}
              </>
            ) : (
              t('editEntry.save')
            )}
          </button>
          <button
            type="button"
            className="btn btn-ghost flex-1 sm:flex-initial active:scale-95 transition-all duration-150"
            onClick={handleCancel}
            disabled={loading}
          >
            {t('editEntry.cancel')}
          </button>
        </div>
      </div>
    </Modal>
  );
};
