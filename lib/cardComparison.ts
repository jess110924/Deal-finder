import { searchListings, type EbayListing, type CardCategory } from "@/lib/sources/ebay";
import { saveNewFinds, type SavedFind } from "@/lib/db";
import { extractSearchKeywords, extractSerialDenominator, isBundle } from "@/lib/cardKeywords";
import { mapWithConcurrency } from "@/lib/concurrency";
import { getSoldComps, type SoldCompsSummary } from "@/lib/soldComps";
import { estimateResaleProfitDollars } from "@/lib/resaleProfit";

export type { CardCategory };
export { isBundle };

// Graded slabs (PSA 10, BGS 9.5, etc.) sell for multiples of a raw card's
// price. Comparing a graded listing against an ungraded sold-comps
// average would produce a false "great deal" — a PSA 10 priced "50%
// below" an ungraded average isn't a deal, it's a mismatch.
//
// Filtered using eBay's own `condition` field (confirmed live: they
// reliably return the literal string "Graded" vs "Ungraded" for trading
// cards, conditionId 2750 vs 4000) — an earlier version of this filter
// used a title regex requiring a grade number right after "PSA"/"BGS"/etc,
// which missed titles like "PSA Graded Mint 9" (words in between) and let
// graded slabs slip through undetected. The structured condition field
// doesn't have that failure mode. (Sold comps themselves come from a
// different API with no such structured field — see isLikelyGraded in
// lib/sources/soldComps.ts for how those get filtered instead.)
export function isGraded(condition: string | null): boolean {
  return (condition ?? "").toLowerCase().includes("graded") && !(condition ?? "").toLowerCase().includes("ungraded");
}

export type CardListingResult = EbayListing & {
  priceDollars: number;
  // How far below the average recent eBay sold price this listing's
  // asking price is. Field name kept as-is (not renamed to something
  // like percentBelowAverageSold) since it's already the key ~200 finds
  // in production Redis are stored under, with no migration path — what
  // it's computed from changed (used to be a PriceCharting reference
  // price; now it's soldComps.averageSoldPriceDollars) but the field
  // itself didn't move.
  percentBelowReference: number | null;
  isUnderpriced: boolean;
  // Real recent eBay sold prices for this exact listing's title — the
  // only comparison basis now. See getSoldComps in lib/soldComps.ts.
  soldComps: SoldCompsSummary | null;
  // Estimated dollar profit from buying this listing and reselling at
  // the average sold price, after eBay's actual selling fee and this
  // listing's own shipping cost — see lib/resaleProfit.ts. The number
  // that actually answers "is this worth buying," which a raw percent-
  // below-average doesn't: a cheap card 25% under average can still be a
  // net loss once eBay's ~13.25%+$0.30-0.40 cut is taken out.
  estimatedProfitDollars: number | null;
  // Profit clearing a minimum bar (not just > $0), since a real flip
  // costs real time/effort (listing it, packaging, shipping, the risk of
  // it not selling at the assumed price) that a $1 "profit" doesn't
  // justify. See MIN_WORTHWHILE_PROFIT_DOLLARS.
  isProfitable: boolean;
  // Whether this listing actually got a sold-comps API call at all, as
  // opposed to being skipped past `maxListingsToEvaluate`. Needed
  // because both "checked, but no comps were found" and "never checked"
  // look identical otherwise (`soldComps: null`, `estimatedProfitDollars:
  // null`) — without this, a UI summary like "N checked, M not checked"
  // can't actually tell those two apart.
  wasChecked: boolean;
};

export type CardSearchResult = {
  query: string;
  category: CardCategory;
  // The overall search query's own sold comps, shown at the top of the
  // page for context — not what any individual listing below is
  // compared against (each has its own, in `listings[].soldComps`, for
  // the same reason described on evaluateListing).
  soldComps: SoldCompsSummary | null;
  listings: CardListingResult[];
};

export const UNDERPRICED_THRESHOLD_PERCENT = 20;

// A real flip costs real effort (listing it, packaging, shipping,
// waiting for it to actually sell at the assumed average price rather
// than sitting unsold) — a $1-2 "profit" after fees isn't worth that.
// $5 is a starting point, not derived from anything more rigorous than
// "clearly worth doing."
export const MIN_WORTHWHILE_PROFIT_DOLLARS = 5;

// Cheapest 12 listings per manual search get their own sold-comps
// lookup — chosen as a middle ground (roughly half of a typical ~20-30
// listing search) between thoroughness and the sold-comps API's metered
// cost. Requested directly: "making my manual search the most
// efficient" after realizing the unattended jobs' cost — this is the
// equivalent cap for the interactive search page, now that it's the
// sole place the sold-comps budget goes.
export const SEARCH_MAX_LISTINGS_TO_EVALUATE = 12;

const LOOKUP_CONCURRENCY = 12;

