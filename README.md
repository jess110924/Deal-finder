# Deal Finder

A fast-scanning deal aggregator: one feed, pulling from 14 active sources
(17 configured — 3 Reddit ones are built but currently disabled, see
Sources below), built for scanning quickly rather than passively waiting
for Discord alerts. Dark theme, product thumbnails on every source. Also
has a `/cards` page for finding underpriced sports card and Pokémon card
listings on eBay.

## /cards — underpriced trading card finder

Different shape from the main deal feed: instead of comparing a price
against its own history (like Keepa does), this compares a **live eBay
listing** against an **independent reference price** (PriceCharting).
Search a card name; it looks up PriceCharting's ungraded market value and
eBay's current Buy It Now listings for that search, then flags any listing
priced 20%+ below the reference.

Covers two categories, picked via a toggle on both the search box and the
watchlist add form: **Sports** and **Pokémon**. Each uses a different
PriceCharting domain and a different eBay category id under the hood (see
the gotcha section below) — everything else (the 20%-below-reference
threshold, graded/bundle filtering, the watchlist, saved finds) works
identically for both.

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
**`sportscardspro.com`** for the Sports category, not `pricecharting.com`
— same company, same account, same API key, same request/response format,
but a domain scoped specifically to sports cards. This isn't a style
choice: querying pricecharting.com's own domain for a sports card search
returns almost entirely irrelevant results (Funko figures, unrelated
products that happen to share a player's name — sometimes zero real
matches in the first 100 results for a very well-known card).
`pricecharting.com` itself is used for the **Pokémon** category instead —
confirmed live (a "1999 Base Set Charizard" query returns a real, sane
$489 ungraded reference), since sportscardspro.com is sports-only and
wouldn't return good Pokémon matches.

