/**
 * Locale registry and shared chrome strings.
 *
 * Every locale is published under its own sub-path. There is deliberately no
 * "default locale at the site root": the root URL is the registered Google
 * OAuth redirect URI and must stay free to handle `?code=&state=`. `/en/` takes
 * the role a root locale would normally play, and is the `x-default` target.
 *
 * Chrome strings (landmark labels, the language button) live here rather than in
 * the locale copy sets: they are interface labels, not page copy.
 */

/** Locale that represents the site when no language is known. */
export const DEFAULT_LOCALE = "en";

export const LOCALES = [
	{ code: "en", label: "English", prefix: "en" },
	{ code: "es", label: "Español", prefix: "es" },
	{ code: "pt", label: "Português", prefix: "pt" },
	{ code: "fr", label: "Français", prefix: "fr" },
	{ code: "de", label: "Deutsch", prefix: "de" },
	{ code: "zh", label: "简体中文", prefix: "zh" },
	{ code: "ja", label: "日本語", prefix: "ja" },
];

/** Language names written in the language itself. */
export const AUTONYMS = Object.fromEntries(LOCALES.map((l) => [l.code, l.label]));

/** Short tag used by the language button and the sitemap hreflang list. */
export const SHORT = { en: "EN", es: "ES", pt: "PT", fr: "FR", de: "DE", zh: "中文", ja: "日本語" };

export const CHROME = {
	en: { navLabel: "Primary", choose: "Choose a language" },
	es: { navLabel: "Principal", choose: "Elegir idioma" },
	pt: { navLabel: "Principal", choose: "Escolher idioma" },
	fr: { navLabel: "Navigation principale", choose: "Choisir une langue" },
	de: { navLabel: "Hauptnavigation", choose: "Sprache wählen" },
	zh: { navLabel: "主导航", choose: "选择语言" },
	ja: { navLabel: "メインビゲーション", choose: "言語を選択" },
};

/** Best matching locale for an Accept-Language / navigator.language tag. */
export function matchLocale(tag = "") {
	const lower = String(tag).toLowerCase();
	if (lower.startsWith("zh")) return "zh";
	const base = lower.slice(0, 2);
	return LOCALES.some((l) => l.code === base) ? base : DEFAULT_LOCALE;
}