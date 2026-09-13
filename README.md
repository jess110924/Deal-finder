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
listing** against **real recent eBay sold prices** for that exact card.
Search a card name; it looks up eBay's current Buy It Now listings for
that search, checks each one's own recent sold comps, and flags any
listing priced 20%+ below the average sold price.

This used to compare against PriceCharting's estimated market value
instead — removed entirely (see "PriceCharting was removed" below) in
favor of comparing against what the card has actually sold for, which
turned out to also be simpler: one fewer API, one fewer category-to-domain
split to get wrong, and a number that's a real transaction instead of an
estimate.

Covers two categories, picked via a toggle on both the search box and the
watchlist add form: **Sports** and **Pokémon** — each maps to a different
eBay category id under the hood; everything else (the 20%-below-average
threshold, graded/bundle filtering, the watchlist, saved finds) works
identically for both.

**Graded slabs (PSA/BGS/SGC/CGC) and multi-card lots are excluded from the
comparison.** Graded cards sell for multiples of an ungraded price, so
comparing them would produce false "amazing deal" signals rather than real
ones; a lot of several cards for one price isn't comparable to a
single-card price at all. For live eBay listings, grading is detected via
eBay's own `condition` field (confirmed reliable: literally "Graded" vs
"Ungraded"), not a title guess — an earlier title-regex version of this
filter missed titles like "PSA Graded Mint 9" (words between "PSA" and the
grade number) and let real graded slabs slip through undetected. Sold
comps come from a different API with no such structured field, so those
are filtered by a title-based grading-company check instead (see
`isLikelyGraded` in `lib/sources/soldComps.ts`).

### Setup

Needs these in `.env`:

```
EBAY_CLIENT_ID=...
EBAY_CLIENT_SECRET=...
SOLD_COMPS_API_KEY=...
```

