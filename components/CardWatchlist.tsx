"use client";

import { useEffect, useState } from "react";
import type { SavedFind, WatchlistEntry } from "@/lib/db";
import type { CardCategory } from "@/lib/cardComparison";

const CATEGORY_LABEL: Record<CardCategory, string> = { sports: "Sports", pokemon: "Pokémon" };

export default function CardWatchlist() {
  const [watchlist, setWatchlist] = useState<WatchlistEntry[]>([]);
  const [finds, setFinds] = useState<SavedFind[]>([]);
  const [category, setCategory] = useState<CardCategory>("sports");
  const [newCard, setNewCard] = useState("");
  const [loading, setLoading] = useState(true);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showBulkAdd, setShowBulkAdd] = useState(false);
  const [bulkText, setBulkText] = useState("");
  const [bulkAdding, setBulkAdding] = useState(false);
  const [bulkAddedCount, setBulkAddedCount] = useState<number | null>(null);

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
    setChecking(true);
    try {
      const res = await fetch("/api/cards/watchlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newCard.trim(), category }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `Request failed: ${res.status}`);
      setWatchlist(json.watchlist ?? []);
      setFinds(json.finds ?? []);
      setNewCard("");
      if (json.checkError) {
        // Card was added fine; only the immediate check had trouble. It'll
        // still get picked up by the next scheduled run, so this is a
        // heads-up, not a failure of the add itself.
        setError(`Added, but the immediate check failed: ${json.checkError}. It'll retry on the next scheduled run.`);
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setChecking(false);
    }
  }

  async function bulkAdd(e: React.FormEvent) {
    e.preventDefault();
    const names = Array.from(
      new Set(
        bulkText
          .split(/[\n,]/)
          .map((n) => n.trim())
          .filter(Boolean)
      )
    );
    if (names.length === 0) return;
    setError(null);
    setBulkAdding(true);
    setBulkAddedCount(null);
    try {
      const res = await fetch("/api/cards/watchlist/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ names, category }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `Request failed: ${res.status}`);
      setWatchlist(json.watchlist ?? []);
      setBulkText("");
      setBulkAddedCount(names.length);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBulkAdding(false);
    }
  }

  async function removeCard(name: string, cardCategory: CardCategory) {
    setError(null);
    try {
      const res = await fetch("/api/cards/watchlist", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, category: cardCategory }),
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
        <div className="flex gap-1 mb-3">
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
              {CATEGORY_LABEL[c]}
            </button>
          ))}
        </div>
        <form onSubmit={addCard} className="flex gap-2 mb-3">
          <div className="relative flex-1">
            <input
              type="text"
              value={newCard}
              onChange={(e) => setNewCard(e.target.value)}
              placeholder={category === "sports" ? "e.g. 2018 Panini Prizm Luka Doncic" : "e.g. 1999 Base Set Charizard"}
              className="w-full rounded-md pl-3 pr-8 py-2 text-sm"
              style={{ border: "1px solid var(--border-hairline)", background: "var(--surface-1)", color: "var(--text-primary)" }}
            />
            {newCard && (
              <button
                type="button"
                onClick={() => setNewCard("")}
                aria-label="Clear"
                className="absolute right-2 top-1/2 -translate-y-1/2 w-5 h-5 flex items-center justify-center text-sm rounded-full"
                style={{ color: "var(--text-muted)" }}
              >
                ×
              </button>
            )}
          </div>
          <button
            type="submit"
            disabled={checking}
            className="rounded-md px-4 py-2 text-sm font-medium text-white"
            style={{ background: "var(--series-1)" }}
          >
            {checking ? "Checking…" : "Add"}
          </button>
        </form>
        {checking && (
          <p className="text-xs mb-3" style={{ color: "var(--text-muted)" }}>
            Running an eBay + PriceCharting search now — this part takes a few seconds.
          </p>
        )}

        <button
          type="button"
          onClick={() => setShowBulkAdd((v) => !v)}
          className="text-xs mb-3"
          style={{ color: "var(--text-secondary)", textDecoration: "underline" }}
        >
          {showBulkAdd ? "Hide bulk add" : "Add multiple cards at once"}
        </button>

        {showBulkAdd && (
          <form onSubmit={bulkAdd} className="mb-4 flex flex-col gap-2">
            <div className="relative">
              <textarea
                value={bulkText}
                onChange={(e) => setBulkText(e.target.value)}
                placeholder={"One card per line (or comma-separated), e.g.\n2023 Panini Prizm Victor Wembanyama\n2018 Panini Prizm Luka Doncic\nPanini Prizm Nikola Jokic"}
                rows={5}
                className="w-full rounded-md pl-3 pr-8 py-2 text-sm"
                style={{ border: "1px solid var(--border-hairline)", background: "var(--surface-1)", color: "var(--text-primary)" }}
              />
              {bulkText && (
                <button
                  type="button"
                  onClick={() => setBulkText("")}
                  aria-label="Clear"
                  className="absolute right-2 top-2 w-5 h-5 flex items-center justify-center text-sm rounded-full"
                  style={{ color: "var(--text-muted)" }}
                >
                  ×
                </button>
              )}
            </div>
            <p className="text-xs" style={{ color: "var(--text-muted)" }}>
              Adds all as {CATEGORY_LABEL[category]}. These skip the instant check (too many to search all
              at once) and get picked up on the next scheduled run, within ~30 minutes.
            </p>
            <button
              type="submit"
              disabled={bulkAdding || !bulkText.trim()}
              className="self-start rounded-md px-4 py-2 text-sm font-medium text-white"
              style={{ background: "var(--series-1)" }}
            >
              {bulkAdding ? "Adding…" : "Add all"}
            </button>
            {bulkAddedCount !== null && (
              <p className="text-xs" style={{ color: "var(--good)" }}>
                Added {bulkAddedCount} card{bulkAddedCount === 1 ? "" : "s"} to the watchlist.
              </p>
            )}
          </form>
        )}

        {!loading && watchlist.length === 0 && (
          <p className="text-sm" style={{ color: "var(--text-muted)" }}>
            Nothing on the watchlist yet.
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          {watchlist.map((entry) => (
            <span
              key={`${entry.category}:${entry.name}`}
              className="rounded-full pl-3 pr-1.5 py-1 text-sm flex items-center gap-2"
              style={{ background: "var(--surface-1)", border: "1px solid var(--border-hairline)", color: "var(--text-primary)" }}
            >
              <span className="text-xs" style={{ color: "var(--text-muted)" }}>
                {CATEGORY_LABEL[entry.category]}
              </span>
              {entry.name}
              <button
                onClick={() => removeCard(entry.name, entry.category)}
                aria-label={`Remove ${entry.name}`}
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
                  {find.category && `${CATEGORY_LABEL[find.category]} · `}
                  {find.source === "discovery" ? "Discovered" : "Watchlist"}: {find.searchedFor}
                </div>
                {find.reference && (
                  <a
                    // productUrl (the reference's own PriceCharting/
                    // SportsCardsPro page) is the primary target — it's
                    // the actual source the reference price came from.
                    // Older saved finds predate this field, so fall back
                    // to the eBay-sourced links for those.
                    href={find.reference.productUrl ?? find.reference.itemWebUrl ?? find.reference.ebaySearchUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs flex items-center gap-1 mt-1"
                    style={{ color: "var(--text-secondary)", textDecoration: "underline" }}
                  >
                    {find.reference.imageUrl && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={find.reference.imageUrl} alt="" className="w-4 h-4 rounded object-contain" style={{ background: "#fff" }} />
                    )}
                    Verify: ${find.reference.ungradedPriceDollars.toFixed(2)} reference for &quot;{find.reference.productName}&quot;
                  </a>
                )}
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
