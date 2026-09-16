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
// per page — requested directly after a "within the day" search only
// checked 12 of the 20-25 auctions actually returned, missing real
// profitable ones sitting just past the cap. PriceCharting isn't billed
// per-request the way sold comps was (see "A brief detour through sold
// comps, and back" in the README), so there's no cost reason to keep
// this as tight as the sold-comps era did; their docs mention a
// 1-request/second limit and concurrency 12 hasn't shown rate-limiting
// in testing at this volume.
const AUCTION_FETCH_LIMIT = 50;
const AUCTION_MAX_LISTINGS_TO_EVALUATE = 25;
const LOOKUP_CONCURRENCY = 12;

// Auction Sniper's own, adjustable, much lower default bar than manual
// search's MIN_WORTHWHILE_PROFIT_DOLLARS ($5) — requested directly
// ("make sure the listings that do show up are profitable even if it's
// a penny", later made an adjustable filter). Manual search's $5 floor
// exists because a real flip costs real effort or it's not worth the
// "browse and decide" flow; sniping defaults to a lower bar since it's a
// faster scan of what's worth a second look — but the user can raise it
// back up if pennies aren't worth their time.
export const DEFAULT_MIN_AUCTION_PROFIT_DOLLARS = 0;

// When a caller asks for a minimum number of profitable results
// (`minProfitableTarget`), this bounds how many additional eBay pages
// get fetched chasing that target — without a cap, a high target on a
// niche card (which may not have anywhere near that many profitable
// auctions, ever) would keep paging until eBay's results ran out,
// risking Vercel's request timeout. Each page can cost up to
// AUCTION_MAX_LISTINGS_TO_EVALUATE PriceCharting lookups, so this bounds
// total lookups per search to roughly 4x that.
const MAX_PAGES_PER_SEARCH = 4;

export type AuctionSearchOptions = {
  maxHoursRemaining?: number;
  // "time" (default) is soonest-ending first — "what do I need to watch
  // in the next hour." "price" is current bid lowest-to-highest,
  // requested directly as a second way to scan results. Only reorders
  // the final returned list; doesn't change which auctions get
  // evaluated (see below).
  sortBy?: "time" | "price";
  // Shifts the starting eBay fetch forward by this many auctions —
  // requested directly ("if I search and don't see anything, I can
  // search again and get new results"). See searchEndingAuctions' doc
  // comment.
  offset?: number;
  // Requested directly, made adjustable after starting at a fixed
  // "any profit counts" bar: the actual dollar floor an auction's
  // estimated profit must clear to count as `isProfitable`.
  minProfitDollars?: number;
  // Requested directly ("show at least 25 profitable listings each
  // search"): keeps fetching and evaluating additional eBay pages,
  // starting from `offset`, until at least this many profitable auctions
  // have been found or MAX_PAGES_PER_SEARCH is reached — whichever comes
  // first. Omit (or 0) to fetch and evaluate a single page, the original
  // behavior.
  minProfitableTarget?: number;
};

export type AuctionSearchResult = {
  auctions: AuctionSnipeResult[];
  // How many eBay pages (of AUCTION_FETCH_LIMIT each) actually got
  // fetched — 1 unless minProfitableTarget pushed it further. The caller
  // needs this to compute where a genuinely-fresh repeat search should
  // start from (offset + pagesSearched * AUCTION_FETCH_LIMIT), since it
  // may have consumed more than one page's worth of offset already.
  pagesSearched: number;
  // False when minProfitableTarget was set but MAX_PAGES_PER_SEARCH (or
  // eBay simply running out of matching auctions) was hit first — lets
  // the UI say "found 18 of the 25 you asked for" honestly instead of
  // silently returning fewer than requested.
  reachedTarget: boolean;
};

async function evaluateAuction(
  auction: EbayAuctionListing,
  category: CardCategory,
  minProfitDollars: number
): Promise<AuctionSnipeResult> {
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
  const isProfitable = estimatedProfitDollars > minProfitDollars;

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

/** One eBay fetch + filter + PriceCharting-evaluate pass at a given offset. */
async function fetchAndEvaluatePage(
  query: string,
  category: CardCategory,
  maxHoursRemaining: number | undefined,
  minProfitDollars: number,
  pageOffset: number
): Promise<{ results: AuctionSnipeResult[]; rawCount: number }> {
  const effectiveQuery = extractSerialDenominator(query) ? extractSearchKeywords(query) : query;
  const rawAuctions = await searchAuctionListings(effectiveQuery, category, AUCTION_FETCH_LIMIT, pageOffset);

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

  const evaluated = await mapWithConcurrency(toEvaluate, LOOKUP_CONCURRENCY, (a) =>
    evaluateAuction(a, category, minProfitDollars)
  );
  const skipped: AuctionSnipeResult[] = toSkip.map((a) => ({
    ...a,
    currentBidDollars: a.currentBidCents / 100,
    minutesRemaining: Math.round((new Date(a.endsAt).getTime() - Date.now()) / 60_000),
    reference: null,
    estimatedProfitDollars: null,
    isProfitable: false,
    wasChecked: false,
  }));

  return { results: [...evaluated, ...skipped], rawCount: rawAuctions.length };
}

/**
 * Live auctions for a card, each checked against its own best-matching
 * PriceCharting product — same "each listing gets its own comparison"
 * rule as manual search, for the same reason (see evaluateListing in
 * lib/cardComparison.ts).
 *
 * Without `minProfitableTarget`, this fetches and evaluates exactly one
 * page (`pagesSearched: 1`) — the original behavior. With it set, pages
 * are fetched starting from `offset` and moving forward
 * (`+AUCTION_FETCH_LIMIT` each time) until either that many profitable
 * auctions have been found, `MAX_PAGES_PER_SEARCH` is hit, or eBay
 * returns fewer than a full page (nothing left to page through) —
 * requested directly ("show at least 25 profitable listings each
 * search"). `reachedTarget` in the result tells the caller which of
 * those it stopped for, so the UI can say "found 18 of 25" honestly
 * rather than imply success either way.
 */
export async function searchEndingAuctions(
  query: string,
  category: CardCategory,
  options: AuctionSearchOptions = {}
): Promise<AuctionSearchResult> {
  const {
    maxHoursRemaining,
    sortBy = "time",
    offset = 0,
    minProfitDollars = DEFAULT_MIN_AUCTION_PROFIT_DOLLARS,
    minProfitableTarget,
  } = options;

  const allResults: AuctionSnipeResult[] = [];
  let pagesSearched = 0;
  let currentOffset = offset;

  do {
    const page = await fetchAndEvaluatePage(query, category, maxHoursRemaining, minProfitDollars, currentOffset);
    pagesSearched++;
    allResults.push(...page.results);

    const profitableSoFar = allResults.filter((a) => a.isProfitable).length;
    const targetReached = !minProfitableTarget || profitableSoFar >= minProfitableTarget;
    const exhausted = page.rawCount < AUCTION_FETCH_LIMIT;

    if (targetReached || exhausted || pagesSearched >= MAX_PAGES_PER_SEARCH) break;
    currentOffset += AUCTION_FETCH_LIMIT;
  } while (true);

  const profitableTotal = allResults.filter((a) => a.isProfitable).length;
  const reachedTarget = !minProfitableTarget || profitableTotal >= minProfitableTarget;

  const auctions =
    sortBy === "price"
      ? [...allResults].sort((a, b) => a.currentBidDollars - b.currentBidDollars)
      : [...allResults].sort((a, b) => a.minutesRemaining - b.minutesRemaining);

  return { auctions, pagesSearched, reachedTarget };
}
