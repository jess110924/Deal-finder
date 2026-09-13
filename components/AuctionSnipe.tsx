"use client";

import { useState } from "react";
import type { CardCategory } from "@/lib/cardComparison";
import type { AuctionSnipeResult } from "@/lib/auctionSnipe";

const HOURS_OPTIONS = [
  { label: "1 hour", value: "1" },
  { label: "6 hours", value: "6" },
  { label: "24 hours", value: "24" },
  { label: "3 days", value: "72" },
  { label: "Any time", value: "" },
];

function formatTimeRemaining(minutes: number): string {
  if (minutes < 0) return "Ended";
  if (minutes < 60) return `${minutes}m left`;
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  if (hours < 24) return `${hours}h ${mins}m left`;
  const days = Math.floor(hours / 24);
  const remHours = hours % 24;
  return `${days}d ${remHours}h left`;
}

export default function AuctionSnipe() {
  const [category, setCategory] = useState<CardCategory>("sports");
  const [query, setQuery] = useState("");
  const [maxHours, setMaxHours] = useState("24");
  const [auctions, setAuctions] = useState<AuctionSnipeResult[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    if (!query.trim()) return;

    setLoading(true);
    setError(null);
    setAuctions(null);
    try {
      const params = new URLSearchParams({ q: query.trim(), category });
      if (maxHours) params.set("maxHours", maxHours);
      const res = await fetch(`/api/cards/auctions?${params}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `Request failed: ${res.status}`);
      setAuctions(json.auctions ?? []);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-lg font-semibold" style={{ color: "var(--text-primary)" }}>
          Auction Sniper
        </h2>
        <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
          Live auctions for a card, soonest-ending first, compared against real recent sold prices.
          The current bid is <strong>not the final price</strong> — an auction with time left or
          existing bids can still climb well past it. This is most useful for auctions ending very
          soon with few or no bids yet, the ones nobody&apos;s found.
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

      <form onSubmit={handleSearch} className="flex flex-wrap gap-2">
        <div className="relative flex-1 min-w-[200px]">
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
        <select
          value={maxHours}
          onChange={(e) => setMaxHours(e.target.value)}
          className="rounded-md px-2 py-2 text-sm"
          style={{ border: "1px solid var(--border-hairline)", background: "var(--surface-1)", color: "var(--text-primary)" }}
        >
          {HOURS_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              Ending within {opt.label.toLowerCase()}
            </option>
          ))}
        </select>
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

      {auctions && (
        <div className="flex flex-col gap-2">
          {auctions.length === 0 && (
            <p className="text-sm py-8 text-center" style={{ color: "var(--text-muted)" }}>
              No live auctions found in that window.
            </p>
          )}
          {auctions.map((auction) => (
            <div
              key={auction.itemId}
              className="rounded-lg overflow-hidden flex flex-col"
              style={{ background: "var(--surface-1)", border: "1px solid var(--border-hairline)" }}
            >
              <a href={auction.itemWebUrl} target="_blank" rel="noopener noreferrer" className="block">
                {auction.imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={auction.imageUrl} alt="" className="w-full aspect-square object-contain" style={{ background: "#fff" }} />
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
                  href={auction.itemWebUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-base hover:underline"
                  style={{ color: "var(--text-primary)" }}
                >
                  {auction.title}
                </a>
                {auction.condition && (
                  <div className="text-xs mt-0.5" style={{ color: "var(--text-muted)" }}>{auction.condition}</div>
                )}
                {auction.soldComps && (
                  <a
                    href={auction.soldComps.soldSearchUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm block mt-1"
                    style={{ color: "var(--series-1)", textDecoration: "underline" }}
                  >
                    Sold comps: avg ${auction.soldComps.averageSoldPriceDollars.toFixed(2)} across{" "}
                    {auction.soldComps.compCount} sale{auction.soldComps.compCount === 1 ? "" : "s"}
                  </a>
                )}
                <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                  <span className="font-semibold text-lg tabular-nums" style={{ color: "var(--text-primary)" }}>
                    ${auction.currentBidDollars.toFixed(2)}
                  </span>
                  <span className="text-xs" style={{ color: "var(--text-muted)" }}>
                    {auction.bidCount} bid{auction.bidCount === 1 ? "" : "s"}
                  </span>
                  <span
                    className="text-xs font-semibold"
                    style={{ color: auction.minutesRemaining <= 60 ? "var(--critical)" : "var(--text-secondary)" }}
                  >
                    {formatTimeRemaining(auction.minutesRemaining)}
                  </span>
                </div>
                {auction.estimatedProfitDollars != null && (
                  <div
                    className="text-sm font-semibold mt-1"
                    style={{ color: auction.isProfitable ? "var(--good)" : "var(--critical)" }}
                  >
                    {auction.estimatedProfitDollars >= 0 ? "Est. profit" : "Est. loss"}: $
                    {Math.abs(auction.estimatedProfitDollars).toFixed(2)} after eBay fees, if won at this bid
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
