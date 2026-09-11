export type CardCategory = "sports" | "pokemon";

// SportsCardsPro and PriceCharting are the same company/account/API key/
// response shape, but scoped to different card types — confirmed live by
// querying both with identical terms. Sports card queries against
// pricecharting.com itself return almost entirely irrelevant results
// (Funko figures, unrelated products sharing a player's name); Pokemon
// queries against sportscardspro.com would have the same problem in
// reverse (it's scoped to sports). So: sports -> sportscardspro.com,
// pokemon -> pricecharting.com. Verified live for pokemon too — a "1999
// Base Set Charizard" query returned a real, sane ungraded reference price.
const API_BASE_BY_CATEGORY: Record<CardCategory, string> = {
  sports: "https://www.sportscardspro.com/api",
  pokemon: "https://www.pricecharting.com/api",
};

export type CardReference = {
  id: string;
  productName: string;
  consoleName: string;
  ungradedPriceCents: number | null;
  // eBay's catalog product id for this exact card, when PriceCharting has
  // it linked — lets us pull a real photo of this specific product via
  // eBay's Browse API (see lib/sources/ebay.ts's findReferenceListing).
  // Confirmed present on newer/more-searched cards (e.g. 2018 Prizm Luka
  // Doncic); confirmed absent on some older ones (e.g. 1999 Base Set
  // Charizard) — always optional, never assume it's there.
  epid: string | null;
};

function mapProduct(json: Record<string, unknown>): CardReference {
  const cents = (v: unknown): number | null =>
    typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : null;

  return {
    id: String(json.id ?? ""),
    productName: String(json["product-name"] ?? ""),
    consoleName: String(json["console-name"] ?? ""),
    ungradedPriceCents: cents(json["loose-price"]),
    epid: json.epid ? String(json.epid) : null,
  };
}

async function pcFetch(category: CardCategory, path: string, params: Record<string, string>) {
  const apiKey = process.env.PRICECHARTING_API_KEY;
  if (!apiKey) {
    throw new Error("PRICECHARTING_API_KEY is not set.");
  }
  const url = new URL(`${API_BASE_BY_CATEGORY[category]}${path}`);
  url.searchParams.set("t", apiKey);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

  const res = await fetch(url.toString(), { next: { revalidate: 3600 } }); // reference prices move slowly; 1hr cache
  if (!res.ok) {
    throw new Error(`PriceCharting request failed: ${res.status} ${res.statusText}`);
  }
  return res.json();
}

function tokenize(s: string): Set<string> {
  return new Set(
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .split(" ")
      .filter((w) => w.length > 1)
  );
}

// Fraction of the query's own words that actually appear in a candidate's
// name — not the other way around, since a candidate naturally carries
// extra words (year, set, subset) the query didn't ask for.
function relevanceScore(query: string, productName: string, consoleName: string): number {
  const queryTokens = tokenize(query);
  if (queryTokens.size === 0) return 0;
  const candidateTokens = tokenize(`${productName} ${consoleName}`);
  let overlap = 0;
  for (const t of queryTokens) if (candidateTokens.has(t)) overlap++;
  return overlap / queryTokens.size;
}

/**
 * Returns the best-matching card product for a free-text search, or null
 * if nothing came back. Reported directly ("a lot of the cards I search
 * ... comparisons aren't accurate") and confirmed live to be a real,
 * frequent problem: this used to just trust whatever PriceCharting's own
 * search put first — but that ranking isn't always relevance to the
 * *player*. Two live examples: "Ja Morant Select Concourse" put an
 * unrelated Brian Thomas Jr. **football** card first, with the real Ja
 * Morant match buried in 5th place; "Shohei Ohtani Topps Chrome" (no year
 * given) put a $492 2026 base card ahead of his $89,688 2018 rookie.
 * Now scores every returned candidate by how much of the *query's own*
 * text actually appears in it, and picks the best-scoring one instead of
 * position 0 — confirmed live this promotes the real Ja Morant card to
 * the top. Doesn't fix genuine ambiguity (the Ohtani case has no year to
 * go on, so several different years' cards score identically) — nothing
 * server-side can resolve that without more specific input.
 */
export async function findCard(query: string, category: CardCategory): Promise<CardReference | null> {
  const json = await pcFetch(category, "/products", { q: query });
  const products = Array.isArray(json?.products) ? json.products : [];
  if (products.length === 0) return null;

  let best = products[0];
  let bestScore = -1;
  for (const p of products) {
    const score = relevanceScore(query, String(p["product-name"] ?? ""), String(p["console-name"] ?? ""));
    if (score > bestScore) {
      bestScore = score;
      best = p;
    }
  }
  return mapProduct(best);
}

const SITE_BASE_BY_CATEGORY: Record<CardCategory, string> = {
  sports: "https://www.sportscardspro.com",
  pokemon: "https://www.pricecharting.com",
};

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

/**
 * Builds the product's own page on PriceCharting/SportsCardsPro — the
 * `/game/<console-slug>/<product-slug>` pattern, confirmed live (on both
 * domains, with the resulting page's title matching the product exactly)
 * rather than assumed. Requested directly: the reference photo/link shown
 * next to a saved find pointed to an eBay listing, not PriceCharting
 * itself.
 *
 * Deliberately not fetched or verified per-card at request time —
 * constructing the URL costs nothing, and trying to verify it server-side
 * hits Cloudflare's bot challenge (confirmed live, even for occasional
 * traffic from here) that a real browser navigating there doesn't —
 * that's exactly what the challenge exists to tell apart. A handful of
 * unusual product names could in principle slugify to a URL that's
 * slightly off, but this hasn't been observed in testing.
 */
export function buildProductUrl(reference: CardReference, category: CardCategory): string {
  return `${SITE_BASE_BY_CATEGORY[category]}/game/${slugify(reference.consoleName)}/${slugify(reference.productName)}`;
}
