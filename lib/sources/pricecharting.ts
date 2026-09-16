import type { CardCategory } from "@/lib/sources/ebay";
import { extractSerialDenominator } from "@/lib/cardKeywords";

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
//
// An IDF-weighted version of this (down-weighting words shared by most
// candidates, up-weighting rare ones) was tried and reverted after a
// live counterexample: querying "Mega Charizard X ex 109/094 Phantasmal
// Flames Full Art Ultra Rare NM" against Pokemon, the real match ("Mega
// Charizard X ex #109", console "Pokemon Phantasmal Flames") shares
// "mega"/"charizard"/"phantasmal"/"flames" with dozens of other Phantasmal
// Flames candidates PriceCharting's own search already returned — so IDF
// down-weighted exactly those words as "too common" and instead promoted
// "Sprigatito [Horizons Full Art] #109" on the rarer, coincidental overlap
// of "full"/"art"/"109". The premise doesn't hold here: PriceCharting's
// search already pre-filters to relevant candidates, so a word most of
// them share is usually the actual subject, not noise. Flat fraction
// handles this case correctly on its own — the real match and "Mega
// Charizard X Ex Ultra-Premium Collection" tie at the same fraction, and
// the specificity tie-break below picks the real match over the
// bundle/collection variant.
function relevanceScore(queryTokens: Set<string>, candidateTokens: Set<string>): number {
  if (queryTokens.size === 0) return 0;
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
 * Scores every returned candidate by how much of the *query's own* text
 * actually appears in it, and picks the best-scoring one instead of
 * position 0 — confirmed live this promotes the real Ja Morant card to
 * the top. Doesn't fix genuine ambiguity (the Ohtani case has no year to
 * go on, so several different years' cards score identically) — nothing
 * server-side can resolve that without more specific input. Always
 * searches with the full raw title/query, not a keyword-stripped
 * version — stripping predates this scoring and is now counterproductive,
 * discarding set-name/parallel words the scorer needs to disambiguate
 * (confirmed live: "Kyrie Irving 2025-26 Topps Inception Gold Electricity
 * Mavericks /50" stripped to "Kyrie Irving gold /50" matched a wrong 2024
 * Panini Prizm Monopoly card; the full query correctly matches the real
 * 2025 Topps Inception product).
 *
 * Two further accuracy passes on top of the position-0 fix above, both
 * from the same "cards that come up aren't accurate" report:
 *
 * 1. A print-run denominator ("/150") in the query is one of the
 *    strongest disambiguators PriceCharting's own product names carry —
 *    when the query has one and at least one candidate's own text has
 *    the same one, scoring is restricted to just that subset first.
 *    Otherwise a wrong-denominator parallel ("Blue Refractor /99") can
 *    still out-score the real one ("Blue Refractor /150") on generic
 *    word overlap alone, since a plain overlap fraction doesn't treat
 *    "/150 not present" as disqualifying on its own.
 * 2. Ties on the overlap score (common — a real card and a "Collection"/
 *    "Ultra-Premium"/bundle variant of the same card often share every
 *    query word) are now broken in favor of the candidate with fewer
 *    total words, instead of whichever PriceCharting happened to return
 *    first. A bundle/collection product name always carries extra words
 *    the single-card query didn't ask for, so the more specific,
 *    single-card name is the better bet between two otherwise-equal
 *    matches. Confirmed live: "Mega Charizard X ex #109" vs "Mega
 *    Charizard X Ex Ultra-Premium Collection" (both Pokemon Phantasmal
 *    Flames) tie on word overlap; specificity now picks the real single
 *    card instead of leaving it to API response order.
 */
export async function findCard(query: string, category: CardCategory): Promise<CardReference | null> {
  const json = await pcFetch(category, "/products", { q: query });
  let products: Record<string, unknown>[] = Array.isArray(json?.products) ? json.products : [];
  if (products.length === 0) return null;

  const serial = extractSerialDenominator(query);
  if (serial) {
    const withSerial = products.filter((p) =>
      `${p["product-name"] ?? ""} ${p["console-name"] ?? ""}`.includes(serial)
    );
    if (withSerial.length > 0) products = withSerial;
  }

  const queryTokens = tokenize(query);
  const candidateTokenSets = products.map((p) => tokenize(`${p["product-name"] ?? ""} ${p["console-name"] ?? ""}`));

  let best = products[0];
  let bestScore = -1;
  let bestSpecificity = Infinity;
  products.forEach((p, i) => {
    const score = relevanceScore(queryTokens, candidateTokenSets[i]);
    const specificity = candidateTokenSets[i].size;
    if (score > bestScore || (score === bestScore && specificity < bestSpecificity)) {
      bestScore = score;
      bestSpecificity = specificity;
      best = p;
    }
  });
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
 * rather than assumed. This is the primary "verify this is the right
 * card" link, since it's the actual source the reference price came
 * from.
 *
 * Deliberately not fetched or verified server-side per card — constructing
 * the URL costs nothing, and trying to verify it server-side hits
 * Cloudflare's bot challenge (confirmed live, even for occasional traffic
 * from here) that a real browser navigating there doesn't, since that's
 * exactly what the challenge exists to tell apart. A handful of unusual
 * product names could in principle slugify to a URL that's slightly off,
 * but this hasn't been observed in testing.
 */
export function buildProductUrl(reference: CardReference, category: CardCategory): string {
  return `${SITE_BASE_BY_CATEGORY[category]}/game/${slugify(reference.consoleName)}/${slugify(reference.productName)}`;
}
