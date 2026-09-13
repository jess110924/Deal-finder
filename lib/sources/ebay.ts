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
  // Cost to have this specific listing shipped to the buyer — part of
  // the real cost to acquire it, not just the item price. Defaults to 0
  // when eBay doesn't report a shipping cost (free shipping, or a
  // shipping option eBay's search response didn't include) — an honest
  // "unknown/free" default, not a guess at a nonzero cost.
  shippingCents: number;
  currency: string;
  itemWebUrl: string;
  imageUrl: string | null;
  condition: string | null;
};

export type CardCategory = "sports" | "pokemon";

// Confirmed live by searching "charizard pokemon card" with no category
// filter and inspecting what categories real listings actually fall
// under — single Pokemon (and other CCG) cards land in "CCG Individual
// Cards", a sibling of "Sports Trading Cards", not a child of it.
const CATEGORY_ID_BY_CARD_CATEGORY: Record<CardCategory, string> = {
  sports: "212", // "Sports Trading Cards"
  pokemon: "183454", // "CCG Individual Cards"
};

function mapItemSummary(item: Record<string, unknown>): EbayListing {
  const price = item.price as { value?: string; currency?: string } | undefined;
  const image = item.image as { imageUrl?: string } | undefined;
  const shippingOptions = item.shippingOptions as { shippingCost?: { value?: string } }[] | undefined;
  const shippingCost = shippingOptions?.[0]?.shippingCost?.value;
  return {
    itemId: String(item.itemId ?? ""),
    title: String(item.title ?? ""),
    priceCents: price?.value ? Math.round(Number(price.value) * 100) : 0,
    shippingCents: shippingCost ? Math.round(Number(shippingCost) * 100) : 0,
    currency: price?.currency ?? "USD",
    itemWebUrl: String(item.itemWebUrl ?? ""),
    imageUrl: image?.imageUrl ?? null,
    condition: (item.condition as string) ?? null,
  };
}

export type SearchListingsOptions = {
  limit?: number;
  minPriceDollars?: number;
  maxPriceDollars?: number;
  sort?: "bestMatch" | "price" | "-price" | "newlyListed";
};

export async function searchListings(
  query: string,
  category: CardCategory,
  options: SearchListingsOptions = {}
): Promise<EbayListing[]> {
  const { limit = 30, minPriceDollars, maxPriceDollars, sort } = options;
  const token = await getAccessToken();

  const url = new URL("https://api.ebay.com/buy/browse/v1/item_summary/search");
  url.searchParams.set("q", query);
  url.searchParams.set("limit", String(limit));
  url.searchParams.set("category_ids", CATEGORY_ID_BY_CARD_CATEGORY[category]);
  if (sort && sort !== "bestMatch") url.searchParams.set("sort", sort);

  // Buy It Now only — comparable single-item prices, not live auctions
  // mid-bid. A price range (when given) is a comma-joined clause in the
  // same `filter` param, not a separate query param.
  const filterParts = ["buyingOptions:{FIXED_PRICE}"];
  if (minPriceDollars != null || maxPriceDollars != null) {
    filterParts.push(`price:[${minPriceDollars ?? ""}..${maxPriceDollars ?? ""}]`);
    filterParts.push("priceCurrency:USD");
  }
  url.searchParams.set("filter", filterParts.join(","));

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
  return items.map(mapItemSummary);
}

// "CCG Individual Cards" (183454) is not Pokemon-only — it's a shared
// bucket across every non-sports card game (confirmed live: a keyword-
// free browse came back full of Naruto, Dragon Ball, One Piece, and Weiss
// Schwarz cards alongside Pokemon). Anchoring the browse with a genre
// keyword fixes this completely (confirmed live: 15/15 results genuinely
// Pokemon afterward) without needing the user to name a specific card —
// "pokemon" is a category-level anchor, not a card name. Sports Trading
// Cards (212) didn't show this problem in testing (results were plain
// football/baseball/hockey/soccer — all genuinely sports), so it doesn't
// need one.
const BROWSE_KEYWORD_BY_CATEGORY: Record<CardCategory, string | null> = {
  sports: null,
  pokemon: "pokemon",
};

/**
 * Browses a category's live listings with no specific card name — the
 * seed for "discover deals without naming a card first". Sorted by
 * newest-listed within a $20-$300 price band: unrestricted-by-price
 * browsing (tried live first) surfaced near-worthless base commons at the
 * cheap end, and sorting by price descending surfaced ultra-rare
 * autographs/jerseys/1-of-1s at the expensive end with too little real
 * sold history to compare against reliably — this band targets the
 * standard rookie/parallel cards that actually have enough recent sold
 * comps to judge.
 */
export async function browseCategory(
  category: CardCategory,
  limit = 25
): Promise<EbayListing[]> {
  const token = await getAccessToken();

  const url = new URL("https://api.ebay.com/buy/browse/v1/item_summary/search");
  url.searchParams.set("category_ids", CATEGORY_ID_BY_CARD_CATEGORY[category]);
  const keyword = BROWSE_KEYWORD_BY_CATEGORY[category];
  if (keyword) url.searchParams.set("q", keyword);
  url.searchParams.set("limit", String(limit));
  url.searchParams.set("sort", "newlyListed");
  url.searchParams.set("filter", "buyingOptions:{FIXED_PRICE},price:[20..300],priceCurrency:USD");

  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${token}`, "X-EBAY-C-MARKETPLACE-ID": "EBAY_US" },
    cache: "no-store", // discovery wants genuinely fresh listings, not a cached page of the same ones every run
  });
  if (!res.ok) {
    throw new Error(`eBay category browse failed: ${res.status} ${res.statusText}`);
  }

  const json = await res.json();
  const items: Record<string, unknown>[] = json?.itemSummaries ?? [];
  return items.map(mapItemSummary);
}

