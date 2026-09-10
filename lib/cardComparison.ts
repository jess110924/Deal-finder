import { findCard, buildProductUrl, type CardCategory, type CardReference } from "@/lib/sources/pricecharting";
import { searchListings, findReferenceListing, type EbayListing } from "@/lib/sources/ebay";
import { saveNewFinds, type ReferenceInfo, type SavedFind } from "@/lib/db";
import { extractSearchKeywords, extractSerialDenominator } from "@/lib/cardKeywords";

export type { CardCategory };

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

// A "lot of 5" (or similar bundle) listing's price covers multiple cards,
// not the one being searched for — comparing its total price against a
// single-card reference price is meaningless, not just ungraded-vs-graded
// mismatched. Caught this from a real result: a 5-card lot spanning three
// different products (Hoops, Chronicles, Prizm Emergent) at $350 sitting
// in results for a Prizm-only search, condition "New" so the grading
// filter didn't (and shouldn't have) caught it.
const LOT_PATTERN = /\b(lot of|lot\/|\(\d+\)|\d+[- ]card lot|bundle)\b/i;

export function isBundle(title: string): boolean {
  return LOT_PATTERN.test(title);
}

export type CardListingResult = EbayListing & {
  priceDollars: number;
  percentBelowReference: number | null;
  isUnderpriced: boolean;
};

export type CardSearchResult = {
  query: string;
  category: CardCategory;
  reference: ReferenceInfo | null;
  listings: CardListingResult[];
};

export const UNDERPRICED_THRESHOLD_PERCENT = 20;

/**
 * A real photo + link for this exact card, so it's obvious at a glance
 * whether whatever's being compared against is actually the right card.
 * `productUrl` (the reference's own PriceCharting/SportsCardsPro page) is
 * always populated — it's the primary "verify" link, since it's the
 * actual source the reference price came from. The eBay-sourced photo/
 * link only exist when PriceCharting linked an eBay catalog id (epid) for
 * this product — not every product has one (confirmed: newer/more-
 * searched cards tend to, older ones sometimes don't) — and
 * `ebaySearchUrl` is a secondary always-available fallback for those.
 * `query` should be the search text that found this reference (not
 * necessarily the product's own name) since that's what's passed to the
 * epid lookup.
 */
export async function buildReferenceInfo(
  query: string,
  reference: CardReference,
  category: CardCategory,
  includeImage = true
): Promise<ReferenceInfo> {
  let imageUrl: string | null = null;
  let itemWebUrl: string | null = null;
  if (includeImage && reference.epid) {
    try {
      const found = await findReferenceListing(query, reference.epid);
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
 * `includeReferenceImage` costs one extra eBay API call and is only
 * worthwhile when the reference is actually going to be shown to someone
 * or saved — pass false to skip it (e.g. discovery's own per-listing
 * lookups build their own reference info directly, only for candidates
 * that already cleared the underpriced threshold).
 */
export async function searchUnderpricedCards(
  query: string,
  category: CardCategory,
  includeReferenceImage = false
): Promise<CardSearchResult> {
  // Only rewrite the query when it carries a print-run denominator
  // ("/150") — a strong, safe signal this is a pasted-in raw eBay title
  // (reported directly: pasting a full eBay title into PriceCharting
  // returns the wrong card) rather than a short deliberate search like
  // "2018 Panini Prizm Luka Doncic". Rewriting the latter would risk
  // dropping its year and matching the wrong season's card instead —
  // gating on the serial number avoids that regression entirely, since a
  // short deliberate query essentially never includes one.
  const effectiveQuery = extractSerialDenominator(query) ? extractSearchKeywords(query) : query;

  const [reference, rawListings] = await Promise.all([
    findCard(effectiveQuery, category),
    searchListings(effectiveQuery, category),
  ]);

  let ungradedListings = rawListings.filter((l) => !isGraded(l.condition) && !isBundle(l.title));

  // Rewriting the query only helps when a subject can be confidently
  // guessed (see extractSearchKeywords) — plenty of real titles start
  // with the year instead of the player, where it can't, and the
  // listings search then stays as loose as the raw title. Confirmed live
  // this lets the wrong parallel through even after the fix above: a
  // search for "...Cade Cunningham #88 Blue Refractor /150..." correctly
  // matched the right PriceCharting product ($34.99) but still returned
  // "Red White & Blue Refractor" listings (a different, much cheaper
  // parallel) flagged as underpriced against it. Filtering the listings
  // themselves by the serial number closes this regardless of whether
  // the query rewrite above succeeded.
  const querySerial = extractSerialDenominator(query);
  if (querySerial) {
    const withSerial = ungradedListings.filter((l) => l.title.includes(querySerial));
    if (withSerial.length > 0) ungradedListings = withSerial;
  }

  const referencePriceCents = reference?.ungradedPriceCents ?? null;

  const listings: CardListingResult[] = ungradedListings.map((l) => {
    const percentBelowReference =
      referencePriceCents && referencePriceCents > 0
        ? ((referencePriceCents - l.priceCents) / referencePriceCents) * 100
        : null;

    return {
      ...l,
      priceDollars: l.priceCents / 100,
      percentBelowReference,
      isUnderpriced: percentBelowReference != null && percentBelowReference >= UNDERPRICED_THRESHOLD_PERCENT,
    };
  });

  // Best deals (most below reference) first, then everything else by price.
  listings.sort((a, b) => {
    if (a.percentBelowReference != null && b.percentBelowReference != null) {
      return b.percentBelowReference - a.percentBelowReference;
    }
    return a.priceDollars - b.priceDollars;
  });

  const referenceInfo = reference ? await buildReferenceInfo(effectiveQuery, reference, category, includeReferenceImage) : null;

  return {
    query,
    category,
    reference: referenceInfo,
    listings,
  };
}

/**
 * Runs a search for one watchlist card and saves any underpriced listings
 * found. Shared by the scheduled check (check-watchlist route, every ~30
 * min) and an immediate on-add check (watchlist route's POST) — without
 * the latter, adding a card gives zero feedback until the next scheduled
 * run, up to 30 minutes of "did this even work?" with nothing to look at.
 */
export async function checkCardAndSaveFinds(card: string, category: CardCategory): Promise<number> {
  const result = await searchUnderpricedCards(card, category, true);
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
      reference: result.reference ?? undefined,
      foundAt: new Date().toISOString(),
    }));
  return saveNewFinds(candidates);
}
