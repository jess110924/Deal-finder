import { browseCategory } from "@/lib/sources/ebay";
import { findCard } from "@/lib/sources/pricecharting";
import {
  isGraded,
  isBundle,
  buildReferenceInfo,
  type CardCategory,
} from "@/lib/cardComparison";
import { extractSearchKeywords } from "@/lib/cardKeywords";
import { saveNewFinds, type SavedFind } from "@/lib/db";

// Browsed listings are freeform real-world titles, not a deliberate search
// query — more likely to include things that aren't a single raw card at
// all. Caught live in testing: a "Retail Shop Display Case" (an
// accessory, not a card) and a "Baseball Card and Memorabilia Collection"
// (a lot) both showed up in a plain category browse sorted by price.
// isBundle() already catches "lot"/"bundle"-style titles; this catches
// the non-card and accessory listings it doesn't.
const NON_CARD_PATTERN =
  /\b(display case|storage box|top\s?loader|sleeves?|binder|album|collection|memorabilia|supplies|shop display|empty box)\b/i;

// Slightly higher than the manual-search/watchlist threshold (20%,
// UNDERPRICED_THRESHOLD_PERCENT in cardComparison.ts). Browsed titles get
// matched to a PriceCharting product without a human choosing the search
// term, so a bad match is more likely here than for a deliberately-typed
// watchlist name — the higher bar is a small safety margin, not a fix for
// that risk. The real safeguard is that every discovered find carries a
// reference photo/link (via buildReferenceInfo) so it can be visually
// checked before trusting it.
const DISCOVERY_THRESHOLD_PERCENT = 25;

/**
 * Browses a category's live eBay listings (no name needed) and checks
 * each one against its own PriceCharting match, saving anything that
 * comes out underpriced. This is the "find cards worth watching without
 * naming them first" path — the watchlist (checkCardAndSaveFinds in
 * cardComparison.ts) only ever checks cards it's explicitly told about.
 */
export async function discoverDeals(category: CardCategory, limit = 25): Promise<number> {
  const listings = await browseCategory(category, limit);
  const candidates: SavedFind[] = [];

  for (const listing of listings) {
    if (isGraded(listing.condition) || isBundle(listing.title) || NON_CARD_PATTERN.test(listing.title)) {
      continue;
    }

    // Discover has no separately-known player name to anchor on (unlike
    // Player Search, which gets it from the search box) — this can only
    // go by whatever it can infer from the title itself, and quietly
    // no-ops back to the full title when it can't confidently do that
    // (see extractSearchKeywords). Confirmed live this matters: feeding
    // PriceCharting a full messy title returned a rare autographed
    // jersey matched against an unrelated $6.50 base card.
    const query = extractSearchKeywords(listing.title);

    let reference;
    try {
      reference = await findCard(query, category);
    } catch {
      continue; // one bad PriceCharting lookup shouldn't kill the whole run
    }
    if (!reference?.ungradedPriceCents || reference.ungradedPriceCents <= 0) continue;

    const percentBelowReference =
      ((reference.ungradedPriceCents - listing.priceCents) / reference.ungradedPriceCents) * 100;
    if (percentBelowReference < DISCOVERY_THRESHOLD_PERCENT) continue;

    const referenceInfo = await buildReferenceInfo(query, reference);
    candidates.push({
      itemId: listing.itemId,
      title: listing.title,
      priceDollars: listing.priceCents / 100,
      itemWebUrl: listing.itemWebUrl,
      imageUrl: listing.imageUrl,
      condition: listing.condition,
      percentBelowReference,
      searchedFor: referenceInfo.productName,
      category,
      source: "discovery",
      reference: referenceInfo,
      foundAt: new Date().toISOString(),
    });
  }

  return saveNewFinds(candidates);
}
