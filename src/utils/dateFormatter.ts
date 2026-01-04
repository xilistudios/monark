import type { TFunction } from 'i18next';

/**
 * Format a date string to show how long ago it was (e.g., "5 minutes ago", "2 hours ago", "3 days ago")
 * @param dateStr - ISO date string to format
 * @param t - i18next translation function
 * @returns Formatted relative time string
 */
export const formatLastSync = (dateStr: string | undefined, t: TFunction): string => {
    if (!dateStr) return t('vaultSelector.never');
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffMins < 1) return t('vaultSelector.never');
    if (diffMins < 60)
        return `${diffMins} ${t('vaultSelector.minutesAgo', 'minutes ago')}`;
    if (diffHours < 24)
        return `${diffHours} ${t('vaultSelector.hoursAgo', 'hours ago')}`;
    return `${diffDays} ${t('vaultSelector.daysAgo', 'days ago')}`;
};
