/**
 * eBay Browse API — searches active (currently listed) items, not sold
 * history. Request/response shape confirmed against eBay's official OAuth
 * docs and their Browse API reference (their main docs site itself blocks
 * automated fetches, so this was checked via their published examples and
 * a community-maintained API client's field list) — genuinely untested
 * against a live account until credentials are added, though, unlike the
 * other sources in this project.
 */

let cachedToken: { token: string; expiresAt: number } | null = null;

async function getAccessToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) {
    return cachedToken.token;
  }

  const clientId = process.env.EBAY_CLIENT_ID;
  const clientSecret = process.env.EBAY_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error("EBAY_CLIENT_ID / EBAY_CLIENT_SECRET are not set.");
  }

  const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
  const res = await fetch("https://api.ebay.com/identity/v1/oauth2/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${basicAuth}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials&scope=https://api.ebay.com/oauth/api_scope",
    cache: "no-store",
  });

  if (!res.ok) {
    throw new Error(`eBay token request failed: ${res.status} ${res.statusText}`);
  }

  const json = await res.json();
  if (!json.access_token) {
    throw new Error(`eBay token response missing access_token: ${JSON.stringify(json)}`);
  }

  cachedToken = { token: json.access_token, expiresAt: Date.now() + json.expires_in * 1000 };
  return cachedToken.token;
}

export type EbayListing = {
  itemId: string;
  title: string;
  priceCents: number;
  currency: string;
  itemWebUrl: string;
  imageUrl: string | null;
  condition: string | null;
};

// Confirmed live by searching "charizard pokemon card" with no category
// filter and inspecting what categories real listings actually fall
// under — single Pokemon (and other CCG) cards land in "CCG Individual
// Cards", a sibling of "Sports Trading Cards", not a child of it.
const CATEGORY_ID_BY_CARD_CATEGORY = {
  sports: "212", // "Sports Trading Cards"
  pokemon: "183454", // "CCG Individual Cards"
} as const;

export async function searchListings(
  query: string,
  category: keyof typeof CATEGORY_ID_BY_CARD_CATEGORY,
  limit = 30
): Promise<EbayListing[]> {
  const token = await getAccessToken();

  const url = new URL("https://api.ebay.com/buy/browse/v1/item_summary/search");
  url.searchParams.set("q", query);
  url.searchParams.set("limit", String(limit));
  url.searchParams.set("category_ids", CATEGORY_ID_BY_CARD_CATEGORY[category]);
  url.searchParams.set("filter", "buyingOptions:{FIXED_PRICE}"); // Buy It Now only — comparable single-item prices, not live auctions mid-bid

  const res = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${token}`,
      "X-EBAY-C-MARKETPLACE-ID": "EBAY_US",
    },
    next: { revalidate: 300 },
  });

  if (!res.ok) {
    throw new Error(`eBay search failed: ${res.status} ${res.statusText}`);
  }

  const json = await res.json();
  const items: Record<string, unknown>[] = json?.itemSummaries ?? [];

  return items.map((item) => {
    const price = item.price as { value?: string; currency?: string } | undefined;
    const image = item.image as { imageUrl?: string } | undefined;
    return {
      itemId: String(item.itemId ?? ""),
      title: String(item.title ?? ""),
      priceCents: price?.value ? Math.round(Number(price.value) * 100) : 0,
      currency: price?.currency ?? "USD",
      itemWebUrl: String(item.itemWebUrl ?? ""),
      imageUrl: image?.imageUrl ?? null,
      condition: (item.condition as string) ?? null,
    };
  });
}

export type ReferenceListing = { imageUrl: string; itemWebUrl: string };

/**
 * Finds one real, currently-listed eBay item matching a PriceCharting
 * product's `epid` (eBay catalog product id) — used to show an actual
 * photo of the exact reference card being compared against, so it's
 * obvious at a glance whether it's really the same card. eBay's Catalog
 * API (which would resolve an epid directly to a product photo without
 * needing a live listing) requires a permission scope this app's key
 * doesn't have (confirmed live: 403 "Insufficient permissions"); filtering
 * a normal Browse API search by epid works with the same basic scope
 * already used elsewhere and returns the exact matching product — verified
 * live against the Luka Doncic Prizm card, whose epid it returned exactly.
 */
export async function findReferenceListing(query: string, epid: string): Promise<ReferenceListing | null> {
  const token = await getAccessToken();

  const url = new URL("https://api.ebay.com/buy/browse/v1/item_summary/search");
  url.searchParams.set("q", query);
  url.searchParams.set("limit", "1");
  url.searchParams.set("filter", `epid:{${epid}}`);

  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${token}`, "X-EBAY-C-MARKETPLACE-ID": "EBAY_US" },
    next: { revalidate: 3600 }, // this is just an illustrative photo, not a price — cache like the reference price itself
  });
  if (!res.ok) {
    throw new Error(`eBay epid lookup failed: ${res.status} ${res.statusText}`);
  }

  const json = await res.json();
  const item = (json?.itemSummaries ?? [])[0] as Record<string, unknown> | undefined;
  if (!item) return null;
  const image = item.image as { imageUrl?: string } | undefined;
  if (!image?.imageUrl || !item.itemWebUrl) return null;
  return { imageUrl: image.imageUrl, itemWebUrl: String(item.itemWebUrl) };
}
