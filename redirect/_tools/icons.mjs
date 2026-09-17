/**
 * Inline SVG icon set — single stroke width, 24×24 grid, no third-party library.
 * Each icon is a raw inner-markup string so it can inherit `currentColor`.
 */

const wrap = (body) =>
	`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${body}</svg>`;

export const icon = {
	shield: wrap(
		'<path d="M12 3l7 3v5.5c0 4.2-2.9 7.6-7 9-4.1-1.4-7-4.8-7-9V6l7-3z"/><path d="M9.2 12l2 2 3.6-3.8"/>',
	),
	lock: wrap(
		'<rect x="4.5" y="10.5" width="15" height="10" rx="2.2"/><path d="M8 10.5V8a4 4 0 018 0v2.5"/><path d="M12 14.5v2.5"/>',
	),
	key: wrap(
		'<circle cx="8" cy="15" r="3.2"/><path d="M10.4 12.6L19 4"/><path d="M16 7l2 2"/><path d="M14 9l2 2"/>',
	),
	entropy: wrap(
		'<rect x="4" y="4" width="16" height="16" rx="4"/><path d="M9 9.6a1.1 1.1 0 100-.1z" fill="currentColor" stroke="none"/><path d="M15 9.6a1.1 1.1 0 100-.1z" fill="currentColor" stroke="none"/><path d="M9 15a1.1 1.1 0 100-.1z" fill="currentColor" stroke="none"/><path d="M15 15a1.1 1.1 0 100-.1z" fill="currentColor" stroke="none"/>',
	),
	timer: wrap(
		'<circle cx="12" cy="13" r="7.5"/><path d="M12 9.5V13l2.5 1.6"/><path d="M9.5 2.8h5"/>',
	),
	cloud: wrap(
		'<path d="M7.5 18.5h9.2a3.8 3.8 0 00.4-7.6 5.2 5.2 0 00-10-1.3 3.6 3.6 0 00.4 8.9z"/><path d="M12 14.4V9.6"/><path d="M9.8 11.5L12 9.3l2.2 2.2"/>',
	),
	devices: wrap(
		'<rect x="2.5" y="5" width="12" height="9" rx="1.6"/><path d="M2.5 17.5h12"/><rect x="16.5" y="9" width="5" height="10" rx="1.4"/>',
	),
	check: wrap('<path d="M4.5 12.5l4.6 4.5L19.5 6.5"/>'),
	shieldCheck: wrap(
		'<path d="M12 3l7 3v5.5c0 4.2-2.9 7.6-7 9-4.1-1.4-7-4.8-7-9V6l7-3z"/><path d="M9 11.8l2.1 2.1L15 10"/>',
	),
	warning: wrap(
		'<path d="M12 4.5L21 19.5H3L12 4.5z"/><path d="M12 10v4"/><path d="M12 16.6v.01"/>',
	),
	info: wrap('<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5"/><path d="M12 7.8v.01"/>'),
	copy: wrap(
		'<rect x="8.5" y="8.5" width="11" height="11" rx="2"/><path d="M15.5 5.5H6.5a2 2 0 00-2 2v9"/>',
	),
	external: wrap(
		'<path d="M14 4.5h5.5V10"/><path d="M19.5 4.5L11 13"/><path d="M17.5 14v4.5a1 1 0 01-1 1H6a1 1 0 01-1-1V8a1 1 0 011-1h4.5"/>',
	),
	chevron: wrap('<path d="M6 9.5l6 6 6-6"/>'),
	arrowRight: wrap('<path d="M4.5 12h14"/><path d="M13 6.5l5.5 5.5L13 17.5"/>'),
	arrowLeft: wrap('<path d="M19.5 12h-14"/><path d="M11 6.5L5.5 12 11 17.5"/>'),
	folder: wrap(
		'<path d="M3.5 7.5a2 2 0 012-2h3.4l2 2.4h7.6a2 2 0 012 2v8.1a2 2 0 01-2 2H5.5a2 2 0 01-2-2V7.5z"/>',
	),
	globe: wrap(
		'<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17"/><path d="M12 3.5c2.2 2.4 3.4 5.4 3.4 8.5S14.2 18.1 12 20.5c-2.2-2.4-3.4-5.4-3.4-8.5S9.8 5.9 12 3.5z"/>',
	),
	close: wrap('<path d="M6 6l12 12"/><path d="M18 6L6 18"/>'),
	github:
		'<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false"><path d="M12 .5C5.73.5.5 5.73.5 12a11.5 11.5 0 007.86 10.92c.58.1.79-.25.79-.56v-2c-3.2.7-3.88-1.37-3.88-1.37-.53-1.34-1.3-1.7-1.3-1.7-1.06-.72.08-.7.08-.7 1.17.08 1.79 1.2 1.79 1.2 1.04 1.79 2.74 1.27 3.4.97.1-.76.4-1.28.74-1.57-2.55-.29-5.24-1.28-5.24-5.7 0-1.26.45-2.29 1.19-3.1-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.18 1.18a11 11 0 015.8 0c2.2-1.49 3.17-1.18 3.17-1.18.63 1.59.23 2.76.12 3.05.74.81 1.18 1.84 1.18 3.1 0 4.43-2.69 5.4-5.25 5.69.41.36.78 1.06.78 2.14v3.17c0 .31.2.67.8.56A11.5 11.5 0 0023.5 12C23.5 5.73 18.27.5 12 .5z"/></svg>',
	monark:
		'<svg viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false"><path d="M12 2.2l5.6 2.4v4.4c0 3.4-2.3 6.1-5.6 7.2-3.3-1.1-5.6-3.8-5.6-7.2V4.6L12 2.2z" fill="currentColor"/></svg>',
};