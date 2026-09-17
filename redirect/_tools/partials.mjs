/**
 * Shared page fragments: <head>, header, footer, language switcher.
 *
 * Every link is built against the *current* locale's sub-path, so a visitor is
 * never silently dropped back into English by navigating.
 */

import { icon } from "./icons.mjs";
import { AUTONYMS, CHROME, DEFAULT_LOCALE, LOCALES, SHORT } from "./config.mjs";

/**
 * Locales that actually shipped, i.e. have a copy set and a generated folder.
 *
 * `LOCALES` in config.mjs is the registry of languages the site knows how to
 * speak; this is the subset the build managed to emit. Everything that *points
 * at* a locale — hreflang alternates, the sitemap, the language menu and strip —
 * must iterate this list instead. Using the registry there would advertise
 * `/ja/` the moment a Japanese copy set is still being written, and every one of
 * those links would 404.
 *
 * build.mjs calls `usePublishedLocales()` once, before rendering anything.
 */
let published = [];

/** Restrict discovery output to the locales the build is about to emit. */
export function usePublishedLocales(codes) {
	published = LOCALES.filter((l) => codes.includes(l.code));
}

/** The published locales, in registry order. */
export const publishedLocales = () => published;

/** Public origin. Drives canonical URLs and Open Graph metadata. */
export const SITE_URL = "https://monark-password-manager.web.app";

const localeOf = (code) => LOCALES.find((l) => l.code === code) ?? LOCALES[0];

/** Sub-path for a locale, without a trailing slash. */
export function prefixOf(code) {
	return localeOf(code).prefix;
}

/** Root-relative asset prefix: "" for the root, "../" one level down. */
export const assetPrefix = (depth) => (depth ? "../" : "");

/** Site-relative path to a page inside a locale. */
export function pagePath(prefix, page = "index") {
	const base = prefix ? `/${prefix}` : "";
	return page === "index" ? `${base}/` : `${base}/${page}`;
}

/** The canonical English path, used as the hreflang `x-default` target. */
export const defaultPath = (page = "index") => pagePath(DEFAULT_LOCALE, page);

/** Absolute URL of a page inside a locale. */
export function pageUrl(prefix, page = "index") {
	return SITE_URL + pagePath(prefix, page);
}

/** Interface strings for the shared chrome, resolved from the locale code. */
export function chrome(code) {
	return CHROME[code];
}

/**
 * Language dropdown. Lists every locale including the current one, which is
 * marked with `aria-current` so the control doubles as a "you are here".
 */
export function languageMenu(code) {
	const ui = chrome(code);

	const items = publishedLocales().map((l) => {
		const isCurrent = l.code === code;
		const current = isCurrent ? ' aria-current="true"' : "";
		// The active row swaps its locale code for the CSS-rendered marker dot.
		const tail = isCurrent ? "" : `<span class="lang-native" aria-hidden="true">${SHORT[l.code]}</span>`;
		return `<li><a href="${pagePath(l.prefix)}" hreflang="${l.code}" lang="${l.code}"${current}><span class="lang-name">${l.label}</span>${tail}</a></li>`;
	}).join("\n\t\t\t\t\t\t\t");

	return `<div class="lang" data-lang>
						<button type="button" class="lang-btn" data-lang-toggle aria-expanded="false" aria-haspopup="menu" aria-label="${ui.choose}: ${AUTONYMS[code]}">
							${icon.globe}<span aria-hidden="true">${SHORT[code]}</span>${icon.chevron}
						</button>
						<ul class="lang-menu" data-lang-menu aria-label="${ui.choose}">
							${items}
						</ul>
					</div>`;
}

/** Inline language strip. Used in the footer, where a dropdown would be noise. */
export function languageStrip(code) {
	return publishedLocales().map(
		(l) =>
			`<a href="${pagePath(l.prefix)}" hreflang="${l.code}" lang="${l.code}"${l.code === code ? ' aria-current="true"' : ""}>${l.label}</a>`,
	).join("\n\t\t\t\t\t");
}

