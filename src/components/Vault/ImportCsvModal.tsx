import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useSelector } from 'react-redux';
import type { DataEntry, GroupEntry } from '../../interfaces/vault.interface';
import type { RootState } from '../../redux/store';
import { VaultManager } from '../../services/vault';
import { Modal } from '../UI/Modal';
import { open } from '@tauri-apps/plugin-dialog';
import { readTextFile } from '@tauri-apps/plugin-fs';
import { csvParsers } from '../../parsers/csvParsersRegistry';
import type { ICsvParser } from '../../interfaces/csv.interface';
import { parseCSV } from '../../utils/csv';
import type { ParsedEntry } from '../../interfaces/parsers.interface';

interface ImportCsvModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: () => void;
  path: string[];
}

/**
 * ImportCsvModal component for importing CSV vault data with manual format selection.
 *
 * This modal allows users to import vault entries from a CSV file. It features a parser selector dropdown,
 * enabling manual selection of the import format (e.g., Buttercup) or automatic detection.
 *
 * ## Parser Selection
 * - The dropdown UI lets users choose a specific parser or "Auto-detect".
 * - When "Auto-detect" is selected, the system tries to detect the format based on CSV content.
 * - Manual selection is useful when auto-detection fails or for explicit control.
 * - Supported formats: Buttercup (see csvParsers registry for extensibility).
 *
 * ## State Variables
 * @state selectedParser The currently selected parser instance or null for auto-detect.
 * @state csvText The raw CSV text loaded from the selected file.
 *
 * ## Dropdown UI
 * - Renders a select element listing all available parsers and an "Auto-detect" option.
 * - Changing the selection updates the parser used for preview and import.
 * - Handles error scenarios for invalid or unsupported formats.
 *
 * ## Example Usage
 * ```tsx
 * <ImportCsvModal
 *   isOpen={modalOpen}
 *   onClose={handleClose}
 *   onSuccess={refreshVault}
 *   path={['/vaults']}
 * />
 * ```
 *
 * @see csvParsersRegistry.ts for supported formats
 * @see en.json for translation keys (importCsv.parserSelector, etc.)
 */
