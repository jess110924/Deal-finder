"use client";

import { useState } from "react";
import type { CardCategory, CardSearchResult } from "@/lib/cardComparison";

export default function CardSearch() {
  const [category, setCategory] = useState<CardCategory>("sports");
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<CardSearchResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    if (!query.trim()) return;

    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch(
        `/api/cards/search?q=${encodeURIComponent(query.trim())}&category=${category}`
      );
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `Request failed: ${res.status}`);
      setResult(json);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  // Only listings that clear MIN_WORTHWHILE_PROFIT_DOLLARS get shown —
  // requested directly: "when I search a card it only shows profitable
  // cards? The loss listings are pointless." Filtering here (not on the
  // server) still requires checking every capped listing's sold comps to
  // know which ones qualify — that check is what determines profitability
  // in the first place, so it can't be skipped to "save" a request; this
  // only stops showing the ones that didn't clear the bar once checked.
  const checked = result?.listings.filter((l) => l.wasChecked) ?? [];
  const profitable = result?.listings.filter((l) => l.isProfitable) ?? [];

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold" style={{ color: "var(--text-primary)" }}>
          Trading Cards
        </h1>
        <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
          Search a card. Listings come from eBay&apos;s active Buy It Now inventory, compared against
          real recent eBay sold prices for that exact title. Only listings with an estimated profit of
          $5+ after eBay&apos;s actual ~13.25%+$0.30-0.40 selling fee and shipping cost are shown, sorted
          highest profit first. Graded slabs (PSA/BGS/SGC) are excluded — their prices aren&apos;t
          comparable to an ungraded average. To keep sold-comps usage sustainable, only the 12 cheapest
          listings per search get checked — checking a listing is what tells us whether it&apos;s
          profitable, so that part can&apos;t be skipped, but you&apos;re only shown the ones worth
          acting on.
        </p>
      </div>

      <div className="flex gap-1">
        {(["sports", "pokemon"] as const).map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => setCategory(c)}
            className="rounded-md px-3 py-1.5 text-sm font-medium"
            style={
              category === c
                ? { background: "var(--series-1)", color: "#fff" }
                : { background: "var(--surface-1)", color: "var(--text-secondary)", border: "1px solid var(--border-hairline)" }
            }
          >
            {c === "sports" ? "Sports" : "Pokémon"}
          </button>
        ))}
      </div>

      <form onSubmit={handleSearch} className="flex gap-2">
        <div className="relative flex-1">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={category === "sports" ? "e.g. 2018 Panini Prizm Luka Doncic" : "e.g. 1999 Base Set Charizard"}
            className="w-full rounded-md pl-3 pr-8 py-2 text-sm"
            style={{ border: "1px solid var(--border-hairline)", background: "var(--surface-1)", color: "var(--text-primary)" }}
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery("")}
              aria-label="Clear search"
              className="absolute right-2 top-1/2 -translate-y-1/2 w-5 h-5 flex items-center justify-center text-sm rounded-full"
              style={{ color: "var(--text-muted)" }}
            >
              ×
            </button>
          )}
        </div>
        <button
          type="submit"
          disabled={loading}
          className="rounded-md px-4 py-2 font-medium text-white"
          style={{ background: "var(--series-1)" }}
        >
          {loading ? "Searching…" : "Search"}
        </button>
      </form>

      {error && (
        <div className="rounded-md px-3 py-2 text-sm" style={{ color: "var(--critical)" }}>
          {error}
        </div>
      )}

      {result && (
        <>
          <div
            className="rounded-lg p-4"
            style={{ background: "var(--surface-1)", border: "1px solid var(--border-hairline)" }}
          >
            {result.soldComps ? (
              <div>
                <div className="text-sm" style={{ color: "var(--text-muted)" }}>
                  Recent sold comps for this search (ungraded)
                </div>
                <div className="text-2xl font-semibold tabular-nums" style={{ color: "var(--text-primary)" }}>
                  ${result.soldComps.averageSoldPriceDollars.toFixed(2)} avg
                </div>
                <div className="text-sm" style={{ color: "var(--text-secondary)" }}>
                  {result.soldComps.compCount} sale{result.soldComps.compCount === 1 ? "" : "s"} · median $
                  {result.soldComps.medianSoldPriceDollars.toFixed(2)}
                </div>
                <a
                  href={result.soldComps.soldSearchUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs"
                  style={{ color: "var(--text-secondary)", textDecoration: "underline" }}
                >
                  View sold listings on eBay
                </a>
              </div>
            ) : (
              <p style={{ color: "var(--text-muted)" }}>No recent sold comps found for this search — showing eBay listings without a comparison.</p>
            )}
          </div>

          <p className="text-xs" style={{ color: "var(--text-muted)" }}>
            {result.listings.length} listing{result.listings.length === 1 ? "" : "s"} found · {checked.length} checked
            against sold comps · {profitable.length} profitable
          </p>

          <div className="flex flex-col gap-2">
            {profitable.length === 0 && (
              <p className="text-sm py-8 text-center" style={{ color: "var(--text-muted)" }}>
                No profitable listings in this search — {checked.length} checked,{" "}
                {result.listings.length - checked.length} not checked (past the 12-listing cap).
              </p>
            )}
            {profitable.map((listing) => (
              <div
                key={listing.itemId}
                className="rounded-lg overflow-hidden flex flex-col"
                style={{ background: "var(--surface-1)", border: "1px solid var(--border-hairline)" }}
              >
                <a href={listing.itemWebUrl} target="_blank" rel="noopener noreferrer" className="block">
                  {listing.imageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={listing.imageUrl} alt="" className="w-full aspect-square object-contain" style={{ background: "#fff" }} />
                  ) : (
                    <div
                      className="w-full aspect-square flex items-center justify-center text-sm"
                      style={{ background: "#fff", color: "var(--text-muted)" }}
                    >
                      No photo
                    </div>
                  )}
                </a>
                <div className="p-3">
                  <a
                    href={listing.itemWebUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-base hover:underline"
                    style={{ color: "var(--text-primary)" }}
                  >
                    {listing.title}
                  </a>
                  {listing.condition && (
                    <div className="text-xs mt-0.5" style={{ color: "var(--text-muted)" }}>{listing.condition}</div>
                  )}
                  {listing.soldComps && (
                    <a
                      href={listing.soldComps.soldSearchUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sm block mt-1"
                      style={{ color: "var(--series-1)", textDecoration: "underline" }}
                    >
                      Sold comps: avg ${listing.soldComps.averageSoldPriceDollars.toFixed(2)} across{" "}
                      {listing.soldComps.compCount} sale{listing.soldComps.compCount === 1 ? "" : "s"}
                    </a>
                  )}
                  <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                    <span className="font-semibold text-lg tabular-nums" style={{ color: "var(--text-primary)" }}>
                      ${listing.priceDollars.toFixed(2)}
                    </span>
                    {listing.shippingCents > 0 && (
                      <span className="text-xs" style={{ color: "var(--text-muted)" }}>
                        + ${(listing.shippingCents / 100).toFixed(2)} ship
                      </span>
                    )}
                    {listing.percentBelowReference != null && (
                      <span className="text-xs" style={{ color: "var(--text-muted)" }}>
                        {listing.percentBelowReference.toFixed(0)}% under avg sold
                      </span>
                    )}
                  </div>
                  {/* Every listing here already cleared MIN_WORTHWHILE_PROFIT_DOLLARS, so this is always a profit. */}
                  <div className="text-sm font-semibold mt-1" style={{ color: "var(--good)" }}>
                    Est. profit: ${listing.estimatedProfitDollars!.toFixed(2)} after eBay fees
                  </div>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
