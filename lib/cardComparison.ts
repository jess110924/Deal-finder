import { findCard, buildProductUrl, type CardCategory, type CardReference } from "@/lib/sources/pricecharting";
import { searchListings, findReferenceListing, type EbayListing } from "@/lib/sources/ebay";
import { saveNewFinds, type ReferenceInfo, type SavedFind } from "@/lib/db";
import { extractSearchKeywords, extractSerialDenominator } from "@/lib/cardKeywords";
import { mapWithConcurrency } from "@/lib/concurrency";

export type { CardCategory };

// Graded slabs (PSA 10, BGS 9.5, etc.) sell for multiples of a raw card's
// price. PriceCharting's reference here is ungraded-only, so comparing a
// graded listing against it would produce a false "great deal" — a PSA 10
// priced "50% below" an ungraded reference isn't a deal, it's a mismatch.
//
// Filtered using eBay's own `condition` field (confirmed live: they
// reliably return the literal string "Graded" vs "Ungraded" for trading
// cards, conditionId 2750 vs 4000) — an earlier version of this filter
// used a title regex requiring a grade number right after "PSA"/"BGS"/etc,
// which missed titles like "PSA Graded Mint 9" (words in between) and let
// graded slabs slip through undetected. The structured condition field
// doesn't have that failure mode.
export function isGraded(condition: string | null): boolean {
  return (condition ?? "").toLowerCase().includes("graded") && !(condition ?? "").toLowerCase().includes("ungraded");
}

// A "lot of 5" (or similar bundle) listing's price covers multiple cards,
// not the one being searched for — comparing its total price against a
// single-card reference price is meaningless, not just ungraded-vs-graded
// mismatched. Caught this from a real result: a 5-card lot spanning three
// different products (Hoops, Chronicles, Prizm Emergent) at $350 sitting
// in results for a Prizm-only search, condition "New" so the grading
// filter didn't (and shouldn't have) caught it.
const LOT_PATTERN = /\b(lot of|lot\/|\(\d+\)|\d+[- ]card lot|bundle)\b/i;

export function isBundle(title: string): boolean {
  return LOT_PATTERN.test(title);
}

export type CardListingResult = EbayListing & {
  priceDollars: number;
  percentBelowReference: number | null;
  isUnderpriced: boolean;
  // This listing's OWN best-matching PriceCharting product — not the one
  // product shown at the top of the page for the overall search query.
  // See the comment on searchUnderpricedCards for why these can't be the
  // same thing.
  reference: ReferenceInfo | null;
};

export type CardSearchResult = {
  query: string;
  category: CardCategory;
  reference: ReferenceInfo | null;
  listings: CardListingResult[];
};

export const UNDERPRICED_THRESHOLD_PERCENT = 20;

/**
 * A real photo + link for this exact card, so it's obvious at a glance
 * whether whatever's being compared against is actually the right card.
 * `productUrl` (the reference's own PriceCharting/SportsCardsPro page) is
 * always populated — it's the primary "verify" link, since it's the
 * actual source the reference price came from. The eBay-sourced photo/
 * link only exist when PriceCharting linked an eBay catalog id (epid) for
 * this product — not every product has one (confirmed: newer/more-
 * searched cards tend to, older ones sometimes don't) — and
 * `ebaySearchUrl` is a secondary always-available fallback for those.
 * `query` should be the search text that found this reference (not
 * necessarily the product's own name) since that's what's passed to the
 * epid lookup.
 */
export async function buildReferenceInfo(
  query: string,
  reference: CardReference,
  category: CardCategory,
  includeImage = true
): Promise<ReferenceInfo> {
  let imageUrl: string | null = null;
  let itemWebUrl: string | null = null;
  if (includeImage && reference.epid) {
    try {
      const found = await findReferenceListing(query, reference.epid);
      imageUrl = found?.imageUrl ?? null;
      itemWebUrl = found?.itemWebUrl ?? null;
    } catch {
      // Not worth failing the whole thing over — ebaySearchUrl/productUrl
      // below still give a way to double-check the reference by hand.
    }
  }
  return {
    productName: reference.productName,
    ungradedPriceDollars: (reference.ungradedPriceCents ?? 0) / 100,
    imageUrl,
    itemWebUrl,
    ebaySearchUrl: `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(reference.productName + " " + reference.consoleName)}`,
    productUrl: buildProductUrl(reference, category),
  };
}

