# Deal Finder

A fast-scanning deal aggregator: one feed, pulling from 9 sources, built for
scanning quickly rather than passively waiting for Discord alerts. Dark
theme, product thumbnails on every source.

## Stack

- Next.js 16 (App Router) + TypeScript + Tailwind
- No database — sources are fetched live on each request; "dismissed" state
  lives in the browser's `localStorage` (per-device, not shared/synced)
- Dark theme only (no light mode / system-preference toggle) — this is a
  personal tool, not a public product, so committing to one look kept
  things simple

## Product images

Every source now carries a thumbnail, extracted from whatever that API
actually provides — verified against live data for each, not assumed:

- **Slickdeals / DansDeals** (RSS 2.0): the full-HTML `content:encoded`
  field usually opens with an `<img>` tag; regex-extracted, since the
  plain-text `description`/`contentSnippet` fields don't carry it
- **Reddit** (Atom): same idea, but the full HTML is in `content` directly
  — Atom has no separate encoded-content field the way RSS 2.0 does
- **CheapShark**: `thumb` field, straight from their API
- **Epic Games**: the `keyImages` array's `"Thumbnail"` entry
- **Keepa**: decoded from their `image` field (an array of ASCII character
  codes, not literal bytes — see `lib/sources/keepa.ts`)

A source with no image for a given post (rare, but happens) just omits the
thumbnail rather than showing a broken-image icon.

## Reddit sources are currently disabled

`r/deals`, `r/GameDeals`, `r/buildapcsales` are commented out in
`lib/config.ts`. What happened: Reddit blocks/rate-limits (403/429)
anonymous scraping traffic from cloud hosting IPs like Vercel's, regardless
of request volume — this showed up in production even though local testing
looked fine. The real fix is Reddit's OAuth API (`lib/sources/reddit.ts`,
already built), which gets treated as a legitimate authenticated client
rather than a scraper. That requires a Reddit "script" app — but Reddit's
current app-registration flow includes a review questionnaire (not just an
instant create-and-go), so this is on hold pending that approval.

To re-enable once approved: add `REDDIT_CLIENT_ID` / `REDDIT_CLIENT_SECRET`
to `.env` (and to Vercel's environment variables + redeploy), then
uncomment the three `reddit-*` entries in `lib/config.ts`.

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
(default 40) sets the minimum percent-off threshold, and `KEEPA_MAX_SALES_RANK`
(default 300000) filters out obscure items — see "Filtering out fake-looking
deals" below for why that second one matters.

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

### Filtering out fake-looking deals

A big "% off" from Keepa isn't always a real deal — the "original price" it's
measured against can be a one-off data glitch, or an inflated list price
nobody ever actually paid (self-published books are especially bad for
this: a $150 "list price" that was never real, discounted to $4.60, reads
as "97% off" but was never a $150 item to begin with). Two independent
checks now filter these out:

1. **Request-level**: `salesRankRange` (capped by `KEEPA_MAX_SALES_RANK`)
   excludes items with near-zero real sales, and `hasReviews: true` requires
   at least one actual customer review.
2. **Response-level**: `salesRankDrops90` — the number of times the item's
   sales rank actually dropped (a real sale happening) in the last 90 days —
   must be greater than zero. This field is confirmed present on every deal
   object from live testing, so it's a hard requirement, not a guess.

Verified against live data: the three most obviously-wrong results from
before this filter existed (a $150 community directory book, a random
Italian novel, an obscure trilogy book — all down to $4-13 with 90%+ "off")
are gone now, replaced by recognizable branded products (adidas, Field &
Stream, Amazon Essentials) with visible sales rank and a real recent-sale
count. The feed also now shows that sales rank + sale count directly under
each Keepa deal's title, so you can sanity-check it yourself without
clicking through to Amazon.

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

## Deploying publicly

Every source is cached for 10-15 minutes at the fetch layer (`next:
{revalidate}`), so repeated page loads within that window don't re-hit the
underlying APIs — this matters most for Keepa, a paid, token-limited
resource, but is also just polite to the free sources.

That caching alone isn't enough once this has a public URL, though — a
bot or crawler finding the link could still trigger fresh fetches often
enough to matter. So the whole site (including `/api/deals`) sits behind a
single shared password:

```
SITE_PASSWORD=pick-something-real
```

Set in your hosting platform's environment variables (never in a file that
gets committed). Leaving it unset only makes sense for local-only use — the
site is wide open without it.

## Project structure

- `app/page.tsx` — renders the feed
- `app/api/deals/route.ts` — aggregates all sources server-side, returns JSON
- `components/DealFeed.tsx` — the feed UI (filtering, sorting, dismiss)
- `lib/config.ts` — the list of sources
- `lib/aggregate.ts` — fetches all sources in parallel, isolates failures
- `lib/sources/rss.ts` — RSS/Atom fetcher (Slickdeals, Reddit, DansDeals)
- `lib/sources/cheapshark.ts`, `epic.ts` — free-game APIs
- `lib/sources/keepa.ts` — Amazon price-drop search (needs your API key)
- `lib/auth.ts`, `proxy.ts`, `app/login/` — the password gate
