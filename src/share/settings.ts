// Language and settings constants for Settings components

/** Supported languages for the application */
export const LANGUAGES = [
	{ code: 'en', label: 'English' },
	{ code: 'es', label: 'Español' },
	{ code: 'fr', label: 'Français' },
	{ code: 'de', label: 'Deutsch' },
	{ code: 'zh', label: '中文' },
	{ code: 'ja', label: '日本語' },
]

/** Default settings for preferences */
export const DEFAULT_SETTINGS = {
	language: 'en',
	theme: 'light',
}

/** Valid language codes */
export const VALID_LANGUAGES = LANGUAGES.map(l => l.code)