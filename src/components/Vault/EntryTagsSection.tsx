import { useTranslation } from 'react-i18next';

interface EntryTagsSectionProps {
  tags: string[];
  newTag: string;
  setNewTag: (tag: string) => void;
  editMode: boolean;
  handleAddTag: () => void;
  handleRemoveTag: (tag: string) => void;
}

export function EntryTagsSection({
  tags,
  newTag,
  setNewTag,
  editMode,
  handleAddTag,
  handleRemoveTag,
}: EntryTagsSectionProps) {
  const { t } = useTranslation('home');

  return (
    <div className="bg-white rounded-lg">
      <div className="p-4">
        <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">
          {t('vault.tags.title')}
        </h3>
      </div>

      <div className="p-4">
        <div className="flex flex-wrap gap-2 mb-4">
          {tags.map((tag) => (
            <span
              key={tag}
              className="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-blue-100 text-blue-800"
            >
              {editMode && (
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
                    d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z"
                  />
                </svg>
              )}
              {tag}
              {editMode && (
                <button
                  className="ml-1 h-4 w-4 text-blue-600 hover:text-blue-800 focus:outline-none"
                  onClick={() => handleRemoveTag(tag)}
                  type="button"
                >
                  <svg
                    className="w-3 h-3"
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
                </button>
              )}
            </span>
          ))}
          {!editMode && tags.length === 0 && (
            <p className="text-gray-500 text-sm">{t('vault.tags.noTags')}</p>
          )}
        </div>

        {editMode && (
          <div className="flex gap-2">
            <input
              type="text"
              className="flex-1 px-3 py-2 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              placeholder={t('vault.tags.addPlaceholder')}
              value={newTag}
              onChange={(e) => setNewTag(e.target.value)}
              maxLength={24}
              onKeyPress={(e) => e.key === 'Enter' && handleAddTag()}
            />
            <button
              className="px-3 py-2 text-white bg-blue-600 rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50"
              onClick={handleAddTag}
              type="button"
              disabled={!newTag.trim()}
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
                  d="M12 6v6m0 0v6m0-6h6m-6 0H6"
                />
              </svg>
              {t('vault.tags.addButton')}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