/**
 * Checks one listing against its OWN recent sold comps — never a single
 * comps figure computed for the overall search query. This is the same
 * fix, for the same reason, as the PriceCharting-era bug this project
 * fixed earlier: searching (or watching) a bare player name like "Luka
 * doncic" returns listings spanning many completely different cards (a
 * 2018 base Prizm, a 2024-25 Obsidian Red Electric Etch parallel, etc.)
 * — comparing all of them against one shared reference (whichever single
 * figure a broad query happened to produce) produces nonsense. Each
 * listing needs its own comps, computed from its own specific title.
 */
async function evaluateListing(listing: EbayListing, category: CardCategory): Promise<CardListingResult> {
  const priceDollars = listing.priceCents / 100;
  const soldComps = await getSoldComps(listing.title, priceDollars).catch(() => null);

  if (!soldComps || soldComps.averageSoldPriceDollars <= 0) {
    return {
      ...listing,
      priceDollars,
      percentBelowReference: null,
      isUnderpriced: false,
      soldComps: null,
      estimatedProfitDollars: null,
      isProfitable: false,
      wasChecked: true,
    };
  }

  const percentBelowReference = soldComps.percentBelowAverage ?? 0;
  const isUnderpriced = percentBelowReference >= UNDERPRICED_THRESHOLD_PERCENT;
  const estimatedProfitDollars = estimateResaleProfitDollars(
    priceDollars,
    listing.shippingCents / 100,
    soldComps.averageSoldPriceDollars
  );
  const isProfitable = estimatedProfitDollars >= MIN_WORTHWHILE_PROFIT_DOLLARS;

  return {
    ...listing,
    priceDollars,
    percentBelowReference,
    isUnderpriced,
    soldComps,
    estimatedProfitDollars,
    isProfitable,
    wasChecked: true,
  };
}

/**
 * `maxListingsToEvaluate` caps how many listings get their own sold-comps
 * lookup (the expensive part — one paid API call each) against a metered,
 * paid API (2,000-10,000 calls/month, depending on plan). Checking every
 * listing (~20-30 per search) adds up fast across repeated manual
 * searches, and adds up even faster for an unattended recurring job —
 * checking every listing for every watched card, every 30 minutes,
 * projected to ~34,500 sold-comps calls/month for a *single* watched
 * card, which is why the watchlist's automatic check was dropped
 * entirely (see `.github/workflows/check-watchlist.yml`) in favor of
 * putting the whole budget toward manual search instead.
 *
 * Capped listings beyond the limit are NOT dropped from the results —
 * they're still returned (title, price, link), just without their own
 * sold comps, so a manual search still shows everything eBay actually
 * has rather than silently hiding results. Only the cheapest N get the
 * expensive lookup: cheapest-first is a reasonable proxy for "most
 * likely underpriced" even before their own comps are known, and a real
 * deal is exactly what this app is trying to catch, not exhaustive
 * coverage of every listing that exists.
 *
 * `includeSummary` skips the *overall query's own* sold-comps lookup (an
 * extra API call, shown at the top of the manual search page for
 * context) — pass false for a caller that never reads `result.soldComps`
 * (e.g. `checkCardAndSaveFinds` below), since that call would otherwise
 * be pure waste.
 */
