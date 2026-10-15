import { searchAnyListings, type EbayListing } from "@/lib/sources/ebay";
import { fetchSoldComps, type SoldComp } from "@/lib/sources/soldComps";
import { isBundle } from "@/lib/cardComparison";
import { estimateElectronicsResaleProfitDollars } from "@/lib/resaleProfit";
import { mapWithConcurrency } from "@/lib/concurrency";

// eBay's own condition string for a broken/salvage item — confirmed live
// as a real value the Browse API returns. Comparing a "for parts" price
// against a working comp's sold price would call a genuinely broken item
// "underpriced," which is backwards — it's cheap because it's broken,
// not because it's a deal.
const BROKEN_CONDITION_PATTERN = /for parts|not working/i;

function isBrokenCondition(condition: string | null): boolean {
  return condition != null && BROKEN_CONDITION_PATTERN.test(condition);
}

// Caught live (back when this compared against other asking prices, but
// the same risk applies to sold comps): searching "Apple Watch Series 9"
// surfaced a "$56.12 OEM Pull Replacement OLED Screen - Repair Part for
// Apple Watch Series 9" as "profitable" — a salvaged screen, not a
// watch, priced (correctly) like a screen, not underpriced at all. A
// title match on the model name doesn't mean it's the actual device;
// "repair part"/"OEM pull"/"screen only"/"for parts only" are all
// phrasings that specifically mean "a piece removed from a device,"
// never a complete, resellable unit. Filtered from both the listings
// being evaluated and the sold comps a listing gets compared against.
const PARTS_LISTING_PATTERN = /\b(repair part|replacement part|oem pull|screen only|parts only)\b/i;

function isPartsListing(title: string): boolean {
  return PARTS_LISTING_PATTERN.test(title);
}

function median(sortedAscending: number[]): number {
  const mid = Math.floor(sortedAscending.length / 2);
  return sortedAscending.length % 2 === 0
    ? (sortedAscending[mid - 1] + sortedAscending[mid]) / 2
    : sortedAscending[mid];
}

// A last safety net on top of the title/condition filters above, not a
// replacement for them: no regex can enumerate every real phrasing for
// "this isn't actually a comparable single unit" (bulk/wholesale lots,
// business-account listings, an outright wrong match slipping through).
// Caught live, back when this compared against other eBay asking prices:
// a real $530 iPhone 15 Pro got compared against a peer average of
// $4,028 — one wildly-priced peer that none of the title filters caught
// dragged the whole average up enough to make an ordinary listing look
// implausibly, wrongly profitable. The same risk exists for sold comps
// (a mis-scraped or genuinely different sale slipping into the results),
// so this stays: drops any comparable priced more than 4x away from the
// group's own median (symmetric — a suspiciously *low* one, e.g. an
// accessory-only sale mislabeled, would skew the average the other
// direction) before computing the average actually used. 4x is
// deliberately generous — wide enough to keep genuine condition/storage/
// carrier price spread (confirmed live: a real iPhone 14 Pro comp set
// spans roughly 1.5-2x low to high) without keeping something off by an
// order of magnitude.
const OUTLIER_MULTIPLE = 4;

function rejectPriceOutliers<T>(items: T[], getPriceDollars: (item: T) => number): T[] {
  const prices = items.map(getPriceDollars).sort((a, b) => a - b);
  const med = median(prices);
  if (med <= 0) return items;
  return items.filter((item) => {
    const price = getPriceDollars(item);
    return price >= med / OUTLIER_MULTIPLE && price <= med * OUTLIER_MULTIPLE;
  });
}

function buildSoldSearchUrl(title: string): string {
  return `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(title)}&LH_Sold=1&LH_Complete=1`;
}

export type ElectronicsResult = EbayListing & {
  priceDollars: number;
  // "What has this exact product actually sold for recently" —
  // requested directly ("comparing against previous sold listings of
  // the same exact product"), via SOLD_COMPS_API_KEY (a paid third-party
  // scraper API; eBay's own API won't grant sold/completed-listing data
  // without a restricted scope this app's key doesn't have). Null when
  // fewer than MIN_COMPS_FOR_REFERENCE real comps were found — too few
  // to average meaningfully, treated as "not enough data" rather than a
  // guess, and deliberately NOT backed by a weaker fallback (e.g. active
  // asking prices) when that happens — requested directly: sold comps
  // only, so a profit number showing here always means a real sold
  // price, never silently something else.
  averageSoldPriceDollars: number | null;
  compCount: number;
  // The most recent sale's date among the comps actually used, "YYYY-MM-DD" —
  // null alongside averageSoldPriceDollars when there weren't enough.
  mostRecentSaleDate: string | null;
  // eBay's own sold/completed-listings search for this title — the
  // "verify this yourself" link, always populated regardless of whether
  // enough comps were found, same role PriceCharting's productUrl plays
  // for cards.
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
// Below this many real comps (after excluding bundles/broken/parts
// listings and outliers), the average is too thin to trust.
const MIN_COMPS_FOR_REFERENCE = 3;

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

/**
 * Searches with the listing's full raw title, not a keyword-stripped
 * version — confirmed live (back in this project's trading-card sold-
 * comps era, same API) that this matters: the scraper API does its own
 * eBay-style relevance ranking, so a stripped-down query actually made
 * results *worse* in testing then. No reason to expect electronics
 * titles behave differently.
 */
async function evaluateListing(listing: EbayListing, minProfitDollars: number): Promise<ElectronicsResult> {
  const priceDollars = listing.priceCents / 100;
  const soldSearchUrl = buildSoldSearchUrl(listing.title);

  let comps: SoldComp[] = [];
  try {
    const rawComps = await fetchSoldComps(listing.title);
    const filtered = rawComps.filter((c) => !isBundle(c.title) && !isBrokenCondition(c.condition) && !isPartsListing(c.title));
    comps = rejectPriceOutliers(filtered, (c) => c.soldPriceDollars);
  } catch {
    comps = [];
  }

  if (comps.length < MIN_COMPS_FOR_REFERENCE) {
    return {
      ...listing,
      priceDollars,
      averageSoldPriceDollars: null,
      compCount: comps.length,
      mostRecentSaleDate: null,
      soldSearchUrl,
      estimatedProfitDollars: null,
      isProfitable: false,
      wasChecked: true,
    };
  }

  const averageSoldPriceDollars = comps.reduce((sum, c) => sum + c.soldPriceDollars, 0) / comps.length;
  const mostRecentSaleDate = [...comps].sort((a, b) => (a.endedAt < b.endedAt ? 1 : a.endedAt > b.endedAt ? -1 : 0))[0].endedAt;
  const estimatedProfitDollars = estimateElectronicsResaleProfitDollars(
    priceDollars,
    listing.shippingCents / 100,
    averageSoldPriceDollars
  );
  const isProfitable = estimatedProfitDollars > minProfitDollars;

  return {
    ...listing,
    priceDollars,
    averageSoldPriceDollars,
    compCount: comps.length,
    mostRecentSaleDate,
    soldSearchUrl,
    estimatedProfitDollars,
    isProfitable,
    wasChecked: true,
  };
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
  const listings = rawListings.filter((l) => !isBundle(l.title) && !isBrokenCondition(l.condition) && !isPartsListing(l.title));

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
