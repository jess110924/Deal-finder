import { searchListings, type EbayListing } from "@/lib/sources/ebay";
import { isGraded, isBundle, type CardCategory } from "@/lib/cardComparison";
import { extractSearchKeywords, extractSerialDenominator } from "@/lib/cardKeywords";

/**
 * Step 1 of the manual "browse a player, eyeball the $30-$100 range"
 * process: a plain price-banded eBay search for a player's name, with no
 * PriceCharting reference attached — a player name isn't one product, so
 * there's nothing single to compare against yet. Ungraded/non-bundle only,
 * same as the rest of the site.
 */
export async function searchPlayerCards(
  query: string,
  category: CardCategory,
  options: { minPriceDollars?: number; maxPriceDollars?: number; limit?: number } = {}
): Promise<EbayListing[]> {
  const { minPriceDollars, maxPriceDollars, limit = 30 } = options;
  const raw = await searchListings(query, category, { limit, minPriceDollars, maxPriceDollars });
  return raw.filter((l) => !isGraded(l.condition) && !isBundle(l.title));
}

export type PeerComparison = {
  title: string;
  peerCount: number;
  averagePriceDollars: number;
  lowestPriceDollars: number;
  lowestListing: EbayListing;
  percentLowestBelowAverage: number;
  listings: EbayListing[]; // sorted lowest price first
};

/**
 * Step 2: "use that exact title to see what similar listings go for, then
 * compare to the current lowest." No eBay API key gets access to sold/
 * completed listing data (confirmed live: the buy.marketplace.insights
 * scope this would need comes back "invalid_scope" for this app's key,
 * meaning it isn't granted — that's a restricted, separately-approved
 * eBay API most developer accounts don't have), so this compares against
 * other *currently active* asking prices for the same exact card instead
 * of recent sold prices. Close to the same shape, but a real caveat: if
 * every seller of a card happens to be overpricing it right now, this
 * baseline is inflated right along with them — it's an asking-price
 * average, not a sold-price one.
 *
 * Two layers of protection against a broad title search pulling in the
 * wrong parallel — confirmed live this is a real risk, not theoretical:
 * a raw "q=<full title>" search for a Gold Wave Prizm pulled in a
 * completely different, much cheaper Blue Shimmer Prizm just because both
 * titles say "Prizm", and even quoting just the distinctive phrase
 * ("Blue Refractor") still pulled in a different, far more common
 * "Red White & Blue Refractor" parallel since that phrase contains it as
 * a substring. (1) `extractSearchKeywords` narrows the search query
 * itself using the known subject (passed in from the Player Search box)
 * plus whatever color/finish words identify the parallel. (2) When the
 * title has a print-run denominator ("/150"), candidates are additionally
 * required to carry that same denominator — confirmed live this cleanly
 * separates real peers from same-named-but-different parallels that
 * don't share it.
 */
export async function comparePeerListings(
  title: string,
  category: CardCategory,
  knownSubject?: string | null
): Promise<PeerComparison | null> {
  const query = extractSearchKeywords(title, knownSubject);
  const raw = await searchListings(query, category, { limit: 30 });
  let listings = raw.filter((l) => !isGraded(l.condition) && !isBundle(l.title));

  const serial = extractSerialDenominator(title);
  if (serial) {
    const withSerial = listings.filter((l) => l.title.includes(serial));
    // Only trust the narrower set if it actually found something —
    // otherwise this falls back to the unfiltered list rather than
    // returning nothing just because of formatting differences.
    if (withSerial.length > 0) listings = withSerial;
  }

  if (listings.length === 0) return null;

  const sorted = [...listings].sort((a, b) => a.priceCents - b.priceCents);
  const averageCents = listings.reduce((sum, l) => sum + l.priceCents, 0) / listings.length;
  const lowest = sorted[0];

  return {
    title,
    peerCount: listings.length,
    averagePriceDollars: averageCents / 100,
    lowestPriceDollars: lowest.priceCents / 100,
    lowestListing: lowest,
    percentLowestBelowAverage: averageCents > 0 ? ((averageCents - lowest.priceCents) / averageCents) * 100 : 0,
    listings: sorted,
  };
}