export async function searchUnderpricedCards(
  query: string,
  category: CardCategory,
  maxListingsToEvaluate?: number,
  includeSummary = true
): Promise<CardSearchResult> {
  // Only rewrite the query when it carries a print-run denominator
  // ("/150") — a strong, safe signal this is a pasted-in raw eBay title
  // rather than a short deliberate search like "2018 Panini Prizm Luka
  // Doncic". Rewriting the latter would risk dropping its year and
  // matching the wrong season's card instead — gating on the serial
  // number avoids that regression entirely, since a short deliberate
  // query essentially never includes one. This narrows what's sent to
  // eBay's own listings search, which has no relevance scoring of its
  // own to fall back on.
  const effectiveQuery = extractSerialDenominator(query) ? extractSearchKeywords(query) : query;

  const [soldComps, rawListings] = await Promise.all([
    includeSummary ? getSoldComps(query, null).catch(() => null) : Promise.resolve(null),
    searchListings(effectiveQuery, category),
  ]);

  let ungradedListings = rawListings.filter((l) => !isGraded(l.condition) && !isBundle(l.title));

  // Filtering listings by the query's own print-run denominator closes a
  // gap the query-rewrite above doesn't: a search for "...Cade Cunningham
  // #88 Blue Refractor /150..." can still return "Red White & Blue
  // Refractor" listings (a different, much cheaper parallel) alongside
  // the real ones. Now a secondary safety net rather than the primary
  // fix — each listing gets its own accurate sold comps below regardless
  // — but still worth keeping: it trims the list down before that
  // (per-listing) work happens.
  const querySerial = extractSerialDenominator(query);
  if (querySerial) {
    const withSerial = ungradedListings.filter((l) => l.title.includes(querySerial));
    if (withSerial.length > 0) ungradedListings = withSerial;
  }

  // Cheapest-first cap — see the doc comment on `maxListingsToEvaluate`.
  // Sorting by raw asking price here (not by anything comps-derived,
  // since comps don't exist yet) is the only ordering available before
  // spending the API calls that would tell us more. The listings past
  // the cap are kept, not discarded — they just don't get their own
  // sold-comps lookup (`toSkip` below), same as a listing whose lookup
  // simply found nothing.
  let toEvaluate = ungradedListings;
  let toSkip: EbayListing[] = [];
  if (maxListingsToEvaluate != null && ungradedListings.length > maxListingsToEvaluate) {
    const sorted = [...ungradedListings].sort((a, b) => a.priceCents - b.priceCents);
    toEvaluate = sorted.slice(0, maxListingsToEvaluate);
    toSkip = sorted.slice(maxListingsToEvaluate);
  }

  // Each listing checked against its own comps, not the shared `soldComps`
  // above — see evaluateListing's doc comment for why. Bounded
  // concurrency for the same reason Discover uses it: sequential would
  // be far too slow for a search returning up to 30 listings.
  const evaluated = await mapWithConcurrency(toEvaluate, LOOKUP_CONCURRENCY, (l) => evaluateListing(l, category));
  const skipped: CardListingResult[] = toSkip.map((l) => ({
    ...l,
    priceDollars: l.priceCents / 100,
    percentBelowReference: null,
    isUnderpriced: false,
    soldComps: null,
    estimatedProfitDollars: null,
    isProfitable: false,
    wasChecked: false,
  }));
  const listings = [...evaluated, ...skipped];

  // Most profitable first (the actual point of this app), then whatever
  // wasn't evaluated (capped out, or no comps found) by price ascending —
  // the cheapest unevaluated listings are the ones worth a manual look
  // first if nothing else has real numbers behind it.
  listings.sort((a, b) => {
    if (a.estimatedProfitDollars != null && b.estimatedProfitDollars != null) {
      return b.estimatedProfitDollars - a.estimatedProfitDollars;
    }
    if (a.estimatedProfitDollars != null) return -1;
    if (b.estimatedProfitDollars != null) return 1;
    return a.priceDollars - b.priceDollars;
  });

  return { query, category, soldComps, listings };
}

// Cheapest 5 listings per card, per check — see the doc comment on
// searchUnderpricedCards's maxListingsToEvaluate for the cost math this
// is protecting against.
const WATCHLIST_MAX_LISTINGS_PER_CHECK = 5;

/**
 * Runs a search for one watchlist card and saves any underpriced listings
 * found. Shared by the scheduled check (check-watchlist route, every ~30
 * min) and an immediate on-add check (watchlist route's POST) — without
 * the latter, adding a card gives zero feedback until the next scheduled
 * run, up to 30 minutes of "did this even work?" with nothing to look at.
 *
 * Filters by `isProfitable`, not `isUnderpriced` — requested directly:
 * the whole point of this app is finding cards worth buying to resell,
 * and a listing can be "underpriced" (below average sold price) while
 * still being a net loss after eBay's real selling fee, especially on
 * cheap cards where the flat $0.30-0.40 per-order fee is a large share
 * of the sale. `isProfitable` is the number that actually answers "is
 * this worth buying" — see lib/resaleProfit.ts.
 *
 * Each saved find carries `l.soldComps` — that listing's own comps from
 * evaluateListing — not the watchlist entry's overall query comps. This
 * matters most exactly when the watchlist entry is broad (just a player
 * name, e.g. "Luka doncic", not "2018 Panini Prizm Luka Doncic"): the
 * listings returned span many different real cards, and using one shared
 * figure for all of them would repeat a bug this project already fixed
 * once for the PriceCharting-based version of this same logic.
 */
export async function checkCardAndSaveFinds(card: string, category: CardCategory): Promise<number> {
  const result = await searchUnderpricedCards(card, category, WATCHLIST_MAX_LISTINGS_PER_CHECK, false);
  const candidates: SavedFind[] = result.listings
    .filter((l) => l.isProfitable)
    .map((l) => ({
      itemId: l.itemId,
      title: l.title,
      priceDollars: l.priceDollars,
      shippingDollars: l.shippingCents / 100,
      itemWebUrl: l.itemWebUrl,
      imageUrl: l.imageUrl,
      condition: l.condition,
      percentBelowReference: l.percentBelowReference!,
      estimatedProfitDollars: l.estimatedProfitDollars ?? undefined,
      searchedFor: card,
      category,
      source: "watchlist",
      soldComps: l.soldComps ?? undefined,
      foundAt: new Date().toISOString(),
    }));
  return saveNewFinds(candidates);
}
