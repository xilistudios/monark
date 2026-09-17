#!/usr/bin/env node
/**
 * Locale integrity checks. Run before publishing:
 *   node _tools/check.mjs
 *
 * Six things are verified, all of which have bitten this site before:
 *   1. structural parity with en.mjs (keys, nesting, array lengths)
 *   2. no leaked English outside the allow-list of protected tokens
 *   3. localization of htmlLang / ogLocale / title / description lengths
 *   4. no emoji, and no forbidden marketing vocabulary
 *   5. link integrity across the emitted site — every internal href, hreflang
 *      alternate and sitemap <loc> must resolve to a file that exists
 *   6. the `hidden` attribute still hides, on the one page that relies on it
 *
 * Check 5 is the one that would have caught the `/ja/` regression: the locale
 * registry advertised a language whose copy set had not landed yet, so the
 * sitemap and every hreflang block pointed at a 404. Run this *after* a build.
 *
 * Check 6 is the one that would have caught the root-page regression: the OAuth
 * card is revealed by clearing the `hidden` attribute, but an author `display`
 * declaration beats the user-agent's `[hidden] { display: none }`, so the hop
 * card and the OAuth card both rendered — with the hop card's "Page not found"
 * copy sitting on top of a successful authentication.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { LOCALES } from "./config.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(HERE, "..");

/** Matches absolute URLs pointing at our own origin. */
const SITE_URL_PREFIX = /^https:\/\/monark-password-manager\.web\.app/;

const BANNED = [
	"elevate", "seamless", "unleash", "next-gen", "cutting-edge", "game-changer",
	"military-grade", "bank-level", "delve", "empower", "revolutionary",
	"state-of-the-art", "best-in-class", "world-class",
];

/** Words that are the same in English and the target language, or brand names. */
const ALLOWED_SHARED = new Set([
	"Monark", "Xilistudios", "Rust", "React", "Tauri", "Linux", "macOS", "Windows",
	"Android", "iOS", "Google", "Drive", "Nextcloud", "WebDAV", "Argon2id",
	"XChaCha20-Poly1305", "CSPRNG", "AGPL-3.0", "LLM", "Open", "Source", "Personal",
	"Bank", "2FA", "SSH", "EN", "ES", "PT", "FR", "DE", "ZH", "JA",
]);

const failures = [];
const warnings = [];

/** Walk the English set, requiring the same shape in the target. */
function compare(a, b, code, p = "") {
	for (const key of Object.keys(b)) {
		const bp = p ? `${p}.${key}` : key;
		if (!(key in a)) {
			failures.push(`${code}: missing key ${bp}`);
			continue;
		}
		const A = a[key];
		const B = b[key];

		if (Array.isArray(B)) {
			if (!Array.isArray(A)) {
				failures.push(`${code}: ${bp} should be an array`);
				continue;
			}
			if (A.length !== B.length) {
				failures.push(`${code}: ${bp} has ${A.length} entries, expected ${B.length}`);
				continue;
			}
			B.forEach((value, i) => {
				if (Array.isArray(value)) compare(A[i], value, code, `${bp}[${i}]`);
			});
		} else if (B && typeof B === "object") {
			compare(A, B, code, bp);
		} else if (typeof A !== "string") {
			failures.push(`${code}: ${bp} should be a string`);
		}
	}
}

/** Strip the markup and technical tokens we never translate. */
function prose(value) {
	return String(value)
		.replace(/<[^>]+>/g, " ")
		.replace(/https?:\/\/\S+/g, " ")
		.replace(/[A-Za-z0-9_.-]+@[A-Za-z0-9.-]+/g, " ");
}

/** Collect every string in a copy set, with its path for reporting. */
function collect(value, out = [], p = "") {
	if (typeof value === "string") out.push([p, value]);
	else if (Array.isArray(value)) value.forEach((v, i) => collect(v, out, `${p}[${i}]`));
	else if (value && typeof value === "object")
		for (const k of Object.keys(value)) collect(value[k], out, p ? `${p}.${k}` : k);
	return out;
}

const en = (await import("./locales/en.mjs")).default;
const enStrings = new Map(collect(en));

