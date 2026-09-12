import { browseCategory, type CardCategory } from "@/lib/sources/ebay";
import { isGraded, isBundle } from "@/lib/cardComparison";
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
// matched to sold comps without a human choosing the search term, so a
// bad match is more likely here than for a deliberately-typed watchlist
// name — the higher bar is a small safety margin, not a fix for that
// risk. The real safeguard is that every discovered find carries its
// sold comps (with a link to eBay's own sold search) so it can be
// checked before trusting it.
const DISCOVERY_THRESHOLD_PERCENT = 25;

const LOOKUP_CONCURRENCY = 6;

/**
 * Browses a category's live eBay listings (no name needed) and checks
 * each one against its own recent sold comps, saving anything that comes
 * out underpriced. This is the "find cards worth watching without naming
 * them first" path — the watchlist (checkCardAndSaveFinds in
 * cardComparison.ts) only ever checks cards it's explicitly told about.
 */
export async function discoverDeals(category: CardCategory, limit = 25): Promise<number> {
  const listings = await browseCategory(category, limit);
  const toCheck = listings.filter(
    (listing) => !isGraded(listing.condition) && !isBundle(listing.title) && !NON_CARD_PATTERN.test(listing.title)
  );

  const results = await mapWithConcurrency(toCheck, LOOKUP_CONCURRENCY, async (listing): Promise<SavedFind | null> => {
    const priceDollars = listing.priceCents / 100;
    const soldComps = await getSoldComps(listing.title, priceDollars).catch(() => null);
    if (!soldComps || soldComps.averageSoldPriceDollars <= 0) return null;

    const percentBelowReference = soldComps.percentBelowAverage ?? 0;
    if (percentBelowReference < DISCOVERY_THRESHOLD_PERCENT) return null;

    return {
      itemId: listing.itemId,
      title: listing.title,
      priceDollars,
      itemWebUrl: listing.itemWebUrl,
      imageUrl: listing.imageUrl,
      condition: listing.condition,
      percentBelowReference,
      searchedFor: listing.title,
      category,
      source: "discovery",
      soldComps,
      foundAt: new Date().toISOString(),
    };
  });

  const candidates = results.filter((r): r is SavedFind => r !== null);
  return saveNewFinds(candidates);
}
