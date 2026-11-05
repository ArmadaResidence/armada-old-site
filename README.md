# armada-old-site — archived copy of the old armadaresidence.com

Static, script-free archive of the **old** Armada Residence website (built on Hostinger Horizons, a JavaScript-rendered React app), kept **for comparison only** before the new site takes over the domain.

- **Source domain:** https://armadaresidence.com (old Horizons site)
- **Capture date:** 2026-11-06
- **Published at:** https://armadaresidence.github.io/armada-old-site/ — page list: [`archive-index.html`](https://armadaresidence.github.io/armada-old-site/archive-index.html)
- **Not for indexing.** Every page carries `<meta name="robots" content="noindex, nofollow">`. The repo-root `robots.txt` disallows everything, but on a GitHub Pages *project* site it is served at `/armada-old-site/robots.txt`, not at the domain root, so crawlers do not read it — the noindex meta is the real guard.

## Contents

| path | what |
|---|---|
| `index.html`, `<path>/index.html` | Arabic pages (the old site's default language), same paths as the live site |
| `en/<path>/index.html` | English pages (see "Language" below) |
| `archive-index.html` | every archived page, its original URL and capture time |
| `assets/` | every image, stylesheet and font the pages use (downloaded, URLs rewritten to relative paths) |
| `screenshots/desktop/`, `screenshots/mobile/` | full-page screenshots of the LIVE old pages at 1440 px and 375 px (mobile emulation, 1× pixel ratio), JPEG q82 |
| `tools/` | the capture scripts (Node + Playwright) |

## How it was captured

1. Discovery: `sitemap.xml` + every same-origin link in each rendered page (breadth-first), plus the routes the app itself renders from its data (branch, room, offer and blog records it loads — the room pages are opened by buttons, not links). `/admin/*` was skipped. Known old URL shapes that render an empty page on the old site (`/about`, `/rooms`, `/contact`, `/our-rooms/`, `/armada-residence-airport-rood/`, `/branches`) are not archived.
2. Each page was rendered in Chrome at 1440 × 900, waited for network idle (capped — the app polls its settings), fonts and a short settle, scrolled slowly to the bottom to trigger lazy images and in-view animations, then the rendered DOM was saved.
3. Clean-up: all `<script>`/`<noscript>` elements and inline event handlers removed; forms have no `action`, every control inside a form is `disabled` and dimmed; internal links point to the archived pages (relative); external links unchanged; a fixed top bar «نسخة أرشيفية من الموقع القديم — للمقارنة فقط» is added and the page (and its fixed header) pushed down by its height.
4. Read only: no form was submitted, nothing was logged into; the browser blocked every non-GET request and every analytics / ad-pixel request (GTM, GA, Google Ads, Meta, TikTok, Snap) so the capture sent no hits to the live properties. No cookie / consent banner was present.

## Language

The old site switches language **in place** (its «English» / «EN» button; no URL change, nothing stored in a cookie or localStorage — a reload returns to Arabic). Each page was therefore captured twice: as loaded (Arabic) and after clicking the English toggle; the English copies live under `/en/…`. The archive's top bar links each page to its other-language copy.