for (const { code } of LOCALES) {
	const file = path.join(HERE, "locales", `${code}.mjs`);
	if (!fs.existsSync(file)) {
		warnings.push(`${code}: no string set yet — skipped`);
		continue;
	}
	const t = (await import(`./locales/${code}.mjs`)).default;

	compare(t, en, code);

	if (t.code !== code) failures.push(`${code}: code is "${t.code}"`);

	// A title that runs long is truncated in search results.
	if (t.title.length > 62) warnings.push(`${code}: title is ${t.title.length} chars`);
	if (t.desc.length < 110 || t.desc.length > 165)
		warnings.push(`${code}: description is ${t.desc.length} chars`);

	const strings = collect(t);

	for (const [p, value] of strings) {
		if (/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/u.test(value)) {
			failures.push(`${code}: emoji in ${p}`);
		}
	}

	// Identical-to-English detection, ignoring protected tokens and markup.
	if (code !== "en") {
		const identical = [];
		for (const [p, value] of strings) {
			const source = enStrings.get(p);
			if (source === undefined || source !== value) continue;
			if (value.length < 3) continue;
			identical.push(p);
		}
		const unexpected = identical.filter((p) => {
			const words = prose(enStrings.get(p)).trim().split(/\s+/).filter(Boolean);
			return words.length > 1 && !words.every((w) => ALLOWED_SHARED.has(w));
		});
		if (unexpected.length > 0)
			warnings.push(`${code}: ${unexpected.length} string(s) identical to English, e.g. ${unexpected.slice(0, 3).join(", ")}`);
	}

	const blob = strings.map(([, v]) => v).join(" ").toLowerCase();
	for (const word of BANNED) {
		if (blob.includes(word)) failures.push(`${code}: banned marketing term "${word}"`);
	}
}

/* ------------------------------------------------- link integrity (emitted) --- */

/**
 * Map a site path to the file a static host would serve for it.
 * The host runs with `cleanUrls`, so `/en/` is `en/index.html`, `/en/privacy`
 * is `en/privacy.html`, and a bare `/x` may also be `x/index.html`.
 */
function fileFor(sitePath) {
	const rel = sitePath.replace(/^\/+/, "").replace(/\/+$/, "");
	if (rel === "") return "index.html";
	const candidates = [`${rel}.html`, path.join(rel, "index.html"), rel];
	return candidates.find((c) => fs.existsSync(path.join(OUT, c))) ?? null;
}

/** Every generated HTML file plus the sitemap, for scanning. */
function emitted() {
	const out = [];
	for (const entry of fs.readdirSync(OUT, { withFileTypes: true })) {
		if (!entry.isDirectory() || entry.name.startsWith(".") || entry.name === "node_modules") continue;
		for (const f of ["index.html", "privacy.html", "terms.html"]) {
			const rel = path.join(entry.name, f);
			if (fs.existsSync(path.join(OUT, rel))) out.push(rel);
		}
	}
	for (const f of ["index.html", "404.html", "home.html", "sitemap.xml"]) {
		if (fs.existsSync(path.join(OUT, f))) out.push(f);
	}
	return out;
}

const broken = new Set();

for (const rel of emitted()) {
	const html = fs.readFileSync(path.join(OUT, rel), "utf8");
	const isSitemap = rel.endsWith(".xml");

	// Internal hrefs and hreflang alternates. Absolute URLs to our own origin
	// count too — the canonical and og:image tags are how crawlers find pages.
	const refs = [
		...html.matchAll(/(?:href|content)="([^"]+)"/g),
		...(isSitemap ? [...html.matchAll(/<loc>([^<]+)<\/loc>/g)] : []),
	].map((m) => m[1]);

	for (const ref of refs) {
		let p = ref;
		if (SITE_URL_PREFIX.test(p)) p = p.replace(SITE_URL_PREFIX, "");
		if (!p.startsWith("/")) continue; // external, in-page anchor, or relative
		p = p.split("#")[0].split("?")[0];
		if (p === "" || p === "/") continue;
		if (/\.[a-z0-9]+$/i.test(p) && !/\.html?$/i.test(p)) {
			// A real asset (png, svg, js, css, woff2, xml…). Verify it exists.
			if (!fs.existsSync(path.join(OUT, p.replace(/^\/+/, "")))) {
				broken.add(`${rel} → ${p} (missing asset)`);
			}
			continue;
		}
		if (!fileFor(p)) broken.add(`${rel} → ${p} (no page)`);
	}
}

