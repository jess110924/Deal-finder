// Real eBay sold prices, via a third-party scraper API — eBay's own API
// won't grant sold/completed-listing data without a restricted scope
// this app's key doesn't have (confirmed live elsewhere in this project:
// buy.marketplace.insights comes back "invalid_scope"). This is a paid
// key the user supplied directly (SOLD_COMPS_API_KEY), not a free API —
// see lib/electronicsSearch.ts for the cost-conscious caps this is
// deliberately used under.
export type SoldComp = {
  itemId: string;
  title: string;
  soldPriceDollars: number;
  endedAt: string; // "YYYY-MM-DD"
  condition: string | null;
  itemWebUrl: string;
  thumbnailUrl: string | null;
  epid: string | null;
};

/**
 * Recent sold listings matching a keyword search. Filters to actually-
 * sold items with a parseable price — defensive in case the scrape
 * endpoint's "sold" scoping is ever imperfect, not because it's been
 * observed to include anything else in testing.
 */
export async function fetchSoldComps(keyword: string, limit = 30): Promise<SoldComp[]> {
  const apiKey = process.env.SOLD_COMPS_API_KEY;
  if (!apiKey) {
    throw new Error("SOLD_COMPS_API_KEY is not set.");
  }

  const url = new URL("https://api.sold-comps.com/v1/scrape");
  url.searchParams.set("keyword", keyword);

  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${apiKey}` },
    next: { revalidate: 3600 }, // sold history moves slowly; 1hr cache, same reasoning as PriceCharting's reference price
  });
  if (!res.ok) {
    throw new Error(`Sold comps request failed: ${res.status} ${res.statusText}`);
  }

  const json = await res.json();
  const items = Array.isArray(json?.items) ? (json.items as Record<string, unknown>[]) : [];

  const comps: SoldComp[] = [];
  for (const item of items) {
    if (item.listingType && item.listingType !== "sold") continue;
    const soldPriceDollars = Number(item.soldPrice);
    if (!Number.isFinite(soldPriceDollars) || soldPriceDollars <= 0) continue;
    const itemWebUrl = typeof item.url === "string" ? item.url : null;
    if (!itemWebUrl) continue;
    comps.push({
      itemId: String(item.itemId ?? ""),
      title: String(item.title ?? ""),
      soldPriceDollars,
      endedAt: String(item.endedAt ?? ""),
      condition: typeof item.condition === "string" ? item.condition : null,
      itemWebUrl,
      thumbnailUrl: typeof item.thumbnailUrl === "string" ? item.thumbnailUrl : null,
      epid: item.epid ? String(item.epid) : null,
    });
    if (comps.length >= limit) break;
  }
  return comps;
}
