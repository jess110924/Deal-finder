"use client";

import { useEffect, useRef, useState } from "react";
import type { CardCategory } from "@/lib/cardComparison";
import type { PlayerCardResult, PeerComparison } from "@/lib/playerSearch";

type PeerState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "done"; comparison: PeerComparison | null };

const SORT_OPTIONS = [
  { label: "Highest profit first", value: "profit" },
  { label: "Price: low to high", value: "price" },
] as const;

// Matches PLAYER_SEARCH_FETCH_LIMIT in lib/playerSearch.ts — same
// repeat-search-pages-forward mechanism as Auction Sniper
// (components/AuctionSnipe.tsx); see that file's comments for the full
// reasoning, identical here.
const PLAYER_PAGE_SIZE = 50;
const MAX_OFFSET = PLAYER_PAGE_SIZE * 8;

export default function PlayerSearch() {
  const [category, setCategory] = useState<CardCategory>("sports");
  const [query, setQuery] = useState("");
  const [minPrice, setMinPrice] = useState("30");
  const [maxPrice, setMaxPrice] = useState("100");
  const [sortBy, setSortBy] = useState<"profit" | "price">("profit");
  // Requested directly ("adjust the profit dollar amount", "show at
  // least 25 profitable listings"), same filters and defaults as Auction
  // Sniper.
  const [minProfit, setMinProfit] = useState("0");
  const [minProfitable, setMinProfitable] = useState("25");
  const [listings, setListings] = useState<PlayerCardResult[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [offset, setOffset] = useState(0);
  const [lastPagesSearched, setLastPagesSearched] = useState(1);
  const [reachedTarget, setReachedTarget] = useState(true);
  const lastSearchKeyRef = useRef<string | null>(null);
  const [peerChecks, setPeerChecks] = useState<Record<string, PeerState>>({});
  const [expandedPeerList, setExpandedPeerList] = useState<Record<string, boolean>>({});
  const [favoritedIds, setFavoritedIds] = useState<Set<string>>(new Set());
  const [favoritingIds, setFavoritingIds] = useState<Set<string>>(new Set());
  const [favoriteError, setFavoriteError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/cards/favorites")
      .then((res) => res.json())
      .then((json) => setFavoritedIds(new Set((json.favorites ?? []).map((f: { itemId: string }) => f.itemId))))
      .catch(() => {});
  }, []);

  // Optimistic, with rollback on failure — same pattern as the watchlist/
  // finds actions in CardWatchlist.tsx, so a failed toggle (e.g. Redis not
  // configured locally) doesn't leave the star showing a state that was
  // never actually saved.
  async function toggleFavorite(listing: PlayerCardResult) {
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
              category,
              searchedFor: query.trim(),
              source: "player-search",
              estimatedProfitDollars: listing.estimatedProfitDollars ?? undefined,
              reference: listing.reference ?? undefined,
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

  // Requested directly: "if I search and don't see anything, I can
  // search again and get new results" — same mechanism as Auction
  // Sniper. Pressing Search again with the *exact same* query/price
  // band/sort/filters moves forward by however many pages the last
  // search actually consumed; changing any field counts as a new search
  // and resets to the start.
  async function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    if (!query.trim()) return;

    const searchKey = JSON.stringify({
      q: query.trim(),
      category,
      minPrice,
      maxPrice,
      sortBy,
      minProfit,
      minProfitable,
    });
    const nextOffset =
      lastSearchKeyRef.current === searchKey ? (offset + lastPagesSearched * PLAYER_PAGE_SIZE) % MAX_OFFSET : 0;
    lastSearchKeyRef.current = searchKey;
    setOffset(nextOffset);

    setLoading(true);
    setError(null);
    setListings(null);
    setPeerChecks({});
    try {
      const params = new URLSearchParams({ q: query.trim(), category, sortBy });
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
      const res = await fetch(`/api/cards/player-search?${params}`);
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

  async function checkPeers(listing: PlayerCardResult) {
    setPeerChecks((prev) => ({ ...prev, [listing.itemId]: { status: "loading" } }));
    try {
      const params = new URLSearchParams({ title: listing.title, category, subject: query.trim() });
      const res = await fetch(`/api/cards/peer-check?${params}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `Request failed: ${res.status}`);
      setPeerChecks((prev) => ({ ...prev, [listing.itemId]: { status: "done", comparison: json.comparison } }));
    } catch (err) {
      setPeerChecks((prev) => ({ ...prev, [listing.itemId]: { status: "error", message: (err as Error).message } }));
    }
  }

  // Requested directly: "loss listings are of no use to me, I only want
  // to see auctions with a profit" originally landed on Auction Sniper —
  // same reasoning and pattern applied here now that each listing has
  // its own PriceCharting check.
  const checked = listings?.filter((l) => l.wasChecked) ?? [];
  const profitable = listings?.filter((l) => l.isProfitable) ?? [];

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-lg font-semibold" style={{ color: "var(--text-primary)" }}>
          Player Search
        </h2>
        <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
          Search a player, filtered to a price band, instead of one exact card. Each listing is checked
          against its own best-matching PriceCharting product — a player name spans many different
          cards, so no single reference applies to all of them — and only listings meeting &quot;Min
          profit&quot; are shown. Pick one and use &quot;Check similar listings&quot; for a second opinion:
          what other currently-listed copies of that exact card are asking (asking prices, not sold
          history — no eBay API here gets access to that). Star (★) any listing to save it to Favorites
          below.
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

      <form onSubmit={handleSearch} className="flex flex-wrap gap-2 items-center">
        <div className="relative flex-1 min-w-[200px]">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Player name, e.g. Jalen Johnson"
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
          value={minPrice}
          onChange={(e) => setMinPrice(e.target.value)}
          className="w-20 rounded-md px-2 py-2 text-sm"
          style={{ border: "1px solid var(--border-hairline)", background: "var(--surface-1)", color: "var(--text-primary)" }}
        />
        <span className="text-sm" style={{ color: "var(--text-muted)" }}>
          to $
        </span>
        <input
          type="number"
          value={maxPrice}
          onChange={(e) => setMaxPrice(e.target.value)}
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
          Checking further pages of eBay&apos;s results to find {minProfitable} profitable listings —
          this can take longer than a single-page search.
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
              against PriceCharting · {profitable.length} profitable
              {lastPagesSearched > 1 && ` (searched ${lastPagesSearched} pages of eBay's results)`}.
              {!reachedTarget && minProfitable.trim() && (
                <>
                  {" "}Fewer than the {minProfitable} you asked for — that may be all there are right
                  now for this search.
                </>
              )}
            </p>
          )}
          {listings.length === 0 && (
            <p className="text-sm py-8 text-center" style={{ color: "var(--text-muted)" }}>
              No ungraded Buy It Now listings found in that price range — search again with the same
              criteria to check a different batch of eBay&apos;s results.
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
          {profitable.map((listing) => {
            const peer = peerChecks[listing.itemId];
            return (
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
                    {listing.reference && (
                      <a
                        href={listing.reference.productUrl ?? listing.reference.itemWebUrl ?? listing.reference.ebaySearchUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs block mt-0.5"
                        style={{ color: "var(--series-1)", textDecoration: "underline" }}
                      >
                        vs ${listing.reference.ungradedPriceDollars.toFixed(2)} for &quot;{listing.reference.productName}&quot;
                      </a>
                    )}
                  </div>
                  <div className="flex flex-col items-end gap-1 shrink-0">
                    <span className="font-semibold tabular-nums" style={{ color: "var(--text-primary)" }}>
                      ${listing.priceDollars.toFixed(2)}
                    </span>
                    <button
                      onClick={() => checkPeers(listing)}
                      disabled={peer?.status === "loading"}
                      className="text-xs"
                      style={{ color: "var(--text-secondary)", textDecoration: "underline" }}
                    >
                      {peer?.status === "loading" ? "Checking…" : "Check similar listings"}
                    </button>
                  </div>
                </div>

                {/* Every listing here already cleared the Min profit filter, so this is always a profit. */}
                {listing.estimatedProfitDollars != null && (
                  <div className="text-sm font-semibold" style={{ color: "var(--good)" }}>
                    Est. profit: ${listing.estimatedProfitDollars.toFixed(2)} after eBay fees
                  </div>
                )}

                {peer?.status === "error" && (
                  <div className="text-xs" style={{ color: "var(--critical)" }}>
                    {peer.message}
                  </div>
                )}

                {peer?.status === "done" && !peer.comparison && (
                  <div className="text-xs" style={{ color: "var(--text-muted)" }}>
                    No other ungraded Buy It Now listings found for this exact title.
                  </div>
                )}

                {peer?.status === "done" && peer.comparison && (
                  <div
                    className="text-xs rounded-md p-2 flex flex-col gap-1"
                    style={{ background: "var(--surface-2, transparent)", border: "1px solid var(--border-hairline)" }}
                  >
                    <div style={{ color: "var(--text-secondary)" }}>
                      {peer.comparison.peerCount} matching listing{peer.comparison.peerCount === 1 ? "" : "s"} for
                      this exact title · average asking ${peer.comparison.averagePriceDollars.toFixed(2)} · lowest $
                      {peer.comparison.lowestPriceDollars.toFixed(2)}
                    </div>
                    {peer.comparison.percentLowestBelowAverage > 0 && (
                      <div className="font-semibold" style={{ color: "var(--good)" }}>
                        Lowest is {peer.comparison.percentLowestBelowAverage.toFixed(0)}% below the average asking
                        price
                      </div>
                    )}
                    <div className="flex gap-3">
                      <a
                        href={peer.comparison.lowestListing.itemWebUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{ color: "var(--text-secondary)", textDecoration: "underline" }}
                      >
                        View the lowest-priced listing
                      </a>
                      <button
                        onClick={() => setExpandedPeerList((prev) => ({ ...prev, [listing.itemId]: !prev[listing.itemId] }))}
                        style={{ color: "var(--text-secondary)", textDecoration: "underline" }}
                      >
                        {expandedPeerList[listing.itemId] ? "Hide" : "Show"} all {peer.comparison.peerCount} — check
                        these are actually the same parallel
                      </button>
                    </div>
                    {expandedPeerList[listing.itemId] && (
                      <div className="flex flex-col gap-1 mt-1">
                        {peer.comparison.listings.map((peerListing) => (
                          <a
                            key={peerListing.itemId}
                            href={peerListing.itemWebUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex justify-between gap-2"
                            style={{ color: "var(--text-muted)" }}
                          >
                            <span className="truncate">{peerListing.title}</span>
                            <span className="shrink-0 tabular-nums">${(peerListing.priceCents / 100).toFixed(2)}</span>
                          </a>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
