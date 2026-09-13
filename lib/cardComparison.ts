import { findCard, buildProductUrl, type CardReference } from "@/lib/sources/pricecharting";
import { searchListings, findReferenceListing, type EbayListing, type CardCategory } from "@/lib/sources/ebay";
import { saveNewFinds, type ReferenceInfo, type SavedFind } from "@/lib/db";
import { extractSearchKeywords, extractSerialDenominator, isBundle } from "@/lib/cardKeywords";
import { mapWithConcurrency } from "@/lib/concurrency";
import { estimateResaleProfitDollars } from "@/lib/resaleProfit";

export type { CardCategory };
export { isBundle };

// Graded slabs (PSA 10, BGS 9.5, etc.) sell for multiples of a raw card's
// price. PriceCharting's reference here is ungraded-only, so comparing a
// graded listing against it would produce a false "great deal" — a PSA 10
// priced "50% below" an ungraded reference isn't a deal, it's a mismatch.
//
// Filtered using eBay's own `condition` field (confirmed live: they
// reliably return the literal string "Graded" vs "Ungraded" for trading
// cards, conditionId 2750 vs 4000) — an earlier version of this filter
// used a title regex requiring a grade number right after "PSA"/"BGS"/etc,
// which missed titles like "PSA Graded Mint 9" (words in between) and let
// graded slabs slip through undetected. The structured condition field
// doesn't have that failure mode.
export function isGraded(condition: string | null): boolean {
  return (condition ?? "").toLowerCase().includes("graded") && !(condition ?? "").toLowerCase().includes("ungraded");
}

export type CardListingResult = EbayListing & {
  priceDollars: number;
  percentBelowReference: number | null;
  isUnderpriced: boolean;
  // This listing's OWN best-matching PriceCharting product — not the one
  // product shown at the top of the page for the overall search query.
  // See the comment on searchUnderpricedCards for why these can't be the
  // same thing.
  reference: ReferenceInfo | null;
  // Estimated dollar profit from buying this listing and reselling at
  // PriceCharting's reference price, after eBay's actual selling fee and
  // this listing's own shipping cost — see lib/resaleProfit.ts. The
  // number that actually answers "is this worth buying," which a raw
  // percent-below-reference doesn't: a cheap card 25% under reference can
  // still be a net loss once eBay's ~13.25%+$0.30-0.40 cut is taken out.
  estimatedProfitDollars: number | null;
  // Profit clearing a minimum bar (not just > $0), since a real flip
  // costs real time/effort (listing it, packaging, shipping, the risk of
  // it not selling at the assumed price) that a $1 "profit" doesn't
  // justify. See MIN_WORTHWHILE_PROFIT_DOLLARS.
  isProfitable: boolean;
  // Whether this listing actually got a PriceCharting lookup at all, as
  // opposed to being skipped past `maxListingsToEvaluate`. Needed
  // because both "checked, but no match was found" and "never checked"
  // look identical otherwise (`reference: null`, `estimatedProfitDollars:
  // null`) — without this, a UI summary like "N checked, M not checked"
  // can't actually tell those two apart.
  wasChecked: boolean;
};

export type CardSearchResult = {
  query: string;
  category: CardCategory;
  reference: ReferenceInfo | null;
  listings: CardListingResult[];
};

export const UNDERPRICED_THRESHOLD_PERCENT = 20;

// A real flip costs real effort (listing it, packaging, shipping,
// waiting for it to actually sell at the assumed reference price rather
// than sitting unsold) — a $1-2 "profit" after fees isn't worth that. $5
// is a starting point, not derived from anything more rigorous than
// "clearly worth doing."
export const MIN_WORTHWHILE_PROFIT_DOLLARS = 5;

// Cheapest 12 listings per manual search get their own PriceCharting
// lookup — bounds how many concurrent requests hit PriceCharting per
// search (their docs mention a 1-request/second limit; concurrency 12
// hasn't shown rate-limiting in testing, but this keeps a broad search
// from firing 30 at once regardless) and keeps a search fast. Listings
// past the cap are still shown, just without their own reference.
export const SEARCH_MAX_LISTINGS_TO_EVALUATE = 12;

const LOOKUP_CONCURRENCY = 12;

/**
 * A real link (and, for the search page's top summary only, a photo) for
 * this exact card, so it's obvious whether whatever's being compared
 * against is actually the right one. `productUrl` (the reference's own
 * PriceCharting/SportsCardsPro page) is always populated — it's the
 * actual source the reference price came from, and the only genuine way
 * to verify this is the right card: PriceCharting's API has no image
 * field at all, at any subscription tier (confirmed against their own
 * API docs), so there's no such thing as "their photo" to fetch through
 * it. `imageUrl`/`itemWebUrl` (when `includeImage` is on) are a
 * *different, weaker* thing: an eBay listing that merely shares the same
 * eBay catalog id as this product. Tried showing that next to every
 * listing as a "verify" photo; removed again — it isn't actually
 * PriceCharting's photo, and even after fixing it self-matching the
 * listing being checked, it was still just an eBay photo mislabeled as a
 * verification, not a real one. Kept only for the top-of-page summary
 * reference, which isn't compared against one specific listing.
 */
