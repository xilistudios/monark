import { useTranslation } from 'react-i18next';
import { writeText } from '@tauri-apps/plugin-clipboard-manager';
import type { Field } from '../../interfaces/vault.interface';

interface FormField extends Field {
  title: string;
  property: string;
  value: string;
  secret: boolean;
}

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

export function EntryFieldsSection({
  fields,
  revealed,
  editMode,
  toggleReveal,
  handleCopy,
  handleAddField,
  handleUpdateField,
  handleRemoveField,
}: EntryFieldsSectionProps) {
  const { t } = useTranslation('home');

  return (
    <div className="bg-white rounded-lg">
      <div className="p-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">
            {t('vault.fields.title')}
          </h3>
          {editMode && (
            <button
              className="inline-flex items-center px-3 py-1.5 border border-transparent text-xs font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
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
          <div
            key={field.property || idx}
            className="bg-gray-50 rounded-lg p-4"
          >
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1 uppercase tracking-wide">
                  {t('vault.fields.titleLabel')}
                </label>
                <input
                  type="text"
                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  placeholder={t('vault.fields.titlePlaceholder')}
                  value={field.title}
                  onChange={(e) =>
                    handleUpdateField(idx, 'title', e.target.value)
                  }
                  maxLength={32}
                  readOnly={!editMode}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1 uppercase tracking-wide">
                  {t('vault.fields.propertyLabel')}
                </label>
                <input
                  type="text"
                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  placeholder={t('vault.fields.propertyPlaceholder')}
                  value={field.property}
                  onChange={(e) =>
                    handleUpdateField(idx, 'property', e.target.value)
                  }
                  maxLength={32}
                  readOnly={!editMode}
                />
              </div>
            </div>

            <div className="mb-4">
              <label className="block text-xs font-medium text-gray-600 mb-1 uppercase tracking-wide">
                {t('vault.fields.valueLabel')}
              </label>
              <div className="flex gap-2">
                <input
                  type={
                    field.secret && !revealed[field.property] && !editMode
                      ? 'password'
                      : 'text'
                  }
                  className="flex-1 px-3 py-2 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent font-mono"
                  placeholder={t('vault.fields.valuePlaceholder')}
                  value={field.value}
                  onChange={(e) =>
                    handleUpdateField(idx, 'value', e.target.value)
                  }
                  maxLength={128}
                  readOnly={!editMode}
                />
                {field.secret && (
                  <button
                    className="px-3 py-2 text-gray-600 border border-gray-300 rounded-md hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    onClick={() => toggleReveal(field.property)}
                    type="button"
                    title={
                      revealed[field.property]
                        ? t('vault.fields.hideButton')
                        : t('vault.fields.showButton')
                    }
                  >
                    {revealed[field.property] ? (
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
                          d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.878 9.878L7.05 6.05M9.878 9.878a3 3 0 105.303-.572m0 0a3 3 0 01-4.243-4.243m4.242 4.243L15.95 17.95"
                        />
                      </svg>
                    ) : (
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
                <button
                  className="px-3 py-2 text-white bg-blue-600 rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
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

            {editMode && (
              <div className="flex items-center justify-between">
                <label className="flex items-center">
                  <input
                    type="checkbox"
                    className="h-4 w-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                    checked={field.secret}
                    onChange={(e) =>
                      handleUpdateField(idx, 'secret', e.target.checked)
                    }
                  />
                  <span className="ml-2 text-sm text-gray-600">
                    {t('vault.fields.secretLabel')}
                  </span>
                </label>
                <button
                  className="inline-flex items-center px-2 py-1 border border-red-300 text-xs font-medium rounded text-red-700 bg-white hover:bg-red-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500"
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
