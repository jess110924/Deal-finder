import { searchListings, type EbayListing } from "@/lib/sources/ebay";
import { fetchSoldComps, isLikelyGraded, type SoldComp } from "@/lib/sources/soldComps";
import { isGraded, isBundle, type CardCategory } from "@/lib/cardComparison";
import { extractSerialDenominator } from "@/lib/cardKeywords";

/**
 * Step 1 of the manual "browse a player, eyeball the $30-$100 range"
 * process: a plain price-banded eBay search for a player's name, with no
 * PriceCharting reference attached — a player name isn't one product, so
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

export type SoldCompsSummary = {
  title: string;
  compCount: number;
  averageSoldPriceDollars: number;
  medianSoldPriceDollars: number;
  // How this specific listing's own asking price compares to the average
  // recent sold price — null when priceDollars wasn't supplied.
  percentBelowAverage: number | null;
  mostRecentSale: SoldComp;
  sales: SoldComp[]; // sorted most recent first
};

/**
 * Step 2: "check what this exact card has actually sold for recently,"
 * using real sold history (`SOLD_COMPS_API_KEY`, a paid third-party
 * scraper API) instead of other active asking prices — a real upgrade
 * over comparing asking prices against each other, which is all that was
 * possible before: no eBay API key here gets access to actual sold/
 * completed listing data (confirmed live: the `buy.marketplace.insights`
 * scope this would need comes back "invalid_scope" for this app's key).
 *
 * Searches with the listing's full raw title, not a keyword-stripped
 * version — confirmed live this matters, the same lesson learned earlier
 * in this project for PriceCharting matching (see cardComparison.ts):
 * this API does its own eBay-style relevance ranking, so stripping the
 * query down to "Luka Doncic silver prizm" for a "Freshman Phenoms"
 * insert actually made results *worse* — 21 loosely-related "Silver
 * Prizm" comps spanning many unrelated years/sets ($0.45-$129.99, median
 * $3) vs. 11 tightly-matched Freshman Phenoms comps ($17.50-$129.99) when
 * searching with the full title instead. The print-run denominator
 * filter below is a second, independent safety net on top of that.
 */
export async function getSoldComps(
  title: string,
  category: CardCategory,
  priceDollars: number | null
): Promise<SoldCompsSummary | null> {
  const raw = await fetchSoldComps(title);
  let sales = raw.filter((c) => !isLikelyGraded(c.title) && !isBundle(c.title));

  const serial = extractSerialDenominator(title);
  if (serial) {
    const withSerial = sales.filter((c) => c.title.includes(serial));
    // Only trust the narrower set if it actually found something —
    // otherwise this falls back to the unfiltered list rather than
    // returning nothing just because of formatting differences.
    if (withSerial.length > 0) sales = withSerial;
  }

  if (sales.length === 0) return null;

  const sortedByDate = [...sales].sort((a, b) => (a.endedAt < b.endedAt ? 1 : a.endedAt > b.endedAt ? -1 : 0));
  const sortedByPrice = [...sales].sort((a, b) => a.soldPriceDollars - b.soldPriceDollars);
  const averageSoldPriceDollars = sales.reduce((sum, c) => sum + c.soldPriceDollars, 0) / sales.length;
  const mid = Math.floor(sortedByPrice.length / 2);
  const medianSoldPriceDollars =
    sortedByPrice.length % 2 === 0
      ? (sortedByPrice[mid - 1].soldPriceDollars + sortedByPrice[mid].soldPriceDollars) / 2
      : sortedByPrice[mid].soldPriceDollars;

  return {
    title,
    compCount: sales.length,
    averageSoldPriceDollars,
    medianSoldPriceDollars,
    percentBelowAverage:
      priceDollars != null && averageSoldPriceDollars > 0
        ? ((averageSoldPriceDollars - priceDollars) / averageSoldPriceDollars) * 100
        : null,
    mostRecentSale: sortedByDate[0],
    sales: sortedByDate,
  };
}
