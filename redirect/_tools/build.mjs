/**
 * Static site builder for the Monark web presence.
 *
 * Run: node _tools/build.mjs   (redirect/build.sh also rasterises og.png)
 *
 * Output, all written into redirect/:
 *
 *   index.html              Google OAuth redirect URI, and the landing hop
 *   <locale>/index.html     marketing page, one per locale
 *   <locale>/privacy.html   privacy policy
 *   <locale>/terms.html     terms of service
 *   404.html                multilingual not-found page
 *   home.html               legacy alias for the old landing URL
 *   site.js, oauth.js       progressive enhancement
 *   sitemap.xml, robots.txt
 *
 * The root `index.html` is the registered Google OAuth redirect URI, so it can
 * never become the marketing page: Google sends ?code=&state= to the site root.
 * Marketing pages therefore live under a locale prefix — /en/, /es/, /pt/, …
 * Spanish keeps the old landing destination, since the previous build served
 * Spanish at the root.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { icon } from "./icons.mjs";
import { AUTONYMS, CHROME, DEFAULT_LOCALE, LOCALES } from "./config.mjs";
import { MOCK } from "./mock.mjs";
import { RELEASES, REPO } from "./links.mjs";
import {
	assetPrefix,
	defaultPath,
	footer,
	head,
	header,
	pagePath,
	pageUrl,
	prefixOf,
	publishedLocales,
	SITE_URL,
	siteScript,
	usePublishedLocales,
} from "./partials.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(HERE, "..");

/**
 * Load the string sets that exist. A locale without a `locales/<code>.mjs` file
 * is reported and simply not published, so a half-finished translation can
 * never take the site down.
 */
const COPY = {};
const MISSING = [];

for (const { code } of LOCALES) {
	const file = path.join(HERE, "locales", `${code}.mjs`);
	if (!fs.existsSync(file)) {
		MISSING.push(code);
		continue;
	}
	COPY[code] = (await import(`./locales/${code}.mjs`)).default;
}

if (MISSING.length > 0) {
	console.warn(`! no copy for: ${MISSING.join(", ")} — those locales were skipped`);
}
if (Object.keys(COPY).length === 0) {
	throw new Error("no locale copy found; nothing to build");
}

/* ------------------------------------------------------------------ utils --- */

const esc = (s) =>
	String(s)
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;");

/** Compact JSON that is safe to embed inside a <script> block. */
const json = (value) => JSON.stringify(value).replace(/</g, "\\u003c");

const reveal = (delay) => ` data-reveal${delay ? ` style="--delay:${delay}ms"` : ""}`;

const written = [];

function write(rel, html) {
	const target = path.join(OUT, rel);
	fs.mkdirSync(path.dirname(target), { recursive: true });
	fs.writeFileSync(target, html);
	written.push(rel);
	return rel;
}

/** Everything derived from a locale code, resolved once. */
function ctx(code, { atRoot = false } = {}) {
	const loc = LOCALES.find((l) => l.code === code) ?? LOCALES[0];
	const depth = atRoot ? 0 : 1;
	return {
		loc,
		copy: COPY[code],
		prefix: prefixOf(code),
		depth,
		root: assetPrefix(depth),
		mock: MOCK[code],
	};
}/* -------------------------------------------------------------- fragments --- */

function vaultMock(mock, delay = 140) {
	const folders = mock.folders
		.map(
			(f, i) =>
				`<a href="#"${i === 1 ? ' aria-current="true"' : ""} tabindex="-1">${icon.folder}<span>${esc(f)}</span></a>`,
		)
		.join("\n\t\t\t\t\t\t\t");

	const entries = mock.entries
		.map(
			([initial, name, sub, tag]) => `<div class="entry">
								<span class="entry-avatar" aria-hidden="true">${esc(initial)}</span>
								<div>
									<strong>${esc(name)}</strong>
									<small>${esc(sub)}</small>
								</div>
								${tag ? `<span class="entry-tag">${esc(tag)}</span>` : '<span class="entry-pw" aria-hidden="true">••••••••••</span>'}
							</div>`,
		)
		.join("\n\t\t\t\t\t\t\t");

	return `<div class="vault-mock" role="img" aria-label="${esc(mock.alt)}"${reveal(delay)}>
						<div class="vault-bar" aria-hidden="true">
							<i></i><i></i><i></i>
							<span>${esc(mock.window)}</span>
						</div>
						<div class="vault-body">
							<div class="vault-side" aria-hidden="true">
								<p>${esc(mock.sideLabel)}</p>
							${folders}
							</div>
							<div class="vault-main">
								<header>
									<h3>${esc(mock.title)}</h3>
									<em>${esc(mock.count)}</em>
								</header>
							${entries}
								<p class="vault-foot">${icon.shieldCheck}<span>${esc(mock.foot)}</span></p>
							</div>
						</div>
					</div>`;
}

