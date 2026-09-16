import { searchAuctionListings, type EbayAuctionListing, type CardCategory } from "@/lib/sources/ebay";
import { isGraded, isBundle, buildReferenceInfo } from "@/lib/cardComparison";
import { extractSearchKeywords, extractSerialDenominator } from "@/lib/cardKeywords";
import { findCard } from "@/lib/sources/pricecharting";
import type { ReferenceInfo } from "@/lib/db";
import { estimateResaleProfitDollars } from "@/lib/resaleProfit";
import { mapWithConcurrency } from "@/lib/concurrency";

export type AuctionSnipeResult = EbayAuctionListing & {
  currentBidDollars: number;
  // Negative once the listed end time has passed — eBay's search index
  // can lag a few seconds/minutes behind an auction actually closing,
  // so this is left negative rather than clamped to 0, which is itself
  // a useful signal ("this already ended, the listing is stale").
  minutesRemaining: number;
  reference: ReferenceInfo | null;
  // Profit *if won at the current bid* — not a prediction of the final
  // price. An auction can close well above its current bid, especially
  // with real time left or existing bidders (see `bidCount`); this
  // number is only a reasonable proxy for auctions that are both
  // ending soon AND still sitting at a low bid, which is exactly the
  // "nobody's found this yet" case sniping targets.
  estimatedProfitDollars: number | null;
  isProfitable: boolean;
  // Whether this auction actually got a PriceCharting lookup, as opposed
  // to being skipped past `AUCTION_MAX_LISTINGS_TO_EVALUATE` — same
  // reasoning as CardListingResult.wasChecked in lib/cardComparison.ts:
  // "checked, no match found" and "never checked" both otherwise look
  // like `reference: null`, which a UI summary can't tell apart.
  wasChecked: boolean;
};

// Fetches more than eBay's/searchAuctionListings' 30-item default and
// evaluates more than manual search's SEARCH_MAX_LISTINGS_TO_EVALUATE (12)
// — requested directly after a "within the day" search only checked 12
// of the 20-25 auctions actually returned, missing real profitable ones
// sitting just past the cap. PriceCharting isn't billed per-request the
// way sold comps was (see "A brief detour through sold comps, and back"
// in the README), so there's no cost reason to keep this as tight as the
// sold-comps era did; their docs mention a 1-request/second limit and
// concurrency 12 hasn't shown rate-limiting in testing at this volume.
const AUCTION_FETCH_LIMIT = 50;
const AUCTION_MAX_LISTINGS_TO_EVALUATE = 25;
const LOOKUP_CONCURRENCY = 12;

// Auction Sniper's own, much lower bar than manual search's
// MIN_WORTHWHILE_PROFIT_DOLLARS ($5) — requested directly ("make sure
// the listings that do show up are profitable even if it's a penny").
// Manual search's $5 floor exists because a real flip costs real effort
// or it's not worth the API-comparable "browse and decide" flow; sniping
// is a different use case — a fast scan of what's ending soon that's
// merely worth a second look, where a $0.25 edge on a $1 bid is still
// useful signal even if it wouldn't clear manual search's bar. Strictly
// greater than zero, not "not a loss" — breakeven isn't a profit.
const MIN_AUCTION_PROFIT_DOLLARS = 0;

async function evaluateAuction(auction: EbayAuctionListing, category: CardCategory): Promise<AuctionSnipeResult> {
  const currentBidDollars = auction.currentBidCents / 100;
  const minutesRemaining = Math.round((new Date(auction.endsAt).getTime() - Date.now()) / 60_000);

  let reference;
  try {
    reference = await findCard(auction.title, category);
  } catch {
    reference = null;
  }

  if (!reference?.ungradedPriceCents || reference.ungradedPriceCents <= 0) {
    return {
      ...auction,
      currentBidDollars,
      minutesRemaining,
      reference: null,
      estimatedProfitDollars: null,
      isProfitable: false,
      wasChecked: true,
    };
  }

  const referenceInfo = await buildReferenceInfo(reference, category, false);
  const estimatedProfitDollars = estimateResaleProfitDollars(
    currentBidDollars,
    auction.shippingCents / 100,
    referenceInfo.ungradedPriceDollars
  );
  const isProfitable = estimatedProfitDollars > MIN_AUCTION_PROFIT_DOLLARS;

  return {
    ...auction,
    currentBidDollars,
    minutesRemaining,
    reference: referenceInfo,
    estimatedProfitDollars,
    isProfitable,
    wasChecked: true,
  };
}

