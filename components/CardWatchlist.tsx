"use client";

import { useEffect, useState } from "react";
import type { SavedFind } from "@/lib/db";

export default function CardWatchlist() {
  const [watchlist, setWatchlist] = useState<string[]>([]);
  const [finds, setFinds] = useState<SavedFind[]>([]);
  const [newCard, setNewCard] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function loadAll() {
    setLoading(true);
    setError(null);
    try {
      const [watchlistRes, findsRes] = await Promise.all([fetch("/api/cards/watchlist"), fetch("/api/cards/finds")]);
      const watchlistJson = await watchlistRes.json();
      const findsJson = await findsRes.json();
      if (!watchlistRes.ok) throw new Error(watchlistJson.error || "Failed to load watchlist.");
      if (!findsRes.ok) throw new Error(findsJson.error || "Failed to load saved finds.");
      setWatchlist(watchlistJson.watchlist ?? []);
      setFinds(findsJson.finds ?? []);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- standard fetch-on-mount, see DealFeed.tsx for the same pattern
    loadAll();
  }, []);

  async function addCard(e: React.FormEvent) {
    e.preventDefault();
    if (!newCard.trim()) return;
    setError(null);
    try {
      const res = await fetch("/api/cards/watchlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newCard.trim() }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `Request failed: ${res.status}`);
      setWatchlist(json.watchlist ?? []);
      setNewCard("");
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function removeCard(name: string) {
    setError(null);
    try {
      const res = await fetch("/api/cards/watchlist", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `Request failed: ${res.status}`);
      setWatchlist(json.watchlist ?? []);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function dismissFind(itemId: string) {
    const previous = finds;
    setFinds((prev) => prev.filter((f) => f.itemId !== itemId)); // optimistic
    try {
      const res = await fetch("/api/cards/finds", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itemId }),
      });
      if (!res.ok) {
        const json = await res.json();
        throw new Error(json.error || `Request failed: ${res.status}`);
      }
    } catch (err) {
      setFinds(previous); // roll back the optimistic removal
      setError((err as Error).message);
    }
  }

  return (
    <div className="flex flex-col gap-8">
      {error && (
        <div
          className="rounded-md px-3 py-2 text-sm"
          style={{ background: "var(--surface-1)", border: "1px solid var(--critical)", color: "var(--critical)" }}
        >
          {error}
        </div>
      )}

      <div>
        <h2 className="text-lg font-semibold mb-2" style={{ color: "var(--text-primary)" }}>
          Watchlist
        </h2>
        <p className="text-sm mb-3" style={{ color: "var(--text-secondary)" }}>
          Cards here get checked automatically every ~30 minutes. Underpriced listings found show up below,
          and stay there until you dismiss them.
        </p>
        <form onSubmit={addCard} className="flex gap-2 mb-3">
          <input
            type="text"
            value={newCard}
            onChange={(e) => setNewCard(e.target.value)}
            placeholder="e.g. 2018 Panini Prizm Luka Doncic"
            className="flex-1 rounded-md px-3 py-2 text-sm"
            style={{ border: "1px solid var(--border-hairline)", background: "var(--surface-1)", color: "var(--text-primary)" }}
          />
          <button
            type="submit"
            className="rounded-md px-4 py-2 text-sm font-medium text-white"
            style={{ background: "var(--series-1)" }}
          >
            Add
          </button>
        </form>
        {!loading && watchlist.length === 0 && (
          <p className="text-sm" style={{ color: "var(--text-muted)" }}>
            Nothing on the watchlist yet.
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          {watchlist.map((name) => (
            <span
              key={name}
              className="rounded-full pl-3 pr-1.5 py-1 text-sm flex items-center gap-2"
              style={{ background: "var(--surface-1)", border: "1px solid var(--border-hairline)", color: "var(--text-primary)" }}
            >
              {name}
              <button
                onClick={() => removeCard(name)}
                aria-label={`Remove ${name}`}
                className="rounded-full w-5 h-5 flex items-center justify-center text-xs"
                style={{ color: "var(--text-muted)" }}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      </div>

      <div>
        <h2 className="text-lg font-semibold mb-2" style={{ color: "var(--text-primary)" }}>
          Saved finds {finds.length > 0 && `(${finds.length})`}
        </h2>
        {!loading && finds.length === 0 && (
          <p className="text-sm" style={{ color: "var(--text-muted)" }}>
            Nothing found yet — checks run automatically; results will appear here.
          </p>
        )}
        <div className="flex flex-col gap-2">
          {finds.map((find) => (
            <div
              key={find.itemId}
              className="rounded-lg p-3 flex gap-3 items-center"
              style={{ background: "var(--surface-1)", border: "1px solid var(--border-hairline)" }}
            >
              {find.imageUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={find.imageUrl} alt="" className="w-14 h-14 rounded-md object-contain shrink-0" style={{ background: "#fff" }} />
              )}
              <div className="flex-1 min-w-0">
                <a
                  href={find.itemWebUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm hover:underline"
                  style={{ color: "var(--text-primary)" }}
                >
                  {find.title}
                </a>
                <div className="text-xs" style={{ color: "var(--text-muted)" }}>
                  Watchlist: {find.searchedFor}
                </div>
              </div>
              <div className="flex flex-col items-end gap-1 shrink-0">
                <span className="font-semibold tabular-nums" style={{ color: "var(--text-primary)" }}>
                  ${find.priceDollars.toFixed(2)}
                </span>
                <span className="text-xs font-semibold" style={{ color: "var(--good)" }}>
                  {find.percentBelowReference.toFixed(0)}% under reference
                </span>
                <button onClick={() => dismissFind(find.itemId)} className="text-xs" style={{ color: "var(--text-muted)" }}>
                  Dismiss
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