function hero(l, mock) {
	const meta = l.hero.meta
		.map(([dt, dd]) => `<div><dt>${esc(dt)}</dt><dd>${esc(dd)}</dd></div>`)
		.join("\n\t\t\t\t\t\t");

	return `<section class="hero">
				<div class="shell hero-grid">
					<div class="hero-copy">
						<span class="eyebrow"${reveal()}>${esc(l.hero.eyebrow)}</span>
						<h1${reveal(60)}>${l.hero.title}</h1>
						<p class="hero-lede"${reveal(120)}>${esc(l.hero.lede)}</p>
						<div class="hero-actions"${reveal(180)}>
							<a class="btn btn--primary" href="${RELEASES}" target="_blank" rel="noopener noreferrer"><span>${esc(l.hero.ctaPrimary)}</span>${icon.arrowRight}</a>
							<a class="btn btn--ghost" href="${REPO}" target="_blank" rel="noopener noreferrer">${icon.github}<span>${esc(l.hero.ctaSecondary)}</span></a>
						</div>
						<dl class="hero-meta"${reveal(240)}>
						${meta}
						</dl>
					</div>
				${vaultMock(mock)}
				</div>
			</section>`;
}

function cells(l) {
	return l.features.cells
		.map((c, i) => {
			const cls = ["cell", c.dark ? "cell--dark" : "", c.wide ? "cell--wide" : "", `cell--${c.span}`]
				.filter(Boolean)
				.join(" ");

			const terminal = c.terminal
				? `<div class="terminal" aria-hidden="true">
						${c.terminal.map(([k, v]) => `<div>${k} ${v}</div>`).join("\n\t\t\t\t\t\t")}
						</div>`
				: "";

			return `<article class="${cls}"${reveal(i * 60)}>
						<div class="cell-copy">
							<span class="cell-icon" aria-hidden="true">${icon[c.icon] ?? icon.shield}</span>
							<h3>${esc(c.title)}</h3>
							<p>${esc(c.body)}</p>
						</div>
					${terminal}
					</article>`;
		})
		.join("\n\t\t\t\t\t");
}

function features(l) {
	return `<section id="features" class="section-rule">
				<div class="shell">
					<div class="section-head">
						<div>
							<span class="eyebrow"${reveal()}>${esc(l.features.eyebrow)}</span>
							<h2${reveal(60)}>${esc(l.features.title)}</h2>
						</div>
						<p class="section-lede"${reveal(120)}>${esc(l.features.lede)}</p>
					</div>
					<div class="bento">
					${cells(l)}
					</div>
				</div>
			</section>`;
}

function specs(l) {
	const items = l.specs.items
		.map(([dt, dd]) => `<div class="spec"><dt>${esc(dt)}</dt><dd>${dd}</dd></div>`)
		.join("\n\t\t\t\t\t\t");

	return `<section class="section-rule">
				<div class="shell">
					<div class="section-head">
						<div>
							<span class="eyebrow"${reveal()}>${esc(l.specs.eyebrow)}</span>
							<h2${reveal(60)}>${esc(l.specs.title)}</h2>
						</div>
						<p class="section-lede"${reveal(120)}>${esc(l.specs.lede)}</p>
					</div>
					<dl class="specs">
					${items}
					</dl>
				</div>
			</section>`;
}

function cta(l) {
	return `<section class="cta">
				<div class="shell cta-inner">
					<div${reveal()}>
						<h2>${esc(l.cta.title)}</h2>
						<p>${esc(l.cta.body)}</p>
					</div>
					<div class="cta-actions"${reveal(80)}>
						<a class="btn btn--primary" href="${RELEASES}" target="_blank" rel="noopener noreferrer"><span>${esc(l.cta.primary)}</span>${icon.arrowRight}</a>
						<a class="btn btn--ghost" href="${REPO}" target="_blank" rel="noopener noreferrer">${icon.github}<span>${esc(l.cta.secondary)}</span></a>
					</div>
				</div>
			</section>`;
}/* ----------------------------------------------------------------- shell ---- */

