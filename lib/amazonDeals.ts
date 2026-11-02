import { fetchDeals, checkCoupons } from "@/lib/sources/keepa";
import type { RawDeal } from "@/lib/types";

export type AmazonDeal = RawDeal & {
  // null = coupon status wasn't checked for this item (checking is
  // capped and opt-in — see MAX_COUPON_CHECKS below); true/false once
  // actually checked against Keepa's per-product data.
  hasCoupon: boolean | null;
};

// Checking coupon status needs a separate, more expensive Keepa
// `/product` lookup per candidate — confirmed live the `/deal` endpoint
// that free-browses discounts has no coupon field at all (see
// checkCoupons' doc comment in lib/sources/keepa.ts). Capped tightly and
// opt-in, same cost-conscious pattern as Electronics Search's sold-comps
// caps — a paid, token-metered API, and testing this live during
// development burned through a real account's remaining tokens checking
// just ~250 products, so this stays deliberately small.
const MAX_COUPON_CHECKS = 12;

export type AmazonDealsOptions = {
  // "Price errors," requested directly, is an approximation — Keepa has
  // no "this is a pricing mistake" flag at all. This is just a much
  // higher discount-percentage floor than the main feed's default (40),
  // on top of the same salesRankDrops90 > 0 legitimacy check fetchDeals
  // already applies underneath — an extreme discount that's still
  // backed by real recent sales, not a guess at what "looks like" an
  // error.
  minDiscountPercent?: number;
  maxPages?: number;
  // Opt-in — see MAX_COUPON_CHECKS above. Off by default so a plain
  // browse of this page never spends the extra per-product tokens
  // unless asked for.
  checkCoupons?: boolean;
};

/**
 * Amazon deals (via Keepa) specifically for extreme discounts ("price
 * errors") and active coupons — requested directly: "a separate Amazon
 * tab that I can link my Keepa API to, to find deals on Amazon that use
 * a coupon or promo code or price errors." Reuses fetchDeals (the same
 * fetch/legitimacy-filter/mapping the main Deal Finder feed's Keepa
 * source uses) rather than duplicating it, then layers coupon-checking
 * on top for the top `MAX_COUPON_CHECKS` candidates when requested.
 */
export async function searchAmazonDeals(options: AmazonDealsOptions = {}): Promise<AmazonDeal[]> {
  const { minDiscountPercent = 70, maxPages = 1, checkCoupons: shouldCheckCoupons = false } = options;

  const deals = await fetchDeals(minDiscountPercent, maxPages);

  if (!shouldCheckCoupons || deals.length === 0) {
    return deals.map((d) => ({ ...d, hasCoupon: null }));
  }

  const toCheck = deals.slice(0, MAX_COUPON_CHECKS);
  const toSkip = deals.slice(MAX_COUPON_CHECKS);
  const asinOf = (d: RawDeal) => d.id.replace(/^keepa-/, "");

  let withCoupon = new Set<string>();
  try {
    withCoupon = await checkCoupons(toCheck.map(asinOf));
  } catch {
    // Leave hasCoupon as "not checked" (null) for this batch rather than
    // failing the whole search over the coupon check specifically — the
    // price-error listings themselves are still useful without it.
  }

  const checked: AmazonDeal[] = toCheck.map((d) => ({ ...d, hasCoupon: withCoupon.has(asinOf(d)) }));
  const skipped: AmazonDeal[] = toSkip.map((d) => ({ ...d, hasCoupon: null }));
  return [...checked, ...skipped];
}