const LOOKUP_CONCURRENCY = 12;

/**
 * Checks one listing against its OWN best-matching PriceCharting product
 * — never the single reference computed for the overall search query.
 * This is the actual fix for a serious, reported-live bug: searching (or
 * watching) a bare player name like "Luka doncic" returns listings
 * spanning many completely different cards (a 2018 base Prizm, a 2024-25
 * Obsidian Red Electric Etch parallel, etc.) — comparing all of them
 * against one shared reference (whichever single product that broad
 * query happened to match) produced nonsense: a real production example
 * flagged a $29.99 2024-25 Obsidian parallel as "45% under reference"
 * against a 2018 Prizm base card's $54.98 price, two unrelated products
 * that only share a player's name.
 *
 * The eBay photo lookup inside buildReferenceInfo (one extra API call)
 * only runs for listings that actually end up flagged underpriced —
 * running it for all ~30 listings on every search would be needlessly
 * expensive for the ones nobody will ever look twice at.
 *
 * Looks up the listing's OWN raw title, not an extractSearchKeywords-
 * stripped version. That stripping predates findCard's relevance scoring
 * (see pricecharting.ts) and is now counterproductive: it discards set-
 * name/parallel words the scorer needs to disambiguate. Confirmed live —
 * "Kyrie Irving 2025-26 Topps Inception Gold Electricity Mavericks /50"
 * stripped down to "Kyrie Irving gold /50" matched a wrong 2024 Panini
 * Prizm Monopoly card, while the full raw title correctly matches the
 * real 2025 Topps Inception product. Re-tested the original cases that
 * motivated the stripping (a Jalen Johnson Noir auto, a Cade Cunningham
 * Chrome refractor, a Ja Morant Select card) with the full title +
 * relevance scoring and all still matched correctly — the scorer alone
 * now handles what the stripping used to.
 */
async function evaluateListing(listing: EbayListing, category: CardCategory): Promise<CardListingResult> {
  const priceDollars = listing.priceCents / 100;

  let reference: CardReference | null;
  try {
    reference = await findCard(listing.title, category);
  } catch {
    reference = null;
  }

  if (!reference?.ungradedPriceCents || reference.ungradedPriceCents <= 0) {
    return { ...listing, priceDollars, percentBelowReference: null, isUnderpriced: false, reference: null };
  }

  const percentBelowReference = ((reference.ungradedPriceCents - listing.priceCents) / reference.ungradedPriceCents) * 100;
  const isUnderpriced = percentBelowReference >= UNDERPRICED_THRESHOLD_PERCENT;
  const referenceInfo = await buildReferenceInfo(listing.title, reference, category, isUnderpriced);

  return { ...listing, priceDollars, percentBelowReference, isUnderpriced, reference: referenceInfo };
}

/**
 * `includeReferenceImage` costs one extra eBay API call and only affects
 * the top-of-page summary reference (the product matched for the overall
 * `query`, shown for context) — pass false to skip it when that summary
 * won't be displayed (e.g. the watchlist, which no longer uses it for
 * the underpriced determination at all, see evaluateListing above).
 */
