import { searchAuctionListings, type EbayAuctionListing, type CardCategory } from "@/lib/sources/ebay";
import { isGraded, isBundle, MIN_WORTHWHILE_PROFIT_DOLLARS, buildReferenceInfo } from "@/lib/cardComparison";
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
};

// Same budget discipline as manual search (SEARCH_MAX_LISTINGS_TO_EVALUATE
// in lib/cardComparison.ts) — bounds concurrent PriceCharting requests
// per search.
const AUCTION_MAX_LISTINGS_TO_EVALUATE = 12;
const LOOKUP_CONCURRENCY = 12;

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
    return { ...auction, currentBidDollars, minutesRemaining, reference: null, estimatedProfitDollars: null, isProfitable: false };
  }

  const referenceInfo = await buildReferenceInfo(reference, category, false);
  const estimatedProfitDollars = estimateResaleProfitDollars(
    currentBidDollars,
    auction.shippingCents / 100,
    referenceInfo.ungradedPriceDollars
  );
  const isProfitable = estimatedProfitDollars >= MIN_WORTHWHILE_PROFIT_DOLLARS;

  return { ...auction, currentBidDollars, minutesRemaining, reference: referenceInfo, estimatedProfitDollars, isProfitable };
}

/**
 * Live auctions for a card, soonest-ending first, each checked against
 * its own best-matching PriceCharting product — same "each listing gets
 * its own comparison" rule as manual search, for the same reason (see
 * evaluateListing in lib/cardComparison.ts). `maxHoursRemaining`, when
 * given, drops anything ending further out than that — sniping is about
 * acting in a specific window, not browsing every auction that exists
 * for a card.
 *
 * Capped to the soonest-ending `AUCTION_MAX_LISTINGS_TO_EVALUATE` for
 * the PriceCharting lookup — the rest are still returned (title, bid,
 * time left, link), just without their own reference/profit estimate.
 */
export async function searchEndingAuctions(
  query: string,
  category: CardCategory,
  maxHoursRemaining?: number
): Promise<AuctionSnipeResult[]> {
  const effectiveQuery = extractSerialDenominator(query) ? extractSearchKeywords(query) : query;
  const rawAuctions = await searchAuctionListings(effectiveQuery, category);

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
  }));

  // Ending soonest first, preserved from eBay's own sort — that's the
  // actual point (what do I need to watch in the next hour), not a
  // profit-sorted list like manual search.
  return [...evaluated, ...skipped].sort((a, b) => a.minutesRemaining - b.minutesRemaining);
}
