import { searchListings, type EbayListing, type CardCategory } from "@/lib/sources/ebay";
import { saveNewFinds, type SavedFind } from "@/lib/db";
import { extractSearchKeywords, extractSerialDenominator, isBundle } from "@/lib/cardKeywords";
import { mapWithConcurrency } from "@/lib/concurrency";
import { getSoldComps, type SoldCompsSummary } from "@/lib/soldComps";

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
    return { ...listing, priceDollars, percentBelowReference: null, isUnderpriced: false, soldComps: null };
  }

  const percentBelowReference = soldComps.percentBelowAverage ?? 0;
  const isUnderpriced = percentBelowReference >= UNDERPRICED_THRESHOLD_PERCENT;

  return { ...listing, priceDollars, percentBelowReference, isUnderpriced, soldComps };
}

/**
 * `maxListingsToEvaluate` caps how many listings get their own sold-comps
 * lookup (the expensive part — one paid API call each) — left unlimited
 * for the interactive search page (a user asked for this specific search,
 * bounded by how often they actually search), but the watchlist's
 * automated background check passes a small number here. Requested
 * directly after realizing the unattended jobs' actual cost: checking
 * every listing (~20-25) for every watched card, every 30 minutes, was
 * projected at ~34,500 sold-comps calls/month for a *single* watched
 * card against a paid API metered at 2,000-10,000/month. Capped to the
 * cheapest N listings — cheapest-first is a reasonable proxy for "most
 * likely underpriced" even before their own comps are known, and a real
 * deal is exactly what this is trying to catch, not exhaustive coverage
 * of every listing that exists.
 *
 * `includeSummary` skips the *overall query's own* sold-comps lookup (an
 * extra API call, shown at the top of the manual search page for
 * context) — the watchlist's background check passes false here since
 * `checkCardAndSaveFinds` never reads `result.soldComps` at all; that
 * call was pure waste on every single automated check.
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
  // spending the API calls that would tell us more.
  if (maxListingsToEvaluate != null && ungradedListings.length > maxListingsToEvaluate) {
    ungradedListings = [...ungradedListings]
      .sort((a, b) => a.priceCents - b.priceCents)
      .slice(0, maxListingsToEvaluate);
  }

  // Each listing checked against its own comps, not the shared `soldComps`
  // above — see evaluateListing's doc comment for why. Bounded
  // concurrency for the same reason Discover uses it: sequential would
  // be far too slow for a search returning up to 30 listings.
  const listings = await mapWithConcurrency(ungradedListings, LOOKUP_CONCURRENCY, (l) => evaluateListing(l, category));

  // Best deals (most below average sold price) first, then everything else by price.
  listings.sort((a, b) => {
    if (a.percentBelowReference != null && b.percentBelowReference != null) {
      return b.percentBelowReference - a.percentBelowReference;
    }
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
    .filter((l) => l.isUnderpriced)
    .map((l) => ({
      itemId: l.itemId,
      title: l.title,
      priceDollars: l.priceDollars,
      itemWebUrl: l.itemWebUrl,
      imageUrl: l.imageUrl,
      condition: l.condition,
      percentBelowReference: l.percentBelowReference!,
      searchedFor: card,
      category,
      source: "watchlist",
      soldComps: l.soldComps ?? undefined,
      foundAt: new Date().toISOString(),
    }));
  return saveNewFinds(candidates);
}