Get the eBay credentials free at [developer.ebay.com](https://developer.ebay.com) →
Application Keys → use the **Production** App ID and Cert ID (not Sandbox).
`SOLD_COMPS_API_KEY` is a paid third-party key (api.sold-comps.com) — see
"Sold comps everywhere" below for what it's used for. Whichever
environment runs the app needs its own copy of these (a local `.env` for
`npm run dev`, Vercel's project environment variables for production).

### PriceCharting was removed

This project originally compared listings against PriceCharting/
SportsCardsPro's estimated market value, with a "Verify" link/photo
pointing at the matched product's own page. Removed entirely, requested
directly ("remove the sportscardpro stuff... I only want sold comps API
and the options that display average sold price"), after a long chain of
matching-accuracy fixes on that system (query-stripping bugs, position-0
trust bugs, self-matched reference photos — see git history if the detail
ever matters) — sold comps replaced it as the sole comparison basis and
made a whole category of "is the reference actually right" bugs moot,
since the comparison is now against real transactions instead of an
estimate that could itself be mismatched. The genuinely reusable lesson
that carried over: search with a listing's *full raw title*, not a
keyword-stripped version — true for PriceCharting matching before, and
confirmed true again for the sold-comps API (see "Sold comps everywhere"
below).

`lib/sources/pricecharting.ts` no longer exists. `CardCategory` (still
needed — Sports vs. Pokémon still drives which eBay category id gets
searched, `212` vs `183454`) moved to `lib/sources/ebay.ts`, the one
place it's still functionally used.

### Sold-comps budget: why Discover and the watchlist auto-check are disabled

The sold-comps API (`SOLD_COMPS_API_KEY`) is a paid, metered third-party
service (2,000 or 10,000 calls/month, depending on plan) — a different
cost model from every other API this project uses, all free. Wiring sold
comps into every listing of every automatic background job (see "Sold
comps everywhere" below) without accounting for that turned out to be a
real problem once actually measured: Discover alone projected to ~32,000
calls/month, and the watchlist's 30-minute auto-check to ~34,500 calls/
month for a *single* watched card — both individually blow past even the
largest tier.

Decided directly, after seeing those numbers, to disable both entirely
and put the whole budget toward manual search instead — that's the
actual "search a card, find price differences" workflow this is for,
and it's the one place cost is naturally bounded by how often a person
searches, not by an unattended job running on a fixed schedule
regardless of whether anyone's looking:

- **Discover** (`.github/workflows/discover-deals.yml`) — schedule
  commented out, `workflow_dispatch` left so it can still be run
  manually from the Actions tab occasionally.
- **Watchlist auto-check** (`.github/workflows/check-watchlist.yml`) —
  same treatment. Adding a card to the watchlist still runs one
  immediate check (a single user-triggered action, not a recurring
  job), but nothing re-checks it automatically afterward anymore.
- **Manual search** — capped to the cheapest `SEARCH_MAX_LISTINGS_TO_EVALUATE`
  (12) listings per search getting their own sold-comps lookup, instead
  of every listing found (~20-30). The rest of the listings still show
  up in the results (title, price, link) — they're not dropped, just
  shown without a sold-comps line — since cheapest-first is a reasonable
  proxy for "most likely underpriced" and the alternative (checking
  everything) burns through a monthly budget in a handful of searches.
  Both this and the watchlist's now-unused 5-per-check cap live in
  `searchUnderpricedCards`'s `maxListingsToEvaluate` parameter in
  `lib/cardComparison.ts`.

Both scheduled workflows can be turned back on later by uncommenting
their `schedule:` line — nothing about the underlying features was
removed, just the unattended cadence that made them expensive.

### Watchlist — adding cards and reviewing what's found

`/cards` also has a **watchlist**: add a card, and it gets checked once
immediately. Anything found underpriced gets saved to a review list that
persists until you dismiss it — server-stored (not just your browser),
so it's the same list regardless of which device you check it from. (The
recurring automatic re-check this section used to describe is disabled —
see "Sold-comps budget" just above.)

Adding a card runs one check immediately (takes a few seconds — it's a
real eBay search + sold-comps check, the "Add" button shows "Checking…"
while it runs, capped to the cheapest 5 listings for the same budget
reasons as above) rather than only registering the card with nothing to
look at. If that immediate check happens to fail for some reason, the
card still gets added to the watchlist regardless — a message says the
check itself failed rather than acting like the add did.

There's also a **bulk add** option ("Add multiple cards at once" link
under the search box) for seeding the watchlist with many cards in one
shot instead of typing them one at a time — paste one card per line (or
comma-separated). Bulk-added cards skip the immediate check (running a
real search for 15-20+ cards sequentially would risk timing out, on top
of the sold-comps cost of doing so) — with the auto-check disabled, a
bulk-added card just sits on the list until you manually search it or
the auto-check is turned back on.

#### Triaging a find: My Picks and Mismatches

Requested directly, since a "Dismiss" button loses a find outright
either way — reviewing a find has three real outcomes, not two: a real
find you'll act on, a wrong match, or neither. Each find in the review
queue now has three actions instead of one:

- **✓ Save as pick** — checked and confirmed as an exact match and a
  real deal. Moves the find into a separate **My Picks** section
  (`lib/db.ts`'s `confirmFind`, stored under `card-confirmed`) instead of
  disappearing.
- **⚠ Flag mismatch** — checked and found to be comparing against the
  wrong card. Moves it into a **Mismatches** section (`flagMismatch`,
  stored under `card-mismatches`) instead of just losing it. This is
  deliberate: every accuracy fix in this project so far started from one
  concrete reported example (the Ja Morant/football-card mismatch, the
  Luka Doncic/Obsidian shared-reference bug) — this turns "the data's
  still wrong sometimes" from something that needs a screenshot into a
  running, structured log of real failures to actually look at.
- **Dismiss** — still there, for a find that's neither (not interested,
  or price too high) and doesn't need to go anywhere.

Both new actions also mark the find dismissed internally (same
mechanism `dismissFind` already used), so a future check (an on-add
check, a manual search, or the auto-check if it's turned back on)
doesn't just re-add the same listing right back into the review queue
after you've already triaged it. Both new sections have their own
"Remove"/"Clear" action to take something back out once you're done
with it (bought it, or the mismatch got fixed) — this doesn't undo the
dismissal, so it won't reappear in the review queue either way.

#### "↻ Refresh reference" — a saved find is a snapshot, not a live view

Reported directly, back when matching was still PriceCharting-based:
after a matching bug got fixed, an already-saved find kept showing the
exact same broken data anyway. Not a regression — a saved find's
comparison data is computed once, at the moment it's found, and stored
as-is; it was never recomputed against later matching-logic fixes.

Dismissing isn't a good answer here: `dismissFind` (and `confirmFind`/
`flagMismatch`) permanently blocklist that listing's item id
(`card-dismissed-ids`) so a real, still-available deal would never be
suggested again just because its cached data happened to be stale.
Added a third option instead — "↻ Refresh reference" on each find in the
review queue re-runs `getSoldComps` for that one listing's title right
now and overwrites just its stored `soldComps`/`percentBelowReference` in
place (`updateFindSoldComps` in `lib/db.ts`, `action: "refresh"` on
`POST /api/cards/finds`) — the find stays exactly where it is, just with
current data. This is the general answer to a problem that's come up
more than once already: every future matching fix will only apply to new
finds unless an existing one is explicitly refreshed, so this is the
tool for "this looks wrong, is it actually still wrong under today's
logic?" without losing the find either way.

This needed two things the rest of the project doesn't use: an actual
database, and a way to run checks on a schedule with nobody's browser
open.

**Database**: [Upstash Redis](https://vercel.com/marketplace/upstash) via
Vercel's Storage tab (free tier: 256MB, 30K commands/day — far more than
this needs). Connecting it auto-injects `KV_REST_API_URL` /
`KV_REST_API_TOKEN`, which `lib/db.ts` reads automatically — no manual
key-copying for this one.

**Scheduling** (currently disabled, see "Sold-comps budget" above):
Vercel's own Cron Jobs cap out at once per day on the free Hobby plan
(any more frequent schedule fails at deploy time) — too coarse for
catching a listing before someone else buys it. Instead,
`.github/workflows/check-watchlist.yml` was built to run on a GitHub
Actions schedule every 30 minutes (no such cap there, and it's free) and
call `POST /api/cards/check-watchlist` on the deployed site. That
endpoint sits outside the site's normal cookie-based login (see
`proxy.ts`) since a script has no browser session to present — it checks
its own secret instead. All of this still exists and works — the
`schedule:` trigger is just commented out.

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
5. To manually trigger a check (the automatic schedule is disabled): on
   GitHub, go to **Actions** tab → "Check card watchlist" workflow →
   **Run workflow** button (works because of the `workflow_dispatch`
   trigger in the yml file) — or uncomment the `schedule:` line in the
   workflow file to turn automatic checks back on.

### Discover — finding deals without naming a card first

**Currently disabled** — see "Sold-comps budget" above. Everything below
describes what it does when run (manually, via `workflow_dispatch`, or
with the schedule uncommented).

The watchlist only ever checks cards it's explicitly told about — it
can't surface a card worth watching that nobody's added yet. Discover
(`lib/cardDiscovery.ts`, `app/api/cards/discover/route.ts`, built to run
hourly via `.github/workflows/discover-deals.yml`) fills that gap: it
browses eBay's live listings directly (no keyword, just the category — Sports or
Pokémon), checks each one against its own recent sold comps, and saves
anything underpriced to the same "Saved finds" list as the watchlist.

A few things this needed that a name-driven search doesn't — each found
by actually running it live and looking at the real results, not assumed:

- **What to browse.** eBay's Browse API allows a category-only browse
  with no `q` — confirmed live. Sorted by price ascending it was almost
  entirely near-worthless base commons (~$2-3); sorted by price
  descending it surfaced ultra-rare autographs/jerseys/1-of-1s instead —
  those tend to have too little real sold history to compare against
  reliably (often one sale, or none). Settled on **sorted by newest-
  listed, within a $20-$300 band** (`lib/sources/ebay.ts`,
  `browseCategory`) — the range with enough standard rookies/parallels
  actually selling regularly to judge, not the extremes.
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
  worth being honest about: a freeform eBay title (year, set, parallel
  name, serial number, and all) matched against sold comps with no human
  choosing the search term is more likely to pull in the wrong parallel's
  comps than a deliberately-typed watchlist name would. A higher bar than
  the usual 20% (**25%**, `DISCOVERY_THRESHOLD_PERCENT`) adds a small
  margin against this turning into a false "deal." The real safeguard
  either way is the sold-comps link attached to every discovered find —
  check that before trusting one, every time.
- **API cost.** Each run makes one sold-comps lookup per browsed listing
  (~25 per category × 2 categories per hourly run), on top of what the
  watchlist already uses. That's why it runs hourly rather than every 30
  minutes. Both the batch size (`limit` in `discoverDeals`) and the cron
  schedule are easy to tune up or down depending on the sold-comps
  service's own usage limits.
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
  one at a time in a loop — up to 25 sequential round-trips per category,
  ~50 total per run — which was slow enough to exceed Vercel's serverless
  function timeout outright (confirmed live: a production run got no
  response at all after 60 seconds). Fixed with bounded concurrency
  (`mapWithConcurrency` in `lib/cardDiscovery.ts`, 6 at a time — fully
  unbounded, all 25 at once, risks looking like abusive traffic instead)
  plus running both categories in parallel rather than sequentially, and
  an explicit `export const maxDuration = 60` (Vercel Hobby's ceiling) as
  a backstop. Confirmed live after the fix: full run in ~18 seconds.

No separate setup needed — it reuses the same `EBAY_CLIENT_ID`/
`EBAY_CLIENT_SECRET`, `SOLD_COMPS_API_KEY`, `CRON_SECRET`, and
`DEAL_FINDER_URL` GitHub secret already configured for the watchlist.

### Player Search — the manual "browse a player, then check the margin" workflow

Built to replace a specific manual process directly: search a player,
scan for cards in a $30-$100 sweet spot, pick one, then check what
similar listings of that exact card go for before buying. `PlayerSearch`
(`components/PlayerSearch.tsx`, `lib/playerSearch.ts`,
`app/api/cards/player-search` + `app/api/cards/peer-check`) does the
first part as a plain price-banded eBay browse (no comparison figure — a
player name isn't one product) and the second as an on-demand "Check
similar listings" button per result.

#### Player Search's sold comps — real sold prices, not asking prices

"Check similar listings" originally compared against other **currently
active** asking prices, since no eBay API key here gets access to sold/
completed listing data (confirmed live: the scope that would need,
`buy.marketplace.insights`, comes back `invalid_scope` for this app's
key — a separately-approved, restricted API most developer accounts
don't have). The user supplied a paid third-party key for
[api.sold-comps.com](https://sold-comps.com) (`SOLD_COMPS_API_KEY`, a
scraper that returns real eBay sold history), so this now uses actual
recent sold prices instead — a real upgrade, not a workaround: if every
active seller of a card happens to be overpricing it right now, asking
prices are inflated right along with them, but sold prices aren't.

`lib/sources/soldComps.ts` wraps the API (`fetchSoldComps`); `getSoldComps`
in `lib/soldComps.ts` filters out graded slabs and bundles, applies the
print-run-denominator safety net (same pattern used elsewhere in this
project), and returns a `SoldCompsSummary` — comp count, average/median
sold price, the most recent sale, a direct link to eBay's own sold/
completed search for that title (`soldSearchUrl`, the "verify" link), and
the full list. The route (`app/api/cards/peer-check`) also takes the
listing's own asking price, so the response can say directly "this
listing is N% below the average recent sold price."

**A real bug caught immediately:** the API's own condition/conditionId
fields don't reliably separate graded slabs from raw cards (a PSA 10 came
back as plain "New (Other)", confirmed live) — grading is detected from
the title instead (`isLikelyGraded` in `lib/sources/soldComps.ts`), on
the theory that a raw card's title has no reason to mention a grading
company at all. And a lesson learned the same way earlier in this
project for the (since-removed) PriceCharting matching: this API has no
relevance scoring of its own, so feeding it a keyword-stripped
query ("Luka Doncic silver prizm") for a "2018-19 Panini Prizm - Freshman
Phenoms Luka Doncic #23 Silver Prizm" pulled in 21 loosely-related Silver
Prizm comps spanning unrelated years/sets (median $3, one real sale of
$129.99 buried in the noise) — the full, unstripped title correctly
returned 11 tightly-matched Freshman Phenoms comps instead ($17.50-
$129.99). Confirmed live before shipping, not assumed.

#### Sold comps everywhere, not just Player Search

Requested directly right after the above shipped: "I want all searches
to have sold comps verify link and average of eBay sold listings" — not
just the one-off "Check similar listings" button. `getSoldComps` moved
out of `lib/playerSearch.ts` into its own `lib/soldComps.ts` (avoiding an
import cycle: it needs `isBundle`, which needed to move to
`lib/cardKeywords.ts` too, so both `cardComparison.ts` and `soldComps.ts`
can use it without depending on each other) and is now called from every
place a listing gets evaluated:

- `evaluateListing` in `lib/cardComparison.ts` (the manual search page
  and every watchlist check) — the sole comparison lookup per listing
  now that PriceCharting is gone entirely (see "PriceCharting was
  removed" above; at the time this shipped it ran alongside a
  PriceCharting lookup instead, which is what first surfaced how useful
  having both side by side actually was — a real example: a "2023 Panini
  Prizm Draft Picks #57 Ja Morant" listing matched to a $450 PriceCharting
  reference sat right next to "Sold comps: avg $2.82 across 18 sales," a
  160x gap that was an obvious signal the PriceCharting match was wrong).
- `discoverDeals` in `lib/cardDiscovery.ts` — the sole comparison lookup
  for candidates as well now.
- The "↻ Refresh reference" action (`app/api/cards/finds/route.ts`)
  refreshes a find's sold comps, since they're a snapshot taken at
  find-time (see "a saved find is a snapshot, not a live view" above).

Once every listing check meant a paid API call instead of a free one,
the actual request volume mattered in a way it hadn't before — see "Sold-
comps budget" near the top of this section for what that forced (Discover
and the watchlist auto-check disabled, manual search capped to the
cheapest 12 listings per search).

#### Real profit, not just "underpriced" — `lib/resaleProfit.ts`

Requested directly: "I want to be able to find cards on eBay that are
undervalued so I can resell them for a profit... make my process more
efficient." A raw "25% under average sold price" doesn't answer "is this
actually worth buying" — eBay takes a real cut of the resale (confirmed
live via web search against eBay's current published fee schedule, not
assumed: **13.25%** of the sale total for Sports/Non-Sport Trading Cards
and CCGs, up to $7,500, plus a flat **$0.30** (orders $10 or under) /
**$0.40** (orders over $10) per order), and a cheap card's margin can get
eaten entirely by that flat per-order fee alone.

`estimateResaleProfitDollars` (`lib/resaleProfit.ts`) computes: cost to
acquire (the listing's price **+ its own shipping cost**, pulled from
eBay's `shippingOptions` — confirmed live against real search results,
field is `item.shippingOptions[0].shippingCost.value`) vs. net proceeds
from reselling at the average sold price (average sold price minus the
estimated eBay fee on that amount). The result — `estimatedProfitDollars`
on `CardListingResult`/`SavedFind` — is shown directly ("Est. profit:
$12.40 after eBay fees" or "Est. loss: $1.10 after eBay fees", colored
good/critical) and is now the **primary sort key** on the manual search
page: most profitable first, not just "most % below average" — the
actual point of the app, front and center instead of requiring mental
math on every listing.

Deliberately does *not* try to model the cost of shipping the card back
out when it's resold — that's charged to (and paid by) whoever buys it
from you, the same way it was charged to you buying this one, so it's
treated as a wash rather than guessed at with no real data to base a
number on either way.

**`isProfitable`** replaced `isUnderpriced` as the actual gate for what
gets saved to the watchlist/Discover review queue
(`MIN_WORTHWHILE_PROFIT_DOLLARS = 5`, `checkCardAndSaveFinds` and
`discoverDeals`) — a listing can be "underpriced" and still not be worth
buying once the real fee is netted out, especially on cheap cards, and
the review queue's whole purpose is "is this worth acting on," not "is
this a smaller number than another number." `isUnderpriced`/
`percentBelowReference` are both still computed and shown as secondary
context (some cards are worth watching even at a smaller absolute
profit), just no longer the thing that decides what surfaces.

### Auction Sniper — live auctions, soonest-ending first

Requested directly: "any way I could find eBay auction listings that are
ending and see if I can snipe them for a deal?" A completely different
eBay search mode from everything else on this page — auctions, not Buy
It Now — with its own section (`components/AuctionSnipe.tsx`,
`lib/auctionSnipe.ts`, `app/api/cards/auctions/route.ts`).

eBay's Browse API supports this directly, confirmed live rather than
assumed (undocumented in anything checked ahead of time): the same
`item_summary/search` endpoint accepts `buyingOptions:{AUCTION}` as a
filter and `endingSoonest` as a sort value, and returns `currentBidPrice`,
`bidCount`, and `itemEndDate` on each result instead of the fixed `price`
a Buy It Now listing has — `searchAuctionListings` in `lib/sources/ebay.ts`
wraps this, deliberately with `cache: "no-store"` (not the 5-minute cache
`searchListings` uses) since a stale current bid or end time defeats the
entire point.

Each auction gets the same per-listing sold-comps check and profit
estimate as manual search (same `getSoldComps`/`estimateResaleProfitDollars`
machinery, same `MIN_WORTHWHILE_PROFIT_DOLLARS`/12-listing cost cap,
capped to the *soonest-ending* 12 rather than cheapest-12 — those are the
actual candidates worth spending a lookup on), with one deliberate
difference in framing: the profit shown is explicitly labeled "if won at
this bid," never presented as a guaranteed number the way a Buy It Now
listing's profit is. A live auction's current bid is not its final
price — an auction with real time left, or bids already on it, can and
does climb well past where it sits now. The `maxHours` filter ("ending
within 1 hour / 6 hours / 24 hours / 3 days / any time") exists because
sniping is inherently about a specific window to act in, not a general
browse — an auction three days out with $0 profit potential *right now*
tells you nothing about what it'll actually close at.

Confirmed live: found a real example while testing — a "2024-25 Panini
Mosaic Ja Morant #195" auction sitting at a **$1.00** bid with **0 bids**
and **2h 39m** left, whose sold comps averaged **$12.41** across 19
sales — an estimated **$8.37** profit if won at that bid, exactly the
"nobody's found this yet" case this feature is built to surface.

### The keyword-extraction fix — why raw eBay titles make bad search queries

Reported directly, and confirmed live to be a serious problem, not a
minor one: feeding a full eBay title into either the reference-price
lookup or eBay's own search frequently returns the *wrong* product. Two
separate live failures drove this:

1. The reference-price lookup (PriceCharting, at the time) matched a
   rare 1-of-10 autographed jersey card against an unrelated $6.50 base
   card that happened to share enough words.
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

This is used in two places today: Player Search's peer-check (has a
known subject from the search box) and the main search box/watchlist's
eBay listings search (only when the query itself carries a serial
number) — narrowing eBay's own keyword search, which has no relevance
scoring to fall back on. It's never used to build the sold-comps query
(`getSoldComps` always searches with the full raw title — see "Sold
comps everywhere" above) for the same reason it stopped feeding the
PriceCharting lookup before that was removed: once a scorer/ranker
exists on the other end, stripping the query down is pure downside.

### The rest of the PriceCharting-matching bug chain (historical)

Several more accuracy bugs got found and fixed in the PriceCharting-based
version of this comparison before it was removed entirely — trusting
whatever PriceCharting's search put first instead of scoring candidates
(a `"Ja Morant Select Concourse"` search put an unrelated football card
ahead of the real match), then a deeper architectural bug where one
shared reference got applied to every listing in a broad search instead
of each listing getting its own (a bare `"Luka doncic"` watchlist entry
flagged a $29.99 listing as "45% under reference" against a completely
unrelated $54.98 product, sharing nothing but a player's name), then the
keyword-stripping-vs-relevance-scoring conflict described above. None of
that code exists anymore — see git history around the "PriceCharting"
commits if the specifics ever matter again — but the pattern across all
of them (score candidates instead of trusting position 0; give each
listing its own comparison, never a shared one; search with the full
title once a scorer/ranker exists to make sense of it) is exactly what
the sold-comps implementation above was built with from the start,
rather than having to relearn each lesson a second time.

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
- `lib/cardComparison.ts` — eBay listings vs. sold-comps comparison + filtering
- `lib/sources/ebay.ts` — eBay listings/browse + the `CardCategory` type
- `lib/soldComps.ts`, `lib/sources/soldComps.ts` — the sold-comps lookup (business logic + raw API client)
- `lib/db.ts` — Upstash Redis: watchlist, saved finds, My Picks, Mismatches, dismissed-ids
- `components/CardWatchlist.tsx` — watchlist manager + saved-finds review UI
- `app/api/cards/confirmed/route.ts`, `mismatches/route.ts` — My Picks / Mismatches endpoints
- `app/api/cards/watchlist/bulk/route.ts` — bulk-add endpoint (no immediate check)
- `app/api/cards/check-watchlist/route.ts` — the watchlist check endpoint
- `.github/workflows/check-watchlist.yml` — the every-30-min GitHub Action (schedule currently disabled — see "Sold-comps budget")
- `lib/cardDiscovery.ts` — browses eBay live listings for deals with no name given
- `app/api/cards/discover/route.ts`, `.github/workflows/discover-deals.yml` — the Discover run (schedule currently disabled)
- `components/PlayerSearch.tsx`, `lib/playerSearch.ts` — price-banded player browse + peer-listing check
- `app/api/cards/player-search/route.ts`, `app/api/cards/peer-check/route.ts` — their endpoints
- `components/AuctionSnipe.tsx`, `lib/auctionSnipe.ts` — live auctions ending soonest, checked against sold comps
- `app/api/cards/auctions/route.ts` — its endpoint
- `lib/resaleProfit.ts` — estimated resale profit after eBay's real selling fee and shipping cost
- `lib/cardKeywords.ts` — rewrites a raw eBay title into a short, targeted search query (used for eBay's own keyword search only)