export function header(current, { page = "index", depth = 0, compact = false } = {}) {
	const prefix = prefixOf(current.code);
	const root = assetPrefix(depth);
	const home = pagePath(prefix);
	const ui = chrome(current.code);

	const navLink = (href, label, key, current2 = false) =>
		`<a href="${href}"${current2 ? ' aria-current="page"' : ""}>${label}</a>`;

	return `<header class="site-header">
			<div class="shell header-inner">
				<a class="brand" href="${home}">
					<img class="brand-mark" src="${root}logo.svg" alt="" width="28" height="28" aria-hidden="true">
					<span class="brand-name">Monark</span>
				</a>
				<nav class="nav" aria-label="${ui.navLabel}">
					${navLink(`${home}#features`, current.nav.features, "index")}
					${compact ? "" : navLink(pagePath(prefix, "privacy"), current.nav.privacy, "privacy", page === "privacy")}
					${compact ? "" : navLink(pagePath(prefix, "terms"), current.nav.terms, "terms", page === "terms")}
				</nav>
				<div class="header-actions">
					${languageMenu(current.code)}
					<a class="btn btn--ghost btn--sm" href="${SITE_RELEASES}" target="_blank" rel="noopener noreferrer">${icon.github}<span>${current.download}</span></a>
				</div>
			</div>
		</header>`;
}

export function footer(current, { depth = 0 } = {}) {
	const prefix = prefixOf(current.code);
	const root = assetPrefix(depth);
	const home = pagePath(prefix);

	const cols = current.footer.cols
		.map(([heading, items]) => {
			const lis = items
				.map(([label, href]) => {
					if (href === "index") return `<li><a href="${home}">${label}</a></li>`;
					if (href === "privacy" || href === "terms")
						return `<li><a href="${pagePath(prefix, href)}">${label}</a></li>`;
					return `<li><a href="${href}" target="_blank" rel="noopener noreferrer">${label}</a></li>`;
				})
				.join("\n\t\t\t\t\t\t");
			return `<div class="footer-col">
						<h4>${heading}</h4>
						<ul>
							${lis}
						</ul>
					</div>`;
		})
		.join("\n\t\t\t\t");

	return `<footer class="site-footer">
			<div class="shell">
				<div class="footer-grid">
					<div class="footer-brand">
						<a class="brand" href="${home}">
							<img class="brand-mark" src="${root}logo.svg" alt="" width="28" height="28" aria-hidden="true">
							<span class="brand-name">Monark</span>
						</a>
						<p>${current.footer.brand}</p>
					</div>
				${cols}
				</div>
				<div class="footer-base">
					<p>${current.footer.baseLeft}</p>
					<nav class="footer-langs" aria-label="${chrome(current.code).choose}">
					${languageStrip(current.code)}
					</nav>
				</div>
			</div>
		</footer>`;
}

/** Shared <head> contents, including the full hreflang alternate set. */
export function head(current, { page = "index", depth = 0, title, desc = current.desc }) {
	const prefix = prefixOf(current.code);
	const root = assetPrefix(depth);
	const canonical = pageUrl(prefix, page);

	const alternates = [
		...publishedLocales().map(
			(l) => `\t<link rel="alternate" hreflang="${l.code}" href="${pageUrl(l.prefix, page)}">`,
		),
		`\t<link rel="alternate" hreflang="x-default" href="${pageUrl(DEFAULT_LOCALE, page)}">`,
	].join("\n");

	return `		<meta charset="utf-8">
		<meta name="viewport" content="width=device-width, initial-scale=1">
		<title>${title ?? current.title}</title>
		<meta name="description" content="${desc}">
		<meta name="color-scheme" content="light dark">
		<meta name="theme-color" content="#fbfaf8" media="(prefers-color-scheme: light)">
		<meta name="theme-color" content="#16100e" media="(prefers-color-scheme: dark)">
		<link rel="canonical" href="${canonical}">
${alternates}
		<meta property="og:type" content="website">
		<meta property="og:site_name" content="Monark">
		<meta property="og:locale" content="${current.ogLocale}">
		<meta property="og:title" content="${title ?? current.title}">
		<meta property="og:description" content="${desc}">
		<meta property="og:url" content="${canonical}">
		<meta property="og:image" content="${SITE_URL}/og.png">
		<meta name="twitter:card" content="summary_large_image">
		<link rel="icon" href="${root}favicon.svg" type="image/svg+xml">
		<link rel="icon" href="${root}favicon.png" type="image/png">
		<link rel="apple-touch-icon" href="${root}favicon.png">
		<link rel="preload" href="${root}fonts/geist-latin.woff2" as="font" type="font/woff2" crossorigin>
		<link rel="preload" href="${root}fonts/newsreader-italic-latin.woff2" as="font" type="font/woff2" crossorigin>
		<link rel="stylesheet" href="${root}styles.css">`;
}

/** Progressive-enhancement script: language dropdown and scroll reveals. */
export function siteScript(depth) {
	return `<script src="${assetPrefix(depth)}site.js" defer></script>`;
}

export const SITE_RELEASES = "https://github.com/xilistudios/monark/releases/latest";