export async function buildReferenceInfo(
  reference: CardReference,
  category: CardCategory,
  includeImage = true
): Promise<ReferenceInfo> {
  let imageUrl: string | null = null;
  let itemWebUrl: string | null = null;
  if (includeImage && reference.epid) {
    try {
      const found = await findReferenceListing(`${reference.productName} ${reference.consoleName}`, reference.epid);
      imageUrl = found?.imageUrl ?? null;
      itemWebUrl = found?.itemWebUrl ?? null;
    } catch {
      // Not worth failing the whole thing over — ebaySearchUrl/productUrl
      // below still give a way to double-check the reference by hand.
    }
  }
  return {
    productName: reference.productName,
    ungradedPriceDollars: (reference.ungradedPriceCents ?? 0) / 100,
    imageUrl,
    itemWebUrl,
    ebaySearchUrl: `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(reference.productName + " " + reference.consoleName)}`,
    productUrl: buildProductUrl(reference, category),
  };
}

/**
 * Checks one listing against its OWN best-matching PriceCharting product
 * — never the single reference computed for the overall search query.
 * This is the actual fix for a serious, reported-live bug: searching (or
 * watching) a bare player name like "Luka doncic" returns listings
 * spanning many completely different cards (a 2018 base Prizm, a 2024-25
 * Obsidian Red Electric Etch parallel, etc.) — comparing all of them
 * against one shared reference (whichever single product that broad
 * query happened to match) produced nonsense.
 *
 * Never fetches a per-listing reference photo — see buildReferenceInfo's
 * doc comment for why. `productUrl` (always populated) remains the real
 * way to verify: a direct link to the actual PriceCharting/SportsCardsPro
 * page.
 *
 * Looks up the listing's OWN raw title, not an extractSearchKeywords-
 * stripped version — findCard's relevance scoring needs the set-name/
 * parallel words that stripping discards to disambiguate correctly (see
 * findCard's doc comment in lib/sources/pricecharting.ts).
 */
async function evaluateListing(listing: EbayListing, category: CardCategory): Promise<CardListingResult> {
  const priceDollars = listing.priceCents / 100;

  let reference: CardReference | null;
  try {
    reference = await findCard(listing.title, category);
  } catch {
    reference = null;
  }

  if (!reference?.ungradedPriceCents || reference.ungradedPriceCents <= 0) {
    return {
      ...listing,
      priceDollars,
      percentBelowReference: null,
      isUnderpriced: false,
      reference: null,
      estimatedProfitDollars: null,
      isProfitable: false,
      wasChecked: true,
    };
  }

  const percentBelowReference = ((reference.ungradedPriceCents - listing.priceCents) / reference.ungradedPriceCents) * 100;
  const isUnderpriced = percentBelowReference >= UNDERPRICED_THRESHOLD_PERCENT;
  const referenceInfo = await buildReferenceInfo(reference, category, false);
  const estimatedProfitDollars = estimateResaleProfitDollars(
    priceDollars,
    listing.shippingCents / 100,
    referenceInfo.ungradedPriceDollars
  );
  const isProfitable = estimatedProfitDollars >= MIN_WORTHWHILE_PROFIT_DOLLARS;

  return {
    ...listing,
    priceDollars,
    percentBelowReference,
    isUnderpriced,
    reference: referenceInfo,
    estimatedProfitDollars,
    isProfitable,
    wasChecked: true,
  };
}

/**
 * `includeReferenceImage` costs one extra eBay API call and only affects
 * the top-of-page summary reference (the product matched for the overall
 * `query`, shown for context) — pass false to skip it when that summary
 * won't be displayed (e.g. the watchlist, which no longer uses it for
 * the underpriced determination at all, see evaluateListing above).
 * Individual listings never fetch a reference photo at all — see
 * evaluateListing's doc comment for why that was removed entirely.
 *
 * `maxListingsToEvaluate` caps how many listings get their own
 * PriceCharting lookup — listings past the cap are NOT dropped from the
 * results, just returned without their own reference/profit estimate, so
 * a manual search still shows everything eBay actually has.
 */
