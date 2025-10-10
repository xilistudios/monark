/**
 * OAuthFlow component for handling Google OAuth authentication
 * Displays authentication URL and handles callback processing
 * @module OAuthFlow
 */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { openUrl } from '@tauri-apps/plugin-opener';

interface OAuthFlowProps {
  providerName: string;
  authUrl: string;
  onSuccess: () => void;
  onError: (error: string) => void;
  onCancel: () => void;
}

export const OAuthFlow = ({
  providerName,
  authUrl,
  onSuccess,
  onError,
  onCancel,
}: OAuthFlowProps) => {
  const { t } = useTranslation('settings');
  const [isOpening, setIsOpening] = useState(false);
  const [hasOpened, setHasOpened] = useState(false);
  const [base64Input, setBase64Input] = useState('');
  const [base64Error, setBase64Error] = useState('');
  const [showBase64Import, setShowBase64Import] = useState(false);

  const handleOpenBrowser = async () => {
    setIsOpening(true);
    try {
      await openUrl(authUrl);
      setHasOpened(true);
    } catch (error) {
      console.error('Failed to open browser:', error);
      onError(t('cloudStorage.oauth.browserError', 'Failed to open browser'));
    } finally {
      setIsOpening(false);
    }
  };

  const handleCopyUrl = async () => {
    try {
      await navigator.clipboard.writeText(authUrl);
      // Show success feedback
    } catch (error) {
      console.error('Failed to copy URL:', error);
    }
  };

  // Import credentials from base64
  const handleImportBase64 = async () => {
    try {
      setBase64Error('');

      if (!base64Input.trim()) {
        setBase64Error(
          t(
            'cloudStorage.oauth.emptyBase64',
            'Please paste the base64 credentials'
          )
        );
        return;
      }

      // Decode base64
      const jsonString = atob(base64Input.trim());
      const credentials = JSON.parse(jsonString);

      // Validate structure
      if (!credentials.code || !credentials.state) {
        throw new Error('Invalid credentials structure');
      }

      // TODO: Complete authentication with the provided code and state
      // This would need to be passed back to the parent component
      console.log('Imported credentials:', credentials);

      setBase64Input('');
      setShowBase64Import(false);
      onSuccess();
    } catch (error) {
      console.error('Failed to decode base64 credentials:', error);
      setBase64Error(
        t(
          'cloudStorage.oauth.invalidBase64',
          'Invalid base64 credentials format'
        )
      );
    }
  };

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="text-center">
        <h3 className="text-lg font-semibold mb-2">
          {t('cloudStorage.oauth.title', 'Authenticate {{provider}}', {
            provider: providerName,
          })}
        </h3>
        <p className="text-base-content/70">
          {t(
            'cloudStorage.oauth.description',
            'Follow these steps to authenticate your cloud storage provider:'
          )}
        </p>
      </div>

      <div className="bg-base-200 rounded-lg p-4">
        <h4 className="font-medium mb-3">
          {t('cloudStorage.oauth.stepsTitle', 'Authentication Steps:')}
        </h4>
        <ol className="list-decimal list-inside space-y-2 text-sm">
          <li>
            {t(
              'cloudStorage.oauth.step1',
              'Click the button below to open the authentication page in your browser'
            )}
          </li>
          <li>
            {t(
              'cloudStorage.oauth.step2',
              'Sign in with your {{provider}} account',
              { provider: providerName }
            )}
          </li>
          <li>
            {t(
              'cloudStorage.oauth.step3',
              'Grant permission to access your files'
            )}
          </li>
          <li>
            {t(
              'cloudStorage.oauth.step4',
              'You will be redirected back to the application automatically'
            )}
          </li>
        </ol>
      </div>

      <div className="flex flex-col gap-3">
        <button
          className="btn btn-primary"
          onClick={handleOpenBrowser}
          disabled={isOpening}
        >
          {isOpening ? (
            <>
              <span className="loading loading-spinner loading-sm"></span>
              {t('cloudStorage.oauth.opening', 'Opening browser...')}
            </>
          ) : (
            <>
              🌐
              {t('cloudStorage.oauth.openBrowser', 'Open Authentication Page')}
            </>
          )}
        </button>

        <div className="flex gap-2">
          <button
            className="btn btn-outline btn-sm flex-1"
            onClick={handleCopyUrl}
          >
            📋
            {t('cloudStorage.oauth.copyUrl', 'Copy URL')}
          </button>
          <button className="btn btn-ghost btn-sm flex-1" onClick={onCancel}>
            {t('cloudStorage.oauth.cancel', 'Cancel')}
          </button>
        </div>
      </div>

      {hasOpened && (
        <div className="alert alert-info">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
            className="stroke-current shrink-0 w-6 h-6"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="2"
              d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
            ></path>
          </svg>
          <div>
            <h3 className="font-bold">
              {t('cloudStorage.oauth.browserOpened', 'Browser opened')}
            </h3>
            <div className="text-xs">
              {t(
                'cloudStorage.oauth.waitForRedirect',
                'Complete the authentication in your browser. You will be redirected back automatically.'
              )}
            </div>
          </div>
        </div>
      )}

      {/* Base64 Import Section */}
      <div className="divider">
        {t('cloudStorage.oauth.orUseCredentials', 'Or use credentials')}
      </div>

      {!showBase64Import ? (
        <button
          className="btn btn-outline btn-sm w-full"
          onClick={() => setShowBase64Import(true)}
        >
          📋{' '}
          {t('cloudStorage.oauth.pasteCredentials', 'Paste Base64 Credentials')}
        </button>
      ) : (
        <div className="form-control">
          <label className="label">
            <span className="label-text text-sm">
              {t('cloudStorage.oauth.base64Credentials', 'Base64 Credentials')}
            </span>
          </label>
          <textarea
            className={`textarea textarea-bordered font-mono text-xs ${
              base64Error ? 'textarea-error' : ''
            }`}
            value={base64Input}
            onChange={(e) => setBase64Input(e.target.value)}
            placeholder={t(
              'cloudStorage.oauth.base64Placeholder',
              'Paste base64 encoded credentials here...'
            )}
            rows={4}
          />
          {base64Error && (
            <label className="label">
              <span className="label-text-alt text-error">{base64Error}</span>
            </label>
          )}
          <div className="flex gap-2 mt-2">
            <button
              className="btn btn-primary btn-sm flex-1"
              onClick={handleImportBase64}
              disabled={!base64Input.trim()}
            >
              {t(
                'cloudStorage.oauth.importCredentials',
                'Import & Authenticate'
              )}
            </button>
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => {
                setShowBase64Import(false);
                setBase64Input('');
                setBase64Error('');
              }}
            >
              {t('cloudStorage.oauth.cancel', 'Cancel')}
            </button>
          </div>
          <label className="label">
            <span className="label-text-alt text-xs">
              {t(
                'cloudStorage.oauth.base64Help',
                'Paste the credentials you copied from the authentication page'
              )}
            </span>
          </label>
        </div>
      )}

      <div className="collapse collapse-arrow bg-base-200">
        <input type="checkbox" />
        <div className="collapse-title text-sm font-medium">
          {t('cloudStorage.oauth.troubleshooting', 'Troubleshooting')}
        </div>
        <div className="collapse-content">
          <div className="text-sm space-y-2">
            <p>
              {t(
                'cloudStorage.oauth.troubleshooting1',
                "If the browser doesn't open automatically, copy the URL and paste it manually."
              )}
            </p>
            <p>
              {t(
                'cloudStorage.oauth.troubleshooting2',
                'Make sure pop-ups are allowed for this application.'
              )}
            </p>
            <p>
              {t(
                'cloudStorage.oauth.troubleshooting3',
                'If authentication fails, try again or contact support.'
              )}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};