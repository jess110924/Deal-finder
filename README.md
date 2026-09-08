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

**Verified against a real account on 2026-09-08.** Keepa's API docs site
(keepa.com/api-docs) returns 403 to automated fetches, so this was built
from their official Python client's source code (github.com/akaszynski/keepa)
first, then corrected against real output once a key was available. One real
bug turned up that way: `current` is a flat array indexed by price type, but
`delta`/`deltaPercent`/`avg` are each a *nested* array of 4 windows —
`deltaPercent[window][priceType]`, not `deltaPercent[priceType]`. Reading it
at the wrong depth silently returned `undefined` for every deal (caught by a
defensive type-check, so it failed quiet rather than crashing) — every
result showed no discount at all, even though the actual filtering was
working correctly the whole time. Fixed and confirmed: a live run returned
150 deals, all with real 40–100% discounts matching the requested range.

`isRangeEnabled` / `isFilterEnabled` are also now confirmed to actually gate
`deltaPercentRange` (not just plausibly named) — verified by the returned
percentages landing inside the requested range once read from the right
place. Product images also work: Keepa's `image` field is an array of ASCII
character codes that decodes to a real filename on their image CDN.

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