function documentShell({ lang, headHtml, body, script = "" }) {
	return `<!doctype html>
<html lang="${lang}">
<head>
${headHtml}
</head>
<body>
${body}${script}
</body>
</html>
`;
}

/* --------------------------------------------------------------- marketing --- */

function renderMarketing(code) {
	const { copy: l, prefix, depth, mock } = ctx(code);

	return documentShell({
		lang: l.htmlLang,
		headHtml: head(l, { page: "index", depth }),
		body: `	<a class="skip-link" href="#main">${esc(l.skip)}</a>
${header(l, { page: "index", depth })}
	<main id="main">
		${hero(l, mock)}
		${features(l)}
		${specs(l)}
		${cta(l)}
	</main>
${footer(l, { depth })}
${siteScript(depth)}
`,
	});
}

/* ------------------------------------------------------------------ legal --- */

function renderLegal(code, kind) {
	const { copy: l, prefix, depth } = ctx(code);
	const doc = l[kind];
	const other = kind === "privacy" ? "terms" : "privacy";

	const toc = doc.sections
		.map((s) => `<li><a href="#${s.id}">${esc(s.title)}</a></li>`)
		.join("\n\t\t\t\t\t\t");

	const sections = doc.sections
		.map(
			(s) => `<article id="${s.id}">
						<h2>${esc(s.title)}</h2>
						${s.html}
					</article>`,
		)
		.join("\n\t\t\t\t\t");

	return documentShell({
		lang: l.htmlLang,
		headHtml: head(l, { page: kind, depth, title: `${doc.title} — Monark`, desc: doc.desc }),
		body: `	<a class="skip-link" href="#main">${esc(l.skip)}</a>
${header(l, { page: kind, depth })}
	<main id="main">
		<div class="shell">
			<div class="doc-head">
				<p class="mono">${esc(doc.title)}</p>
				<h1>${esc(doc.title)}</h1>
				<p class="doc-meta">
					<span>${esc(doc.updated)}</span>
					<span>${esc(doc.version)}</span>
					<span>Xilistudios</span>
				</p>
			</div>
			<div class="doc-layout">
				<nav class="toc" aria-label="${esc(doc.title)}">
					<ol>
					${toc}
					</ol>
				</nav>
				<div class="legal">
				${sections}
				</div>
			</div>
			<nav class="doc-nav">
				<a class="btn btn--ghost btn--sm" href="${pagePath(prefix)}">${icon.arrowLeft}<span>${esc(l.oauth.home)}</span></a>
				<a class="btn btn--ghost btn--sm" href="${pagePath(prefix, other)}"><span>${esc(l[other].title)}</span>${icon.arrowRight}</a>
			</nav>
		</div>
	</main>
${footer(l, { depth })}
${siteScript(depth)}
`,
	});
}/* ------------------------------------------------------------- oauth page --- */

/**
 * Strings and links the shared `oauth.js` needs, as embeddable JSON.
 * `hop` adds the landing-redirect behaviour used at the site root.
 */
function oauthConfig(code, { hop = null } = {}) {
	const { copy: l, root, prefix } = ctx(code, { atRoot: true });
	const o = l.oauth;

	return {
		strings: {
			successTitle: o.successTitle,
			successBody: o.successBody,
			copyHeading: o.copyHeading,
			copyBody: o.copyBody,
			copyButton: o.copyButton,
			copied: o.copied,
			copyFailed: o.copyFailed,
			encodeFailed: o.encodeFailed,
			instructions: o.instructions,
			steps: o.steps,
			closable: o.closable,
			statusOk: o.statusOk,
			statusPending: o.statusPending,
			working: o.working,
			workingBody: o.workingBody,
			errorTitle: o.errorTitle,
			errorBody: o.errorBody,
			invalidTitle: o.invalidTitle,
			invalidBody: o.invalidBody,
			unknownError: o.unknownError,
			closeWindow: o.closeWindow,
			home: o.home,
		},
		logo: `${root}logo.svg`,
		homeHref: pagePath(prefix),
		links: [
			[pagePath(prefix), o.home],
			[pagePath(prefix, "privacy"), l.nav.privacy],
			[pagePath(prefix, "terms"), l.nav.terms],
		],
		hop,
	};
}

