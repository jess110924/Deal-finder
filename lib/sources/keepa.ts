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

  const selection = {
    page: 0,
    domainId: US_DOMAIN_ID,
    priceTypes: [AMAZON_PRICE_TYPE],
    deltaPercentRange: [minDiscountPercent, 100],
    isRangeEnabled: true,
    isFilterEnabled: true,
    sortType: 4,
  };

  const url = new URL("https://api.keepa.com/deal/");
  url.searchParams.set("key", apiKey);
  url.searchParams.set("domain", String(US_DOMAIN_ID));
  url.searchParams.set("selection", JSON.stringify(selection));

  const res = await fetch(url.toString(), { cache: "no-store" });
  if (!res.ok) {
    throw new Error(`Keepa request failed: ${res.status} ${res.statusText}`);
  }
  const json = await res.json();

  if (json?.error) {
    throw new Error(`Keepa API error: ${JSON.stringify(json.error)}`);
  }

  const deals: KeepaDeal[] = json?.deals?.dr ?? [];

  return deals.map((d) => {
    const currentCents = d.current?.[AMAZON_PRICE_TYPE];
    const deltaPercent = d.deltaPercent?.[0]?.[AMAZON_PRICE_TYPE];

    const price = typeof currentCents === "number" && currentCents >= 0 ? currentCents / 100 : null;
    const validDeltaPercent = typeof deltaPercent === "number" && deltaPercent >= 0 ? deltaPercent : null;
    const originalPrice =
      price != null && validDeltaPercent != null && validDeltaPercent < 100
        ? price / (1 - validDeltaPercent / 100)
        : null;

    const imageFilename = Array.isArray(d.image) ? d.image.map((code) => String.fromCharCode(code)).join("") : null;

    return {
      id: `keepa-${d.asin}`,
      title: d.title || d.asin,
      link: `https://www.amazon.com/dp/${d.asin}`,
      description: null,
      imageUrl: imageFilename ? `https://m.media-amazon.com/images/I/${imageFilename}` : null,
      pubDate: null,
      creator: null,
      discountPercent: validDeltaPercent,
      price,
      originalPrice,
    };
  });
}

type KeepaDeal = {
  asin: string;
  title: string;
  current?: number[];
  deltaPercent?: number[][];
  image?: number[];
};
