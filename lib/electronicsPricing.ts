import { fetchSoldComps, type SoldComp } from "@/lib/sources/soldComps";
import { isBundle } from "@/lib/cardComparison";

// Shared between Electronics Search (lib/electronicsSearch.ts) and
// Electronics Auction Sniper (lib/electronicsAuctionSnipe.ts) — both
// need the exact same "what has this exact product actually sold for"
// lookup and the same noise filters around it, just applied to a
// different price (a listing's asking price vs. an auction's current
// bid). Kept in one place so a fix to the matching/filtering logic (like
// the two caught live and documented below) applies to both instead of
// needing to be made twice.

// eBay's own condition string for a broken/salvage item — confirmed live
// as a real value the Browse API returns. Comparing a "for parts" price
// against a working comp's sold price would call a genuinely broken item
// "underpriced," which is backwards — it's cheap because it's broken,
// not because it's a deal.
const BROKEN_CONDITION_PATTERN = /for parts|not working/i;

function isBrokenCondition(condition: string | null): boolean {
  return condition != null && BROKEN_CONDITION_PATTERN.test(condition);
}

// Caught live (back when Electronics Search compared against other
// active asking prices, but the same risk applies to sold comps):
// searching "Apple Watch Series 9" surfaced a "$56.12 OEM Pull
// Replacement OLED Screen - Repair Part for Apple Watch Series 9" as
// "profitable" — a salvaged screen, not a watch, priced (correctly)
// like a screen, not underpriced at all. A title match on the model
// name doesn't mean it's the actual device; "repair part"/"OEM pull"/
// "screen only"/"for parts only" are all phrasings that specifically
// mean "a piece removed from a device," never a complete, resellable
// unit.
const PARTS_LISTING_PATTERN = /\b(repair part|replacement part|oem pull|screen only|parts only)\b/i;

function isPartsListing(title: string): boolean {
  return PARTS_LISTING_PATTERN.test(title);
}

/** Whether a listing/auction itself should be excluded from results entirely. */
export function isExcludedListing(title: string, condition: string | null): boolean {
  return isBundle(title) || isBrokenCondition(condition) || isPartsListing(title);
}

function median(sortedAscending: number[]): number {
  const mid = Math.floor(sortedAscending.length / 2);
  return sortedAscending.length % 2 === 0
    ? (sortedAscending[mid - 1] + sortedAscending[mid]) / 2
    : sortedAscending[mid];
}

// A last safety net on top of the title/condition filters above, not a
// replacement for them: no regex can enumerate every real phrasing for
// "this isn't actually a comparable single unit" (bulk/wholesale lots,
// business-account listings, an outright wrong match slipping through).
// Caught live, back when Electronics Search compared against other eBay
// asking prices: a real $530 iPhone 15 Pro got compared against a peer
// average of $4,028 — one wildly-priced peer that none of the title
// filters caught dragged the whole average up enough to make an
// ordinary listing look implausibly, wrongly profitable. The same risk
// exists for sold comps (a mis-scraped or genuinely different sale
// slipping into the results), so this stays: drops any comparable
// priced more than 4x away from the group's own median (symmetric — a
// suspiciously *low* one, e.g. an accessory-only sale mislabeled, would
// skew the average the other direction) before computing the average
// actually used. 4x is deliberately generous — wide enough to keep
// genuine condition/storage/carrier price spread (confirmed live: a
// real iPhone 14 Pro comp set spans roughly 1.5-2x low to high) without
// keeping something off by an order of magnitude.
const OUTLIER_MULTIPLE = 4;

function rejectPriceOutliers<T>(items: T[], getPriceDollars: (item: T) => number): T[] {
  const prices = items.map(getPriceDollars).sort((a, b) => a - b);
  const med = median(prices);
  if (med <= 0) return items;
  return items.filter((item) => {
    const price = getPriceDollars(item);
    return price >= med / OUTLIER_MULTIPLE && price <= med * OUTLIER_MULTIPLE;
  });
}

// Below this many real comps (after excluding bundles/broken/parts
// listings and outliers), the average is too thin to trust.
const MIN_COMPS_FOR_REFERENCE = 3;

export type ElectronicsPricing = {
  averageSoldPriceDollars: number | null;
  compCount: number;
  mostRecentSaleDate: string | null;
  soldSearchUrl: string;
};

export function buildSoldSearchUrl(title: string): string {
  return `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(title)}&LH_Sold=1&LH_Complete=1`;
}

/**
 * "What has this exact product actually sold for recently" — requested
 * directly ("comparing against previous sold listings of the same exact
 * product"), via SOLD_COMPS_API_KEY (a paid third-party scraper API;
 * eBay's own API won't grant sold/completed-listing data without a
 * restricted scope this app's key doesn't have). Searches with the
 * listing's full raw title, not a keyword-stripped version — confirmed
 * live (back in this project's trading-card sold-comps era, same API)
 * that this matters: the scraper API does its own eBay-style relevance
 * ranking, so a stripped-down query actually made results *worse* then.
 * No reason to expect electronics titles behave differently.
 *
 * Returns `averageSoldPriceDollars: null` when fewer than
 * MIN_COMPS_FOR_REFERENCE real comps were found — too few to average
 * meaningfully, treated as "not enough data" rather than a guess.
 * `soldSearchUrl` is always populated regardless — the "verify this
 * yourself" link, same role PriceCharting's productUrl plays for cards.
 */
export async function getElectronicsSoldPricing(title: string): Promise<ElectronicsPricing> {
  const soldSearchUrl = buildSoldSearchUrl(title);

  let comps: SoldComp[] = [];
  try {
    const rawComps = await fetchSoldComps(title);
    const filtered = rawComps.filter((c) => !isExcludedListing(c.title, c.condition));
    comps = rejectPriceOutliers(filtered, (c) => c.soldPriceDollars);
  } catch {
    comps = [];
  }

  if (comps.length < MIN_COMPS_FOR_REFERENCE) {
    return { averageSoldPriceDollars: null, compCount: comps.length, mostRecentSaleDate: null, soldSearchUrl };
  }

  const averageSoldPriceDollars = comps.reduce((sum, c) => sum + c.soldPriceDollars, 0) / comps.length;
  const mostRecentSaleDate = [...comps].sort((a, b) => (a.endedAt < b.endedAt ? 1 : a.endedAt > b.endedAt ? -1 : 0))[0]
    .endedAt;

  return { averageSoldPriceDollars, compCount: comps.length, mostRecentSaleDate, soldSearchUrl };
}
