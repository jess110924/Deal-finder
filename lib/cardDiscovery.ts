import { browseCategory } from "@/lib/sources/ebay";
import { findCard } from "@/lib/sources/pricecharting";
import {
  isGraded,
  isBundle,
  buildReferenceInfo,
  type CardCategory,
} from "@/lib/cardComparison";
import { getSoldComps } from "@/lib/soldComps";
import { saveNewFinds, type SavedFind } from "@/lib/db";
import { mapWithConcurrency } from "@/lib/concurrency";

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

const LOOKUP_CONCURRENCY = 6;

/**
 * Browses a category's live eBay listings (no name needed) and checks
 * each one against its own PriceCharting match, saving anything that
 * comes out underpriced. This is the "find cards worth watching without
 * naming them first" path — the watchlist (checkCardAndSaveFinds in
 * cardComparison.ts) only ever checks cards it's explicitly told about.
 */
export async function discoverDeals(category: CardCategory, limit = 25): Promise<number> {
  const listings = await browseCategory(category, limit);
  const toCheck = listings.filter(
    (listing) => !isGraded(listing.condition) && !isBundle(listing.title) && !NON_CARD_PATTERN.test(listing.title)
  );

  const results = await mapWithConcurrency(toCheck, LOOKUP_CONCURRENCY, async (listing): Promise<SavedFind | null> => {
    // Looks up the raw listing title directly — findCard's relevance
    // scoring (pricecharting.ts) picks the best-matching candidate out of
    // everything the query returns, so it no longer needs a hand-trimmed
    // query to avoid being fooled by position-0 results. An earlier
    // version stripped the title down first (extractSearchKeywords); that
    // predated the scoring fix and is now counterproductive — it discards
    // set-name/parallel words the scorer needs, confirmed live on a
    // reported Kyrie Irving mismatch (see cardComparison.ts's
    // evaluateListing for the full example).
    let reference;
    try {
      reference = await findCard(listing.title, category);
    } catch {
      return null; // one bad PriceCharting lookup shouldn't kill the whole run
    }
    if (!reference?.ungradedPriceCents || reference.ungradedPriceCents <= 0) return null;

    const percentBelowReference =
      ((reference.ungradedPriceCents - listing.priceCents) / reference.ungradedPriceCents) * 100;
    if (percentBelowReference < DISCOVERY_THRESHOLD_PERCENT) return null;

    const priceDollars = listing.priceCents / 100;
    const [referenceInfo, soldComps] = await Promise.all([
      buildReferenceInfo(reference, category, false),
      getSoldComps(listing.title, priceDollars).catch(() => null),
    ]);
    return {
      itemId: listing.itemId,
      title: listing.title,
      priceDollars,
      itemWebUrl: listing.itemWebUrl,
      imageUrl: listing.imageUrl,
      condition: listing.condition,
      percentBelowReference,
      searchedFor: referenceInfo.productName,
      category,
      source: "discovery",
      reference: referenceInfo,
      soldComps: soldComps ?? undefined,
      foundAt: new Date().toISOString(),
    };
  });

  const candidates = results.filter((r): r is SavedFind => r !== null);
  return saveNewFinds(candidates);
}