The eBay side has an equivalent split: Sports searches use category id
`212` ("Sports Trading Cards"); Pokémon searches use `183454` ("CCG
Individual Cards") — confirmed by searching "charizard pokemon card" with
no category filter and checking which categories real listings actually
fall under.

Both this and the eBay integration were verified against real accounts —
the reference price search, the eBay listing search, and the
graded/bundle filtering were each checked against actual results, not
assumed to work from documentation alone.

### Verifying the reference is actually the right card

Every place a reference product shows up — the manual search page, each
saved find on the watchlist, each one Discover surfaces — links straight
to that product's own page on PriceCharting/SportsCardsPro
(`productUrl`, built by `buildProductUrl` in `lib/sources/pricecharting.ts`),
plus a real photo where one's available. Requested directly: the "Verify"
link originally pointed to an eBay listing instead of PriceCharting
itself.

PriceCharting's API doesn't return a page URL directly — this is built
from the product's own console/product name (`/game/<console-slug>/
<product-slug>`, lowercased and hyphenated), confirmed live rather than
assumed: fetched the constructed URL for both a sports card
(sportscardspro.com) and a Pokémon card (pricecharting.com) and checked
the resulting page's `<title>` actually matched the product. It's built
deterministically and never fetched or verified server-side per card —
partly because there's no need to, and partly because trying to fetch it
server-side hits Cloudflare's bot challenge (confirmed live, even for
occasional traffic from here) that a real browser navigating there
doesn't, since that's exactly what the challenge is built to tell apart.

The photo comes from a separate, older mechanism: newer/more searched-for
products come back from PriceCharting's API with an `epid` — an eBay
catalog product id. eBay's Catalog API would resolve that directly to a
product photo, but it needs a permission scope this app's key doesn't
have (confirmed live: 403 "Insufficient permissions"). Filtering a normal
Browse API search by that same epid works with the same basic scope
already used everywhere else, and returns the exact matching product —
confirmed live against the Luka Doncic Prizm card, whose epid it returned
back exactly. Not every product has an epid (confirmed absent on some
older ones, e.g. 1999 Base Set Charizard) — when it's missing, there's no
photo, but the PriceCharting link (and, failing that, a plain eBay
search) is always shown regardless, so there's always something to click
through and double-check by hand.

Every saved find — from the watchlist or from Discover (below) — carries
this same reference info (`reference` on `SavedFind` in `lib/db.ts`), not
just the manual search page. Discover in particular needs it: it matches
freeform eBay titles to PriceCharting products with no human choosing the
search term, so mismatches are more likely there than for a deliberately-
typed watchlist name — the reference link is the way to catch one before
trusting it. Finds saved before `productUrl` existed fall back to the
older eBay-sourced links (the field is optional on `ReferenceInfo` for
exactly this reason).

### Watchlist — automatic background checking

Beyond the one-off manual search above, `/cards` also has a **watchlist**:
add a card, and it gets checked automatically roughly every 30 minutes from
then on. Anything found underpriced gets saved to a review list that
persists until you dismiss it — server-stored now (not just your browser),
so it's the same list regardless of which device you check it from.

Adding a card also runs one check immediately (takes a few seconds — it's
a real eBay + PriceCharting search, the "Add" button shows "Checking…"
while it runs) rather than only registering the card and leaving you
waiting up to 30 minutes with nothing to look at. If that immediate check
happens to fail for some reason, the card still gets added to the
watchlist regardless — it'll just pick up on the next scheduled run
instead, and a message says as much rather than acting like the add
itself failed.

There's also a **bulk add** option ("Add multiple cards at once" link
under the search box) for seeding the watchlist with many cards in one
shot instead of typing them one at a time — paste one card per line (or
comma-separated). Bulk-added cards skip the immediate check (running a
real search for 15-20+ cards sequentially would risk timing out) and
just get picked up on the next scheduled run, same as any other add that
happens to miss its instant check.

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

### Discover — finding deals without naming a card first

The watchlist only ever checks cards it's explicitly told about — it
can't surface a card worth watching that nobody's added yet. Discover
(`lib/cardDiscovery.ts`, `app/api/cards/discover/route.ts`, runs hourly
via `.github/workflows/discover-deals.yml`) fills that gap: it browses
eBay's live listings directly (no keyword, just the category — Sports or
Pokémon), checks each one against its own PriceCharting match, and saves
anything underpriced to the same "Saved finds" list as the watchlist.

A few things this needed that a name-driven search doesn't — each found
by actually running it live and looking at the real results, not assumed:

- **What to browse.** eBay's Browse API allows a category-only browse
  with no `q` — confirmed live. Sorted by price ascending it was almost
  entirely near-worthless base commons (~$2-3); sorted by price
  descending it surfaced ultra-rare autographs/jerseys/1-of-1s instead —
  and *every one* of those came back matched against a wildly lower,
  clearly-wrong PriceCharting reference (a $1500 1-of-10 autographed
  jersey matched to an unrelated $6.50 base card), because PriceCharting's
  catalog doesn't really cover one-of-a-kind memorabilia. Settled on
  **sorted by newest-listed, within a $20-$300 band** (`lib/sources/ebay.ts`,
  `browseCategory`) — the range PriceCharting's catalog actually covers
  well (standard rookies/parallels), not the extremes.
- **The Pokémon category isn't Pokémon-only.** eBay's `183454` ("CCG
  Individual Cards") turned out to be a shared bucket across every
  non-sports card game — a keyword-free browse of it came back full of
  Naruto, Dragon Ball, One Piece, and Weiss Schwarz cards mixed in with
  Pokémon (confirmed live). Anchoring the Pokémon browse with `q=pokemon`
  fixed this completely (confirmed live: 15/15 results genuinely Pokémon
  afterward) — that's a category-level anchor baked into the code, not a
  card name you have to supply. Sports Trading Cards (212) didn't have
  this problem — results were plain football/baseball/hockey/soccer, all
  genuinely sports.
- **Junk that isn't a card.** A plain category browse also turned up
  non-card listings — a "Retail Shop Display Case" (an accessory) and a
  "Baseball Card and Memorabilia Collection" (a lot) both showed up live
  in testing. `isBundle()` (in `lib/cardComparison.ts`) already catches
  lot/bundle titles; a second pattern in `lib/cardDiscovery.ts`
  (`NON_CARD_PATTERN`) catches the accessory/collection kind it doesn't.
- **Match quality is genuinely lower than a deliberate search.** This is
  worth being honest about: testing live, feeding a full freeform eBay
  title (year, set, parallel name, serial number, and all) into
  PriceCharting's search frequently returned an unrelated product as the
  top match rather than the right one — more often than not, in the
  batches tested. The threshold direction protects against this turning
  into a false "deal" (a bad match only becomes a problem if it happens
  to look *underpriced*, and in every mismatch observed during testing it
  went the other way — the listing was worth far more than whatever
  unrelated product got matched, not less), so nothing false-positive
  showed up in testing. But it does mean Discover may go a while between
  genuine finds, and a higher bar than the usual 20%
  (**25%**, `DISCOVERY_THRESHOLD_PERCENT`) adds a small further margin.
  The real safeguard either way is the reference photo/link attached to
  every discovered find — check that before trusting one, every time.
- **API cost.** Each run makes one PriceCharting lookup per browsed
  listing (~25 per category × 2 categories per hourly run), on top of
  what the watchlist already uses — noticeably more than the watchlist
  alone. That's why it runs hourly rather than every 30 minutes. Both the
  batch size (`limit` in `discoverDeals`) and the cron schedule are easy
  to tune up or down depending on what PriceCharting's plan actually
  allows.
- **This actually broke in production, silently, for a while.** Both this
  endpoint and check-watchlist failed on every single scheduled run from
  the day they were set up — not a code bug, a missing GitHub Actions
  secret (`DEAL_FINDER_URL` was never actually added, so the workflow's
  curl command had no host to send the request to and failed instantly
  with a malformed-URL error; `CRON_SECRET` was missing too). Diagnosed
  by checking the GitHub Actions run history directly
  (`api.github.com/repos/.../actions/workflows/.../runs`) rather than
  guessing. Once those two secrets were actually added, a second, real
  bug surfaced: the original `discoverDeals` checked each browsed listing
  against PriceCharting one at a time in a loop — up to 25 sequential
  round-trips per category, ~50 total per run — which was slow enough to
  exceed Vercel's serverless function timeout outright (confirmed live: a
  production run got no response at all after 60 seconds). Fixed with
  bounded concurrency (`mapWithConcurrency` in `lib/cardDiscovery.ts`,
  6 at a time — fully unbounded, all 25 at once, risks looking like
  abusive traffic to PriceCharting instead) plus running both categories
  in parallel rather than sequentially, and an explicit
  `export const maxDuration = 60` (Vercel Hobby's ceiling) as a backstop.
  Confirmed live after the fix: full run in ~18 seconds.

No separate setup needed — it reuses the same `PRICECHARTING_API_KEY`,
`EBAY_CLIENT_ID`/`EBAY_CLIENT_SECRET`, `CRON_SECRET`, and
`DEAL_FINDER_URL` GitHub secret already configured for the watchlist.

### Player Search — the manual "browse a player, then check the margin" workflow

Built to replace a specific manual process directly: search a player,
scan for cards in a $30-$100 sweet spot, pick one, then check what
similar listings of that exact card go for before buying. `PlayerSearch`
(`components/PlayerSearch.tsx`, `lib/playerSearch.ts`,
`app/api/cards/player-search` + `app/api/cards/peer-check`) does the
first part as a plain price-banded eBay browse (no PriceCharting
reference — a player name isn't one product) and the second as an
on-demand "Check similar listings" button per result.

The "similar listings" comparison is against other **currently active**
asking prices, not recent sold prices — no eBay API key gets access to
sold/completed listing data (confirmed live: the scope that would need,
`buy.marketplace.insights`, comes back `invalid_scope` for this app's
key — it's a separately-approved, restricted API most developer accounts
don't have). A real caveat worth remembering: if every seller of a card
happens to be overpricing it right now, this baseline is inflated right
along with them.

### The keyword-extraction fix — why raw eBay titles make bad search queries

Reported directly, and confirmed live to be a serious problem, not a
minor one: feeding a full eBay title into either PriceCharting's search
or eBay's own search frequently returns the *wrong* product. Two
separate live failures drove this:

1. PriceCharting matched a rare 1-of-10 autographed jersey card against
   an unrelated $6.50 base card that happened to share enough words.
2. eBay's own keyword search, used for the peer/similar-listings
   comparison above, pulled a $2.25 "Blue Shimmer Prizm" into the
   "peers" of a "Gold Wave Prizms" card — and even after narrowing to
   just the distinctive phrase ("Blue Refractor"), it still pulled in a
   different, far cheaper "Red White & Blue Refractor" parallel, since
   that phrase contains the shorter one as a substring.

`lib/cardKeywords.ts` (`extractSearchKeywords`) fixes this by rewriting
a raw title into a short, targeted query: **subject + color/finish words
that actually identify the specific parallel + serial number**, dropping
year/brand/set noise. Confirmed live against the reported example:
`"Jalen Johnson 2025-26 Topps Chrome ORANGE Leather Refractor /25 Serial
Numbered"` → `"Jalen Johnson orange refractor /25"`.

A few things that made this trickier than it looks:

- **Word-boundary matching, not substring.** A naive `.includes()` check
  matched the color "red" inside "Serial **Numbe­red**" — confirmed live,
  it added a bogus "red" to every single query built from a title
  carrying that boilerplate phrase. Fixed with `\b`-anchored regexes.
- **"mint" is deliberately not a recognized color** — it's an extremely
  common condition term ("Near Mint", "Gem Mint") that would falsely
  match as the "Mint" parallel color on a large fraction of listings.
- **The serial-number denominator ("/150") is a second, independent
  safety net**, applied to the actual search *results* regardless of
  whether the query rewrite above could identify a subject to rewrite
  around. This matters: plenty of real titles start with the year, not
  the player, where the rewrite can't confidently proceed at all — but
  filtering results by a shared "/150" still cleanly separates real
  peers from same-named-but-different parallels, confirmed live.
- **Only activates when there's an actual parallel/serial signal to
  preserve**, and only when a subject (given directly by Player Search,
  or guessed for Discover) can be identified. A plain base-card query
  passes through unchanged — there's nothing to disambiguate, and the
  full query already works fine for those (extensively tested earlier
  in this project). This also means the main search box and watchlist
  only get rewritten when a print-run number is present — a short
  deliberate query like "2018 Panini Prizm Luka Doncic" is left alone,
  since rewriting it risks dropping the year and matching the wrong
  season's card instead.
- **Residual limitation, left visible rather than hidden:** even after
  both fixes, different sets/years can coincidentally share the same
  parallel name *and* the same print-run size (e.g. "Blue Refractor
  /150" exists across several different Topps/Bowman products across
  different years) — confirmed live, a peer-check still returned a
  genuine mix of these. Rather than trying to solve this perfectly, the
  full peer list is shown in the UI ("Show all N — check these are
  actually the same parallel") so a mismatch like this stays visible and
  checkable instead of silently skewing a hidden average.
- **A real bug this whole mechanism had, caught live:** the subject-
  guessing fallback (used when no subject is known, e.g. the main search
  box) took whatever text sits before the year as the subject — but that
  isn't always the player. Reported directly: `"Panini 2024-25 Noir
  Shadow Signatures Jalen Johnson Hawks SHA-JJO Auto 58/99"` guessed
  **"Panini"** (the manufacturer, sitting right before the year) as the
  subject, producing the query `"Panini /99"` — every actual identifying
  word, including the player's name, gone. That matched a completely
  unrelated card. Fixed by rejecting a guess when every word in it is a
  known manufacturer name (`BRAND_WORDS` in `lib/cardKeywords.ts`) — a
  mixed lead like "Panini Jalen Johnson" still keeps a real word to go
  on and isn't rejected, only a lead that's *entirely* brand names is.
  Confirmed live: the same query now correctly returns "Jalen Johnson
  [Gold] #7" from the right product line.

This is used in three places: Player Search's peer-check (has a known
subject from the search box), Discover's per-listing PriceCharting
lookup (no known subject — falls back to a best-effort guess, or leaves
the title unchanged if it can't tell), and the main search box / watchlist
(only when the query itself carries a serial number).

### PriceCharting result ranking — why it was matching the wrong card even with a good query

Reported directly ("a lot of the cards I search there's a lot of
mismatches") and confirmed live to be real and frequent, not rare edge
cases: `findCard` (`lib/sources/pricecharting.ts`) used to just trust
whatever PriceCharting's own `/products` search put first — but that
ranking isn't reliably relevance-to-the-player. Two live examples that
exposed this directly, with a good, already-cleaned query:

- `"Ja Morant Select Concourse"` put a completely unrelated Brian Thomas
  Jr. **football** card first. The real Ja Morant match existed in the
  results — 5th place, not 1st.
- `"Shohei Ohtani Topps Chrome"` (no year given) put a $492 2026 base
  card ahead of his $89,688 2018 rookie.

Fixed by scoring every candidate PriceCharting actually returned instead
of trusting position 0: `relevanceScore` counts what fraction of the
*query's own* words appear in each candidate's product+console name
(deliberately not the reverse — a candidate naturally carries extra
words, like year and set, that the query didn't ask for and shouldn't be
penalized for), and `findCard` now picks whichever candidate scores
highest. Confirmed live this promotes the real Ja Morant card to the
top, and left the two Jalen Johnson/Cade Cunningham cases from the
sections above correctly unaffected (checked all three again after
shipping this fix, in the real app, not just the scoring function in
isolation).

**What this doesn't fix**: genuine query ambiguity. The Ohtani example
has no year to go on, so several of his different-year Topps Chrome
cards score identically — nothing server-side can resolve that without
more specific input (the UI's own placeholder text already models
this: "e.g. 2018 Panini Prizm Luka Doncic" includes a year for exactly
this reason). Scoring fixes "matched a completely different player,"
not "matched the right player's wrong year" when the query itself
doesn't say which year.

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
| r/deals, r/GameDeals, r/buildapcsales | No | Reddit deal communities — disabled, see below |
| DansDeals | No | Credit card bonuses, cashback/points stacking |
| DealNews | No | Editorially-vetted deals across retailers, all categories |
| 9to5Toys | No | Tech/gadget deals, mostly Apple/Amazon-adjacent |
| Slickdeals PC Parts | No | GPU/CPU/motherboard/SSD/PSU/RAM deals + PC builds |
| Ben's Bargains | No | General deals firehose, Slickdeals-style |
| Slickdeals: Target | No | Deals mentioning Target specifically |
| Slickdeals: Walmart | No | Deals mentioning Walmart specifically |
| Slickdeals: Food & Grocery | No | Grocery items, restaurant gift cards/offers |
| Slickdeals: More Categories | No | Clothing, shoes, kitchen, toys, beauty, pet, travel |
| CheapShark | No | PC games currently $0 across Steam, GOG, Epic, etc. |
| Epic Games Store | No | Epic's own free-game giveaways |
| **Keepa** | **Yes** | Real Amazon price-drop search across their whole catalog |

**DealNews and 9to5Toys** were added specifically to increase deal volume
(confirmed live before adding: ~49 and ~50 deals per fetch respectively,
real currently-active listings, not stale/cached content) — both are
plain RSS 2.0, no key needed, added the same way DansDeals was. One real
bug this surfaced: 9to5Toys' `<description>` is CDATA-wrapped, so HTML
entities inside it (its image URL had a literal `&#038;` instead of `&`)
never get XML-decoded the normal way — confirmed live, and fixed with an
entity-decode step in `lib/sources/rss.ts`'s `extractImage()` rather than
sending a malformed query string to the image CDN.

**Slickdeals PC Parts** was requested directly ("find PC parts for
cheap") and needed a different approach than DealNews/9to5Toys: Slickdeals
has no dedicated PC-parts *forum* to filter by (its forums are discussion
sections — Hot Deals, Freebies, Tech Support — not product categories),
but its site-wide keyword search does work well for this, confirmed live
per term (GPU, CPU, motherboard, SSD, "power supply", "RAM DDR5" each
returned real, relevant results; joining terms with "OR" into one query
was tried and does not work — it returns unrelated noise instead).
Rather than six separate always-visible source toggles in the feed UI,
`lib/config.ts`'s `SourceConfig` gained an optional `urls: string[]`
(alongside the existing single `url`) — `aggregate.ts` fetches all of
them with `Promise.allSettled` (so one bad sub-fetch doesn't fail the
whole merged source) and dedupes by item id, since a single full-PC-build
deal often matches several of the keyword searches at once. Confirmed
live: 113 deduped results, real GPU/CPU/RAM/SSD/motherboard/PSU deals and
some full-PC-build listings mixed in (expected — a prebuilt desktop's
listing mentioning its GPU/CPU specs legitimately matches those searches
too).

**Ben's Bargains** — a long-running, Slickdeals-style aggregator, added
after being asked directly for other sites like Slickdeals. Same pattern
as DealNews/9to5Toys: verified live before adding (real, currently-active
RSS 2.0 feed, 20 items per fetch, working images) rather than assumed
from its reputation alone. One of its items matched this app's existing
"stackable deal" detection (`lib/stackable.ts`, Subscribe & Save + coupon
code) on the very first live test.

**Slickdeals: Target / Slickdeals: Walmart** were requested directly
("any way to check target and Walmart?"). Kept as two separate sources
rather than merged like PC Parts — Target and Walmart deals don't
overlap (a deal is at one store, not both) and toggling one off without
the other is a reasonable thing to want. One real false positive turned
up live and got fixed before shipping: Slickdeals' search stems "Target"
to also match "targeted" (as in "this offer may be a *targeted* promo"),
completely unrelated to the retailer — a BJ's Wholesale membership renewal
showed up in the Target results this way. `SourceConfig` gained an
optional `retailerMatch` field; when set, `aggregate.ts` requires that
word to literally appear (word-boundary, case-insensitive) in the title
or description before keeping a result — confirmed live this removed the
BJ's false positive (and one more like it) while keeping every genuine
match, including titles that don't obviously mention the store by
themselves (Slickdeals' search matches a deal's full body/link, not just
its title — a plain "Kenmore Microwave" listing turned out to genuinely
link to target.com once checked).

**Slickdeals: Food & Grocery / Slickdeals: More Categories** were added
after being asked directly for maximum coverage ("food and all others...
anything and everything"). Checked for a dedicated grocery/food deals
site first — Krazy Coupon Lady's `/feed/` just redirects to their
JS-rendered homepage (no real feed behind it), Groupon has no RSS at
all — so both use the same keyword-search approach as PC Parts/Target/
Walmart. Worth knowing about the tradeoff made here: Slickdeals caps
*every* RSS feed at 25 items regardless of any parameter tried
(confirmed live), so a less-frequent category like food was already
liable to get crowded out of the generic Hot Deals firehose by
higher-volume ones even though it's technically posted there — a
dedicated search guarantees it a slice of visibility regardless. More
Categories in particular is intentionally broad-net rather than
precision-tuned: unlike Target/Walmart, there's no single brand word to
`retailerMatch` a whole category against, so it accepts more noise in
exchange for breadth (a Kindle ebook slipped into "beauty" results in
testing) — the same tradeoff PC Parts already makes for full-PC-bundle
listings. Together these push total live feed volume from ~551 to ~776
in testing.

**Reddit (r/deals, r/GameDeals, r/buildapcsales) is fully built
(`lib/sources/reddit.ts`, OAuth-based specifically because Reddit
403s/429s anonymous RSS scraping from cloud IPs) but currently
commented out in `lib/config.ts`** pending `REDDIT_CLIENT_ID`/
`REDDIT_CLIENT_SECRET` — re-enable by uncommenting those three lines and
adding the two env vars once a Reddit script-type app is set up. This is
the single biggest lever for more deal volume left on the table — r/
buildapcsales specifically would meaningfully add to PC parts coverage
on top of Slickdeals PC Parts above, since it's community-curated rather
than keyword-matched.

**Other easy levers, not yet done:**
- `KEEPA_MIN_DISCOUNT` (default 40) is a tunable env var, not a hard
  limit — lowering it (e.g. to 25) surfaces more real deals from the same
  API call, at no extra token cost. The independent `salesRankDrops90 > 0`
  check (see below) still guards against fake-looking ones regardless of
  where this threshold is set, so lowering it doesn't reopen that problem.
- [IsThereAnyDeal](https://isthereanydeal.com/apps/) has a free public API
  that aggregates game deals across far more storefronts than CheapShark +
  Epic alone (Steam, GOG, Humble, Fanatical, and more) — would need a free
  API key signup, not yet integrated.

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
- **"$ and under"** filters to deals at or below a price ceiling you type
  in (e.g. "5" for $5-and-under) — requested directly. Only Keepa carries
  real structured price data; every RSS-based source's price is extracted
  from its title text instead (`extractPrice` in `lib/sources/rss.ts`),
  taking the first dollar amount found — checked against a broad real
  sample before writing this, and titles consistently lead or close with
  the actual deal price, with secondary amounts (free-shipping thresholds,
  multi-buy math) coming after it, not before. A title with no dollar
  amount but the standalone word "free" prices at $0 (covers the Freebies
  forum, which often never states a price because there isn't one).
  Confirmed live: 727 of 776 deals got a price this way, 101 of them
  genuinely $5 or under, with a sanity check confirming no $100+ deal
  slipped through. **While this filter is set, deals with no extractable
  price are hidden** rather than shown anyway — there'd be no way to tell
  whether an unknown price actually qualifies, so showing them would
  undermine the filter's whole point.

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
- `app/api/cards/watchlist/bulk/route.ts` — bulk-add endpoint (no immediate check)
- `app/api/cards/check-watchlist/route.ts` — the scheduled check endpoint
- `.github/workflows/check-watchlist.yml` — the every-30-min GitHub Action
- `lib/cardDiscovery.ts` — browses eBay live listings for deals with no name given
- `app/api/cards/discover/route.ts`, `.github/workflows/discover-deals.yml` — the hourly Discover run
- `components/PlayerSearch.tsx`, `lib/playerSearch.ts` — price-banded player browse + peer-listing check
- `app/api/cards/player-search/route.ts`, `app/api/cards/peer-check/route.ts` — their endpoints
- `lib/cardKeywords.ts` — rewrites a raw eBay title into a short, targeted search query
