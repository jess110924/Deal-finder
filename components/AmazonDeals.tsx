"use client";

import { useEffect, useState } from "react";
import type { AmazonDeal } from "@/lib/amazonDeals";

export default function AmazonDeals() {
  const [minDiscount, setMinDiscount] = useState("70");
  const [checkCoupons, setCheckCoupons] = useState(false);
  const [couponOnly, setCouponOnly] = useState(false);
  const [deals, setDeals] = useState<AmazonDeal[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastCheckedCoupons, setLastCheckedCoupons] = useState(false);

  async function load(e?: React.FormEvent) {
    e?.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      const minDiscountNum = Number(minDiscount);
      if (minDiscount.trim() && Number.isFinite(minDiscountNum) && minDiscountNum >= 0) {
        params.set("minDiscount", String(minDiscountNum));
      }
      if (checkCoupons) params.set("checkCoupons", "1");
      const res = await fetch(`/api/amazon/deals?${params}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `Request failed: ${res.status}`);
      setDeals(json.deals ?? []);
      setLastCheckedCoupons(checkCoupons);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    // Initial load on mount, default params (no coupon check — that's
    // opt-in and costs extra Keepa tokens, see lib/amazonDeals.ts).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const checkedForCoupons = deals?.filter((d) => d.hasCoupon != null) ?? [];
  const withCoupon = deals?.filter((d) => d.hasCoupon === true) ?? [];
  const visibleDeals = couponOnly ? withCoupon : (deals ?? []);

  return (
    <div className="flex flex-col gap-6 w-full max-w-3xl mx-auto px-6 py-8">
      <div>
        <h2 className="text-lg font-semibold" style={{ color: "var(--text-primary)" }}>
          Amazon Deals
        </h2>
        <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
          Amazon price drops via Keepa, filtered for the extreme end — &quot;price errors&quot; here
          means a much steeper discount than the main feed&apos;s Keepa deals use, still backed by
          real recent sales (Keepa has no actual &quot;this is a pricing mistake&quot; flag; this is an
          approximation, not a guarantee). &quot;Has a coupon&quot; requires a separate, more expensive
          per-item lookup — Keepa&apos;s deal browse itself carries no coupon data at all — so it&apos;s
          opt-in and capped to the top 12 results per search, not checked by default.
        </p>
      </div>

      <form onSubmit={load} className="flex flex-wrap gap-2 items-center">
        <div className="flex items-center gap-1">
          <span className="text-sm" style={{ color: "var(--text-muted)" }}>
            Min discount
          </span>
          <input
            type="number"
            min="0"
            max="100"
            value={minDiscount}
            onChange={(e) => setMinDiscount(e.target.value)}
            className="w-16 rounded-md px-2 py-2 text-sm"
            style={{ border: "1px solid var(--border-hairline)", background: "var(--surface-1)", color: "var(--text-primary)" }}
          />
          <span className="text-sm" style={{ color: "var(--text-muted)" }}>
            %
          </span>
        </div>
        <label className="flex items-center gap-1.5 text-sm" style={{ color: "var(--text-secondary)" }}>
          <input type="checkbox" checked={checkCoupons} onChange={(e) => setCheckCoupons(e.target.checked)} />
          Check for coupons (top 12, costs extra tokens)
        </label>
        <button
          type="submit"
          disabled={loading}
          className="rounded-md px-4 py-2 text-sm font-medium text-white"
          style={{ background: "var(--series-1)" }}
        >
          {loading ? "Loading…" : "Search"}
        </button>
      </form>

      {error && (
        <div className="rounded-md px-3 py-2 text-sm" style={{ color: "var(--critical)" }}>
          {error}
        </div>
      )}

      {deals && (
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <p className="text-xs" style={{ color: "var(--text-muted)" }}>
              {deals.length} deal{deals.length === 1 ? "" : "s"} found
              {lastCheckedCoupons && ` · ${checkedForCoupons.length} checked for coupons · ${withCoupon.length} have one`}
              .
            </p>
            {lastCheckedCoupons && withCoupon.length > 0 && (
              <label className="flex items-center gap-1.5 text-xs" style={{ color: "var(--text-secondary)" }}>
                <input type="checkbox" checked={couponOnly} onChange={(e) => setCouponOnly(e.target.checked)} />
                Coupon only
              </label>
            )}
          </div>
          {visibleDeals.length === 0 && (
            <p className="text-sm py-8 text-center" style={{ color: "var(--text-muted)" }}>
              {couponOnly
                ? "None of the results had a coupon — try unchecking “Coupon only” or lowering the discount floor."
                : "Nothing at that discount floor right now — try lowering it."}
            </p>
          )}
          {visibleDeals.map((deal) => (
            <div
              key={deal.id}
              className="rounded-lg p-3 flex gap-3 items-start"
              style={{ background: "var(--surface-1)", border: "1px solid var(--border-hairline)" }}
            >
              {deal.imageUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={deal.imageUrl}
                  alt=""
                  className="w-12 h-12 rounded-md object-contain shrink-0"
                  style={{ background: "#fff" }}
                  loading="lazy"
                  onError={(e) => {
                    e.currentTarget.style.display = "none";
                  }}
                />
              )}
              <div className="flex-1 min-w-0">
                {deal.hasCoupon === true && (
                  <div className="text-xs font-semibold mb-1" style={{ color: "var(--good)" }}>
                    🏷️ Has a coupon
                  </div>
                )}
                <a
                  href={deal.link}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-medium hover:underline"
                  style={{ color: "var(--text-primary)" }}
                >
                  {deal.title}
                </a>
                {deal.description && (
                  <p className="text-sm mt-1 line-clamp-2" style={{ color: "var(--text-secondary)" }}>
                    {deal.description}
                  </p>
                )}
              </div>
              <div className="flex flex-col items-end gap-2 shrink-0">
                {deal.discountPercent != null && (
                  <span className="text-sm font-semibold tabular-nums" style={{ color: "var(--good)" }}>
                    {deal.discountPercent}% off
                  </span>
                )}
                {deal.price != null && (
                  <span className="text-sm tabular-nums" style={{ color: "var(--text-secondary)" }}>
                    ${deal.price.toFixed(2)}
                    {deal.originalPrice != null && (
                      <span style={{ color: "var(--text-muted)", textDecoration: "line-through", marginLeft: 4 }}>
                        ${deal.originalPrice.toFixed(2)}
                      </span>
                    )}
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
