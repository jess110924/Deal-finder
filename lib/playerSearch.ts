import { searchListings, type EbayListing, type CardCategory } from "@/lib/sources/ebay";
import { isGraded, isBundle, buildReferenceInfo } from "@/lib/cardComparison";
import { extractSearchKeywords, extractSerialDenominator } from "@/lib/cardKeywords";
import { findCard } from "@/lib/sources/pricecharting";
import type { ReferenceInfo } from "@/lib/db";
import { estimateResaleProfitDollars } from "@/lib/resaleProfit";
import { mapWithConcurrency } from "@/lib/concurrency";

export type PlayerCardResult = EbayListing & {
  priceDollars: number;
  // This listing's OWN best-matching PriceCharting product — a price
  // band search spans many different cards for one player, so (same
  // reasoning as evaluateListing in lib/cardComparison.ts) each listing
  // needs its own comparison, never one shared reference for the whole
  // query.
  reference: ReferenceInfo | null;
  estimatedProfitDollars: number | null;
  isProfitable: boolean;
  wasChecked: boolean;
};

// Same reasoning and values as Auction Sniper's AUCTION_FETCH_LIMIT/
// AUCTION_MAX_LISTINGS_TO_EVALUATE/MAX_PAGES_PER_SEARCH (lib/auctionSnipe.ts):
// PriceCharting isn't billed per-request, so there's no cost reason to
// keep this tight, and multi-page "min profitable" searches need a bound
// on total lookups to stay within Vercel's request timeout.
const PLAYER_SEARCH_FETCH_LIMIT = 50;
const PLAYER_SEARCH_MAX_LISTINGS_TO_EVALUATE = 25;
const MAX_PAGES_PER_SEARCH = 4;
const LOOKUP_CONCURRENCY = 12;

export const DEFAULT_MIN_PLAYER_SEARCH_PROFIT_DOLLARS = 0;

export type PlayerSearchOptions = {
  minPriceDollars?: number;
  maxPriceDollars?: number;
  // "profit" (default) is highest-estimated-profit first — the same
  // "most useful first" default manual search uses. "price" is lowest
  // asking price first, the original Player Search order.
  sortBy?: "profit" | "price";
  offset?: number;
  minProfitDollars?: number;
  minProfitableTarget?: number;
};

export type PlayerSearchResult = {
  listings: PlayerCardResult[];
  pagesSearched: number;
  reachedTarget: boolean;
};

async function evaluatePlayerListing(
  listing: EbayListing,
  category: CardCategory,
  minProfitDollars: number
): Promise<PlayerCardResult> {
  const priceDollars = listing.priceCents / 100;

  let reference;
  try {
    reference = await findCard(listing.title, category);
  } catch {
    reference = null;
  }

  if (!reference?.ungradedPriceCents || reference.ungradedPriceCents <= 0) {
    return { ...listing, priceDollars, reference: null, estimatedProfitDollars: null, isProfitable: false, wasChecked: true };
  }

  const referenceInfo = await buildReferenceInfo(reference, category, false);
  const estimatedProfitDollars = estimateResaleProfitDollars(
    priceDollars,
    listing.shippingCents / 100,
    referenceInfo.ungradedPriceDollars
  );
  const isProfitable = estimatedProfitDollars > minProfitDollars;

  return { ...listing, priceDollars, reference: referenceInfo, estimatedProfitDollars, isProfitable, wasChecked: true };
}

/** One eBay fetch + filter + PriceCharting-evaluate pass at a given offset. */
async function fetchAndEvaluatePage(
  query: string,
  category: CardCategory,
  minPriceDollars: number | undefined,
  maxPriceDollars: number | undefined,
  minProfitDollars: number,
  pageOffset: number
): Promise<{ results: PlayerCardResult[]; rawCount: number }> {
  const rawListings = await searchListings(query, category, {
    limit: PLAYER_SEARCH_FETCH_LIMIT,
    minPriceDollars,
    maxPriceDollars,
    offset: pageOffset,
  });
  const listings = rawListings.filter((l) => !isGraded(l.condition) && !isBundle(l.title));

  const toEvaluate = listings.slice(0, PLAYER_SEARCH_MAX_LISTINGS_TO_EVALUATE);
  const toSkip = listings.slice(PLAYER_SEARCH_MAX_LISTINGS_TO_EVALUATE);

  const evaluated = await mapWithConcurrency(toEvaluate, LOOKUP_CONCURRENCY, (l) =>
    evaluatePlayerListing(l, category, minProfitDollars)
  );
  const skipped: PlayerCardResult[] = toSkip.map((l) => ({
    ...l,
    priceDollars: l.priceCents / 100,
    reference: null,
    estimatedProfitDollars: null,
    isProfitable: false,
    wasChecked: false,
  }));

  return { results: [...evaluated, ...skipped], rawCount: rawListings.length };
}

/**
 * Step 1 of the manual "browse a player, eyeball for a good one" process:
 * a price-banded eBay search for a player's name, ungraded/non-bundle
 * only, each listing checked against its own best-matching PriceCharting
 * product (not one shared reference for the whole query — a player name
 * spans many different cards).
 *
 * `minProfitDollars`/`minProfitableTarget` and the offset/multi-page
 * auto-search behavior are the same filters and mechanism as Auction
 * Sniper's `searchEndingAuctions` (lib/auctionSnipe.ts) — requested
 * directly to bring them here too. See that file's doc comments for the
 * full reasoning; identical here: `minProfitDollars` replaces the fixed
 * default in `isProfitable`, `minProfitableTarget` keeps fetching
 * further eBay pages (up to `MAX_PAGES_PER_SEARCH`) until that many
 * profitable listings are found or eBay's results run out, and the
 * returned `pagesSearched`/`reachedTarget` let the caller report
 * honestly when a niche player/price-band genuinely doesn't have that
 * many.
 */
