# Deal Finder

A fast-scanning deal aggregator: one feed, pulling from 9 sources, built for
scanning quickly rather than passively waiting for Discord alerts.

## Stack

- Next.js 16 (App Router) + TypeScript + Tailwind
- No database — sources are fetched live on each request; "dismissed" state
  lives in the browser's `localStorage` (per-device, not shared/synced)

## Getting started

```bash
npm install
npm run dev
```

Visit http://localhost:3000. Works immediately with no setup — 8 of the 9
sources need no API key. The 9th (Keepa) needs your key, see below.

## Sources

| Source | Needs a key? | Covers |
|---|---|---|
| Slickdeals Freebies | No | Free samples, free food/restaurant offers |
| Slickdeals Hot Deals | No | General deals firehose |
| r/deals, r/GameDeals, r/buildapcsales | No | Reddit deal communities |
| DansDeals | No | Credit card bonuses, cashback/points stacking |
| CheapShark | No | PC games currently $0 across Steam, GOG, Epic, etc. |
| Epic Games Store | No | Epic's own free-game giveaways |
| **Keepa** | **Yes** | Real Amazon price-drop search across their whole catalog |

### Setting up Keepa

```bash
cp .env.example .env
```

Add your Keepa API key to `.env` as `KEEPA_API_KEY`. `KEEPA_MIN_DISCOUNT`
(default 40) sets the minimum percent-off threshold for results.

**Important — this integration is unverified against a real key.** Keepa's
API docs site (keepa.com/api-docs) returns 403 to automated fetches, so this
was built directly from their official Python client's source code
(github.com/akaszynski/keepa) — which confirms the request/response shape
(endpoint, auth, the `dr` array of deals with `asin`/`title`/`current`/
`deltaPercent`), but two filter flags (`isRangeEnabled`, `isFilterEnabled`)
are included based on their names, not confirmed against real behavior,
since I have no Keepa key to test with myself. See the comments in
`lib/sources/keepa.ts` for exactly what's confirmed vs. inferred.

**When you first run this with a real key**, check:
- Do results actually respect `KEEPA_MIN_DISCOUNT`, or come back unfiltered?
  If unfiltered, `isRangeEnabled`/`isFilterEnabled` are the first thing to
  try toggling.
- Do prices look right, or off by 100x? (Assumed Keepa returns cents.)
- Is `sortType: 4` actually giving biggest-drop-first? (The website's own
  "Biggest discount" sort button doesn't depend on this being right — it
  re-sorts client-side regardless — so this only affects ordering *within*
  Keepa's raw response before the website re-sorts it.)

If something's off, tell me what the actual response looks like and I'll
fix the mapping — this is a five-minute fix once we can see real output,
just not something I could get right blind.

## Using it efficiently

- **Source pills** (top) toggle which sources are shown — click to turn a
  source off/on. All start on.
- **Sort**: Newest (default) or Biggest discount (Keepa/CheapShark/Epic
  deals have a real percentage; RSS-sourced deals don't, and sort after the
  ones that do).
- **Dismiss** a single deal, or **Mark all read** to clear everything
  currently visible — both persist across reloads (localStorage), so a
  daily sweep only shows what's new since last time.
- **Refresh** re-fetches all sources on demand; the page doesn't auto-poll
  in the background (this is a page you open to check, not a bot).

Dismissed-state is per-browser, not per-account — clearing browser data or
switching browsers resets it.

## Project structure

- `app/page.tsx` — renders the feed
- `app/api/deals/route.ts` — aggregates all sources server-side, returns JSON
- `components/DealFeed.tsx` — the feed UI (filtering, sorting, dismiss)
- `lib/config.ts` — the list of sources
- `lib/aggregate.ts` — fetches all sources in parallel, isolates failures
- `lib/sources/rss.ts` — RSS/Atom fetcher (Slickdeals, Reddit, DansDeals)
- `lib/sources/cheapshark.ts`, `epic.ts` — free-game APIs
- `lib/sources/keepa.ts` — Amazon price-drop search (needs your API key)
