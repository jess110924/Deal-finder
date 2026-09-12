import { fetchSoldComps, isLikelyGraded, type SoldComp } from "@/lib/sources/soldComps";
import { isBundle, extractSerialDenominator } from "@/lib/cardKeywords";

export type SoldCompsSummary = {
  title: string;
  compCount: number;
  averageSoldPriceDollars: number;
  medianSoldPriceDollars: number;
  // How a given listing's own asking price compares to the average
  // recent sold price — null when priceDollars wasn't supplied.
  percentBelowAverage: number | null;
  mostRecentSale: SoldComp;
  sales: SoldComp[]; // sorted most recent first
  // A direct link to eBay's own sold/completed listings for this title —
  // the "verify" link: lets anyone double-check the comps by hand on
  // eBay itself.
  soldSearchUrl: string;
};

/**
 * "What has this exact card actually sold for recently," using real sold
 * history (`SOLD_COMPS_API_KEY`, a paid third-party scraper API,
 * api.sold-comps.com) instead of active asking prices — a real upgrade
 * over comparing asking prices against each other, which is all that was
 * possible before: no eBay API key here gets access to actual sold/
 * completed listing data (confirmed live: the `buy.marketplace.insights`
 * scope this would need comes back "invalid_scope" for this app's key).
 *
 * No `category` parameter — the sold-comps API isn't split by category
 * (sports vs. pokemon), so there's nothing to pass.
 *
 * Searches with the listing's full raw title, not a keyword-stripped
 * version — confirmed live this matters: this API does its own eBay-style
 * relevance ranking, so stripping the
 * query down to "Luka Doncic silver prizm" for a "Freshman Phenoms"
 * insert actually made results *worse* — 21 loosely-related "Silver
 * Prizm" comps spanning many unrelated years/sets ($0.45-$129.99, median
 * $3) vs. 11 tightly-matched Freshman Phenoms comps ($17.50-$129.99) when
 * searching with the full title instead. The print-run denominator
 * filter below is a second, independent safety net on top of that.
 */
export async function getSoldComps(title: string, priceDollars: number | null): Promise<SoldCompsSummary | null> {
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
    soldSearchUrl: `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(title)}&LH_Sold=1&LH_Complete=1`,
  };
}
