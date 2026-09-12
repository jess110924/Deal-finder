"use client";

import { useEffect, useState } from "react";
import type { SavedFind, WatchlistEntry } from "@/lib/db";
import type { CardCategory } from "@/lib/cardComparison";

const CATEGORY_LABEL: Record<CardCategory, string> = { sports: "Sports", pokemon: "Pokémon" };

// Shared by Saved finds / My Picks / Mismatches — a big edge-to-edge
// listing photo up top (like the manual search page), so the card reads
// like a photo post rather than a link with a thumbnail. Requested
// directly: bigger photos.
function FindHeroPhoto({ find }: { find: SavedFind }) {
  return (
    <a href={find.itemWebUrl} target="_blank" rel="noopener noreferrer" className="block">
      {find.imageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={find.imageUrl} alt="" className="w-full aspect-square object-contain" style={{ background: "#fff" }} />
      ) : (
        <div className="w-full aspect-square flex items-center justify-center text-sm" style={{ background: "#fff", color: "var(--text-muted)" }}>
          No photo
        </div>
      )}
    </a>
  );
}

export default function CardWatchlist() {
  const [watchlist, setWatchlist] = useState<WatchlistEntry[]>([]);
  const [finds, setFinds] = useState<SavedFind[]>([]);
  const [confirmed, setConfirmed] = useState<SavedFind[]>([]);
  const [mismatches, setMismatches] = useState<SavedFind[]>([]);
  const [category, setCategory] = useState<CardCategory>("sports");
  const [newCard, setNewCard] = useState("");
  const [loading, setLoading] = useState(true);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showBulkAdd, setShowBulkAdd] = useState(false);
  const [bulkText, setBulkText] = useState("");
  const [bulkAdding, setBulkAdding] = useState(false);
  const [bulkAddedCount, setBulkAddedCount] = useState<number | null>(null);
  const [refreshingIds, setRefreshingIds] = useState<Set<string>>(new Set());

  async function loadAll() {
    setLoading(true);
    setError(null);
    try {
      const [watchlistRes, findsRes, confirmedRes, mismatchesRes] = await Promise.all([
        fetch("/api/cards/watchlist"),
        fetch("/api/cards/finds"),
        fetch("/api/cards/confirmed"),
        fetch("/api/cards/mismatches"),
      ]);
      const watchlistJson = await watchlistRes.json();
      const findsJson = await findsRes.json();
      const confirmedJson = await confirmedRes.json();
      const mismatchesJson = await mismatchesRes.json();
      if (!watchlistRes.ok) throw new Error(watchlistJson.error || "Failed to load watchlist.");
      if (!findsRes.ok) throw new Error(findsJson.error || "Failed to load saved finds.");
      if (!confirmedRes.ok) throw new Error(confirmedJson.error || "Failed to load confirmed picks.");
      if (!mismatchesRes.ok) throw new Error(mismatchesJson.error || "Failed to load mismatches.");
      setWatchlist(watchlistJson.watchlist ?? []);
      setFinds(findsJson.finds ?? []);
      setConfirmed(confirmedJson.confirmed ?? []);
      setMismatches(mismatchesJson.mismatches ?? []);
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

  // Recomputes a find's stored reference (photo, price, verify link)
  // under the current matching logic. Needed because a saved find is a
  // snapshot from whenever it was found — a later fix to the matching or
  // photo logic doesn't retroactively apply to anything already sitting
  // in the review queue. Requested directly after a matching fix shipped
  // and an already-saved find kept showing the old, wrong reference photo.
  async function refreshFind(itemId: string) {
    setRefreshingIds((prev) => new Set(prev).add(itemId));
    setError(null);
    try {
      const res = await fetch("/api/cards/finds", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itemId, action: "refresh" }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `Request failed: ${res.status}`);
      setFinds((prev) => prev.map((f) => (f.itemId === itemId ? json.find : f)));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setRefreshingIds((prev) => {
        const next = new Set(prev);
        next.delete(itemId);
        return next;
      });
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

  // Moves a find from the review queue into either "My Picks" (verified
  // exact match + real deal) or "Mismatches" (verified wrong, kept for
  // debugging) instead of just dismissing it and losing it.
  async function triageFind(find: SavedFind, action: "confirm" | "flag") {
    const previousFinds = finds;
    const previousConfirmed = confirmed;
    const previousMismatches = mismatches;
    setFinds((prev) => prev.filter((f) => f.itemId !== find.itemId)); // optimistic
    if (action === "confirm") setConfirmed((prev) => [find, ...prev]);
    else setMismatches((prev) => [find, ...prev]);

    try {
      const res = await fetch("/api/cards/finds", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itemId: find.itemId, action }),
      });
      if (!res.ok) {
        const json = await res.json();
        throw new Error(json.error || `Request failed: ${res.status}`);
      }
    } catch (err) {
      setFinds(previousFinds); // roll back
      setConfirmed(previousConfirmed);
      setMismatches(previousMismatches);
      setError((err as Error).message);
    }
  }

  async function removeFromList(itemId: string, list: "confirmed" | "mismatches") {
    const isConfirmed = list === "confirmed";
    const previous = isConfirmed ? confirmed : mismatches;
    const setList = isConfirmed ? setConfirmed : setMismatches;
    setList((prev) => prev.filter((f) => f.itemId !== itemId)); // optimistic
    try {
      const res = await fetch(`/api/cards/${list}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itemId }),
      });
      if (!res.ok) {
        const json = await res.json();
        throw new Error(json.error || `Request failed: ${res.status}`);
      }
    } catch (err) {
      setList(previous); // roll back
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
        <p className="text-sm mb-3" style={{ color: "var(--text-secondary)" }}>
          Review each one: if you check it and it&apos;s a real, exact-match deal, save it to My Picks below.
          If the reference is actually the wrong card, flag it as a mismatch instead of just dismissing it —
          that list gets used to actually fix the matching logic.
        </p>
        {!loading && finds.length === 0 && (
          <p className="text-sm" style={{ color: "var(--text-muted)" }}>
            Nothing found yet — checks run automatically; results will appear here.
          </p>
        )}
        <div className="flex flex-col gap-2">
          {finds.map((find) => (
            <div
              key={find.itemId}
              className="rounded-lg overflow-hidden flex flex-col"
              style={{ background: "var(--surface-1)", border: "1px solid var(--border-hairline)" }}
            >
              <FindHeroPhoto find={find} />
              <div className="p-3">
                <div className="min-w-0">
                  <a
                    href={find.itemWebUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-base hover:underline"
                    style={{ color: "var(--text-primary)" }}
                  >
                    {find.title}
                  </a>
                  <div className="text-xs mt-0.5" style={{ color: "var(--text-muted)" }}>
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
                      className="text-sm block mt-1"
                      style={{ color: "var(--text-secondary)", textDecoration: "underline" }}
                    >
                      Verify: ${find.reference.ungradedPriceDollars.toFixed(2)} reference for &quot;{find.reference.productName}&quot;
                    </a>
                  )}
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1.5">
                    <span className="font-semibold text-lg tabular-nums" style={{ color: "var(--text-primary)" }}>
                      ${find.priceDollars.toFixed(2)}
                    </span>
                    <span className="text-xs font-semibold" style={{ color: "var(--good)" }}>
                      {find.percentBelowReference.toFixed(0)}% under reference
                    </span>
                    <button
                      onClick={() => triageFind(find, "confirm")}
                      className="text-xs font-medium"
                      style={{ color: "var(--good)" }}
                    >
                      ✓ Save as pick
                    </button>
                    <button
                      onClick={() => triageFind(find, "flag")}
                      className="text-xs font-medium"
                      style={{ color: "var(--critical)" }}
                    >
                      ⚠ Flag mismatch
                    </button>
                    <button onClick={() => dismissFind(find.itemId)} className="text-xs" style={{ color: "var(--text-muted)" }}>
                      Dismiss
                    </button>
                    <button
                      onClick={() => refreshFind(find.itemId)}
                      disabled={refreshingIds.has(find.itemId)}
                      className="text-xs"
                      style={{ color: "var(--text-muted)" }}
                      title="Looks wrong? Re-check this find's reference photo/price under the latest matching logic."
                    >
                      {refreshingIds.has(find.itemId) ? "Refreshing…" : "↻ Refresh reference"}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div>
        <h2 className="text-lg font-semibold mb-2" style={{ color: "var(--text-primary)" }}>
          My Picks {confirmed.length > 0 && `(${confirmed.length})`}
        </h2>
        <p className="text-sm mb-3" style={{ color: "var(--text-secondary)" }}>
          Finds you&apos;ve personally verified as an exact match and a real deal.
        </p>
        {!loading && confirmed.length === 0 && (
          <p className="text-sm" style={{ color: "var(--text-muted)" }}>
            Nothing saved yet — use &quot;Save as pick&quot; on a find above once you&apos;ve checked it.
          </p>
        )}
        <div className="flex flex-col gap-2">
          {confirmed.map((find) => (
            <div
              key={find.itemId}
              className="rounded-lg overflow-hidden flex flex-col"
              style={{ background: "var(--surface-1)", border: "1px solid var(--good)" }}
            >
              <FindHeroPhoto find={find} />
              <div className="p-3">
                <div className="min-w-0">
                  <a
                    href={find.itemWebUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-base hover:underline"
                    style={{ color: "var(--text-primary)" }}
                  >
                    {find.title}
                  </a>
                  <div className="text-xs mt-0.5" style={{ color: "var(--text-muted)" }}>
                    {find.category && `${CATEGORY_LABEL[find.category]} · `}
                    {find.source === "discovery" ? "Discovered" : "Watchlist"}: {find.searchedFor}
                  </div>
                  {find.reference && (
                    <a
                      href={find.reference.productUrl ?? find.reference.itemWebUrl ?? find.reference.ebaySearchUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sm block mt-1"
                      style={{ color: "var(--text-secondary)", textDecoration: "underline" }}
                    >
                      ${find.reference.ungradedPriceDollars.toFixed(2)} reference for &quot;{find.reference.productName}&quot;
                    </a>
                  )}
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1.5">
                    <span className="font-semibold text-lg tabular-nums" style={{ color: "var(--text-primary)" }}>
                      ${find.priceDollars.toFixed(2)}
                    </span>
                    <span className="text-xs font-semibold" style={{ color: "var(--good)" }}>
                      {find.percentBelowReference.toFixed(0)}% under reference
                    </span>
                    <button
                      onClick={() => removeFromList(find.itemId, "confirmed")}
                      className="text-xs"
                      style={{ color: "var(--text-muted)" }}
                    >
                      Remove
                    </button>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div>
        <h2 className="text-lg font-semibold mb-2" style={{ color: "var(--text-primary)" }}>
          Mismatches {mismatches.length > 0 && `(${mismatches.length})`}
        </h2>
        <p className="text-sm mb-3" style={{ color: "var(--text-secondary)" }}>
          Finds you&apos;ve checked and found to be comparing against the wrong card. Kept here (not just
          dismissed) so these can be reviewed to fix the matching logic — worth sharing the title and
          reference shown below when reporting one.
        </p>
        {!loading && mismatches.length === 0 && (
          <p className="text-sm" style={{ color: "var(--text-muted)" }}>
            None flagged — use &quot;Flag mismatch&quot; on a find above when the reference is wrong.
          </p>
        )}
        <div className="flex flex-col gap-2">
          {mismatches.map((find) => (
            <div
              key={find.itemId}
              className="rounded-lg overflow-hidden flex flex-col"
              style={{ background: "var(--surface-1)", border: "1px solid var(--critical)" }}
            >
              <FindHeroPhoto find={find} />
              <div className="p-3">
                <div className="min-w-0">
                  <a
                    href={find.itemWebUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-base hover:underline"
                    style={{ color: "var(--text-primary)" }}
                  >
                    {find.title}
                  </a>
                  <div className="text-xs mt-0.5" style={{ color: "var(--text-muted)" }}>
                    {find.category && `${CATEGORY_LABEL[find.category]} · `}
                    {find.source === "discovery" ? "Discovered" : "Watchlist"}: {find.searchedFor}
                  </div>
                  {find.reference && (
                    <a
                      href={find.reference.productUrl ?? find.reference.itemWebUrl ?? find.reference.ebaySearchUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sm block mt-1"
                      style={{ color: "var(--critical)", textDecoration: "underline" }}
                    >
                      Wrongly matched: ${find.reference.ungradedPriceDollars.toFixed(2)} for &quot;{find.reference.productName}&quot;
                    </a>
                  )}
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1.5">
                    <span className="font-semibold text-lg tabular-nums" style={{ color: "var(--text-primary)" }}>
                      ${find.priceDollars.toFixed(2)}
                    </span>
                    <button
                      onClick={() => removeFromList(find.itemId, "mismatches")}
                      className="text-xs"
                      style={{ color: "var(--text-muted)" }}
                    >
                      Clear
                    </button>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
