import { searchAnyAuctionListings, type EbayAuctionListing } from "@/lib/sources/ebay";
import { getElectronicsSoldPricing, isExcludedListing, buildSoldSearchUrl } from "@/lib/electronicsPricing";
import { estimateElectronicsResaleProfitDollars } from "@/lib/resaleProfit";
import { mapWithConcurrency } from "@/lib/concurrency";

export type ElectronicsAuctionResult = EbayAuctionListing & {
  currentBidDollars: number;
  // Negative once the listed end time has passed — eBay's search index
  // can lag a few seconds/minutes behind an auction actually closing,
  // so this is left negative rather than clamped to 0, which is itself
  // a useful signal ("this already ended, the listing is stale").
  minutesRemaining: number;
  // See getElectronicsSoldPricing in lib/electronicsPricing.ts — null
  // when there wasn't enough real sold history to trust.
  averageSoldPriceDollars: number | null;
  compCount: number;
  mostRecentSaleDate: string | null;
  soldSearchUrl: string;
  // Profit *if won at the current bid* — not a prediction of the final
  // price. An auction can close well above its current bid, especially
  // with real time left or existing bidders (see `bidCount`); this
  // number is only a reasonable proxy for auctions that are both
  // ending soon AND still sitting at a low bid, which is exactly the
  // "nobody's found this yet" case sniping targets.
  estimatedProfitDollars: number | null;
  isProfitable: boolean;
  wasChecked: boolean;
};

// Same cost-conscious caps as Electronics Search (lib/electronicsSearch.ts)
// and for the same reason — SOLD_COMPS_API_KEY is a paid, metered API,
// unlike the free eBay Browse API the trading-card Auction Sniper
// (lib/auctionSnipe.ts) checks against. No "show at least N profitable"
// auto-paging here either: a search costs at most
// AUCTION_MAX_LISTINGS_TO_EVALUATE sold-comps calls, full stop.
const AUCTION_FETCH_LIMIT = 50;
const AUCTION_MAX_LISTINGS_TO_EVALUATE = 12;
const LOOKUP_CONCURRENCY = 6;

export const DEFAULT_MIN_ELECTRONICS_AUCTION_PROFIT_DOLLARS = 0;

export type ElectronicsAuctionSearchOptions = {
  maxHoursRemaining?: number;
  sortBy?: "time" | "price";
  offset?: number;
  minProfitDollars?: number;
};

export type ElectronicsAuctionSearchResult = {
  auctions: ElectronicsAuctionResult[];
};

async function evaluateAuction(auction: EbayAuctionListing, minProfitDollars: number): Promise<ElectronicsAuctionResult> {
  const currentBidDollars = auction.currentBidCents / 100;
  const minutesRemaining = Math.round((new Date(auction.endsAt).getTime() - Date.now()) / 60_000);
  const pricing = await getElectronicsSoldPricing(auction.title);

  if (pricing.averageSoldPriceDollars == null) {
    return {
      ...auction,
      currentBidDollars,
      minutesRemaining,
      ...pricing,
      estimatedProfitDollars: null,
      isProfitable: false,
      wasChecked: true,
    };
  }

  const estimatedProfitDollars = estimateElectronicsResaleProfitDollars(
    currentBidDollars,
    auction.shippingCents / 100,
    pricing.averageSoldPriceDollars
  );
  const isProfitable = estimatedProfitDollars > minProfitDollars;

  return {
    ...auction,
    currentBidDollars,
    minutesRemaining,
    ...pricing,
    estimatedProfitDollars,
    isProfitable,
    wasChecked: true,
  };
}

/**
 * Electronics Auction Sniper — requested directly: "catch ending
 * auctions with potential profit," same workflow as the trading-card
 * Auction Sniper (lib/auctionSnipe.ts) but for any electronics, checked
 * against real sold comps instead of PriceCharting (see
 * lib/electronicsPricing.ts). No eBay category restriction
 * (searchAnyAuctionListings in lib/sources/ebay.ts), each auction
 * checked against its own sold comps rather than one shared reference,
 * same reasoning as Electronics Search.
 *
 * No multi-page auto-search toward a profitable-count target — see
 * Electronics Search's AUCTION_MAX_LISTINGS_TO_EVALUATE comment above
 * for the cost reasoning, identical here. `offset`, when given, shifts
 * the eBay fetch forward one page — the same manual "search again for
 * new results" mechanism as the trading-card version, user-initiated
 * each time rather than automatic.
 */
export async function searchElectronicsAuctions(
  query: string,
  options: ElectronicsAuctionSearchOptions = {}
): Promise<ElectronicsAuctionSearchResult> {
  const { maxHoursRemaining, sortBy = "time", offset = 0, minProfitDollars = DEFAULT_MIN_ELECTRONICS_AUCTION_PROFIT_DOLLARS } =
    options;

  const rawAuctions = await searchAnyAuctionListings(query, AUCTION_FETCH_LIMIT, offset);
  let auctions = rawAuctions.filter((a) => !isExcludedListing(a.title, a.condition) && a.currentBidCents > 0);

  if (maxHoursRemaining != null) {
    const cutoff = Date.now() + maxHoursRemaining * 60 * 60_000;
    auctions = auctions.filter((a) => new Date(a.endsAt).getTime() <= cutoff);
  }

  // Already sorted soonest-ending first by the API — slicing here keeps
  // that order, evaluating the ones about to close (the actual snipe
  // candidates) rather than an arbitrary/cheapest-first subset.
  const toEvaluate = auctions.slice(0, AUCTION_MAX_LISTINGS_TO_EVALUATE);
  const toSkip = auctions.slice(AUCTION_MAX_LISTINGS_TO_EVALUATE);

  const evaluated = await mapWithConcurrency(toEvaluate, LOOKUP_CONCURRENCY, (a) => evaluateAuction(a, minProfitDollars));
  const skipped: ElectronicsAuctionResult[] = toSkip.map((a) => ({
    ...a,
    currentBidDollars: a.currentBidCents / 100,
    minutesRemaining: Math.round((new Date(a.endsAt).getTime() - Date.now()) / 60_000),
    averageSoldPriceDollars: null,
    compCount: 0,
    mostRecentSaleDate: null,
    soldSearchUrl: buildSoldSearchUrl(a.title),
    estimatedProfitDollars: null,
    isProfitable: false,
    wasChecked: false,
  }));

  const combined = [...evaluated, ...skipped];
  const auctionsSorted =
    sortBy === "price"
      ? combined.sort((a, b) => a.currentBidDollars - b.currentBidDollars)
      : combined.sort((a, b) => a.minutesRemaining - b.minutesRemaining);

  return { auctions: auctionsSorted };
}
