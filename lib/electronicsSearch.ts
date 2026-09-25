import { searchAnyListings, type EbayListing } from "@/lib/sources/ebay";
import { isBundle } from "@/lib/cardComparison";
import { estimateElectronicsResaleProfitDollars } from "@/lib/resaleProfit";
import { mapWithConcurrency } from "@/lib/concurrency";

// eBay's own condition string for a broken/salvage item — confirmed live
// as a real value the Browse API returns. Comparing a "for parts" price
// against working peers' average would call a genuinely broken item
// "underpriced," which is backwards — it's cheap because it's broken,
// not because it's a deal.
const BROKEN_CONDITION_PATTERN = /for parts|not working/i;

function isBrokenCondition(condition: string | null): boolean {
  return condition != null && BROKEN_CONDITION_PATTERN.test(condition);
}

// Caught live: searching "Apple Watch Series 9" surfaced a "$56.12 OEM
// Pull Replacement OLED Screen - Repair Part for Apple Watch Series 9"
// as "profitable" — a salvaged screen, not a watch, priced (correctly)
// like a screen, not underpriced at all. A title match on the model
// name doesn't mean it's the actual device; "repair part"/"OEM pull"/
// "screen only"/"for parts only" are all phrasings that specifically
// mean "a piece removed from a device," never a complete, resellable
// unit. Filtered from both the main results and the peer set a listing
// gets compared against, same as isBundle/isBrokenCondition above.
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
// Caught live: a real $530 iPhone 15 Pro got compared against a peer
// average of $4,028 — one wildly-priced peer that none of the title
// filters caught dragged the whole average up enough to make an
// ordinary listing look implausibly, wrongly profitable. Rather than
// chase that one specific listing's exact wording, this rejects any
// peer priced more than 4x away from the peer group's own median
// (symmetric — a suspiciously *low* peer, e.g. an accessory-only
// listing mislabeled, would skew the average the other direction) before
// computing the average actually used. 4x is deliberately generous —
// wide enough to keep genuine condition/storage/carrier price spread
// (confirmed live: a real iPhone 14 Pro peer set spans roughly 1.5-2x
// low to high) without keeping a listing that's off by an order of
// magnitude.
const OUTLIER_MULTIPLE = 4;

function rejectPriceOutliers(peers: EbayListing[]): EbayListing[] {
  const prices = peers.map((p) => p.priceCents / 100).sort((a, b) => a - b);
  const med = median(prices);
  if (med <= 0) return peers;
  return peers.filter((p) => {
    const price = p.priceCents / 100;
    return price >= med / OUTLIER_MULTIPLE && price <= med * OUTLIER_MULTIPLE;
  });
}

export type ElectronicsResult = EbayListing & {
  priceDollars: number;
  // The average asking price among OTHER currently-listed items matching
  // this one's own title — there's no PriceCharting-style "true value"
  // API for general electronics, so (requested directly, same technique
  // Player Search already uses for cards) this is a peer-asking-price
  // average, not a confirmed sold price. Null when fewer than
  // MIN_PEERS_FOR_REFERENCE real peers were found — too few to average
  // meaningfully, treated as "not enough data" rather than a guess.
  peerAveragePriceDollars: number | null;
  peerCount: number;
  estimatedProfitDollars: number | null;
  isProfitable: boolean;
  wasChecked: boolean;
};

// Same reasoning and values as Auction Sniper/Player Search
// (lib/auctionSnipe.ts, lib/playerSearch.ts) — no per-request billing
// concern for eBay's own API the way PriceCharting/sold-comps had, and a
// bound on total lookups per search is still needed to stay within
// Vercel's request timeout.
const FETCH_LIMIT = 50;
const MAX_LISTINGS_TO_EVALUATE = 25;
const MAX_PAGES_PER_SEARCH = 4;
const LOOKUP_CONCURRENCY = 12;
// Below this many real peers (after excluding the listing itself and any
// broken/bundle peers), the average is too thin to trust — confirmed
// live that a tight, specific query (an exact model/storage/color) can
// still turn up 20-30 peers, so requiring a few is a real filter, not
// one that starves every search.
const MIN_PEERS_FOR_REFERENCE = 3;

export const DEFAULT_MIN_ELECTRONICS_PROFIT_DOLLARS = 0;

export type ElectronicsSearchOptions = {
  minPriceDollars?: number;
  maxPriceDollars?: number;
  sortBy?: "profit" | "price";
  offset?: number;
  minProfitDollars?: number;
  minProfitableTarget?: number;
};

export type ElectronicsSearchResult = {
  listings: ElectronicsResult[];
  pagesSearched: number;
  reachedTarget: boolean;
};

/**
 * Peers found by searching eBay again with this listing's own raw
 * title — confirmed live this works well without any electronics-
 * specific keyword extraction (unlike cards' extractSearchKeywords):
 * real listing titles are already fairly structured ("Apple iPhone 14
 * Pro 128GB Fully Unlocked - VERY GOOD Condition") and eBay's own search
 * returns a tight, genuinely-comparable set of other listings for the
 * same model/storage/condition tier. The listing's own itemId is
 * explicitly excluded from its own peer set — without this, a very
 * cheap listing (exactly the kind worth flagging) pulls its own low
 * price into the average that then gets compared against it, making it
 * look less underpriced than it really is relative to the rest of the
 * market.
 */