for (const b of broken) failures.push(`broken link: ${b}`);

/* ---------------------------------------------------- hidden still hides --- */

/* `index.html` is the only page that ships two mutually exclusive modes and
   toggles between them with the `hidden` attribute. That attribute only works
   while nothing else sets `display` on the element, and `.oauth-wrap` sets
   `display: grid` — so the stylesheet has to restate it with `!important`.
   Assert it structurally rather than trusting anyone to remember. */
{
	const css = fs.readFileSync(path.join(OUT, "styles.css"), "utf8");
	const hides =
		/\[hidden\][^{]*\{[^}]*display\s*:\s*none\s*!important/.test(css);

	const root = path.join(OUT, "index.html");
	const html = fs.existsSync(root) ? fs.readFileSync(root, "utf8") : "";
	const toggles = /id="hop"\s+hidden/.test(html);

	if (toggles && !hides) {
		failures.push(
			"stylesheet never restates [hidden] { display: none !important }, so the root page renders both of its cards",
		);
	}
}

/* --------------------------------------------------- contrast still holds --- */

/* The design tokens are the whole accessibility story for this site: every
   colour on every page resolves through one of the variables in `:root` (or its
   dark twins), so a single darkened value silently repaints dozens of small
   labels. That has gone wrong twice — once when --ink-tertiary sat at 3.23:1
   across every 11px uppercase label, and once when the dark feature card kept
   hardcoded light text on a surface that flipped to cream in dark mode.

   So the pairs that carry meaning are asserted here rather than trusted. Ratios
   are the WCAG 2.x ones; 4.5 is body/label text, 3.0 is large text, icons and
   the boundaries of controls. Decorative hairlines (--rule, --rule-strong) are
   deliberately absent: they are never a control's only affordance. */
{
	const css = fs.readFileSync(path.join(OUT, "styles.css"), "utf8");

	/** Pull `--name: #hex` out of one brace-delimited block. */
	function tokens(text) {
		const t = {};
		for (const m of text.matchAll(/(--[a-z-]+)\s*:\s*(#[0-9a-fA-F]{3,8})\b/g)) {
			t[m[1]] = m[2];
		}
		return t;
	}

	const light = tokens(css.slice(css.indexOf(":root {"), css.indexOf("/* The root page ships")));
	const dark = tokens(css.slice(css.lastIndexOf(':root[data-theme="dark"]')));

	/* A token that is no longer a literal hex — say `--surface-ink: var(--cocoa)`
	   — would make the palette dance with the theme again, and the ratio maths
	   below cannot see through an indirection. Naming the token and failing
	   beats crashing with "cannot read properties of undefined". */
	const required = [
		"--canvas", "--surface", "--surface-sunken", "--ink", "--ink-secondary",
		"--ink-tertiary", "--accent", "--accent-ink", "--accent-quiet",
		"--accent-quiet-ink", "--ok-quiet", "--ok-ink", "--warn-quiet", "--warn-ink",
		"--danger-quiet", "--danger-ink", "--border-control", "--surface-ink",
		"--surface-ink-strong", "--surface-ink-muted", "--surface-ink-accent",
		"--surface-ink-tint", "--surface-ink-term", "--surface-ink-term-ink",
		"--surface-ink-term-key", "--surface-ink-term-edge",
	];
	let tokensOk = true;
	for (const [mode, t] of [["light", light], ["dark", dark]]) {
		for (const name of required) {
			// The dark feature card is theme-independent, so its tokens only need
			// to be literal in the :root block.
			if (mode === "dark" && name.startsWith("--surface-ink")) continue;
			if (!/^#[0-9a-fA-F]{6}$/.test(t[name] ?? "")) {
				tokensOk = false;
				failures.push(
					`${mode}: ${name} is missing or not a literal hex colour, so it cannot be contrast-checked`,
				);
			}
		}
	}

	/* The dark feature card must be pinned to its own surface. Pointing it back
	   at --cocoa is exactly the bug that rendered it at 1.00:1 in dark mode, and
	   the ratio maths above would not catch it because both tokens are valid
	   hex. Assert the indirection instead. */
	const darkCard = css.slice(css.indexOf(".cell--dark {"), css.indexOf(".cell-icon {"));
	if (!/--surface-ink\b/.test(darkCard) || /--cocoa\b/.test(darkCard)) {
		failures.push(
			".cell--dark no longer pins its own surface — it will follow the theme and go unreadable in dark mode",
		);
	}

	const rgb = (hex) => {
		const x = hex.replace("#", "");
		const s = x.length === 3 ? x.split("").map((c) => c + c).join("") : x;
		return [0, 2, 4].map((i) => parseInt(s.slice(i, i + 2), 16));
	};
	const luminance = (hex) =>
		rgb(hex)
			.map((v) => {
				const c = v / 255;
				return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
			})
			.reduce((acc, c, i) => acc + c * [0.2126, 0.7152, 0.0722][i], 0);

	const ratio = (a, b) => {
		const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
		return (hi + 0.05) / (lo + 0.05);
	};

	/** Every pair that must hold, per theme. */
	const checks = [];
	for (const [mode, t] of [["light", light], ["dark", dark]]) {
		const surfaces = { canvas: t["--canvas"], surface: t["--surface"], sunken: t["--surface-sunken"] };
		for (const fg of [
			"--ink",
			"--ink-secondary",
			"--ink-tertiary",
			"--accent",
			"--accent-quiet-ink",
			"--ok-ink",
			"--warn-ink",
			"--danger-ink",
		]) {
			for (const [name, bg] of Object.entries(surfaces)) {
				checks.push([`${mode}: ${fg} on --${name}`, t[fg], bg, 4.5]);
			}
		}
		checks.push([`${mode}: --accent-quiet-ink on --accent-quiet`, t["--accent-quiet-ink"], t["--accent-quiet"], 4.5]);
		checks.push([`${mode}: --ok-ink on --ok-quiet`, t["--ok-ink"], t["--ok-quiet"], 4.5]);
		checks.push([`${mode}: --warn-ink on --warn-quiet`, t["--warn-ink"], t["--warn-quiet"], 4.5]);
		checks.push([`${mode}: --danger-ink on --danger-quiet`, t["--danger-ink"], t["--danger-quiet"], 4.5]);
		checks.push([`${mode}: --accent-ink on --accent`, t["--accent-ink"], t["--accent"], 4.5]);
		// Non-text: focus ring, control borders, spinner segment.
		checks.push([`${mode}: --accent focus ring on --surface`, t["--accent"], t["--surface"], 3]);
		checks.push([`${mode}: --accent focus ring on --canvas`, t["--accent"], t["--canvas"], 3]);
		for (const [name, bg] of Object.entries(surfaces)) {
			checks.push([`${mode}: --border-control on --${name}`, t["--border-control"], bg, 3]);
		}
	}

	// The dark feature card is theme-independent on purpose, so it is checked once.
	for (const [label, fg, bg, need] of [
		["card heading", light["--surface-ink-strong"], light["--surface-ink"], 4.5],
		["card body", light["--surface-ink-muted"], light["--surface-ink"], 4.5],
		["card icon", light["--surface-ink-accent"], light["--surface-ink-tint"], 3],
		["terminal text", light["--surface-ink-term-ink"], light["--surface-ink-term"], 4.5],
		["terminal key", light["--surface-ink-term-key"], light["--surface-ink-term"], 4.5],
		["terminal value", light["--surface-ink-accent"], light["--surface-ink-term"], 4.5],
		["terminal edge", light["--surface-ink-term-edge"], light["--surface-ink"], 3],
		["terminal edge (panel)", light["--surface-ink-term-edge"], light["--surface-ink-term"], 3],
	]) {
		checks.push([`dark card: ${label}`, fg, bg, need]);
	}

	if (!tokensOk) {
		// Some token is not a literal hex, so a ratio would be computed against
		// `undefined`. The failures above already name the token; skip the maths.
	} else {
		for (const [label, fg, bg, need] of checks) {
			const value = ratio(fg, bg);
			if (value < need) {
				failures.push(`${label} is ${value.toFixed(2)}:1, needs ${need}:1`);
			}
		}
	}
}

for (const w of warnings) console.log(`warn  ${w}`);
for (const f of failures) console.log(`FAIL  ${f}`);

if (failures.length === 0) {
	console.log(`\nOK — ${LOCALES.length} locales, no structural or copy failures.`);
} else {
	console.log(`\n${failures.length} failure(s).`);
	process.exitCode = 1;
}