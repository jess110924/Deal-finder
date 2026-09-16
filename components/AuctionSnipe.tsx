"use client";

import { useEffect, useRef, useState } from "react";
import type { CardCategory } from "@/lib/cardComparison";
import type { AuctionSnipeResult } from "@/lib/auctionSnipe";

const HOURS_OPTIONS = [
  { label: "15 minutes", value: "0.25" },
  { label: "30 minutes", value: "0.5" },
  { label: "1 hour", value: "1" },
  { label: "6 hours", value: "6" },
  { label: "24 hours", value: "24" },
  { label: "3 days", value: "72" },
  { label: "Any time", value: "" },
];

// Matches AUCTION_FETCH_LIMIT in lib/auctionSnipe.ts — each repeat search
// of the exact same query/filters shifts the eBay fetch forward by one
// page instead of re-fetching the identical soonest-ending batch. Wraps
// back to the start after 4 pages rather than growing forever — past
// that, deeper pages are increasingly likely to just be empty or past
// what's actually worth sniping.
const AUCTION_PAGE_SIZE = 50;
const MAX_OFFSET = AUCTION_PAGE_SIZE * 4;

const SORT_OPTIONS = [
  { label: "Ending soonest", value: "time" },
  { label: "Price: low to high", value: "price" },
] as const;

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
  const [sortBy, setSortBy] = useState<"time" | "price">("time");
  const [auctions, setAuctions] = useState<AuctionSnipeResult[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [offset, setOffset] = useState(0);
  // Not state — changing it shouldn't itself trigger a render, only the
  // next handleSearch call needs to read it.
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

  // Requested directly ("add stars to the auctions I find so I can add
  // to my save list") — same star/favorite mechanism as Player Search
  // (components/PlayerSearch.tsx), just with an auction's own snapshot
  // fields (bid count, end time, profit estimate, reference) instead of
  // a plain listing's. Optimistic with rollback on failure, same reason
  // as Player Search's version: a failed save (e.g. Redis not
  // configured) shouldn't leave the star showing saved when it isn't.
  async function toggleFavorite(auction: AuctionSnipeResult) {
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
              category,
              searchedFor: query.trim(),
              source: "auction",
              bidCount: auction.bidCount,
              endsAt: auction.endsAt,
              estimatedProfitDollars: auction.estimatedProfitDollars ?? undefined,
              reference: auction.reference ?? undefined,
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

  // Requested directly: "if I search and don't see anything, I can
  // search again and get new results." Without this, an unchanged query
  // always re-fetches the exact same soonest-ending batch from eBay, so
  // "0 profitable" on a repeat click could never change on its own.
  // Pressing Search again with the *same* query/category/window/sort
  // moves to the next batch instead (wrapping back to the start after
  // MAX_OFFSET); changing any of those counts as a new search and resets
  // to the beginning, since paging forward on genuinely different
  // criteria wouldn't make sense.
  async function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    if (!query.trim()) return;

    const searchKey = JSON.stringify({ q: query.trim(), category, maxHours, sortBy });
    const nextOffset =
      lastSearchKeyRef.current === searchKey ? (offset + AUCTION_PAGE_SIZE) % MAX_OFFSET : 0;
    lastSearchKeyRef.current = searchKey;
    setOffset(nextOffset);

    setLoading(true);
    setError(null);
    setAuctions(null);
    try {
      const params = new URLSearchParams({ q: query.trim(), category, sortBy });
      if (maxHours) params.set("maxHours", maxHours);
      if (nextOffset > 0) params.set("offset", String(nextOffset));
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

  // Requested directly: "loss listings are of no use to me, I only want
  // to see auctions with a profit" — same reasoning and pattern as
  // CardSearch's profitable-only filter. `checked` vs `profitable` (not
  // just auctions.length vs profitable.length) is what makes "0 shown"
  // legible: it's the difference between "checked 12, none profitable"
  // and "found 40, only checked 12."
  const checked = auctions?.filter((a) => a.wasChecked) ?? [];
  const profitable = auctions?.filter((a) => a.isProfitable) ?? [];

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-lg font-semibold" style={{ color: "var(--text-primary)" }}>
          Auction Sniper
        </h2>
        <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
          Live auctions for a card, compared against PriceCharting&apos;s reference price. Only
          auctions with any estimated profit if won at the current bid are shown — even a few cents,
          a lower bar than manual search&apos;s $5 minimum, since sniping is about scanning everything
          worth a second look, not just what clears a real flip&apos;s effort. The current bid is{" "}
          <strong>not the final price</strong> — an auction with time left or existing bids can still
          climb well past it. This is most useful for auctions ending very soon with few or no bids
          yet, the ones nobody&apos;s found. Star (★) one to save it to Favorites, further down the
          page.
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
              {auctions.length} auction{auctions.length === 1 ? "" : "s"} found · {checked.length} checked against
              PriceCharting · {profitable.length} profitable.
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
              No profitable auctions in this batch — {checked.length} checked,{" "}
              {auctions.length - checked.length} not checked (past the 25-auction cap). Search again with
              the same criteria to check a different batch.
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
                {auction.reference && (
                  <a
                    href={auction.reference.productUrl ?? auction.reference.itemWebUrl ?? auction.reference.ebaySearchUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm block mt-1"
                    style={{ color: "var(--series-1)", textDecoration: "underline" }}
                  >
                    vs ${auction.reference.ungradedPriceDollars.toFixed(2)} for &quot;{auction.reference.productName}&quot;
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
                {/* Every auction here already cleared MIN_WORTHWHILE_PROFIT_DOLLARS, so this is always a profit. */}
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
