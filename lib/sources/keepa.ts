import type { RawDeal } from "@/lib/types";

const US_DOMAIN_ID = 1; // Keepa's DCODES list: index 1 = US (confirmed from their official Python client's source)

/**
 * NOT independently verified end-to-end — Keepa's API docs site returns 403
 * to automated fetches, so this is built from the actual request/response
 * code in their official Python client (github.com/akaszynski/keepa,
 * src/keepa/keepa_sync.py `deals()` method and query_keys.py), which is
 * ground truth for the request shape, but the exact *filtering semantics*
 * of a couple of flags are inferred from their names, not confirmed:
 *
 * - Confirmed: endpoint is `GET https://api.keepa.com/deal/?key=&domain=&selection=`,
 *   `selection` is a JSON-encoded object, response is `{ deals: { dr: [...] }, tokensLeft }`,
 *   and each deal in `dr` has `asin`, `title`, and `current`/`delta`/`deltaPercent`
 *   arrays indexed by Keepa's standard CSV-type order (0 = Amazon price).
 * - Inferred, not confirmed: `isRangeEnabled` / `isFilterEnabled` are almost
 *   certainly what gate whether `deltaPercentRange` actually filters results
 *   (vs. being ignored), based on the parameter names alone.
 *
 * First real run against this should be checked carefully — if results look
 * unfiltered or empty, these two flags are the first thing to try flipping.
 */
export async function fetchDeals(minDiscountPercent = 40): Promise<RawDeal[]> {
  const apiKey = process.env.KEEPA_API_KEY;
  if (!apiKey) {
    throw new Error("KEEPA_API_KEY is not set.");
  }

  const selection = {
    page: 0,
    domainId: US_DOMAIN_ID,
    priceTypes: [0], // Amazon's own price (not 3rd-party marketplace offers)
    deltaPercentRange: [minDiscountPercent, 100],
    isRangeEnabled: true,
    isFilterEnabled: true,
    sortType: 4, // deal-list sort; 4 commonly denotes "largest percent drop first" in Keepa's UI-facing sort options — unconfirmed against their source, worth checking against actual result ordering
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
    const currentCents = d.current?.[0];
    const deltaPercent = d.deltaPercent?.[0];
    const price = typeof currentCents === "number" && currentCents >= 0 ? currentCents / 100 : null;
    const originalPrice =
      price != null && typeof deltaPercent === "number" && deltaPercent < 100
        ? price / (1 - deltaPercent / 100)
        : null;

    return {
      id: `keepa-${d.asin}`,
      title: d.title || d.asin,
      link: `https://www.amazon.com/dp/${d.asin}`,
      description: null,
      pubDate: null,
      creator: null,
      discountPercent: typeof deltaPercent === "number" ? deltaPercent : null,
      price,
      originalPrice,
    };
  });
}

type KeepaDeal = {
  asin: string;
  title: string;
  current?: number[];
  deltaPercent?: number[];
};
