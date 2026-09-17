#!/usr/bin/env node
/**
 * Minimal static server that mimics Firebase Hosting's `cleanUrls`.
 *
 * The site cannot be verified over file:// — the root page's OAuth hop rewrites
 * to `/en/`, and clean URLs like `/en/privacy` have no `.html` on disk. Both
 * only resolve the way they do in production when a host maps them. This server
 * applies the same rules, so what a headless browser sees here is what ships.
 *
 *   node _tools/serve.mjs [port]     # default 4173
 */
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const PORT = Number(process.argv[2] ?? 4173);

const TYPES = {
	".html": "text/html; charset=utf-8",
	".css": "text/css; charset=utf-8",
	".js": "text/javascript; charset=utf-8",
	".svg": "image/svg+xml",
	".png": "image/png",
	".xml": "application/xml",
	".txt": "text/plain; charset=utf-8",
	".woff2": "font/woff2",
	".ico": "image/x-icon",
};

/** Resolve a request path the way `cleanUrls` does. */
function resolve(urlPath) {
	const clean = decodeURIComponent(urlPath.split("?")[0].split("#")[0]);
	if (clean.includes("..")) return null;

	const rel = clean.replace(/^\/+/, "");
	const candidates = rel === ""
		? ["index.html"]
		: [rel, `${rel}.html`, path.join(rel, "index.html")];

	for (const c of candidates) {
		const abs = path.join(ROOT, c);
		if (!abs.startsWith(ROOT)) return null;
		if (fs.existsSync(abs) && fs.statSync(abs).isFile()) return abs;
	}
	return null;
}

http
	.createServer((req, res) => {
		const file = resolve(req.url ?? "/");
		if (!file) {
			const notFound = path.join(ROOT, "404.html");
			res.writeHead(404, { "content-type": TYPES[".html"] });
			res.end(fs.existsSync(notFound) ? fs.readFileSync(notFound) : "404");
			return;
		}
		res.writeHead(200, { "content-type": TYPES[path.extname(file)] ?? "application/octet-stream" });
		res.end(fs.readFileSync(file));
	})
	.listen(PORT, () => console.log(`serving ${ROOT} on http://localhost:${PORT}`));