export const ImportCsvModal = ({
  isOpen,
  onClose,
  onSuccess,
  path,
}: ImportCsvModalProps) => {
  const { t } = useTranslation('home');
  const currentVaultId = useSelector(
    (state: RootState) => state.vault.currentVaultId
  );

  const [csvFile, setCsvFile] = useState<File | null>(null);
  const [parsedEntries, setParsedEntries] = useState<ParsedEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [showPreview, setShowPreview] = useState(false);

  /**
   * The currently selected parser instance for import.
   * Null means auto-detect mode is active.
   */
  const [selectedParser, setSelectedParser] = useState<ICsvParser | null>(null);

  /**
   * The raw CSV text loaded from the selected file.
   */
  const [csvText, setCsvText] = useState<string | null>(null);

  // Select parser based on file content
  const selectParser = (csvText: string): ICsvParser | null => {
    const rows = parseCSV(csvText);
    for (const parser of csvParsers) {
      if (parser.detect(rows)) return parser;
    }
    return null;
  };

  // Use parser to convert CSV text to entries
  const parseCsvToEntries = (
    csvText: string,
    parserInstance?: ICsvParser | null
  ): ParsedEntry[] => {
    const parserToUse = parserInstance ?? selectParser(csvText);
    if (!parserToUse) return [];
    return parserToUse.parse(csvText);
  };

  // Update preview when parser or csvText changes
  useEffect(() => {
    if (csvText) {
      const entries = parseCsvToEntries(csvText, selectedParser);
      setParsedEntries(entries);
    }
  }, [selectedParser, csvText]);

  const handleFileSelect = async () => {
    try {
      const result = await open({
        multiple: false,
        directory: false,
        filters: [{ name: 'CSV Files', extensions: ['csv'] }],
      });

      if (result) {
        // Use Tauri FS plugin to read the file
        const text = await readTextFile(result);

        // Create a File object for consistency
        const file = new File([text], result.split('/').pop() || 'import.csv', {
          type: 'text/csv',
        });

        setCsvFile(file);

        setCsvText(text);
        const detectedParser = selectParser(text);
        setSelectedParser(detectedParser);

        setShowPreview(true);
        setError('');
      }
    } catch (err) {
      console.error('Error selecting file:', err);
      setError(t('importCsv.errors.fileSelection'));
    }
  };

  const handleImport = async () => {
    if (!currentVaultId || parsedEntries.length === 0 || !selectedParser) {
      setError(t('importCsv.errors.noData'));
      return;
    }

    setLoading(true);
    setError('');

    try {
      const vaultInstance =
        VaultManager.getInstance().getInstance(currentVaultId);
      if (!vaultInstance) {
        throw new Error('Vault instance not found');
      }

      let groups: Array<{ path: string[]; entry: GroupEntry }> = [];
      let entries: Array<{ path: string[]; entry: DataEntry }> = [];

      // Use Buttercup-specific hierarchy processing if applicable
      if (
        selectedParser &&
        selectedParser.constructor?.name === 'ButtercupParser' &&
        typeof (selectedParser as any).processHierarchy === 'function'
      ) {
        const result = (selectedParser as any).processHierarchy(
          parsedEntries,
          path
        );
        groups = result.groups;
        entries = result.entries;
      } else {
        // Fallback for other parsers: assume flat structure
        entries = parsedEntries
          .filter((e) => e.type === 'entry')
          .map((e) => ({
            path: [],
            entry: {
              id: e.id,
              entry_type: 'entry',
              name: e.name,
              data_type: 'login',
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
              fields: e.fields,
              tags: [],
            } as DataEntry,
          }));
      }

      console.log('groups', groups);
      console.log('entries', entries);

      // First, create all groups in bulk
      if (groups.length > 0) {
        await vaultInstance.addEntries(groups);
      }

      // Then, create all entries in bulk
      if (entries.length > 0) {
        await vaultInstance.addEntries(entries);
      }

      // Reset state
      setCsvFile(null);
      setParsedEntries([]);
      setShowPreview(false);

      onSuccess?.();
      onClose();
    } catch (err) {
      console.error('Error importing CSV:', err);
      setError(t('importCsv.errors.importFailed'));
    } finally {
      setLoading(false);
    }
  };

  const handleCancel = () => {
    setCsvFile(null);
    setParsedEntries([]);
    setShowPreview(false);
    setError('');
    onClose();
  };

  const renderPreview = () => {
    if (!showPreview || parsedEntries.length === 0) return null;

    const isButtercup =
      selectedParser &&
      selectedParser.constructor?.name === 'ButtercupParser' &&
      typeof (selectedParser as any).processHierarchy === 'function';

    const groups = isButtercup
      ? parsedEntries.filter((e) => e.type === 'group')
      : [];
    const entries = parsedEntries.filter((e) => e.type === 'entry');

    return (
      <div className="space-y-4">
        {/* Parser selector dropdown */}
        <div className="form-control w-full max-w-xs">
          <label className="label">
            <span className="label-text">{t('importCsv.parserSelector')}</span>
          </label>
          <select
            className="select select-bordered"
            value={selectedParser?.constructor.name || 'auto'}
            onChange={(e) => {
              if (e.target.value === 'auto') setSelectedParser(null);
              else
                setSelectedParser(
                  csvParsers.find(
                    (p) => p.constructor.name === e.target.value
                  ) || null
                );
            }}
          >
            <option value="auto">{t('importCsv.parserSelector.auto')}</option>
            {csvParsers.map((parser) => (
              <option
                key={parser.constructor.name}
                value={parser.constructor.name}
              >
                {parser.constructor.name}
              </option>
            ))}
          </select>
        </div>
        <div className="stats shadow">
          <div className="stat">
            <div className="stat-title">{t('importCsv.preview.groups')}</div>
            <div className="stat-value text-primary">{groups.length}</div>
          </div>
          <div className="stat">
            <div className="stat-title">{t('importCsv.preview.entries')}</div>
            <div className="stat-value text-secondary">{entries.length}</div>
          </div>
        </div>

        <div className="max-h-60 overflow-auto">
          <div className="space-y-2">
            {parsedEntries.slice(0, 10).map((entry, index) => (
              <div key={index} className="card bg-base-200 shadow-sm">
                <div className="card-body p-3">
                  <div className="flex items-center gap-2">
                    {entry.type === 'group' ? (
                      <svg
                        className="w-4 h-4 text-primary"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"
                        />
                      </svg>
                    ) : (
                      <svg
                        className="w-4 h-4 text-secondary"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z"
                        />
                      </svg>
                    )}
                    <span className="font-semibold">{entry.name}</span>
                    <span className="badge badge-outline badge-sm">
                      {entry.type === 'group'
                        ? t('importCsv.preview.groupType')
                        : t('importCsv.preview.entryType')}
                    </span>
                  </div>
                  {entry.type === 'entry' && entry.fields.length > 0 && (
                    <div className="text-sm text-base-content/60">
                      {t('importCsv.preview.fieldsCount', {
                        count: entry.fields.length,
                      })}
                    </div>
                  )}
                </div>
              </div>
            ))}
            {parsedEntries.length > 10 && (
              <div className="text-center text-sm text-base-content/60">
                {t('importCsv.preview.andMore', {
                  count: parsedEntries.length - 10,
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  };

  return (
    <Modal isOpen={isOpen} onClose={handleCancel}>
      <div className="space-y-4">
        <h3 className="font-bold text-lg">{t('importCsv.title')}</h3>

        {!showPreview ? (
          <>
            <div className="alert alert-info">
              <svg
                className="w-6 h-6"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
              <div>
                <h4 className="font-bold">{t('importCsv.help.title')}</h4>
                <div className="text-sm mt-1">
                  <p>{t('importCsv.help.description')}</p>
                  <ul className="list-disc list-inside mt-2 space-y-1">
                    <li>{t('importCsv.help.specialFields')}</li>
                    <li>{t('importCsv.help.typeField')}</li>
                    <li>{t('importCsv.help.regularFields')}</li>
                  </ul>
                </div>
              </div>
            </div>

            <div className="form-control">
              <label className="label">
                <span className="label-text">{t('importCsv.csvFile')}</span>
              </label>
              <div className="join w-full">
                <input
                  type="text"
                  placeholder={t('importCsv.csvFilePlaceholder')}
                  className="input input-bordered join-item flex-1"
                  value={csvFile?.name || ''}
                  readOnly
                />
                {csvFile ? (
                  <button
                    className="btn join-item btn-error"
                    onClick={() => {
                      setCsvFile(null);
                      setParsedEntries([]);
                      setError('');
                    }}
                    type="button"
                  >
                    {t('importCsv.clear')}
                  </button>
                ) : null}
                <button
                  className="btn join-item"
                  onClick={handleFileSelect}
                  type="button"
                >
                  {t('importCsv.browse')}
                </button>
              </div>
            </div>
          </>
        ) : (
          <>
            <div className="flex items-center justify-between">
              <h4 className="font-semibold">{t('importCsv.preview.title')}</h4>
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => setShowPreview(false)}
              >
                {t('importCsv.preview.selectDifferentFile')}
              </button>
            </div>
            {renderPreview()}
          </>
        )}

        {error && (
          <div className="alert alert-error">
            <span>{error}</span>
          </div>
        )}

        <div className="modal-action">
          {showPreview ? (
            <button
              className="btn btn-primary"
              onClick={handleImport}
              disabled={loading || parsedEntries.length === 0}
            >
              {loading ? (
                <>
                  <span className="loading loading-spinner loading-sm"></span>
                  {t('importCsv.importing')}
                </>
              ) : (
                t('importCsv.import')
              )}
            </button>
          ) : (
            <button
              className="btn btn-primary"
              onClick={() => csvFile && setShowPreview(true)}
              disabled={!csvFile}
            >
              {t('importCsv.preview.button')}
            </button>
          )}
          <button className="btn" onClick={handleCancel} disabled={loading}>
            {t('importCsv.cancel')}
          </button>
        </div>
      </div>
    </Modal>
  );
};