/**
 * Live auctions for a card, each checked against its own best-matching
 * PriceCharting product — same "each listing gets its own comparison"
 * rule as manual search, for the same reason (see evaluateListing in
 * lib/cardComparison.ts). `maxHoursRemaining`, when given, drops anything
 * ending further out than that — sniping is about acting in a specific
 * window, not browsing every auction that exists for a card. Fractional
 * values work (0.5 = 30 minutes), so the window can go tighter than an
 * hour.
 *
 * Capped to the soonest-ending `AUCTION_MAX_LISTINGS_TO_EVALUATE` for the
 * PriceCharting lookup regardless of `sortBy` below — those are the
 * actual snipe candidates worth spending a lookup on even if the final
 * list is displayed sorted by price. The rest are still returned (title,
 * bid, time left, link), just without their own reference/profit
 * estimate.
 *
 * `sortBy` controls the order of the final, returned list only (not which
 * auctions get evaluated, above): "time" (default) is soonest-ending
 * first — "what do I need to watch in the next hour" — `"price"` is
 * current bid lowest-to-highest, requested directly as a second way to
 * scan results. Price is always known (it's on the raw auction, not
 * something that requires a PriceCharting lookup), so this sort applies
 * cleanly whether or not a given auction was actually checked.
 */
export async function searchEndingAuctions(
  query: string,
  category: CardCategory,
  maxHoursRemaining?: number,
  sortBy: "time" | "price" = "time"
): Promise<AuctionSnipeResult[]> {
  const effectiveQuery = extractSerialDenominator(query) ? extractSearchKeywords(query) : query;
  const rawAuctions = await searchAuctionListings(effectiveQuery, category, AUCTION_FETCH_LIMIT);

  let auctions = rawAuctions.filter((a) => !isGraded(a.condition) && !isBundle(a.title) && a.currentBidCents > 0);

  const querySerial = extractSerialDenominator(query);
  if (querySerial) {
    const withSerial = auctions.filter((a) => a.title.includes(querySerial));
    if (withSerial.length > 0) auctions = withSerial;
  }

  if (maxHoursRemaining != null) {
    const cutoff = Date.now() + maxHoursRemaining * 60 * 60_000;
    auctions = auctions.filter((a) => new Date(a.endsAt).getTime() <= cutoff);
  }

  // Already sorted soonest-ending first by the API — slicing here keeps
  // that order, evaluating the ones about to close (the actual snipe
  // candidates) rather than an arbitrary/cheapest-first subset.
  const toEvaluate = auctions.slice(0, AUCTION_MAX_LISTINGS_TO_EVALUATE);
  const toSkip = auctions.slice(AUCTION_MAX_LISTINGS_TO_EVALUATE);

  const evaluated = await mapWithConcurrency(toEvaluate, LOOKUP_CONCURRENCY, (a) => evaluateAuction(a, category));
  const skipped: AuctionSnipeResult[] = toSkip.map((a) => ({
    ...a,
    currentBidDollars: a.currentBidCents / 100,
    minutesRemaining: Math.round((new Date(a.endsAt).getTime() - Date.now()) / 60_000),
    reference: null,
    estimatedProfitDollars: null,
    isProfitable: false,
    wasChecked: false,
  }));

  const combined = [...evaluated, ...skipped];
  return sortBy === "price"
    ? combined.sort((a, b) => a.currentBidDollars - b.currentBidDollars)
    : combined.sort((a, b) => a.minutesRemaining - b.minutesRemaining);
}
