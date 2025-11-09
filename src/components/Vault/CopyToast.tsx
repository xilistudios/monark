// CopyToast.tsx
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

interface CopyToastProps {
  fieldName?: string;
  isVisible: boolean;
  onHide: () => void;
  isError?: boolean;
}

export function CopyToast({ fieldName, isVisible, onHide, isError = false }: CopyToastProps) {
  const { t } = useTranslation('home');
  const [showToast, setShowToast] = useState(false);

  useEffect(() => {
    if (isVisible) {
      setShowToast(true);
      const timer = setTimeout(() => {
        setShowToast(false);
        setTimeout(onHide, 300); // Wait for animation to complete
      }, 2000);
      return () => clearTimeout(timer);
    } else {
      setShowToast(false);
    }
  }, [isVisible, onHide]);

  if (!showToast && !isVisible) {
    return null;
  }

  const getMessage = () => {
    if (isError) {
      return fieldName
        ? `${t('vault.manager.copyFailed')}: ${fieldName}`
        : t('vault.manager.copyFailed');
    }
    
    return fieldName
      ? `${fieldName} ${t('vault.manager.copied')}`
      : t('vault.manager.copied');
  };

  return (
    <div className="toast toast-end toast-bottom">
      <div className={`alert ${isError ? 'alert-error' : 'alert-success'} transition-opacity duration-300 ${
        isVisible ? 'opacity-100' : 'opacity-0'
      }`}>
        <svg
          className="w-4 h-4 shrink-0 stroke-current"
          fill="none"
          viewBox="0 0 24 24"
        >
          {isError ? (
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="2"
              d="M6 18L18 6M6 6l12 12"
            />
          ) : (
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="2"
              d="M5 13l4 4L19 7"
            />
          )}
        </svg>
        <span className="text-sm font-medium">{getMessage()}</span>
      </div>
    </div>
  );
}