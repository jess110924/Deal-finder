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

  return (
    <div className="flex flex-col gap-6">
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
            {result.reference ? (
              <div className="flex gap-4 items-center">
                {result.reference.imageUrl && (
                  <a href={result.reference.itemWebUrl ?? result.reference.ebaySearchUrl} target="_blank" rel="noopener noreferrer" className="shrink-0">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={result.reference.imageUrl}
                      alt=""
                      className="w-28 h-28 rounded-lg object-contain"
                      style={{ background: "#fff", border: "1px solid var(--border-hairline)" }}
                    />
                  </a>
                )}
                <div className="flex-1 min-w-0">
                  <div className="text-sm" style={{ color: "var(--text-muted)" }}>
                    Closest PriceCharting match for this search (ungraded)
                  </div>
                  <div className="font-medium text-lg" style={{ color: "var(--text-primary)" }}>{result.reference.productName}</div>
                  <div className="text-2xl font-semibold tabular-nums" style={{ color: "var(--text-primary)" }}>
                    ${result.reference.ungradedPriceDollars.toFixed(2)}
                  </div>
                  <a
                    // The reference's own PriceCharting/SportsCardsPro
                    // page — the actual source the price above came
                    // from, so it's the most direct way to verify this
                    // is the right card. Falls back to the eBay-sourced
                    // links only if productUrl somehow isn't available.
                    href={result.reference.productUrl ?? result.reference.itemWebUrl ?? result.reference.ebaySearchUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs"
                    style={{ color: "var(--text-secondary)", textDecoration: "underline" }}
                  >
                    {result.reference.productUrl ? "View this card on PriceCharting" : "Search eBay to double-check this is the right card"}
                  </a>
                </div>
              </div>
            ) : (
              <p style={{ color: "var(--text-muted)" }}>No PriceCharting reference found for this search — showing eBay listings without a comparison.</p>
            )}
          </div>

          <p className="text-xs" style={{ color: "var(--text-muted)" }}>
            A broad search (just a player name, say) can return listings for many different cards, not
            copies of the one above — each listing below is checked against its own closest match, shown
            under it, not necessarily the one above.
          </p>

          <div className="flex flex-col gap-2">
            {result.listings.length === 0 && (
              <p className="text-sm py-8 text-center" style={{ color: "var(--text-muted)" }}>
                No ungraded Buy It Now listings found.
              </p>
            )}
            {result.listings.map((listing) => (
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
                <div className="p-3 flex gap-3">
                  <a
                    href={listing.reference?.productUrl ?? listing.reference?.itemWebUrl ?? listing.reference?.ebaySearchUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex flex-col items-center gap-1 shrink-0"
                    style={{ visibility: listing.reference ? "visible" : "hidden" }}
                  >
                    {listing.reference?.imageUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={listing.reference.imageUrl}
                        alt=""
                        className="w-20 h-20 rounded-md object-contain"
                        style={{ background: "#fff", border: "1px solid var(--series-1)" }}
                      />
                    ) : (
                      <div
                        className="w-20 h-20 rounded-md flex items-center justify-center text-[10px] text-center px-1"
                        style={{ background: "#fff", border: "1px solid var(--border-hairline)", color: "var(--text-muted)" }}
                      >
                        No photo
                      </div>
                    )}
                    <span className="text-[10px] leading-none" style={{ color: "var(--series-1)" }}>Verify</span>
                  </a>
                  <div className="flex-1 min-w-0">
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
                    {listing.reference && (
                      <a
                        href={listing.reference.productUrl ?? listing.reference.itemWebUrl ?? listing.reference.ebaySearchUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-sm block mt-1"
                        style={{ color: "var(--text-secondary)", textDecoration: "underline" }}
                      >
                        vs ${listing.reference.ungradedPriceDollars.toFixed(2)} for &quot;{listing.reference.productName}&quot;
                      </a>
                    )}
                    <div className="flex items-center gap-2 mt-1.5">
                      <span className="font-semibold text-lg tabular-nums" style={{ color: "var(--text-primary)" }}>
                        ${listing.priceDollars.toFixed(2)}
                      </span>
                      {listing.isUnderpriced && (
                        <span className="text-xs font-semibold" style={{ color: "var(--good)" }}>
                          {listing.percentBelowReference!.toFixed(0)}% under reference
                        </span>
                      )}
                    </div>
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
