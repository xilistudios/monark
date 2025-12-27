import { useState } from 'react';
import { useTranslation } from 'react-i18next';

interface PasswordFieldInputProps {
  value: string;
  onChange: (value: string) => void;
  readOnly?: boolean;
}

export function PasswordFieldInput({
  value,
  onChange,
  readOnly = false,
}: PasswordFieldInputProps) {
  const { t } = useTranslation('home');
  const [showPassword, setShowPassword] = useState(false);

  return (
    <div className="flex gap-2">
      <input
        type={showPassword ? 'text' : 'password'}
        className={`input flex-1 w-full px-3 py-2 text-sm border border-base-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary font-mono ${readOnly ? 'bg-base-100' : ''}`}
        placeholder={t('vault.fields.valuePlaceholder')}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        maxLength={128}
        readOnly={readOnly}
      />
      <button
        className="btn px-3 py-2 text-base-content border border-base-300 rounded-md hover:bg-base-200 focus:outline-none focus:ring-2 focus:ring-primary"
        onClick={() => setShowPassword(!showPassword)}
        type="button"
        title={
          showPassword
            ? t('vault.fields.hidePassword')
            : t('vault.fields.showPassword')
        }
      >
        {showPassword ? (
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
    </div>
  );
}
