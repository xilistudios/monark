/**
 * Progressive enhancement for the Monark marketing pages.
 *
 * Nothing here is required to read the site: the language menu is a plain list
 * of links and every section is in the DOM before this file runs. The script
 * only adds the dropdown behaviour, the locale shortcut and the scroll reveals.
 *
 * Loaded with `defer`, so the DOM is already parsed.
 */
(() => {
	"use strict";

	/* ------------------------------------------------------- language menu --- */

	const dropdown = document.querySelector("[data-lang]");

	if (dropdown) {
		const toggle = dropdown.querySelector("[data-lang-toggle]");
		const menu = dropdown.querySelector("[data-lang-menu]");

		const setOpen = (open) => {
			dropdown.dataset.open = String(open);
			toggle.setAttribute("aria-expanded", String(open));
		};

		setOpen(false);

		toggle.addEventListener("click", (event) => {
			event.stopPropagation();
			setOpen(dropdown.dataset.open !== "true");
		});

		dropdown.addEventListener("keydown", (event) => {
			if (event.key === "Escape" && dropdown.dataset.open === "true") {
				setOpen(false);
				toggle.focus();
			}
		});

		document.addEventListener("click", (event) => {
			if (!dropdown.contains(event.target)) setOpen(false);
		});

		// Leaving the tab open while navigating away would reopen it on return.
		menu.addEventListener("click", () => setOpen(false));
	}

	/* ------------------------------------------------- visit memory shortcut --- */

	// A visitor who picked Español once should not have to pick it again. This
	// only ever *offers* a switch: it never redirects on its own, because doing
	// so would break deep links and surprise anyone whose browser locale is not
	// their reading preference.
	const STORE = "monark.lang";
	const here = document.documentElement.lang.slice(0, 2);

	try {
		localStorage.setItem(STORE, here);
	} catch {
		/* private mode — the shortcut is simply unavailable */
	}

	/* ------------------------------------------------------------- reveals --- */

	const targets = document.querySelectorAll("[data-reveal]");

	if (targets.length === 0) return;

	const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
	if (reduce.matches || !("IntersectionObserver" in window)) {
		for (const el of targets) el.dataset.shown = "true";
		return;
	}

	const observer = new IntersectionObserver(
		(entries) => {
			for (const entry of entries) {
				if (!entry.isIntersecting) continue;
				entry.target.dataset.shown = "true";
				observer.unobserve(entry.target);
			}
		},
		{ rootMargin: "0px 0px -8% 0px", threshold: 0.05 },
	);

	for (const el of targets) observer.observe(el);

	// Anything already in view before the observer attaches still animates in.
	requestAnimationFrame(() => {
		for (const el of targets) {
			const box = el.getBoundingClientRect();
			if (box.top < window.innerHeight * 0.92) el.dataset.shown = "true";
		}
	});
})();