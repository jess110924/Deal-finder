import { searchAnyListings, type EbayListing } from "@/lib/sources/ebay";
import { getElectronicsSoldPricing, isExcludedListing, buildSoldSearchUrl } from "@/lib/electronicsPricing";
import { estimateElectronicsResaleProfitDollars } from "@/lib/resaleProfit";
import { mapWithConcurrency } from "@/lib/concurrency";

export type ElectronicsResult = EbayListing & {
  priceDollars: number;
  // See getElectronicsSoldPricing in lib/electronicsPricing.ts — null
  // when there wasn't enough real sold history to trust, deliberately
  // NOT backed by a weaker fallback (e.g. active asking prices) when
  // that happens: requested directly, sold comps only, so a profit
  // number showing here always means a real sold price, never silently
  // something else.
  averageSoldPriceDollars: number | null;
  compCount: number;
  mostRecentSaleDate: string | null;
  soldSearchUrl: string;
  estimatedProfitDollars: number | null;
  isProfitable: boolean;
  wasChecked: boolean;
};

// Deliberately much tighter than Auction Sniper/Player Search's eBay-
// only caps (lib/auctionSnipe.ts, lib/playerSearch.ts) — those call
// eBay's own free Browse API per listing; this calls SOLD_COMPS_API_KEY,
// a paid, metered third-party API. Requested directly after flagging
// this project's own cost history: the sold-comps era's watchlist
// check, capped at 5 listings/check, still projected ~7,200 calls/month
// for a single watched card — Electronics Search's free-text, any-
// electronics scope is far broader than one card, so the per-search cap
// here matches manual card search's original SEARCH_MAX_LISTINGS_TO_EVALUATE
// (12) instead of the 25 the eBay-only version of this file used. No
// multi-page auto-search for a "show at least N profitable" target
// either (that feature existed in the eBay-peer-average version of this
// file; removed here, same reasoning) — each search costs at most
// MAX_LISTINGS_TO_EVALUATE sold-comps calls, full stop, not a multiple
// of that chasing a target count. Manually pressing Search again still
// pages forward through eBay's own (free) results, see `offset` below —
// that's a user-initiated, bounded cost each time, not an automatic loop.
const FETCH_LIMIT = 30;
const MAX_LISTINGS_TO_EVALUATE = 12;
// Lower than the eBay-only pages' LOOKUP_CONCURRENCY (12) — same "be
// cautious with a paid API" reasoning as the lookup cap above; nothing
// here has observed SOLD_COMPS_API_KEY rate-limiting, but there's also
// no reason to find out the hard way with real money on the line.
const LOOKUP_CONCURRENCY = 6;

export const DEFAULT_MIN_ELECTRONICS_PROFIT_DOLLARS = 0;

export type ElectronicsSearchOptions = {
  minPriceDollars?: number;
  maxPriceDollars?: number;
  sortBy?: "profit" | "price";
  offset?: number;
  minProfitDollars?: number;
};

export type ElectronicsSearchResult = {
  listings: ElectronicsResult[];
};

async function evaluateListing(listing: EbayListing, minProfitDollars: number): Promise<ElectronicsResult> {
  const priceDollars = listing.priceCents / 100;
  const pricing = await getElectronicsSoldPricing(listing.title);

  if (pricing.averageSoldPriceDollars == null) {
    return { ...listing, priceDollars, ...pricing, estimatedProfitDollars: null, isProfitable: false, wasChecked: true };
  }

  const estimatedProfitDollars = estimateElectronicsResaleProfitDollars(
    priceDollars,
    listing.shippingCents / 100,
    pricing.averageSoldPriceDollars
  );
  const isProfitable = estimatedProfitDollars > minProfitDollars;

  return { ...listing, priceDollars, ...pricing, estimatedProfitDollars, isProfitable, wasChecked: true };
}

/**
 * Electronics Search — requested directly: "locate iPhones, Apple
 * Watches and any electronics cheaper than their average value so I can
 * resell for profit," later upgraded to compare against real sold
 * prices instead of other active asking prices ("comparing against
 * previous sold listings of the same exact product"). No eBay category
 * restriction (see searchAnyListings' doc comment in
 * lib/sources/ebay.ts), each listing checked against its own sold comps
 * (see evaluateListing above) rather than one shared reference, for the
 * same reason manual card search gives every listing its own
 * PriceCharting match: a broad query ("iPhone", say) spans many
 * different actual products.
 *
 * `offset`, when given, shifts the eBay fetch forward — same "search
 * again for new results" mechanism as Auction Sniper/Player Search (see
 * those files), a single page per call, user-initiated each time rather
 * than an automatic loop (see MAX_LISTINGS_TO_EVALUATE's comment above
 * for why this version doesn't auto-page toward a profit-count target
 * the way the eBay-only features do).
 */
export async function searchElectronics(
  query: string,
  options: ElectronicsSearchOptions = {}
): Promise<ElectronicsSearchResult> {
  const {
    minPriceDollars,
    maxPriceDollars,
    sortBy = "profit",
    offset = 0,
    minProfitDollars = DEFAULT_MIN_ELECTRONICS_PROFIT_DOLLARS,
  } = options;

  const rawListings = await searchAnyListings(query, {
    limit: FETCH_LIMIT,
    minPriceDollars,
    maxPriceDollars,
    offset,
  });
  const listings = rawListings.filter((l) => !isExcludedListing(l.title, l.condition));

  const toEvaluate = listings.slice(0, MAX_LISTINGS_TO_EVALUATE);
  const toSkip = listings.slice(MAX_LISTINGS_TO_EVALUATE);

  const evaluated = await mapWithConcurrency(toEvaluate, LOOKUP_CONCURRENCY, (l) => evaluateListing(l, minProfitDollars));
  const skipped: ElectronicsResult[] = toSkip.map((l) => ({
    ...l,
    priceDollars: l.priceCents / 100,
    averageSoldPriceDollars: null,
    compCount: 0,
    mostRecentSaleDate: null,
    soldSearchUrl: buildSoldSearchUrl(l.title),
    estimatedProfitDollars: null,
    isProfitable: false,
    wasChecked: false,
  }));

  const allResults = [...evaluated, ...skipped];
  const sorted =
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

  return { listings: sorted };
}
