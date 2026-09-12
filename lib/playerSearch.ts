import { searchListings, type EbayListing } from "@/lib/sources/ebay";
import { isGraded, isBundle, type CardCategory } from "@/lib/cardComparison";

/**
 * Step 1 of the manual "browse a player, eyeball the $30-$100 range"
 * process: a plain price-banded eBay search for a player's name, with no
 * comparison figure attached — a player name isn't one product, so
 * there's nothing single to compare against yet. Ungraded/non-bundle only,
 * same as the rest of the site.
 */
export async function searchPlayerCards(
  query: string,
  category: CardCategory,
  options: { minPriceDollars?: number; maxPriceDollars?: number; limit?: number } = {}
): Promise<EbayListing[]> {
  const { minPriceDollars, maxPriceDollars, limit = 30 } = options;
  const raw = await searchListings(query, category, { limit, minPriceDollars, maxPriceDollars });
  return raw.filter((l) => !isGraded(l.condition) && !isBundle(l.title));
}
