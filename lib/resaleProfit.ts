// eBay's Final Value Fee for Sports/Non-Sport Trading Cards and
// Collectible Card Games: 13.25% of the total sale amount up to $7,500
// (2.35% on the portion above that, irrelevant at trading-card prices),
// plus a flat $0.30 (orders $10 or under) / $0.40 (orders over $10)
// per-order fee. Confirmed via live web search against eBay's current
// published fee schedule (Sept 2026), not assumed or carried over from
// stale knowledge — this exact number is what a real resale would
// actually be charged, and materially changes whether a "deal" is worth
// buying at all once it's netted out.
const EBAY_FINAL_VALUE_FEE_RATE = 0.1325;
const EBAY_LOW_ORDER_FLAT_FEE = 0.3;
const EBAY_HIGH_ORDER_FLAT_FEE = 0.4;
const EBAY_LOW_ORDER_THRESHOLD_DOLLARS = 10;

export function estimateEbaySellingFeeDollars(saleAmountDollars: number): number {
  const flatFee = saleAmountDollars <= EBAY_LOW_ORDER_THRESHOLD_DOLLARS ? EBAY_LOW_ORDER_FLAT_FEE : EBAY_HIGH_ORDER_FLAT_FEE;
  return saleAmountDollars * EBAY_FINAL_VALUE_FEE_RATE + flatFee;
}

/**
 * Estimated dollar profit from buying this listing and reselling it for
 * the average recent sold price — the number that actually answers
 * "is this worth buying," not just "is it cheaper than average."
 * Requested directly: "I want to be able to find cards on eBay that are
 * undervalued so I can resell them for a profit" — a raw
 * percent-below-average doesn't account for eBay's ~13.25%+ cut, and a
 * card that's "25% under average" can still be a loss once that's taken
 * out, especially on cheap cards where the flat $0.30/$0.40 per-order
 * fee is a large share of the sale.
 *
 * Cost side includes the listing's own shipping cost (a real, often
 * overlooked part of what it actually costs to acquire the card) — not
 * just the sticker price. Deliberately does NOT try to model the cost of
 * shipping it back out when resold: that's charged to (and paid by) the
 * next buyer in the same way, so it's treated as a wash rather than
 * guessed at with no real data to base a number on.
 */
export function estimateResaleProfitDollars(
  listingPriceDollars: number,
  listingShippingDollars: number,
  averageSoldPriceDollars: number
): number {
  const totalCostToAcquire = listingPriceDollars + listingShippingDollars;
  const sellingFee = estimateEbaySellingFeeDollars(averageSoldPriceDollars);
  const netResaleProceeds = averageSoldPriceDollars - sellingFee;
  return netResaleProceeds - totalCostToAcquire;
}
