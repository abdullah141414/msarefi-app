# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

**مصاريفي** ("My Expenses") — a personal Arabic (RTL), Saudi-focused expense-tracker PWA for one user's iPhone. Vanilla HTML/CSS/JS, no framework, no bundler, no npm/`package.json`, no test suite, no linter. Everything runs directly in the browser from static files.

Deployed as a static site via GitHub Pages from this repo (`abdullah141414/msarefi-app`, branch `main`) at `https://abdullah141414.github.io/msarefi-app/`. There is no CI build step — whatever is committed to `main` is served as-is.

## Running locally

No build/install step. Serve the directory as static files and open in a browser:

```
python -m http.server 8642
```

(This matches `.claude/launch.json`, used by the Claude Code preview tool.)

**Local dev gotcha:** `python -m http.server` sends no cache headers, so the service worker (`sw.js`) can serve stale cached JS/CSS while iterating locally, making edits appear not to take effect. Before verifying a change in the preview browser, unregister the service worker and clear caches:

```js
const regs = await navigator.serviceWorker.getRegistrations();
await Promise.all(regs.map(r => r.unregister()));
const keys = await caches.keys();
await Promise.all(keys.map(k => caches.delete(k)));
```
then hard-reload.

## Deploying

Push to `main` → GitHub Pages Actions workflow deploys automatically. **This workflow is flaky** ("Deployment failed, try again later" is common); if a deploy fails, retrigger with an empty commit (`git commit --allow-empty -m "Retrigger Pages deployment"`) and poll `https://abdullah141414.github.io/msarefi-app/sw.js` for the new `CACHE` version string to confirm it went live.

**Whenever any file listed in `sw.js`'s `SHELL` array changes (i.e. almost any `index.html`/`css/`/`js/` edit), bump the `CACHE` constant in `sw.js`** (e.g. `masareefi-v13` → `v14`). The service worker is cache-first for same-origin requests and does not auto-update — without a cache bump, users' already-installed PWAs won't see the change. The app deliberately does *not* call `self.skipWaiting()` on install; instead it shows an "update available" banner and only activates the new SW when the user taps it (`postMessage({type:'SKIP_WAITING'})` → `sw.js`'s `message` listener).

## Architecture

### Script loading and module pattern

No bundler — four `<script>` tags in `index.html`, loaded in dependency order, each defining one global via an IIFE:

```
js/store.js   → window.Store       (localStorage persistence)
js/sms.js     → window.SmsParser   (bank-SMS text parsing + categorization)
js/stats.js   → window.Stats       (aggregation + hand-rolled SVG chart generation)
js/app.js     → (no export) owns all DOM wiring, state, and event handlers, in its own top-level IIFE
```

`app.js` is the only consumer of the other three and the only file that touches the DOM. It's organized as one large IIFE with Arabic section-header comments (`// ===== ... =====`) — search for these to navigate; major ones include: state/settings, cycle-date math, entrance animations, view navigation (tap + swipe), the intelligence layer (insights/forecast/anomaly detection), home/record/stats rendering, the expense/category sheets, SMS import + Cloudflare relay sync, backup export/import, recurring expenses, themes, savings goal, CSV export, shareable report, pull-to-refresh, onboarding, and the PIN/Face ID privacy lock.

### Persistence (`js/store.js`)

Everything lives in `localStorage` under `masareefi.*` keys (expenses, categories, settings, budgets, recurring templates, learned-merchant map, cycle-start-day, relay config, seen-SMS hashes). `Store.exportAll()`/`importAll()` serialize/restore the whole set as one JSON file for the in-app backup feature. There is no server-side or cross-device sync of app data itself (only the SMS relay mailbox, see below, is server-side and ephemeral).

### The billing cycle (not calendar month)

Home, record, and stats views all group expenses by a **user-configurable cycle** (`Store.getCycleStartDay()`, 1–28, default 1) instead of the calendar month — e.g. day 27 means each "month" runs the 27th to the 26th, so it can match a payday. `cycleStartOf`/`cycleKeyOf`/`expensesOfCycle`/`shiftCycle` in `app.js` are the shared helpers; day 1 exactly reproduces normal calendar-month behavior. Any new view that shows "this month's" data should go through these, not raw calendar months.

### Bank-SMS auto-logging (the app's signature feature)

Two independent entry paths feed the same `importSmsText()` pipeline in `app.js`, which runs the message through `SmsParser.parse()`, dedupes by `SmsParser.fingerprint()`, guesses a category, and saves an expense:

1. **Direct URL** — an iOS Shortcuts automation opens `https://.../#sms=<encoded message>`; `app.js` reads `location.hash` on load. Requires the phone to be unlocked.
2. **Cloudflare relay mailbox** (`cloudflare/worker.js`, deployed separately by the user to Cloudflare Workers + KV — *not* part of this repo's own deploy) — the Shortcuts automation instead POSTs the SMS text to the worker's `/in` endpoint (works even while the phone is locked, since it's a background network request, not opening the app). The app polls `GET /pull` on load and on `visibilitychange`. The worker also sends a VAPID Web Push notification on message arrival so the phone can alert without the app being open — see `js/app.js`'s "Web Push" section and `sw.js`'s `push`/`notificationclick` handlers.

**`cloudflare/worker.js` has no CI/deploy pipeline of its own** — if you edit it, the user must manually re-paste the code into the Cloudflare dashboard for a deployed worker to pick it up. Its required env: KV binding `SMS_BOX`, secrets `RELAY_KEY`, `VAPID_PRIVATE`, var `VAPID_PUBLIC` (the public key is also hardcoded in `js/app.js`, must match).

`SmsParser` (`js/sms.js`) is tuned against real Saudi bank SMS formats (POS purchase, Apple Pay, various merchant-line and amount-line phrasings) — see the design docs in `docs/superpowers/specs/` for the sample messages it was built/tested against. Category guessing checks the user's learned-merchant overrides (`Store.getLearnedMerchants()`, trained whenever a user manually recategorizes an expense with a merchant note) before falling back to the built-in Saudi merchant/keyword dictionary.

### Theming

Four color themes (`teal` default, `royal`, `gold`, `ocean`) × light/dark, selected via `data-theme`/`data-mode` attributes on `<html>` and CSS custom properties in `css/style.css`. `data-mode="auto"` follows `prefers-color-scheme`. RTL throughout (`dir="rtl"`), IBM Plex Sans Arabic font.

### Navigation

Tab switching (`goToView()` in `app.js`) and finger-swipe between the four main tabs (home/stats/record/categories) both drive the same lightweight, direction-aware CSS transition (`.view.nav-in`, one keyframe, no animation-stacking). The heavier "full" entrance choreography (staggered card pop-ins, donut spin-in, hero sheen) only plays on cold app start and when paging between stats cycles — deliberately *not* on every tab switch, since stacking it with the transition caused visible flicker. Swipe gestures are gated to ignore open sheets/modals, the lock screen, onboarding, record-row swipe-to-delete, and the app's own horizontally-scrollable strips, so gestures never collide.

## Conventions

- All UI text, code comments, commit messages, and the design docs in `docs/superpowers/specs/` are in Arabic — match this when editing.
- No external JS/CSS dependencies beyond the Google Fonts webfont link in `index.html`. Keep it that way (the app's fast/offline-first PWA identity depends on it) — charts are hand-rolled inline SVG (`js/stats.js`), not a charting library.
- Verification is manual, via the Claude Code preview browser tool against the local static server — there are no automated tests to run.