async function evaluateListing(listing: EbayListing, minProfitDollars: number): Promise<ElectronicsResult> {
  const priceDollars = listing.priceCents / 100;

  let peers: EbayListing[] = [];
  try {
    const rawPeers = await searchAnyListings(listing.title, { limit: 30 });
    const filtered = rawPeers.filter(
      (p) => p.itemId !== listing.itemId && !isBundle(p.title) && !isBrokenCondition(p.condition) && !isPartsListing(p.title)
    );
    peers = rejectPriceOutliers(filtered);
  } catch {
    peers = [];
  }

  if (peers.length < MIN_PEERS_FOR_REFERENCE) {
    return {
      ...listing,
      priceDollars,
      peerAveragePriceDollars: null,
      peerCount: peers.length,
      estimatedProfitDollars: null,
      isProfitable: false,
      wasChecked: true,
    };
  }

  const peerAveragePriceDollars = peers.reduce((sum, p) => sum + p.priceCents / 100, 0) / peers.length;
  const estimatedProfitDollars = estimateElectronicsResaleProfitDollars(
    priceDollars,
    listing.shippingCents / 100,
    peerAveragePriceDollars
  );
  const isProfitable = estimatedProfitDollars > minProfitDollars;

  return {
    ...listing,
    priceDollars,
    peerAveragePriceDollars,
    peerCount: peers.length,
    estimatedProfitDollars,
    isProfitable,
    wasChecked: true,
  };
}

/** One eBay fetch + filter + peer-evaluate pass at a given offset. */
async function fetchAndEvaluatePage(
  query: string,
  minPriceDollars: number | undefined,
  maxPriceDollars: number | undefined,
  minProfitDollars: number,
  pageOffset: number
): Promise<{ results: ElectronicsResult[]; rawCount: number }> {
  const rawListings = await searchAnyListings(query, {
    limit: FETCH_LIMIT,
    minPriceDollars,
    maxPriceDollars,
    offset: pageOffset,
  });
  const listings = rawListings.filter((l) => !isBundle(l.title) && !isBrokenCondition(l.condition) && !isPartsListing(l.title));

  const toEvaluate = listings.slice(0, MAX_LISTINGS_TO_EVALUATE);
  const toSkip = listings.slice(MAX_LISTINGS_TO_EVALUATE);

  const evaluated = await mapWithConcurrency(toEvaluate, LOOKUP_CONCURRENCY, (l) => evaluateListing(l, minProfitDollars));
  const skipped: ElectronicsResult[] = toSkip.map((l) => ({
    ...l,
    priceDollars: l.priceCents / 100,
    peerAveragePriceDollars: null,
    peerCount: 0,
    estimatedProfitDollars: null,
    isProfitable: false,
    wasChecked: false,
  }));

  return { results: [...evaluated, ...skipped], rawCount: rawListings.length };
}

/**
 * Electronics Search — requested directly: "locate iPhones, Apple
 * Watches and any electronics cheaper than their average value so I can
 * resell for profit." No category restriction (see searchAnyListings'
 * doc comment in lib/sources/ebay.ts — a free-text query targets the
 * right eBay category on its own, confirmed live), each listing checked
 * against its own peer-average asking price (see evaluateListing above)
 * rather than one shared reference, for the same reason manual card
 * search gives every listing its own PriceCharting match: a broad query
 * ("iPhone", say) spans many different actual products.
 *
 * `minProfitDollars`/`minProfitableTarget` and the offset/multi-page
 * auto-search behavior mirror Auction Sniper's/Player Search's
 * searchEndingAuctions/searchPlayerCards exactly — see those files' doc
 * comments for the full reasoning, identical here: `minProfitDollars`
 * replaces the default $0 floor, `minProfitableTarget` keeps fetching
 * further eBay pages (up to MAX_PAGES_PER_SEARCH) until that many
 * profitable listings are found or eBay's results run out, and the
 * returned `pagesSearched`/`reachedTarget` let the caller report
 * honestly when a niche search genuinely doesn't have that many.
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
    minProfitableTarget,
  } = options;

  const allResults: ElectronicsResult[] = [];
  let pagesSearched = 0;
  let currentOffset = offset;

  do {
    const page = await fetchAndEvaluatePage(query, minPriceDollars, maxPriceDollars, minProfitDollars, currentOffset);
    pagesSearched++;
    allResults.push(...page.results);

    const profitableSoFar = allResults.filter((l) => l.isProfitable).length;
    const targetReached = !minProfitableTarget || profitableSoFar >= minProfitableTarget;
    const exhausted = page.rawCount < FETCH_LIMIT;

    if (targetReached || exhausted || pagesSearched >= MAX_PAGES_PER_SEARCH) break;
    currentOffset += FETCH_LIMIT;
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