function oauthCard(code, { root, id = "oauth" }) {
	const { copy: l, prefix } = ctx(code);
	const o = l.oauth;

	return `<div class="oauth-wrap" id="${id}">
			<div class="oauth-card" id="${id}-card">
				<img class="oauth-mark" src="${root}logo.svg" alt="Monark" width="44" height="44">
				<div class="spinner" id="${id}-spinner"></div>
				<h1 id="${id}-title">${esc(o.working)}</h1>
				<p id="${id}-body">${esc(o.workingBody)}</p>
				<p class="status" id="${id}-status" role="status" aria-live="polite">${esc(o.statusPending)}</p>
				<nav class="oauth-links">
					<a href="${pagePath(prefix)}">${esc(o.home)}</a>
					<a href="${pagePath(prefix, "privacy")}">${esc(l.nav.privacy)}</a>
					<a href="${pagePath(prefix, "terms")}">${esc(l.nav.terms)}</a>
				</nav>
			</div>
		</div>`;
}

/**
 * The registered Google OAuth redirect URI, served at the site root.
 *
 * Two modes in one document, as before:
 *   no query params      → the landing hop, which forwards to /en/
 *   ?code=&state=&error= → the deep-link handoff and credential copy UI
 */
function renderRoot() {
	const { copy: l, root, depth } = ctx(DEFAULT_LOCALE, { atRoot: true });
	const home = defaultPath();
	const alternates = publishedLocales().map(
		(x) => `		<link rel="alternate" hreflang="${x.code}" href="${pageUrl(x.prefix)}">`,
	).join("\n");

	return documentShell({
		lang: l.htmlLang,
		headHtml: `		<meta charset="utf-8">
		<meta name="viewport" content="width=device-width, initial-scale=1">
		<title>${esc(l.oauth.title)} — Monark</title>
		<meta name="description" content="${esc(l.oauth.desc)}">
		<meta name="robots" content="noindex, follow">
		<meta name="color-scheme" content="light dark">
		<meta name="theme-color" content="#fbfaf8" media="(prefers-color-scheme: light)">
		<meta name="theme-color" content="#16100e" media="(prefers-color-scheme: dark)">
		<link rel="icon" href="favicon.svg" type="image/svg+xml">
		<link rel="icon" href="favicon.png" type="image/png">
		<link rel="canonical" href="${SITE_URL}${home}">
${alternates}
		<link rel="stylesheet" href="styles.css">`,
		body: `${header(l, { page: "index", depth, compact: true })}
	<main id="main">
		<div class="oauth-wrap" id="hop" hidden>
			<div class="oauth-card">
				<img class="oauth-mark" src="logo.svg" alt="Monark" width="44" height="44">
				<h1>Monark</h1>
				<p>${esc(l.notFound.body)}</p>
				<p><a class="btn btn--primary" href="${home}"><span>${esc(l.notFound.back)}</span>${icon.arrowRight}</a></p>
				<nav class="footer-langs" aria-label="${esc(CHROME[DEFAULT_LOCALE].choose)}">
				${publishedLocales().map((x) => `	<a href="${pagePath(x.prefix)}" hreflang="${x.code}" lang="${x.code}">${AUTONYMS[x.code]}</a>`).join("\n")}
				</nav>
			</div>
		</div>
		${oauthCard(DEFAULT_LOCALE, { root })}
	</main>
	<script>window.MONARK_OAUTH = ${json(oauthConfig(DEFAULT_LOCALE, { hop: home }))};</script>
	<script src="oauth.js" defer></script>
`,
	});
}

/* -------------------------------------------------------------------- 404 --- */

function render404() {
	const { copy: l, depth } = ctx(DEFAULT_LOCALE, { atRoot: true });
	const home = defaultPath();

	return documentShell({
		lang: l.htmlLang,
		headHtml: `		<meta charset="utf-8">
		<meta name="viewport" content="width=device-width, initial-scale=1">
		<title>${esc(l.notFound.title)} — Monark</title>
		<meta name="description" content="${esc(l.notFound.desc)}">
		<meta name="robots" content="noindex">
		<meta name="color-scheme" content="light dark">
		<meta name="theme-color" content="#fbfaf8" media="(prefers-color-scheme: light)">
		<meta name="theme-color" content="#16100e" media="(prefers-color-scheme: dark)">
		<link rel="icon" href="favicon.svg" type="image/svg+xml">
		<link rel="icon" href="favicon.png" type="image/png">
		<link rel="stylesheet" href="styles.css">`,
		body: `${header(l, { page: "index", depth, compact: true })}
	<main id="main">
		<div class="shell">
			<div class="blank">
				<p class="mono">404</p>
				<h1>${esc(l.notFound.title)}</h1>
				<p>${esc(l.notFound.body)}</p>
				<a class="btn btn--primary" href="${home}"><span>${esc(l.notFound.back)}</span>${icon.arrowRight}</a>
				<nav class="footer-langs" aria-label="${esc(CHROME[DEFAULT_LOCALE].choose)}">
				${publishedLocales().map((x) => `	<a href="${pagePath(x.prefix)}" hreflang="${x.code}" lang="${x.code}">${AUTONYMS[x.code]}</a>`).join("\n")}
				</nav>
			</div>
		</div>
	</main>
`,
	});
}/* ------------------------------------------------------- legacy deep link --- */

