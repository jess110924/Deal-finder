"use client";

import { useEffect, useRef, useState } from "react";
import type { ElectronicsAuctionResult } from "@/lib/electronicsAuctionSnipe";

const HOURS_OPTIONS = [
  { label: "15 minutes", value: "0.25" },
  { label: "30 minutes", value: "0.5" },
  { label: "1 hour", value: "1" },
  { label: "6 hours", value: "6" },
  { label: "24 hours", value: "24" },
  { label: "3 days", value: "72" },
  { label: "Any time", value: "" },
];

const SORT_OPTIONS = [
  { label: "Ending soonest", value: "time" },
  { label: "Price: low to high", value: "price" },
] as const;

// Matches AUCTION_FETCH_LIMIT in lib/electronicsAuctionSnipe.ts — same
// manual "search again for new results" mechanism as the trading-card
// Auction Sniper (components/AuctionSnipe.tsx), one page per click, no
// automatic multi-page search (see that lib file's cost-reasoning
// comment — SOLD_COMPS_API_KEY is paid, metered, unlike the free eBay
// Browse API the card version checks against).
const PAGE_SIZE = 50;
const MAX_OFFSET = PAGE_SIZE * 8;

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

export default function ElectronicsAuctionSnipe() {
  const [query, setQuery] = useState("");
  const [maxHours, setMaxHours] = useState("24");
  const [sortBy, setSortBy] = useState<"time" | "price">("time");
  const [minProfit, setMinProfit] = useState("0");
  const [auctions, setAuctions] = useState<ElectronicsAuctionResult[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [offset, setOffset] = useState(0);
  const lastSearchKeyRef = useRef<string | null>(null);
  const [favoritedIds, setFavoritedIds] = useState<Set<string>>(new Set());
  const [favoritingIds, setFavoritingIds] = useState<Set<string>>(new Set());
  const [favoriteError, setFavoriteError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/cards/favorites")
      .then((res) => res.json())
      .then((json) => setFavoritedIds(new Set((json.favorites ?? []).map((f: { itemId: string }) => f.itemId))))
      .catch(() => {});
  }, []);

  // Optimistic, with rollback on failure — same pattern as the
  // trading-card Auction Sniper's star button.
  async function toggleFavorite(auction: ElectronicsAuctionResult) {
    const isFavorited = favoritedIds.has(auction.itemId);
    setFavoritingIds((prev) => new Set(prev).add(auction.itemId));
    setFavoriteError(null);
    setFavoritedIds((prev) => {
      const next = new Set(prev);
      if (isFavorited) next.delete(auction.itemId);
      else next.add(auction.itemId);
      return next;
    });
    try {
      const res = isFavorited
        ? await fetch("/api/cards/favorites", {
            method: "DELETE",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ itemId: auction.itemId }),
          })
        : await fetch("/api/cards/favorites", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              itemId: auction.itemId,
              title: auction.title,
              priceDollars: auction.currentBidDollars,
              itemWebUrl: auction.itemWebUrl,
              imageUrl: auction.imageUrl,
              condition: auction.condition,
              searchedFor: query.trim(),
              source: "electronics-auction",
              bidCount: auction.bidCount,
              endsAt: auction.endsAt,
              estimatedProfitDollars: auction.estimatedProfitDollars ?? undefined,
              averageSoldPriceDollars: auction.averageSoldPriceDollars ?? undefined,
              compCount: auction.compCount,
              mostRecentSaleDate: auction.mostRecentSaleDate ?? undefined,
              soldSearchUrl: auction.soldSearchUrl,
            }),
          });
      if (!res.ok) {
        const json = await res.json();
        throw new Error(json.error || `Request failed: ${res.status}`);
      }
    } catch (err) {
      setFavoritedIds((prev) => {
        const next = new Set(prev);
        if (isFavorited) next.add(auction.itemId);
        else next.delete(auction.itemId);
        return next;
      });
      setFavoriteError((err as Error).message);
    } finally {
      setFavoritingIds((prev) => {
        const next = new Set(prev);
        next.delete(auction.itemId);
        return next;
      });
    }
  }

  // Same "search again for new results" mechanism as the trading-card
  // Auction Sniper — one page per click, changing any field resets to
  // the start.
  async function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    if (!query.trim()) return;

    const searchKey = JSON.stringify({ q: query.trim(), maxHours, sortBy, minProfit });
    const nextOffset = lastSearchKeyRef.current === searchKey ? (offset + PAGE_SIZE) % MAX_OFFSET : 0;
    lastSearchKeyRef.current = searchKey;
    setOffset(nextOffset);

    setLoading(true);
    setError(null);
    setAuctions(null);
    try {
      const params = new URLSearchParams({ q: query.trim(), sortBy });
      if (maxHours) params.set("maxHours", maxHours);
      if (nextOffset > 0) params.set("offset", String(nextOffset));
      const minProfitNum = Number(minProfit);
      if (minProfit.trim() && Number.isFinite(minProfitNum) && minProfitNum >= 0) {
        params.set("minProfit", String(minProfitNum));
      }
      const res = await fetch(`/api/electronics/auctions?${params}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `Request failed: ${res.status}`);
      setAuctions(json.auctions ?? []);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  // Requested directly: "catch ending auctions with potential profit" —
  // only profitable auctions are shown, same pattern as the rest of this
  // site.
  const checked = auctions?.filter((a) => a.wasChecked) ?? [];
  const profitable = auctions?.filter((a) => a.isProfitable) ?? [];

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-lg font-semibold" style={{ color: "var(--text-primary)" }}>
          Electronics Auction Sniper
        </h2>
        <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
          Live electronics auctions, checked against real recent sold prices for that same title —
          same sold-comps lookup Electronics Search above uses. Only auctions meeting &quot;Min
          profit&quot; are shown. The current bid is <strong>not the final price</strong> — an auction
          with time left or existing bids can still climb well past it. Checking against sold history
          uses a paid, metered API, so this is capped the same as Electronics Search — up to 12
          auctions checked per search, no automatic deeper search for a target profitable count. Star
          (★) one to save it to Favorites below.
        </p>
      </div>

      <form onSubmit={handleSearch} className="flex flex-wrap gap-2">
        <div className="relative flex-1 min-w-[200px]">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="e.g. iPhone 15 Pro Max 256GB Unlocked"
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
        <select
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value as "time" | "price")}
          className="rounded-md px-2 py-2 text-sm"
          style={{ border: "1px solid var(--border-hairline)", background: "var(--surface-1)", color: "var(--text-primary)" }}
        >
          {SORT_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              Sort: {opt.label}
            </option>
          ))}
        </select>
        <div className="flex items-center gap-1">
          <span className="text-sm" style={{ color: "var(--text-muted)" }}>
            Min profit $
          </span>
          <input
            type="number"
            min="0"
            step="0.01"
            value={minProfit}
            onChange={(e) => setMinProfit(e.target.value)}
            className="w-20 rounded-md px-2 py-2 text-sm"
            style={{ border: "1px solid var(--border-hairline)", background: "var(--surface-1)", color: "var(--text-primary)" }}
          />
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

      {favoriteError && (
        <div className="rounded-md px-3 py-2 text-sm" style={{ color: "var(--critical)" }}>
          Couldn&apos;t save favorite: {favoriteError}
        </div>
      )}

      {auctions && (
        <div className="flex flex-col gap-2">
          {offset > 0 && (
            <p className="text-xs" style={{ color: "var(--text-muted)" }}>
              Showing a later batch of eBay&apos;s results (offset {offset}) — search again with the same
              criteria for another, or change your search to start over.
            </p>
          )}
          {auctions.length > 0 && (
            <p className="text-xs" style={{ color: "var(--text-muted)" }}>
              {auctions.length} auction{auctions.length === 1 ? "" : "s"} found · {checked.length} checked
              against sold comps · {profitable.length} profitable.
            </p>
          )}
          {auctions.length === 0 && (
            <p className="text-sm py-8 text-center" style={{ color: "var(--text-muted)" }}>
              No live auctions found in that window — search again with the same criteria to check a
              different batch of eBay&apos;s results.
            </p>
          )}
          {auctions.length > 0 && profitable.length === 0 && (
            <p className="text-sm py-8 text-center" style={{ color: "var(--text-muted)" }}>
              No profitable auctions found — {checked.length} checked, {auctions.length - checked.length} not
              checked (past the 12-auction cap). Search again with the same criteria to check a different
              batch.
            </p>
          )}
          {profitable.map((auction) => (
            <div
              key={auction.itemId}
              className="rounded-lg overflow-hidden flex flex-col"
              style={{ background: "var(--surface-1)", border: "1px solid var(--border-hairline)" }}
            >
              <div className="relative">
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
                <button
                  onClick={() => toggleFavorite(auction)}
                  disabled={favoritingIds.has(auction.itemId)}
                  aria-label={favoritedIds.has(auction.itemId) ? "Remove from favorites" : "Save to favorites"}
                  className="absolute top-2 left-2 w-7 h-7 flex items-center justify-center text-lg leading-none rounded-full"
                  style={{
                    background: "rgba(0,0,0,0.55)",
                    color: favoritedIds.has(auction.itemId) ? "var(--series-1)" : "#fff",
                  }}
                >
                  {favoritedIds.has(auction.itemId) ? "★" : "☆"}
                </button>
              </div>
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
                {auction.averageSoldPriceDollars != null && (
                  <a
                    href={auction.soldSearchUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm block mt-1"
                    style={{ color: "var(--series-1)", textDecoration: "underline" }}
                  >
                    vs ${auction.averageSoldPriceDollars.toFixed(2)} average sold price ({auction.compCount} sales
                    {auction.mostRecentSaleDate && `, most recent ${auction.mostRecentSaleDate}`})
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
                {/* Every auction here already cleared Min profit, so this is always a profit. */}
                {auction.estimatedProfitDollars != null && (
                  <div className="text-sm font-semibold mt-1" style={{ color: "var(--good)" }}>
                    Est. profit: ${auction.estimatedProfitDollars.toFixed(2)} after eBay fees, if won at this bid
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
