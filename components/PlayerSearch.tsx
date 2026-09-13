"use client";

import { useState } from "react";
import type { CardCategory } from "@/lib/cardComparison";
import type { EbayListing } from "@/lib/sources/ebay";
import type { PeerComparison } from "@/lib/playerSearch";

type PeerState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "done"; comparison: PeerComparison | null };

export default function PlayerSearch() {
  const [category, setCategory] = useState<CardCategory>("sports");
  const [query, setQuery] = useState("");
  const [minPrice, setMinPrice] = useState("30");
  const [maxPrice, setMaxPrice] = useState("100");
  const [listings, setListings] = useState<EbayListing[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [peerChecks, setPeerChecks] = useState<Record<string, PeerState>>({});
  const [expandedPeerList, setExpandedPeerList] = useState<Record<string, boolean>>({});

  async function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    if (!query.trim()) return;

    setLoading(true);
    setError(null);
    setListings(null);
    setPeerChecks({});
    try {
      const params = new URLSearchParams({ q: query.trim(), category });
      if (minPrice.trim()) params.set("min", minPrice.trim());
      if (maxPrice.trim()) params.set("max", maxPrice.trim());
      const res = await fetch(`/api/cards/player-search?${params}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `Request failed: ${res.status}`);
      setListings(json.listings ?? []);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function checkPeers(listing: EbayListing) {
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

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-lg font-semibold" style={{ color: "var(--text-primary)" }}>
          Player Search
        </h2>
        <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
          Search a player, filtered to a price band, instead of one exact card. Pick a listing that looks
          interesting, then check what other currently-listed copies of that exact card are asking — no eBay API
          gives access to actual sold prices, so this compares against other active asking prices, not sales
          history. If a card is priced well below what everyone else is asking for the same one, that's the
          signal to look closer.
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
        <button
          type="submit"
          disabled={loading}
          className="rounded-md px-4 py-2 text-sm font-medium text-white"
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

      {listings && listings.length === 0 && (
        <p className="text-sm py-8 text-center" style={{ color: "var(--text-muted)" }}>
          No ungraded Buy It Now listings found in that price range.
        </p>
      )}

      {listings && listings.length > 0 && (
        <div className="flex flex-col gap-2">
          {listings.map((listing) => {
            const peer = peerChecks[listing.itemId];
            return (
              <div
                key={listing.itemId}
                className="rounded-lg p-3 flex flex-col gap-2"
                style={{ background: "var(--surface-1)", border: "1px solid var(--border-hairline)" }}
              >
                <div className="flex gap-3 items-center">
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
                  </div>
                  <div className="flex flex-col items-end gap-1 shrink-0">
                    <span className="font-semibold tabular-nums" style={{ color: "var(--text-primary)" }}>
                      ${(listing.priceCents / 100).toFixed(2)}
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
