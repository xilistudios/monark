#!/usr/bin/env bash
# Render _tools/og/card.html to og.png (1200×630) with a local headless Chrome.
#
# Why not ImageMagick: its SVG delegate (MSVG/rsvg) refuses or mangles the
# Inkscape-authored logo.svg, and librsvg pulls in its own font stack — the
# Newsreader italic in the headline would silently fall back to a system serif.
# Chrome renders the exact same CSS, font-faces and logo that ship in the site.
#
# Usage: ./_tools/og/render.sh   (writes ../og.png next to the card assets)
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
site="$(cd "$here/../.." && pwd)"
out="$site/og.png"

chrome=""
for candidate in google-chrome-stable google-chrome chromium chromium-browser; do
	if command -v "$candidate" >/dev/null 2>&1; then
		chrome="$candidate"
		break
	fi
done

if [ -z "$chrome" ]; then
	echo "render.sh: no Chrome/Chromium found on PATH." >&2
	echo "  macOS:  /Applications/Google Chrome.app/Contents/MacOS/Google Chrome" >&2
	echo "  or install chrome-headless-shell and add it to PATH." >&2
	exit 1
fi

# --virtual-time-budget waits for the woff2 faces to decode before the shot;
# without it Chrome captures the fallback stack.
"$chrome" \
	--headless=new \
	--disable-gpu \
	--hide-scrollbars \
	--force-device-scale-factor=1 \
	--window-size=1200,630 \
	--virtual-time-budget=4000 \
	--default-background-color=00000000 \
	--screenshot="$out" \
	"file://$here/card.html"

echo "wrote $out"