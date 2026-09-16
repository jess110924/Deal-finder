"use client";

import { useEffect, useState } from "react";
import type { FavoriteCard } from "@/lib/db";
import type { CardCategory } from "@/lib/cardComparison";

const CATEGORY_LABEL: Record<CardCategory, string> = { sports: "Sports", pokemon: "Pokémon" };
const SOURCE_LABEL: Record<NonNullable<FavoriteCard["source"]>, string> = {
  "player-search": "Player Search",
  auction: "Auction Sniper",
};

export default function CardFavorites() {
  const [favorites, setFavorites] = useState<FavoriteCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [removingIds, setRemovingIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    fetch("/api/cards/favorites")
      .then((res) => res.json())
      .then((json) => setFavorites(json.favorites ?? []))
      .catch((err) => setError((err as Error).message))
      .finally(() => setLoading(false));
  }, []);

  async function remove(itemId: string) {
    setRemovingIds((prev) => new Set(prev).add(itemId));
    try {
      const res = await fetch("/api/cards/favorites", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itemId }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `Request failed: ${res.status}`);
      setFavorites(json.favorites ?? []);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setRemovingIds((prev) => {
        const next = new Set(prev);
        next.delete(itemId);
        return next;
      });
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-lg font-semibold" style={{ color: "var(--text-primary)" }}>
          Favorites {favorites.length > 0 && `(${favorites.length})`}
        </h2>
        <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
          Listings you&apos;ve starred from Player Search or Auction Sniper, saved as a snapshot of when
          you starred them — the price, bid, or listing may have changed, ended, or sold since. Click
          through to eBay to check the current status.
        </p>
      </div>

      {error && (
        <div className="rounded-md px-3 py-2 text-sm" style={{ color: "var(--critical)" }}>
          {error}
        </div>
      )}

      {!loading && favorites.length === 0 && (
        <p className="text-sm" style={{ color: "var(--text-muted)" }}>
          Nothing starred yet — use the ☆ button on a listing in Player Search or an auction in Auction
          Sniper above.
        </p>
      )}

      <div className="flex flex-col gap-2">
        {favorites.map((fav) => (
          <div
            key={fav.itemId}
            className="rounded-lg overflow-hidden flex flex-col"
            style={{ background: "var(--surface-1)", border: "1px solid var(--border-hairline)" }}
          >
            <a href={fav.itemWebUrl} target="_blank" rel="noopener noreferrer" className="block">
              {fav.imageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={fav.imageUrl} alt="" className="w-full aspect-square object-contain" style={{ background: "#fff" }} />
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
                href={fav.itemWebUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-base hover:underline"
                style={{ color: "var(--text-primary)" }}
              >
                {fav.title}
              </a>
              <div className="text-xs mt-0.5" style={{ color: "var(--text-muted)" }}>
                {SOURCE_LABEL[fav.source ?? "player-search"]} · {CATEGORY_LABEL[fav.category]} · Searched:{" "}
                {fav.searchedFor || "—"}
                {fav.condition && ` · ${fav.condition}`}
              </div>
              {fav.reference && (
                <a
                  href={fav.reference.productUrl ?? fav.reference.itemWebUrl ?? fav.reference.ebaySearchUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm block mt-1"
                  style={{ color: "var(--series-1)", textDecoration: "underline" }}
                >
                  vs ${fav.reference.ungradedPriceDollars.toFixed(2)} for &quot;{fav.reference.productName}&quot;
                </a>
              )}
              <div className="flex items-center gap-3 mt-1.5 flex-wrap">
                <span className="font-semibold text-lg tabular-nums" style={{ color: "var(--text-primary)" }}>
                  ${fav.priceDollars.toFixed(2)}
                </span>
                {fav.source === "auction" && fav.bidCount != null && (
                  <span className="text-xs" style={{ color: "var(--text-muted)" }}>
                    {fav.bidCount} bid{fav.bidCount === 1 ? "" : "s"} when starred
                  </span>
                )}
                {fav.source === "auction" && fav.endsAt && new Date(fav.endsAt).getTime() < Date.now() && (
                  <span className="text-xs font-semibold" style={{ color: "var(--critical)" }}>
                    Likely ended
                  </span>
                )}
                <span className="text-xs" style={{ color: "var(--text-muted)" }}>
                  Starred {new Date(fav.favoritedAt).toLocaleDateString()}
                </span>
                <button
                  onClick={() => remove(fav.itemId)}
                  disabled={removingIds.has(fav.itemId)}
                  className="text-xs"
                  style={{ color: "var(--text-muted)" }}
                >
                  Remove
                </button>
              </div>
              {fav.estimatedProfitDollars != null && (
                <div className="text-sm font-semibold mt-1" style={{ color: "var(--good)" }}>
                  Est. profit when starred: ${fav.estimatedProfitDollars.toFixed(2)} after eBay fees
                  {fav.source === "auction" ? ", if won at that bid" : ""}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