export async function searchUnderpricedCards(
  query: string,
  category: CardCategory,
  includeReferenceImage = false
): Promise<CardSearchResult> {
  // Only rewrite the query when it carries a print-run denominator
  // ("/150") — a strong, safe signal this is a pasted-in raw eBay title
  // rather than a short deliberate search like "2018 Panini Prizm Luka
  // Doncic". Rewriting the latter would risk dropping its year and
  // matching the wrong season's card instead — gating on the serial
  // number avoids that regression entirely, since a short deliberate
  // query essentially never includes one. This still narrows what's sent
  // to eBay's own listings search, which has no relevance scoring of its
  // own to fall back on.
  const effectiveQuery = extractSerialDenominator(query) ? extractSearchKeywords(query) : query;

  // The PriceCharting lookup, by contrast, gets the full raw query, not
  // effectiveQuery — findCard's relevance scoring (pricecharting.ts) needs
  // the set-name/parallel words that extractSearchKeywords strips out to
  // disambiguate correctly. Confirmed live: stripping "Kyrie Irving
  // 2025-26 Topps Inception Gold Electricity Mavericks /50" down to
  // "Kyrie Irving gold /50" matched the wrong "2024 Panini Prizm
  // Monopoly" card; the full query correctly matches the real "2025
  // Topps Inception" product.
  const [reference, rawListings] = await Promise.all([
    findCard(query, category),
    searchListings(effectiveQuery, category),
  ]);

  let ungradedListings = rawListings.filter((l) => !isGraded(l.condition) && !isBundle(l.title));

  // Rewriting the query only helps when a subject can be confidently
  // guessed (see extractSearchKeywords) — plenty of real titles start
  // with the year instead of the player, where it can't, and the
  // listings search then stays as loose as the raw title. Confirmed live
  // this lets the wrong parallel through even after the fix above: a
  // search for "...Cade Cunningham #88 Blue Refractor /150..." correctly
  // matched the right PriceCharting product ($34.99) but still returned
  // "Red White & Blue Refractor" listings (a different, much cheaper
  // parallel) flagged as underpriced against it. Filtering the listings
  // themselves by the serial number closes this regardless of whether
  // the query rewrite above succeeded. Now a secondary safety net rather
  // than the primary fix — each listing gets its own accurate reference
  // below regardless — but still worth keeping: it also trims the
  // (now more expensive, since every listing gets its own PriceCharting
  // lookup) list down before that work happens.
  const querySerial = extractSerialDenominator(query);
  if (querySerial) {
    const withSerial = ungradedListings.filter((l) => l.title.includes(querySerial));
    if (withSerial.length > 0) ungradedListings = withSerial;
  }

  // Each listing checked against its own match, not the shared `reference`
  // below — see evaluateListing's doc comment for why that distinction is
  // the actual fix for a real reported bug. Bounded concurrency for the
  // same reason Discover uses it: sequential would be far too slow for a
  // search returning up to 30 listings.
  const listings = await mapWithConcurrency(ungradedListings, LOOKUP_CONCURRENCY, (l) => evaluateListing(l, category));

  // Best deals (most below reference) first, then everything else by price.
  listings.sort((a, b) => {
    if (a.percentBelowReference != null && b.percentBelowReference != null) {
      return b.percentBelowReference - a.percentBelowReference;
    }
    return a.priceDollars - b.priceDollars;
  });

  // This is the *overall query's* best match, shown at the top of the
  // page for context — not what any individual listing below is actually
  // compared against anymore (each has its own, in `listings[].reference`).
  const referenceInfo = reference ? await buildReferenceInfo(query, reference, category, includeReferenceImage) : null;

  return {
    query,
    category,
    reference: referenceInfo,
    listings,
  };
}

/**
 * Runs a search for one watchlist card and saves any underpriced listings
 * found. Shared by the scheduled check (check-watchlist route, every ~30
 * min) and an immediate on-add check (watchlist route's POST) — without
 * the latter, adding a card gives zero feedback until the next scheduled
 * run, up to 30 minutes of "did this even work?" with nothing to look at.
 *
 * Each saved find carries `l.reference` — that listing's own match from
 * evaluateListing — not the watchlist entry's overall query match. This
 * matters most exactly when the watchlist entry is broad (just a player
 * name, e.g. "Luka doncic", not "2018 Panini Prizm Luka Doncic"): the
 * listings returned span many different real cards, and using one shared
 * reference for all of them was the reported bug this fixes (see
 * evaluateListing's doc comment for the concrete numbers).
 */
export async function checkCardAndSaveFinds(card: string, category: CardCategory): Promise<number> {
  // The top-of-page summary reference (searchUnderpricedCards's own
  // `reference`) is never shown here, so there's no reason to spend the
  // extra eBay call fetching its photo.
  const result = await searchUnderpricedCards(card, category, false);
  const candidates: SavedFind[] = result.listings
    .filter((l) => l.isUnderpriced)
    .map((l) => ({
      itemId: l.itemId,
      title: l.title,
      priceDollars: l.priceDollars,
      itemWebUrl: l.itemWebUrl,
      imageUrl: l.imageUrl,
      condition: l.condition,
      percentBelowReference: l.percentBelowReference!,
      searchedFor: card,
      category,
      source: "watchlist",
      reference: l.reference ?? undefined,
      foundAt: new Date().toISOString(),
    }));
  return saveNewFinds(candidates);
}
