import type { RawDeal } from "@/lib/types";

const US_DOMAIN_ID = 1; // Keepa's DCODES list: index 1 = US (confirmed from their official Python client's source)
const AMAZON_PRICE_TYPE = 0; // Keepa's standard CSV-type index for Amazon's own price

/**
 * Verified against a live account on 2026-09-08. The request shape came
 * from Keepa's official Python client source (their docs site 403s
 * automated fetches), and real output confirmed / corrected the guesses:
 *
 * - `current` is a FLAT array indexed by CSV-type (0 = Amazon price, in
 *   cents; -1/-2 = "no data" for that price type).
 * - `delta` / `deltaPercent` / `avg` are each a nested array of 4 windows,
 *   each itself CSV-type-indexed — i.e. `deltaPercent[window][csvType]`,
 *   NOT `deltaPercent[csvType]`. Getting this wrong originally made every
 *   result read back as `null` despite the filter itself working correctly.
 *   Which of the 4 windows Keepa considers primary isn't documented; index
 *   0 matched the requested `deltaPercentRange` filter in every deal
 *   checked, so that's what's used.
 * - `isRangeEnabled` / `isFilterEnabled` do correctly gate `deltaPercentRange`
 *   — confirmed by the returned deltaPercent values actually falling inside
 *   the requested range once read from the right place.
 * - `image` is an array of ASCII character codes, not bytes to decode
 *   otherwise — join + String.fromCharCode gives a real filename, and
 *   Keepa's image CDN is `https://m.media-amazon.com/images/I/<filename>`.
 */
export async function fetchDeals(minDiscountPercent = 40): Promise<RawDeal[]> {
  const apiKey = process.env.KEEPA_API_KEY;
  if (!apiKey) {
    throw new Error("KEEPA_API_KEY is not set.");
  }

  const maxSalesRank = Number(process.env.KEEPA_MAX_SALES_RANK) || 300000;

  const selection = {
    page: 0,
    domainId: US_DOMAIN_ID,
    priceTypes: [AMAZON_PRICE_TYPE],
    deltaPercentRange: [minDiscountPercent, 100],
    salesRankRange: [1, maxSalesRank], // excludes obscure items with near-zero actual sales
    hasReviews: true, // requires at least one real customer review — proof someone actually bought it
    isRangeEnabled: true,
    isFilterEnabled: true,
    sortType: 4,
  };

  const url = new URL("https://api.keepa.com/deal/");
  url.searchParams.set("key", apiKey);
  url.searchParams.set("domain", String(US_DOMAIN_ID));
  url.searchParams.set("selection", JSON.stringify(selection));

  // Cached longer than the free sources (15 min vs 10) since Keepa tokens
  // are a limited, paid resource — this is on top of the password gate in
  // proxy.ts, not instead of it.
  const res = await fetch(url.toString(), { next: { revalidate: 900 } });
  if (!res.ok) {
    throw new Error(`Keepa request failed: ${res.status} ${res.statusText}`);
  }
  const json = await res.json();

  if (json?.error) {
    throw new Error(`Keepa API error: ${JSON.stringify(json.error)}`);
  }

  const rawDeals: KeepaDeal[] = json?.deals?.dr ?? [];

  const deals = rawDeals
    // Second, independent legitimacy check beyond the request-level filters
    // above: salesRankDrops90 counts actual rank-drop events (a real sale
    // happened) in the last 90 days — confirmed present on every deal object
    // in live testing. Zero means no observed purchase activity, which is
    // exactly the "technically-true but nobody's actually buying it at that
    // reference price" pattern that produces fake-looking huge discounts.
    .filter((d) => (d.salesRankDrops90 ?? 0) > 0)
    .map((d) => {
      const currentCents = d.current?.[AMAZON_PRICE_TYPE];
      const deltaPercent = d.deltaPercent?.[0]?.[AMAZON_PRICE_TYPE];
      const salesRank = d.current?.[SALES_RANK_TYPE];

      const price = typeof currentCents === "number" && currentCents >= 0 ? currentCents / 100 : null;
      const validDeltaPercent = typeof deltaPercent === "number" && deltaPercent >= 0 ? deltaPercent : null;
      const originalPrice =
        price != null && validDeltaPercent != null && validDeltaPercent < 100
          ? price / (1 - validDeltaPercent / 100)
          : null;

      const imageFilename = Array.isArray(d.image) ? d.image.map((code) => String.fromCharCode(code)).join("") : null;

      const rankNote =
        typeof salesRank === "number" && salesRank > 0
          ? `Category sales rank #${salesRank.toLocaleString()} · ${d.salesRankDrops90} sale(s) in last 90 days`
          : null;

      return {
        id: `keepa-${d.asin}`,
        title: d.title || d.asin,
        link: `https://www.amazon.com/dp/${d.asin}`,
        description: rankNote,
        imageUrl: imageFilename ? `https://m.media-amazon.com/images/I/${imageFilename}` : null,
        pubDate: null,
        creator: null,
        discountPercent: validDeltaPercent,
        price,
        originalPrice,
      };
    });

  return deals;
}

const SALES_RANK_TYPE = 3; // Keepa's standard CSV-type index for category sales rank

type KeepaDeal = {
  asin: string;
  title: string;
  current?: number[];
  deltaPercent?: number[][];
  image?: number[];
  salesRankDrops90?: number;
};
