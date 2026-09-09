"use client";

import { useState } from "react";
import type { CardSearchResult } from "@/lib/cardComparison";

export default function CardSearch() {
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
      const res = await fetch(`/api/cards/search?q=${encodeURIComponent(query.trim())}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `Request failed: ${res.status}`);
      setResult(json);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col gap-6 w-full max-w-3xl mx-auto px-6 py-8">
      <div>
        <h1 className="text-2xl font-semibold" style={{ color: "var(--text-primary)" }}>
          Trading Cards
        </h1>
        <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
          Search a card. Reference price comes from PriceCharting; listings come from eBay&apos;s active
          Buy It Now inventory. Graded slabs (PSA/BGS/SGC) are excluded from the comparison — their
          prices aren&apos;t comparable to an ungraded reference.
        </p>
      </div>

      <form onSubmit={handleSearch} className="flex gap-2">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="e.g. 2018 Panini Prizm Luka Doncic"
          className="flex-1 rounded-md px-3 py-2 text-sm"
          style={{ border: "1px solid var(--border-hairline)", background: "var(--surface-1)", color: "var(--text-primary)" }}
        />
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
            {result.reference ? (
              <>
                <div className="text-sm" style={{ color: "var(--text-muted)" }}>
                  PriceCharting reference (ungraded)
                </div>
                <div className="font-medium" style={{ color: "var(--text-primary)" }}>{result.reference.productName}</div>
                <div className="text-xl font-semibold tabular-nums" style={{ color: "var(--text-primary)" }}>
                  ${result.reference.ungradedPriceDollars.toFixed(2)}
                </div>
              </>
            ) : (
              <p style={{ color: "var(--text-muted)" }}>No PriceCharting reference found for this search — showing eBay listings without a comparison.</p>
            )}
          </div>

          <div className="flex flex-col gap-2">
            {result.listings.length === 0 && (
              <p className="text-sm py-8 text-center" style={{ color: "var(--text-muted)" }}>
                No ungraded Buy It Now listings found.
              </p>
            )}
            {result.listings.map((listing) => (
              <a
                key={listing.itemId}
                href={listing.itemWebUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="rounded-lg p-3 flex gap-3 items-center"
                style={{ background: "var(--surface-1)", border: "1px solid var(--border-hairline)" }}
              >
                {listing.imageUrl && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={listing.imageUrl} alt="" className="w-14 h-14 rounded-md object-contain shrink-0" style={{ background: "#fff" }} />
                )}
                <div className="flex-1 min-w-0">
                  <div className="text-sm" style={{ color: "var(--text-primary)" }}>{listing.title}</div>
                  {listing.condition && (
                    <div className="text-xs" style={{ color: "var(--text-muted)" }}>{listing.condition}</div>
                  )}
                </div>
                <div className="flex flex-col items-end gap-1 shrink-0">
                  <span className="font-semibold tabular-nums" style={{ color: "var(--text-primary)" }}>
                    ${listing.priceDollars.toFixed(2)}
                  </span>
                  {listing.isUnderpriced && (
                    <span className="text-xs font-semibold" style={{ color: "var(--good)" }}>
                      {listing.percentBelowReference!.toFixed(0)}% under reference
                    </span>
                  )}
                </div>
              </a>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