/** `home.html` is kept as a redirect so any old bookmark still resolves. */
function renderLegacyHome() {
	const { copy: l } = ctx(DEFAULT_LOCALE, { atRoot: true });
	const target = defaultPath();

	return documentShell({
		lang: l.htmlLang,
		headHtml: `		<meta charset="utf-8">
		<meta name="viewport" content="width=device-width, initial-scale=1">
		<title>Monark</title>
		<link rel="canonical" href="${SITE_URL}${target}">
		<meta http-equiv="refresh" content="0; url=${target}">
		<meta name="robots" content="noindex">
		<link rel="stylesheet" href="styles.css">`,
		body: `	<main id="main">
		<div class="shell">
			<div class="blank">
				<p class="mono">Monark</p>
				<h1>${esc(l.notFound.back)}</h1>
				<a class="btn btn--primary" href="${target}"><span>${esc(l.notFound.back)}</span>${icon.arrowRight}</a>
			</div>
		</div>
	</main>
`,
	});
}

/* --------------------------------------------------------------- discovery --- */

function renderSitemap() {
	const pages = ["index", "privacy", "terms"];
	const urls = pages
		.map((page) => {
			const alternates = [
				...publishedLocales().map(
					(l) =>
						`\t\t<xhtml:link rel="alternate" hreflang="${l.code}" href="${pageUrl(l.prefix, page)}"/>`,
				),
				`\t\t<xhtml:link rel="alternate" hreflang="x-default" href="${pageUrl(DEFAULT_LOCALE, page)}"/>`,
			].join("\n");
			const priority = page === "index" ? "1.0" : "0.5";
			return `\t<url>
\t\t<loc>${pageUrl(DEFAULT_LOCALE, page)}</loc>
${alternates}
\t\t<changefreq>${page === "index" ? "monthly" : "yearly"}</changefreq>
\t\t<priority>${priority}</priority>
\t</url>`;
		})
		.join("\n");

	return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
	xmlns:xhtml="http://www.w3.org/1999/xhtml">
${urls}
</urlset>
`;
}

function renderRobots() {
	return `User-agent: *
Allow: /
Disallow: /index.html

Sitemap: ${SITE_URL}/sitemap.xml
`;
}

/* ------------------------------------------------------------------- emit --- */

/* Lock discovery output (hreflang, sitemap, language menus) to the locales that
   are actually about to be written. Without this, a locale present in the
   registry but not yet translated — `ja` today — gets advertised sitewide and
   every one of its links 404s. */
usePublishedLocales(Object.keys(COPY));

for (const { code } of LOCALES) {
	if (!COPY[code]) continue;
	const dir = `${prefixOf(code)}/`;
	write(`${dir}index.html`, renderMarketing(code));
	write(`${dir}privacy.html`, renderLegal(code, "privacy"));
	write(`${dir}terms.html`, renderLegal(code, "terms"));
}

write("index.html", renderRoot());
write("404.html", render404());
write("home.html", renderLegacyHome());
write("sitemap.xml", renderSitemap());
write("robots.txt", renderRobots());

/* Copy the hand-written runtime assets into place. */
for (const asset of ["site.js", "oauth.js"]) {
	const from = path.join(HERE, asset);
	if (fs.existsSync(from)) {
		fs.copyFileSync(from, path.join(OUT, asset));
		written.push(asset);
	}
}

const published = LOCALES.filter((l) => COPY[l.code]).map((l) => l.code);
console.log(`Built ${written.length} files across ${published.length} locales (${published.join(", ")}):`);
for (const f of written) console.log(`  ${f}`);