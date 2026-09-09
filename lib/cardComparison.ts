import { findCard } from "@/lib/sources/pricecharting";
import { searchListings, type EbayListing } from "@/lib/sources/ebay";
import { saveNewFinds, type SavedFind } from "@/lib/db";

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
function isGraded(condition: string | null): boolean {
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

function isBundle(title: string): boolean {
  return LOT_PATTERN.test(title);
}

export type CardListingResult = EbayListing & {
  priceDollars: number;
  percentBelowReference: number | null;
  isUnderpriced: boolean;
};

export type CardSearchResult = {
  query: string;
  reference: { productName: string; ungradedPriceDollars: number } | null;
  listings: CardListingResult[];
};

const UNDERPRICED_THRESHOLD_PERCENT = 20;

export async function searchUnderpricedCards(query: string): Promise<CardSearchResult> {
  const [reference, rawListings] = await Promise.all([findCard(query), searchListings(query)]);

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

  return {
    query,
    reference: reference
      ? { productName: reference.productName, ungradedPriceDollars: (reference.ungradedPriceCents ?? 0) / 100 }
      : null,
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
export async function checkCardAndSaveFinds(card: string): Promise<number> {
  const result = await searchUnderpricedCards(card);
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
      foundAt: new Date().toISOString(),
    }));
  return saveNewFinds(candidates);
}
