// SportsCardsPro, not pricecharting.com — same company, same account, same
// API key, same request/response shape, but a domain scoped specifically
// to sports cards. This matters: querying pricecharting.com's own domain
// for a sports card search returns almost entirely irrelevant results
// (Funko figures, unrelated products sharing a player's name, sometimes
// zero real matches in the first 100 results) even though the query and
// API usage are correct — confirmed by testing the identical query against
// both domains with the same key. Pokemon card search on pricecharting.com
// itself works fine; sports cards specifically don't, hence this domain.
const API_BASE = "https://www.sportscardspro.com/api";

export type CardReference = {
  id: string;
  productName: string;
  consoleName: string;
  ungradedPriceCents: number | null;
};

function mapProduct(json: Record<string, unknown>): CardReference {
  const cents = (v: unknown): number | null =>
    typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : null;

  return {
    id: String(json.id ?? ""),
    productName: String(json["product-name"] ?? ""),
    consoleName: String(json["console-name"] ?? ""),
    ungradedPriceCents: cents(json["loose-price"]),
  };
}

async function pcFetch(path: string, params: Record<string, string>) {
  const apiKey = process.env.PRICECHARTING_API_KEY;
  if (!apiKey) {
    throw new Error("PRICECHARTING_API_KEY is not set.");
  }
  const url = new URL(`${API_BASE}${path}`);
  url.searchParams.set("t", apiKey);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

  const res = await fetch(url.toString(), { next: { revalidate: 3600 } }); // reference prices move slowly; 1hr cache
  if (!res.ok) {
    throw new Error(`SportsCardsPro request failed: ${res.status} ${res.statusText}`);
  }
  return res.json();
}

/** Returns the best-matching card product for a free-text search, or null if nothing came back. */
export async function findCard(query: string): Promise<CardReference | null> {
  const json = await pcFetch("/products", { q: query });
  const products = Array.isArray(json?.products) ? json.products : [];
  if (products.length === 0) return null;
  return mapProduct(products[0]);
}