export async function searchUnderpricedCards(
  query: string,
  category: CardCategory,
  includeReferenceImage = false,
  maxListingsToEvaluate?: number
): Promise<CardSearchResult> {
  // Only rewrite the query when it carries a print-run denominator
  // ("/150") — a strong, safe signal this is a pasted-in raw eBay title
  // rather than a short deliberate search like "2018 Panini Prizm Luka
  // Doncic". Rewriting the latter would risk dropping its year and
  // matching the wrong season's card instead — gating on the serial
  // number avoids that regression entirely, since a short deliberate
  // query essentially never includes one. This still narrows what's sent
  // to eBay's own listings search, which has no relevance scoring of its
  // own to fall back on.
  const effectiveQuery = extractSerialDenominator(query) ? extractSearchKeywords(query) : query;

  // The PriceCharting lookup, by contrast, gets the full raw query, not
  // effectiveQuery — findCard's relevance scoring needs the set-name/
  // parallel words that extractSearchKeywords strips out to disambiguate
  // correctly.
  const [reference, rawListings] = await Promise.all([
    findCard(query, category),
    searchListings(effectiveQuery, category),
  ]);

  let ungradedListings = rawListings.filter((l) => !isGraded(l.condition) && !isBundle(l.title));

  // Filtering listings by the query's own print-run denominator closes a
  // gap the query-rewrite above doesn't: a search for "...Cade Cunningham
  // #88 Blue Refractor /150..." can still return "Red White & Blue
  // Refractor" listings (a different, much cheaper parallel) alongside
  // the real ones. Now a secondary safety net rather than the primary
  // fix — each listing gets its own accurate reference below regardless
  // — but still worth keeping: it trims the list down before that
  // (per-listing) work happens.
  const querySerial = extractSerialDenominator(query);
  if (querySerial) {
    const withSerial = ungradedListings.filter((l) => l.title.includes(querySerial));
    if (withSerial.length > 0) ungradedListings = withSerial;
  }

  // Cheapest-first cap — the listings past it are kept, not discarded,
  // just returned without their own PriceCharting lookup (`toSkip`
  // below), same as a listing whose lookup simply found nothing.
  let toEvaluate = ungradedListings;
  let toSkip: EbayListing[] = [];
  if (maxListingsToEvaluate != null && ungradedListings.length > maxListingsToEvaluate) {
    const sorted = [...ungradedListings].sort((a, b) => a.priceCents - b.priceCents);
    toEvaluate = sorted.slice(0, maxListingsToEvaluate);
    toSkip = sorted.slice(maxListingsToEvaluate);
  }

  // Each listing checked against its own match, not the shared `reference`
  // below — see evaluateListing's doc comment for why that distinction is
  // the actual fix for a real reported bug. Bounded concurrency for the
  // same reason Discover uses it: sequential would be far too slow for a
  // search returning up to 30 listings.
  const evaluated = await mapWithConcurrency(toEvaluate, LOOKUP_CONCURRENCY, (l) => evaluateListing(l, category));
  const skipped: CardListingResult[] = toSkip.map((l) => ({
    ...l,
    priceDollars: l.priceCents / 100,
    percentBelowReference: null,
    isUnderpriced: false,
    reference: null,
    estimatedProfitDollars: null,
    isProfitable: false,
    wasChecked: false,
  }));
  const listings = [...evaluated, ...skipped];

  // Most profitable first (the actual point of this app), then whatever
  // wasn't evaluated (capped out, or no match found) by price ascending.
  listings.sort((a, b) => {
    if (a.estimatedProfitDollars != null && b.estimatedProfitDollars != null) {
      return b.estimatedProfitDollars - a.estimatedProfitDollars;
    }
    if (a.estimatedProfitDollars != null) return -1;
    if (b.estimatedProfitDollars != null) return 1;
    return a.priceDollars - b.priceDollars;
  });

  // This is the *overall query's* best match, shown at the top of the
  // page for context — not what any individual listing below is actually
  // compared against anymore (each has its own, in `listings[].reference`).
  const referenceInfo = reference ? await buildReferenceInfo(reference, category, includeReferenceImage) : null;

  return {
    query,
    category,
    reference: referenceInfo,
    listings,
  };
}

// Cheapest 5 listings per card, per check — same reasoning as
// SEARCH_MAX_LISTINGS_TO_EVALUATE above, just a tighter number since this
// runs on an immediate on-add check rather than a one-off manual search.
const WATCHLIST_MAX_LISTINGS_PER_CHECK = 5;

/**
 * Runs a search for one watchlist card and saves any underpriced listings
 * found. Shared by the scheduled check (check-watchlist route) and an
 * immediate on-add check (watchlist route's POST) — without the latter,
 * adding a card gives zero feedback until the next scheduled run.
 *
 * Filters by `isProfitable`, not `isUnderpriced`: the whole point of this
 * app is finding cards worth buying to resell, and a listing can be
 * "underpriced" (below PriceCharting's reference) while still being a
 * net loss after eBay's real selling fee, especially on cheap cards
 * where the flat $0.30-0.40 per-order fee is a large share of the sale.
 * `isProfitable` is the number that actually answers "is this worth
 * buying" — see lib/resaleProfit.ts.
 *
 * Each saved find carries `l.reference` — that listing's own match from
 * evaluateListing — not the watchlist entry's overall query match. This
 * matters most exactly when the watchlist entry is broad (just a player
 * name, e.g. "Luka doncic", not "2018 Panini Prizm Luka Doncic"): the
 * listings returned span many different real cards, and using one shared
 * reference for all of them was a reported bug this fixes.
 */
export async function checkCardAndSaveFinds(card: string, category: CardCategory): Promise<number> {
  // The top-of-page summary reference (searchUnderpricedCards's own
  // `reference`) is never shown here, so there's no reason to spend the
  // extra eBay call fetching its photo.
  const result = await searchUnderpricedCards(card, category, false, WATCHLIST_MAX_LISTINGS_PER_CHECK);
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
      reference: l.reference ?? undefined,
      foundAt: new Date().toISOString(),
    }));
  return saveNewFinds(candidates);
}
