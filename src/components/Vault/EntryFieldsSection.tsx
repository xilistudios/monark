import { useTranslation } from 'react-i18next';
import type { Field, FieldType } from '../../interfaces/vault.interface';
import { useState } from 'react';
import { PasswordFieldInput } from './PasswordFieldInput';
import { PasswordFieldView } from './PasswordFieldView';

interface FormField extends Field {
  id: string;
}

const FIELD_TYPE_OPTIONS: { value: FieldType; label: string }[] = [
  { value: 'text', label: 'Text' },
  { value: 'url', label: 'URL' },
  { value: 'note', label: 'Note' },
  { value: 'otp', label: 'OTP' },
  { value: 'password', label: 'Password' },
  { value: 'ssh key', label: 'SSH Key' },
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
    value: string | boolean
  ) => void;
  handleRemoveField: (index: number) => void;
}

/**
 * Validates URL format
 */
const isValidUrl = (url: string): boolean => {
  try {
    new URL(url);
    return true;
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
    value: string | boolean
  ) => void,
  t: (key: string) => string
) => {
  const baseClasses =
    'w-full px-3 py-2 text-sm border border-base-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary';
  const readOnlyClasses = editMode ? '' : 'bg-base-100';

  if (!editMode) {
    // View mode rendering
    return renderFieldValue(field);
  }

  switch (field.property) {
    case 'url':
      return (
        <div className="space-y-1">
          <input
            type="url"
            className={`input ${baseClasses} ${readOnlyClasses} ${
              field.value && !isValidUrl(field.value) ? 'border-error' : ''
            }`}
            placeholder="https://example.com"
            value={field.value}
            onChange={(e) => handleUpdateField(idx, 'value', e.target.value)}
            maxLength={512}
            readOnly={!editMode}
          />
          {field.value && !isValidUrl(field.value) && (
            <p className="text-xs text-error">Please enter a valid URL</p>
          )}
        </div>
      );

    case 'note':
      return (
        <textarea
          className={`textarea ${baseClasses} ${readOnlyClasses} min-h-[80px] resize-y`}
          placeholder={t('vault.fields.valuePlaceholder')}
          value={field.value}
          onChange={(e) => handleUpdateField(idx, 'value', e.target.value)}
          maxLength={1000}
          readOnly={!editMode}
        />
      );

    case 'password':
      return (
        <PasswordFieldInput
          value={field.value}
          onChange={(value) => handleUpdateField(idx, 'value', value)}
          readOnly={!editMode}
        />
      );

    case 'text':
    case 'otp':
    case 'ssh key':
    default:
      return (
        <input
          type="text"
          className={`input ${baseClasses} ${readOnlyClasses} ${field.property === 'otp' || field.property === 'ssh key' ? 'font-mono' : ''}`}
          placeholder={t('vault.fields.valuePlaceholder')}
          value={field.value}
          onChange={(e) => handleUpdateField(idx, 'value', e.target.value)}
          maxLength={field.property === 'ssh key' ? 2048 : 128}
          readOnly={!editMode}
        />
      );
  }
};

/**
 * Renders the appropriate view component based on field type
 */
const renderFieldValue = (field: FormField) => {
  if (!field.value) {
    return <p className="text-base-content/60 italic">No value</p>;
  }

  switch (field.property) {
    case 'url':
      return isValidUrl(field.value) ? (
        <a
          href={field.value}
          target="_blank"
          rel="noopener noreferrer"
          className="text-primary hover:text-primary-focus underline break-all"
        >
          {field.value}
        </a>
      ) : (
        <p className="text-base-content break-all">{field.value}</p>
      );

    case 'note':
      return (
        <p className="text-base-content whitespace-pre-wrap break-words">
          {field.value}
        </p>
      );

    case 'password':
      return <PasswordFieldView value={field.value} />;

    case 'otp':
      return (
        <p className="text-base-content font-mono text-lg tracking-wider">
          {field.value}
        </p>
      );

    case 'text':
    case 'ssh key':
    default:
      return (
        <p
          className={`text-base-content break-all ${field.property === 'ssh key' ? 'font-mono text-xs' : ''}`}
        >
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
  const { t } = useTranslation('home');

  return (
    <div className="bg-base-100 rounded-lg">
      <div className="p-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-base-content uppercase tracking-wide">
            {t('vault.fields.title')}
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
              {t('vault.fields.addButton')}
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
                  {t('vault.fields.titleLabel')}
                </label>
                <input
                  type="text"
                  className="input w-full px-3 py-2 text-sm border border-base-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
                  placeholder={t('vault.fields.titlePlaceholder')}
                  value={field.title}
                  onChange={(e) =>
                    handleUpdateField(idx, 'title', e.target.value)
                  }
                  maxLength={32}
                  readOnly={!editMode}
                />
              </div>
              {editMode && (
                <div>
                  <label className="block text-xs font-medium text-base-content mb-1 uppercase tracking-wide">
                    {t('vault.fields.propertyLabel')}
                  </label>
                  <select
                    className="select w-full px-3 py-2 text-sm border border-base-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
                    value={field.property}
                    onChange={(e) =>
                      handleUpdateField(
                        idx,
                        'property',
                        e.target.value as FieldType
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
                {t('vault.fields.valueLabel')}
              </label>
              <div className="flex gap-2">
                <div className="flex-1">
                  {renderFieldInput(field, idx, editMode, handleUpdateField, t)}
                </div>
                <button
                  className="btn px-3 py-2 text-white bg-primary rounded-md hover:bg-primary-focus focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary"
                  onClick={() => handleCopy(field.value, field.title)}
                  type="button"
                  title={t('vault.fields.copyButton', {
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

            {editMode && field.property !== 'password' && (
              <div className="flex items-center justify-between">
                <label className="flex items-center">
                  <input
                    type="checkbox"
                    className="checkbox h-4 w-4 text-primary border-base-300 rounded focus:ring-primary"
                    checked={field.secret}
                    onChange={(e) =>
                      handleUpdateField(idx, 'secret', e.target.checked)
                    }
                  />
                  <span className="ml-2 text-sm text-base-content">
                    {t('vault.fields.secretLabel')}
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
                  {t('vault.fields.removeButton')}
                </button>
              </div>
            )}
            {editMode && field.property === 'password' && (
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
                  {t('vault.fields.removeButton')}
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
