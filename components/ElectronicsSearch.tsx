"use client";

import { useEffect, useRef, useState } from "react";
import type { ElectronicsResult } from "@/lib/electronicsSearch";

const SORT_OPTIONS = [
  { label: "Highest profit first", value: "profit" },
  { label: "Price: low to high", value: "price" },
] as const;

// Matches FETCH_LIMIT in lib/electronicsSearch.ts — same repeat-search-
// pages-forward mechanism as Auction Sniper/Player Search
// (components/AuctionSnipe.tsx, components/PlayerSearch.tsx); see those
// files' comments for the full reasoning, identical here.
const PAGE_SIZE = 50;
const MAX_OFFSET = PAGE_SIZE * 8;

export default function ElectronicsSearch() {
  const [query, setQuery] = useState("");
  const [minPrice, setMinPrice] = useState("");
  const [maxPrice, setMaxPrice] = useState("");
  const [sortBy, setSortBy] = useState<"profit" | "price">("profit");
  const [minProfit, setMinProfit] = useState("0");
  const [minProfitable, setMinProfitable] = useState("25");
  const [listings, setListings] = useState<ElectronicsResult[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [offset, setOffset] = useState(0);
  const [lastPagesSearched, setLastPagesSearched] = useState(1);
  const [reachedTarget, setReachedTarget] = useState(true);
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

  // Optimistic, with rollback on failure — same pattern as Player
  // Search/Auction Sniper's star buttons.
  async function toggleFavorite(listing: ElectronicsResult) {
    const isFavorited = favoritedIds.has(listing.itemId);
    setFavoritingIds((prev) => new Set(prev).add(listing.itemId));
    setFavoriteError(null);
    setFavoritedIds((prev) => {
      const next = new Set(prev);
      if (isFavorited) next.delete(listing.itemId);
      else next.add(listing.itemId);
      return next;
    });
    try {
      const res = isFavorited
        ? await fetch("/api/cards/favorites", {
            method: "DELETE",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ itemId: listing.itemId }),
          })
        : await fetch("/api/cards/favorites", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              itemId: listing.itemId,
              title: listing.title,
              priceDollars: listing.priceDollars,
              itemWebUrl: listing.itemWebUrl,
              imageUrl: listing.imageUrl,
              condition: listing.condition,
              searchedFor: query.trim(),
              source: "electronics",
              estimatedProfitDollars: listing.estimatedProfitDollars ?? undefined,
              peerAveragePriceDollars: listing.peerAveragePriceDollars ?? undefined,
              peerCount: listing.peerCount,
            }),
          });
      if (!res.ok) {
        const json = await res.json();
        throw new Error(json.error || `Request failed: ${res.status}`);
      }
    } catch (err) {
      setFavoritedIds((prev) => {
        const next = new Set(prev);
        if (isFavorited) next.add(listing.itemId);
        else next.delete(listing.itemId);
        return next;
      });
      setFavoriteError((err as Error).message);
    } finally {
      setFavoritingIds((prev) => {
        const next = new Set(prev);
        next.delete(listing.itemId);
        return next;
      });
    }
  }

  // Same "search again for new results" mechanism as Auction Sniper/
  // Player Search — pressing Search again with the exact same criteria
  // moves forward by however many pages the last search consumed;
  // changing any field resets to the start.
  async function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    if (!query.trim()) return;

    const searchKey = JSON.stringify({ q: query.trim(), minPrice, maxPrice, sortBy, minProfit, minProfitable });
    const nextOffset = lastSearchKeyRef.current === searchKey ? (offset + lastPagesSearched * PAGE_SIZE) % MAX_OFFSET : 0;
    lastSearchKeyRef.current = searchKey;
    setOffset(nextOffset);

    setLoading(true);
    setError(null);
    setListings(null);
    try {
      const params = new URLSearchParams({ q: query.trim(), sortBy });
      if (minPrice.trim()) params.set("min", minPrice.trim());
      if (maxPrice.trim()) params.set("max", maxPrice.trim());
      if (nextOffset > 0) params.set("offset", String(nextOffset));
      const minProfitNum = Number(minProfit);
      if (minProfit.trim() && Number.isFinite(minProfitNum) && minProfitNum >= 0) {
        params.set("minProfit", String(minProfitNum));
      }
      const minProfitableNum = Number(minProfitable);
      if (minProfitable.trim() && Number.isFinite(minProfitableNum) && minProfitableNum > 0) {
        params.set("minProfitable", String(Math.floor(minProfitableNum)));
      }
      const res = await fetch(`/api/electronics/search?${params}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `Request failed: ${res.status}`);
      setListings(json.listings ?? []);
      setLastPagesSearched(json.pagesSearched ?? 1);
      setReachedTarget(json.reachedTarget ?? true);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  // Requested directly: "locate iPhones, Apple Watches and any
  // electronics cheaper than their average value so I can resell for
  // profit" — only profitable listings are shown, same pattern as
  // manual card search/Player Search/Auction Sniper.
  const checked = listings?.filter((l) => l.wasChecked) ?? [];
  const profitable = listings?.filter((l) => l.isProfitable) ?? [];

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-lg font-semibold" style={{ color: "var(--text-primary)" }}>
          Electronics Search
        </h2>
        <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
          Search any electronics — iPhones, Apple Watches, laptops, whatever — and each listing gets
          checked against its own peer group: other currently-listed items matching that same title.
          There&apos;s no PriceCharting-style price guide for electronics, so this is an average asking
          price, not a confirmed sold price, same caveat Player Search&apos;s peer-check carries for
          cards. Only listings meeting &quot;Min profit&quot; are shown. Star (★) any listing to save it
          to Favorites below.
        </p>
      </div>

      <form onSubmit={handleSearch} className="flex flex-wrap gap-2 items-center">
        <div className="relative flex-1 min-w-[200px]">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="e.g. iPhone 14 Pro 128GB, Apple Watch Series 9"
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
        <span className="text-sm" style={{ color: "var(--text-muted)" }}>
          $
        </span>
        <input
          type="number"
          min="0"
          value={minPrice}
          onChange={(e) => setMinPrice(e.target.value)}
          placeholder="min"
          className="w-20 rounded-md px-2 py-2 text-sm"
          style={{ border: "1px solid var(--border-hairline)", background: "var(--surface-1)", color: "var(--text-primary)" }}
        />
        <span className="text-sm" style={{ color: "var(--text-muted)" }}>
          to $
        </span>
        <input
          type="number"
          min="0"
          value={maxPrice}
          onChange={(e) => setMaxPrice(e.target.value)}
          placeholder="max"
          className="w-20 rounded-md px-2 py-2 text-sm"
          style={{ border: "1px solid var(--border-hairline)", background: "var(--surface-1)", color: "var(--text-primary)" }}
        />
        <select
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value as "profit" | "price")}
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
        <div className="flex items-center gap-1">
          <span className="text-sm" style={{ color: "var(--text-muted)" }}>
            Show at least
          </span>
          <input
            type="number"
            min="0"
            step="1"
            value={minProfitable}
            onChange={(e) => setMinProfitable(e.target.value)}
            placeholder="1 page"
            className="w-16 rounded-md px-2 py-2 text-sm"
            style={{ border: "1px solid var(--border-hairline)", background: "var(--surface-1)", color: "var(--text-primary)" }}
          />
          <span className="text-sm" style={{ color: "var(--text-muted)" }}>
            profitable
          </span>
        </div>
        <button
          type="submit"
          disabled={loading}
          className="rounded-md px-4 py-2 text-sm font-medium text-white"
          style={{ background: "var(--series-1)" }}
        >
          {loading ? "Searching…" : "Search"}
        </button>
      </form>

      {loading && minProfitable.trim() && Number(minProfitable) > 0 && (
        <p className="text-xs" style={{ color: "var(--text-muted)" }}>
          Checking further pages of eBay&apos;s results to find {minProfitable} profitable listings — this
          can take longer than a single-page search.
        </p>
      )}

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

      {listings && (
        <div className="flex flex-col gap-2">
          {offset > 0 && (
            <p className="text-xs" style={{ color: "var(--text-muted)" }}>
              Showing a later batch of eBay&apos;s results (offset {offset}) — search again with the same
              criteria for another, or change your search to start over.
            </p>
          )}
          {listings.length > 0 && (
            <p className="text-xs" style={{ color: "var(--text-muted)" }}>
              {listings.length} listing{listings.length === 1 ? "" : "s"} found · {checked.length} checked
              against peer prices · {profitable.length} profitable
              {lastPagesSearched > 1 && ` (searched ${lastPagesSearched} pages of eBay's results)`}.
              {!reachedTarget && minProfitable.trim() && (
                <>
                  {" "}Fewer than the {minProfitable} you asked for — that may be all there are right now
                  for this search.
                </>
              )}
            </p>
          )}
          {listings.length === 0 && (
            <p className="text-sm py-8 text-center" style={{ color: "var(--text-muted)" }}>
              No listings found in that price range — search again with the same criteria to check a
              different batch of eBay&apos;s results.
            </p>
          )}
          {listings.length > 0 && profitable.length === 0 && (
            <p className="text-sm py-8 text-center" style={{ color: "var(--text-muted)" }}>
              No profitable listings found — {checked.length} checked across {lastPagesSearched} page
              {lastPagesSearched === 1 ? "" : "s"} of eBay&apos;s results, {listings.length - checked.length}{" "}
              not checked (past the per-page 25-listing cap). Search again with the same criteria to
              check further pages.
            </p>
          )}
          {profitable.map((listing) => (
            <div
              key={listing.itemId}
              className="rounded-lg p-3 flex flex-col gap-2"
              style={{ background: "var(--surface-1)", border: "1px solid var(--border-hairline)" }}
            >
              <div className="flex gap-3 items-center">
                <button
                  onClick={() => toggleFavorite(listing)}
                  disabled={favoritingIds.has(listing.itemId)}
                  aria-label={favoritedIds.has(listing.itemId) ? "Remove from favorites" : "Save to favorites"}
                  className="shrink-0 text-xl leading-none"
                  style={{ color: favoritedIds.has(listing.itemId) ? "var(--series-1)" : "var(--text-muted)" }}
                >
                  {favoritedIds.has(listing.itemId) ? "★" : "☆"}
                </button>
                {listing.imageUrl && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={listing.imageUrl}
                    alt=""
                    className="w-14 h-14 rounded-md object-contain shrink-0"
                    style={{ background: "#fff" }}
                  />
                )}
                <div className="flex-1 min-w-0">
                  <a
                    href={listing.itemWebUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm hover:underline"
                    style={{ color: "var(--text-primary)" }}
                  >
                    {listing.title}
                  </a>
                  {listing.condition && (
                    <div className="text-xs" style={{ color: "var(--text-muted)" }}>
                      {listing.condition}
                    </div>
                  )}
                  {listing.peerAveragePriceDollars != null && (
                    <div className="text-xs mt-0.5" style={{ color: "var(--series-1)" }}>
                      vs ${listing.peerAveragePriceDollars.toFixed(2)} average asking price ({listing.peerCount}{" "}
                      peers)
                    </div>
                  )}
                </div>
                <span className="font-semibold tabular-nums shrink-0" style={{ color: "var(--text-primary)" }}>
                  ${listing.priceDollars.toFixed(2)}
                </span>
              </div>

              {/* Every listing here already cleared the Min profit filter, so this is always a profit. */}
              {listing.estimatedProfitDollars != null && (
                <div className="text-sm font-semibold" style={{ color: "var(--good)" }}>
                  Est. profit: ${listing.estimatedProfitDollars.toFixed(2)} after eBay fees
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