export async function searchPlayerCards(
  query: string,
  category: CardCategory,
  options: PlayerSearchOptions = {}
): Promise<PlayerSearchResult> {
  const {
    minPriceDollars,
    maxPriceDollars,
    sortBy = "profit",
    offset = 0,
    minProfitDollars = DEFAULT_MIN_PLAYER_SEARCH_PROFIT_DOLLARS,
    minProfitableTarget,
  } = options;

  const allResults: PlayerCardResult[] = [];
  let pagesSearched = 0;
  let currentOffset = offset;

  do {
    const page = await fetchAndEvaluatePage(
      query,
      category,
      minPriceDollars,
      maxPriceDollars,
      minProfitDollars,
      currentOffset
    );
    pagesSearched++;
    allResults.push(...page.results);

    const profitableSoFar = allResults.filter((l) => l.isProfitable).length;
    const targetReached = !minProfitableTarget || profitableSoFar >= minProfitableTarget;
    const exhausted = page.rawCount < PLAYER_SEARCH_FETCH_LIMIT;

    if (targetReached || exhausted || pagesSearched >= MAX_PAGES_PER_SEARCH) break;
    currentOffset += PLAYER_SEARCH_FETCH_LIMIT;
  } while (true);

  const profitableTotal = allResults.filter((l) => l.isProfitable).length;
  const reachedTarget = !minProfitableTarget || profitableTotal >= minProfitableTarget;

  const listings =
    sortBy === "price"
      ? [...allResults].sort((a, b) => a.priceDollars - b.priceDollars)
      : [...allResults].sort((a, b) => {
          if (a.estimatedProfitDollars != null && b.estimatedProfitDollars != null) {
            return b.estimatedProfitDollars - a.estimatedProfitDollars;
          }
          if (a.estimatedProfitDollars != null) return -1;
          if (b.estimatedProfitDollars != null) return 1;
          return a.priceDollars - b.priceDollars;
        });

  return { listings, pagesSearched, reachedTarget };
}

export type PeerComparison = {
  title: string;
  peerCount: number;
  averagePriceDollars: number;
  lowestPriceDollars: number;
  lowestListing: EbayListing;
  percentLowestBelowAverage: number;
  listings: EbayListing[]; // sorted lowest price first
};

/**
 * Step 2: "use that exact title to see what similar listings go for, then
 * compare to the current lowest." No eBay API key gets access to sold/
 * completed listing data (confirmed live: the buy.marketplace.insights
 * scope this would need comes back "invalid_scope" for this app's key,
 * meaning it isn't granted — that's a restricted, separately-approved
 * eBay API most developer accounts don't have), so this compares against
 * other *currently active* asking prices for the same exact card instead
 * of recent sold prices. Close to the same shape, but a real caveat: if
 * every seller of a card happens to be overpricing it right now, this
 * baseline is inflated right along with them — it's an asking-price
 * average, not a sold-price one.
 *
 * Deliberately still asking-price-based, not PriceCharting — unlike the
 * main browse above (which gained its own PriceCharting check when the
 * profit filters were added), this stays the way it worked before, per
 * the original revert: it never used PriceCharting even before sold
 * comps existed.
 *
 * Two layers of protection against a broad title search pulling in the
 * wrong parallel — confirmed live this is a real risk, not theoretical:
 * a raw "q=<full title>" search for a Gold Wave Prizm pulled in a
 * completely different, much cheaper Blue Shimmer Prizm just because both
 * titles say "Prizm", and even quoting just the distinctive phrase
 * ("Blue Refractor") still pulled in a different, far more common
 * "Red White & Blue Refractor" parallel since that phrase contains it as
 * a substring. (1) `extractSearchKeywords` narrows the search query
 * itself using the known subject (passed in from the Player Search box)
 * plus whatever color/finish words identify the parallel. (2) When the
 * title has a print-run denominator ("/150"), candidates are additionally
 * required to carry that same denominator — confirmed live this cleanly
 * separates real peers from same-named-but-different parallels that
 * don't share it.
 */
export async function comparePeerListings(
  title: string,
  category: CardCategory,
  knownSubject?: string | null
): Promise<PeerComparison | null> {
  const query = extractSearchKeywords(title, knownSubject);
  const raw = await searchListings(query, category, { limit: 30 });
  let listings = raw.filter((l) => !isGraded(l.condition) && !isBundle(l.title));

  const serial = extractSerialDenominator(title);
  if (serial) {
    const withSerial = listings.filter((l) => l.title.includes(serial));
    // Only trust the narrower set if it actually found something —
    // otherwise this falls back to the unfiltered list rather than
    // returning nothing just because of formatting differences.
    if (withSerial.length > 0) listings = withSerial;
  }

  if (listings.length === 0) return null;

  const sorted = [...listings].sort((a, b) => a.priceCents - b.priceCents);
  const averageCents = listings.reduce((sum, l) => sum + l.priceCents, 0) / listings.length;
  const lowest = sorted[0];

  return {
    title,
    peerCount: listings.length,
    averagePriceDollars: averageCents / 100,
    lowestPriceDollars: lowest.priceCents / 100,
    lowestListing: lowest,
    percentLowestBelowAverage: averageCents > 0 ? ((averageCents - lowest.priceCents) / averageCents) * 100 : 0,
    listings: sorted,
  };
}
