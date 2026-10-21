/**
 * OAuth redirect handler.
 *
 * Served at the site root, which is the redirect URI registered in the Google
 * Cloud console. Google returns the authorisation response here as query
 * parameters, so this page has exactly two jobs:
 *
 *   1. no `code`/`state`/`error` in the URL → forward to the marketing site
 *   2. otherwise → hand the credentials to the desktop or mobile app
 *
 * The handover uses a custom-scheme deep link (`monark://oauth/callback`). On
 * Android that is an `intent://` URL so the browser can reach the installed
 * package, and on iOS the scheme can be navigated to directly. Desktop is
 * different: a browser only honours a custom scheme the user actually asked
 * for, so there the handover is a button on the success screen rather than an
 * automatic attempt — Firefox, Chrome and Zen all drop the latter.
 *
 * Because the deep link can fail silently (no app installed, no handler
 * registered), the credentials are also rendered for manual copy. That
 * fallback is the reason this page still needs a UI at all.
 *
 * Strings arrive as `window.MONARK_OAUTH`, injected by the build so this file
 * stays free of copy.
 */
(() => {
	"use strict";

	const config = window.MONARK_OAUTH ?? {};
	const strings = config.strings ?? {};

	const DEEP_LINK_DELAY = 500;
	const BUTTON_RESET_DELAY = 3000;

	const params = new URLSearchParams(window.location.search);
	const code = params.get("code");
	const state = params.get("state");
	const error = params.get("error");
	const errorDescription = params.get("error_description");

	const card = document.getElementById("oauth-card");
	const spinner = document.getElementById("oauth-spinner");
	const statusEl = document.getElementById("oauth-status");
	const titleEl = document.getElementById("oauth-title");
	const bodyEl = document.getElementById("oauth-body");
	const hopView = document.getElementById("hop");

	const hasCallbackParams = Boolean(code || state || error);

	/* ------------------------------------------------------------ helpers --- */

	const el = (tag, className, text) => {
		const node = document.createElement(tag);
		if (className) node.className = className;
		if (text !== undefined) node.textContent = text;
		return node;
	};

	const isMeaningful = (value) => Boolean(value && value.trim().length > 0);

	/** Replace the whole card contents. */
	const render = (...nodes) => {
		if (!card) return;
		card.replaceChildren(...nodes);
	};

	const setStatus = (message, tone) => {
		if (!statusEl) return;
		statusEl.textContent = message;
		statusEl.className = "status" + (tone ? ` status--${tone}` : "");
	};

	/** URL-encoded callback query carrying the credentials back to the app. */
	const callbackQuery = () =>
		`code=${encodeURIComponent(code)}&state=${encodeURIComponent(state)}`;

	/** The custom-scheme deep link the app registers as its callback. */
	const callbackDeepLink = () => `monark://oauth/callback?${callbackQuery()}`;

	/**
	 * Fire the custom-scheme deep link on the platforms that accept it without
	 * a user gesture — Android and iOS. Desktop is deliberately absent: see
	 * `bindOpenApp`, which requires a click.
	 */
	function openDeepLink() {
		const query = callbackQuery();
		const deepLink = callbackDeepLink();

		try {
			const agent = navigator.userAgent;

			if (/Android/i.test(agent)) {
				// `intent://` needs an explicit package and end marker.
				window.location.href = `intent://oauth/callback?${query}#Intent;scheme=monark;package=com.monark.app;end`;
			} else if (/iPhone|iPad|iPod/i.test(agent)) {
				window.location.href = deepLink;
			}
			// Desktop: nothing here, on purpose. A `monark://` navigation that no
			// one asked for is dropped by the browser, so the handover waits for
			// a click — see `bindOpenApp`.
		} catch (err) {
			console.log("Deep link attempt failed:", err);
		}
	}

	/** Base64 JSON of the credentials, matching what the app's paste field expects. */
	function credentialsAsBase64() {
		return btoa(JSON.stringify({ code, state }));
	}

	function bindCopy() {
		const button = document.getElementById("oauth-copy");
		const done = document.getElementById("oauth-copied");
		if (!button) return;

		button.addEventListener("click", async () => {
			let payload;
			try {
				payload = credentialsAsBase64();
			} catch (err) {
				console.error("Could not encode credentials:", err);
				setStatus(strings.encodeFailed ?? "", "error");
				return;
			}

			try {
				await navigator.clipboard.writeText(payload);
			} catch (err) {
				console.error("Could not copy credentials:", err);
				setStatus(strings.copyFailed ?? "", "error");
				return;
			}

			if (done) done.dataset.visible = "true";
			setStatus(strings.copied ?? "", "ok");

			const label = button.textContent;
			button.disabled = true;
			button.textContent = strings.copied ?? label;
			window.setTimeout(() => {
				button.disabled = false;
				button.textContent = label;
			}, BUTTON_RESET_DELAY);
		});
	}

	/**
	 * Wire the primary "open the app" button. The navigation has to happen
	 * inside the click handler itself: a custom scheme launched from a timer,
	 * a load event or a hidden iframe is dropped by every desktop browser.
	 */
	function bindOpenApp() {
		const button = document.getElementById("oauth-open-app");
		if (!button) return;

		button.addEventListener("click", () => {
			window.location.href = callbackDeepLink();
		});
	}

	/* -------------------------------------------------------------- states --- */

	function showSuccess() {
		if (spinner) spinner.remove();
		if (titleEl) titleEl.remove();
		if (bodyEl) bodyEl.remove();
		if (statusEl) statusEl.remove();

		const heading = el("h1", null, strings.successTitle ?? "");
		const lede = el("p", null, strings.successBody ?? "");

		// The desktop handover: a real, visible button, because the browser only
		// follows a custom scheme that the user asked for.
		const openApp = el("button", "btn btn--primary oauth-open-app", strings.openApp ?? "");
		openApp.id = "oauth-open-app";
		openApp.type = "button";

		// An annotation on the button above it: hidden when a stale cached
		// config lacks the string (no blank gap), and tied to the button for
		// assistive tech when visible.
		const openHint = el("p", "oauth-open-hint", strings.openAppHint ?? "");
		openHint.id = "oauth-open-hint";
		if (isMeaningful(strings.openAppHint)) {
			openApp.setAttribute("aria-describedby", "oauth-open-hint");
		} else {
			openHint.hidden = true;
		}

		const block = el("div", "oauth-block");
		block.append(
			el("h3", null, strings.copyHeading ?? ""),
			el("p", null, strings.copyBody ?? ""),
		);

		const copyButton = el("button", "btn btn--primary btn--sm", strings.copyButton ?? "");
		copyButton.id = "oauth-copy";
		copyButton.type = "button";
		block.append(copyButton);

		const done = el("p", "copy-done", strings.copied ?? "");
		done.id = "oauth-copied";
		block.append(done);

		const steps = el("div", "steps");
		steps.append(el("h4", null, strings.instructions ?? ""));
		const list = el("ol");
		for (const step of strings.steps ?? []) list.append(el("li", null, step));
		steps.append(list);

		const note = el("p", null, strings.closable ?? "");
		note.style.fontSize = "0.8125rem";
		note.style.color = "var(--ink-tertiary)";

		const ok = el("p", "status status--ok", strings.statusOk ?? "");
		ok.setAttribute("role", "status");

		render(heading, lede, ok, openApp, openHint, block, steps, note);
		bindCopy();
		bindOpenApp();
	}

	function showError(title, message, detail) {
		if (spinner) spinner.remove();
		if (titleEl) titleEl.remove();
		if (bodyEl) bodyEl.remove();
		if (statusEl) statusEl.remove();

		const icon = el("div", "oauth-error-icon");
		icon.innerHTML =
			'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 4.5L21 19.5H3L12 4.5z"/><path d="M12 10v4"/><path d="M12 16.6v.01"/></svg>';

		const close = el("button", "btn btn--ghost btn--sm", strings.closeWindow ?? "");
		close.type = "button";
		close.addEventListener("click", () => window.close());

		render(
			icon,
			el("h1", null, title),
			el("p", null, message),
			el("p", "status status--error", detail),
			close,
		);
	}

	/* ---------------------------------------------------------------- run --- */

	// Mode 1: a plain visit. The root URL is also the app's registered redirect
	// URI, so a bare hit has to move on to the marketing site.
	if (!hasCallbackParams) {
		if (hopView) hopView.hidden = false;
		if (config.hop) window.location.replace(config.hop);
		return;
	}

	if (hopView) hopView.hidden = true;
	if (card) card.hidden = false;

	// Mode 2a: Google reported a failure.
	if (error) {
		console.error("OAuth error:", error, errorDescription);
		showError(
			strings.errorTitle ?? "",
			strings.errorBody ?? "",
			errorDescription || error || strings.unknownError || "",
		);
		return;
	}

	// Mode 2b: a response that is missing half of what it needs is not usable.
	if (!isMeaningful(code) || !isMeaningful(state)) {
		showError(strings.invalidTitle ?? "", strings.invalidBody ?? "", strings.unknownError ?? "");
		return;
	}

	// Mode 2c: the real path. Hand off where that needs no gesture, then leave
	// the button and the manual copy fallback on screen.
	setStatus(strings.statusOk ?? "", "ok");
	window.setTimeout(() => {
		openDeepLink();
		showSuccess();
	}, DEEP_LINK_DELAY);
})();