import { findCard, type CardCategory, type CardReference } from "@/lib/sources/pricecharting";
import { searchListings, findReferenceListing, type EbayListing } from "@/lib/sources/ebay";
import { saveNewFinds, type ReferenceInfo, type SavedFind } from "@/lib/db";

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
 * The photo/link only exist when PriceCharting linked an eBay catalog id
 * (epid) for this product — not every product has one (confirmed: newer/
 * more-searched cards tend to, older ones sometimes don't) — but
 * `ebaySearchUrl` is always populated regardless, so there's always
 * something to click through and double-check by hand. `query` should be
 * the search text that found this reference (not necessarily the
 * product's own name) since that's what's passed to the epid lookup.
 */
export async function buildReferenceInfo(
  query: string,
  reference: CardReference,
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
      // Not worth failing the whole thing over — ebaySearchUrl below
      // still gives a way to double-check the reference by hand.
    }
  }
  return {
    productName: reference.productName,
    ungradedPriceDollars: (reference.ungradedPriceCents ?? 0) / 100,
    imageUrl,
    itemWebUrl,
    ebaySearchUrl: `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(reference.productName + " " + reference.consoleName)}`,
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
  const [reference, rawListings] = await Promise.all([findCard(query, category), searchListings(query, category)]);

  const ungradedListings = rawListings.filter((l) => !isGraded(l.condition) && !isBundle(l.title));

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

  const referenceInfo = reference ? await buildReferenceInfo(query, reference, includeReferenceImage) : null;

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
