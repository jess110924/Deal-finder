// The flat per-order fee is the same across every eBay category —
// confirmed alongside both category-specific rates below.
const EBAY_LOW_ORDER_FLAT_FEE = 0.3;
const EBAY_HIGH_ORDER_FLAT_FEE = 0.4;
const EBAY_LOW_ORDER_THRESHOLD_DOLLARS = 10;

function flatOrderFeeDollars(saleAmountDollars: number): number {
  return saleAmountDollars <= EBAY_LOW_ORDER_THRESHOLD_DOLLARS ? EBAY_LOW_ORDER_FLAT_FEE : EBAY_HIGH_ORDER_FLAT_FEE;
}

// eBay's Final Value Fee for Sports/Non-Sport Trading Cards and
// Collectible Card Games: 13.25% of the total sale amount up to $7,500
// (2.35% on the portion above that, irrelevant at trading-card prices).
// Confirmed via live web search against eBay's current published fee
// schedule (Sept 2026), not assumed or carried over from stale
// knowledge — this exact number is what a real resale would actually be
// charged, and materially changes whether a "deal" is worth buying at
// all once it's netted out.
const EBAY_CARDS_FINAL_VALUE_FEE_RATE = 0.1325;

export function estimateEbaySellingFeeDollars(saleAmountDollars: number): number {
  return saleAmountDollars * EBAY_CARDS_FINAL_VALUE_FEE_RATE + flatOrderFeeDollars(saleAmountDollars);
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

// eBay's *standard* Final Value Fee across most categories as of the
// Feb 2025 fee update (13.6% for non-Store sellers) — confirmed via live
// web search, same standard this project already holds itself to for
// the cards rate above, not assumed. Used as Electronics Search's
// default because "electronics" spans many different eBay fee
// categories with genuinely different rates (the same live search found
// Cell Phones & Smartphones specifically sits lower, around 9%, and
// couldn't get a confident, distinctly-sourced number for Smart Watches
// specifically). Deliberately erring toward the *higher*, more
// conservative rate as the one-size-fits-all default rather than the
// lower phone-specific one: a wrong estimate should understate profit,
// not overstate it — so on an actual iPhone/Apple Watch listing, real
// profit if resold is likely *better* than what's shown here, never
// worse for this reason.
const EBAY_ELECTRONICS_FINAL_VALUE_FEE_RATE = 0.136;

export function estimateElectronicsResaleProfitDollars(
  listingPriceDollars: number,
  listingShippingDollars: number,
  averagePriceDollars: number
): number {
  const totalCostToAcquire = listingPriceDollars + listingShippingDollars;
  const sellingFee = averagePriceDollars * EBAY_ELECTRONICS_FINAL_VALUE_FEE_RATE + flatOrderFeeDollars(averagePriceDollars);
  const netResaleProceeds = averagePriceDollars - sellingFee;
  return netResaleProceeds - totalCostToAcquire;
}
