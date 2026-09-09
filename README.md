# Deal Finder

A fast-scanning deal aggregator: one feed, pulling from 9 sources, built for
scanning quickly rather than passively waiting for Discord alerts. Dark
theme, product thumbnails on every source. Also has a `/cards` page for
finding underpriced sports card listings on eBay.

## /cards — underpriced trading card finder

Different shape from the main deal feed: instead of comparing a price
against its own history (like Keepa does), this compares a **live eBay
listing** against an **independent reference price** (PriceCharting).
Search a card name; it looks up PriceCharting's ungraded market value and
eBay's current Buy It Now listings for that search, then flags any listing
priced 20%+ below the reference.

**Graded slabs (PSA/BGS/SGC/CGC) and multi-card lots are excluded from the
comparison.** Graded cards sell for multiples of an ungraded reference
price, so comparing them would produce false "amazing deal" signals rather
than real ones; a lot of several cards for one price isn't comparable to a
single-card reference at all. Grading is detected via eBay's own
`condition` field (confirmed reliable: literally "Graded" vs "Ungraded"),
not a title guess — an earlier title-regex version of this filter missed
titles like "PSA Graded Mint 9" (words between "PSA" and the grade number)
and let real graded slabs slip through undetected.

### Setup

Needs two things in `.env`:

```
PRICECHARTING_API_KEY=your-existing-key
EBAY_CLIENT_ID=...
EBAY_CLIENT_SECRET=...
```

Get the eBay credentials free at [developer.ebay.com](https://developer.ebay.com) →
Application Keys → use the **Production** App ID and Cert ID (not Sandbox).

### An important gotcha this was built around: pricecharting.com vs sportscardspro.com

The reference-price lookup (`lib/sources/pricecharting.ts`) queries
**`sportscardspro.com`**, not `pricecharting.com` — same company, same
account, same API key, same request/response format, but a domain scoped
specifically to sports cards. This isn't a style choice: querying
pricecharting.com's own domain for a sports card search returns almost
entirely irrelevant results (Funko figures, unrelated products that happen
to share a player's name — sometimes zero real matches in the first 100
results for a very well-known card). Pokémon card search on
pricecharting.com itself works fine; sports cards specifically don't,
confirmed by testing identical queries against both domains with the same
key side by side. If this project ever needs Pokémon card support too,
that would go back to querying pricecharting.com instead.

Both this and the eBay integration were verified against real accounts —
the reference price search, the eBay listing search, and the
graded/bundle filtering were each checked against actual results, not
assumed to work from documentation alone.

### Watchlist — automatic background checking

Beyond the one-off manual search above, `/cards` also has a **watchlist**:
add a card, and it gets checked automatically roughly every 30 minutes.
Anything found underpriced gets saved to a review list that persists until
you dismiss it — server-stored now (not just your browser), so it's the
same list regardless of which device you check it from.

This needed two things the rest of the project doesn't use: an actual
database, and a way to run checks on a schedule with nobody's browser
open.

**Database**: [Upstash Redis](https://vercel.com/marketplace/upstash) via
Vercel's Storage tab (free tier: 256MB, 30K commands/day — far more than
this needs). Connecting it auto-injects `KV_REST_API_URL` /
`KV_REST_API_TOKEN`, which `lib/db.ts` reads automatically — no manual
key-copying for this one.

**Scheduling**: Vercel's own Cron Jobs cap out at once per day on the free
Hobby plan (any more frequent schedule fails at deploy time) — too coarse
for catching a listing before someone else buys it. Instead,
`.github/workflows/check-watchlist.yml` runs on a GitHub Actions schedule
every 30 minutes (no such cap there, and it's free) and calls
`POST /api/cards/check-watchlist` on the deployed site. That endpoint sits
outside the site's normal cookie-based login (see `proxy.ts`) since a
script has no browser session to present — it checks its own secret
instead.

#### Setup

1. In Vercel: **Storage** tab → **Create Database** → **Upstash** → **Redis**
   → free tier → **Connect** to this project. This injects the two
   `KV_REST_API_URL`/`KV_REST_API_TOKEN` variables automatically.
2. Pick a random secret value and add it as `CRON_SECRET` in **both**:
   - Vercel's environment variables (so the endpoint recognizes it)
   - This GitHub repo's **Settings → Secrets and variables → Actions** (so
     the workflow can send it) — same value in both places
3. Also add a second GitHub Actions secret, `DEAL_FINDER_URL`, set to your
   deployed site's URL (e.g. `https://deal-finder-yourname.vercel.app`,
   **no trailing slash**)
4. Redeploy (any push does this, or trigger one manually)
5. To test without waiting up to 30 minutes: on GitHub, go to **Actions**
   tab → "Check card watchlist" workflow → **Run workflow** button
   (works because of the `workflow_dispatch` trigger in the yml file)

## Stack

- Next.js 16 (App Router) + TypeScript + Tailwind
- Upstash Redis (via Vercel's Marketplace) for the card watchlist and saved
  finds — everything else has no database and is fetched live per request;
  the main deal feed's "dismissed" state lives in the browser's
  `localStorage` (per-device, not shared/synced) rather than here
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
- `app/cards/page.tsx`, `components/CardSearch.tsx` — manual card search
- `lib/cardComparison.ts` — eBay-vs-PriceCharting comparison + filtering
- `lib/sources/pricecharting.ts`, `ebay.ts` — the two card data sources
- `lib/db.ts` — Upstash Redis: watchlist, saved finds, dismissed-ids
- `components/CardWatchlist.tsx` — watchlist manager + saved-finds review UI
- `app/api/cards/check-watchlist/route.ts` — the scheduled check endpoint
- `.github/workflows/check-watchlist.yml` — the every-30-min GitHub Action
