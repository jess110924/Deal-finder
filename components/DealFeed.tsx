"use client";

import { useEffect, useState } from "react";
import type { Deal } from "@/lib/types";
import { SOURCES } from "@/lib/config";

type SourceResult = { name: string; label: string; ok: boolean; error?: string; count: number };
type ApiResponse = { deals: Deal[]; results: SourceResult[]; fetchedAt: string };

const DISMISSED_KEY = "deal-finder:dismissed";
const MAX_DISMISSED = 2000;

function loadDismissed(): Set<string> {
  try {
    const raw = localStorage.getItem(DISMISSED_KEY);
    return new Set(raw ? JSON.parse(raw) : []);
  } catch {
    return new Set();
  }
}

function saveDismissed(ids: Set<string>) {
  try {
    localStorage.setItem(DISMISSED_KEY, JSON.stringify(Array.from(ids).slice(-MAX_DISMISSED)));
  } catch {
    // localStorage unavailable (private browsing, etc.) — dismissal just won't persist
  }
}

function relativeTime(iso: string | null): string {
  if (!iso) return "";
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.round(diffMs / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

type SortMode = "newest" | "discount";

export default function DealFeed() {
  const [data, setData] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [activeSources, setActiveSources] = useState<Set<string>>(new Set(SOURCES.map((s) => s.name)));
  const [sortMode, setSortMode] = useState<SortMode>("newest");
  const [stackableOnly, setStackableOnly] = useState(false);
  const [maxPrice, setMaxPrice] = useState("");

  useEffect(() => {
    // Reading localStorage must happen client-side only — a lazy useState
    // initializer would run during server rendering too (where localStorage
    // doesn't exist) and cause a hydration mismatch, so an effect is the
    // correct tool here despite the lint rule's general "avoid setState in
    // effects" guidance.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDismissed(loadDismissed());
  }, []);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/deals", { cache: "no-store" });
      if (!res.ok) throw new Error(`Request failed: ${res.status}`);
      const json: ApiResponse = await res.json();
      setData(json);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    // Standard fetch-on-mount: `load` does hit setState synchronously before
    // its first `await`, which is what this lint rule flags, but there's no
    // cascading-render issue here — it's a single initial fetch, not a loop.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, []);

  function dismiss(id: string) {
    setDismissed((prev) => {
      const next = new Set(prev);
      next.add(id);
      saveDismissed(next);
      return next;
    });
  }

  function dismissAllVisible() {
    if (!data) return;
    setDismissed((prev) => {
      const next = new Set(prev);
      for (const d of visibleDeals) next.add(d.id);
      saveDismissed(next);
      return next;
    });
  }

  function toggleSource(name: string) {
    setActiveSources((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }

  // Most sources don't carry structured price data — lib/sources/rss.ts
  // extracts it from the title text where possible, but not every title
  // has one (a link-only post, say). When a price ceiling is set, a deal
  // with no known price is excluded rather than shown anyway — showing
  // "under $5" and then including unknowns would undermine the filter,
  // since there'd be no way to tell whether an unknown actually qualifies.
  const maxPriceValue = maxPrice.trim() === "" ? null : Number(maxPrice);
  const priceFilterActive = maxPriceValue != null && Number.isFinite(maxPriceValue);

  // No manual useMemo here — the React Compiler (enabled in this Next.js
  // version) handles memoizing derived values like this automatically.
  const filteredDeals = data
    ? data.deals.filter(
        (d) =>
          !dismissed.has(d.id) &&
          activeSources.has(d.source) &&
          (!stackableOnly || d.isStackable) &&
          (!priceFilterActive || (d.price != null && d.price <= maxPriceValue))
      )
    : [];
  const visibleDeals =
    sortMode === "discount"
      ? [...filteredDeals].sort((a, b) => (b.discountPercent ?? -1) - (a.discountPercent ?? -1))
      : filteredDeals;

  const failedSources = data?.results.filter((r) => !r.ok) ?? [];

  return (
    <div className="flex flex-col gap-4 w-full max-w-3xl mx-auto px-6 py-8">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-semibold" style={{ color: "var(--text-primary)" }}>
            Deal Finder
          </h1>
          {data && (
            <p className="text-sm" style={{ color: "var(--text-muted)" }}>
              {visibleDeals.length} shown · updated {relativeTime(data.fetchedAt)}
            </p>
          )}
        </div>
        <div className="flex gap-2">
          <button
            onClick={dismissAllVisible}
            className="rounded-md px-3 py-1.5 text-sm"
            style={{ border: "1px solid var(--border-hairline)", color: "var(--text-secondary)" }}
          >
            Mark all read
          </button>
          <button
            onClick={load}
            disabled={loading}
            className="rounded-md px-3 py-1.5 text-sm font-medium text-white"
            style={{ background: "var(--series-1)" }}
          >
            {loading ? "Refreshing…" : "Refresh"}
          </button>
        </div>
      </div>

      <div className="flex gap-2 flex-wrap">
        {SOURCES.map((s) => {
          const active = activeSources.has(s.name);
          return (
            <button
              key={s.name}
              onClick={() => toggleSource(s.name)}
              className="rounded-full px-3 py-1 text-xs"
              style={{
                background: active ? "var(--series-1)" : "var(--surface-1)",
                color: active ? "#fff" : "var(--text-secondary)",
                border: "1px solid var(--border-hairline)",
              }}
            >
              {s.label}
            </button>
          );
        })}
      </div>

      <div className="flex gap-2 flex-wrap items-center">
        <button
          onClick={() => setStackableOnly((v) => !v)}
          className="rounded-full px-3 py-1 text-xs font-medium"
          style={{
            background: stackableOnly ? "var(--stack)" : "var(--surface-1)",
            color: stackableOnly ? "#fff" : "var(--stack)",
            border: "1px solid var(--stack)",
          }}
        >
          ⭐ Stackable only
        </button>
        <span className="text-xs" style={{ color: "var(--text-muted)" }}>
          Subscribe & Save + coupon-stacking style deals
        </span>
        <span className="text-xs" style={{ color: "var(--text-muted)" }}>
          ·
        </span>
        <label className="flex items-center gap-1 text-xs" style={{ color: "var(--text-secondary)" }}>
          $ and under:
          <input
            type="number"
            min="0"
            step="1"
            value={maxPrice}
            onChange={(e) => setMaxPrice(e.target.value)}
            placeholder="e.g. 5"
            className="w-16 rounded-md px-2 py-1 text-xs"
            style={{ border: "1px solid var(--border-hairline)", background: "var(--surface-1)", color: "var(--text-primary)" }}
          />
        </label>
        {priceFilterActive && (
          <span className="text-xs" style={{ color: "var(--text-muted)" }}>
            (deals with no listed price are hidden while this is set)
          </span>
        )}
      </div>

      <div className="flex gap-2 text-sm">
        <span style={{ color: "var(--text-muted)" }}>Sort:</span>
        <button
          onClick={() => setSortMode("newest")}
          style={{ color: sortMode === "newest" ? "var(--series-1)" : "var(--text-secondary)", fontWeight: sortMode === "newest" ? 600 : 400 }}
        >
          Newest
        </button>
        <span style={{ color: "var(--text-muted)" }}>·</span>
        <button
          onClick={() => setSortMode("discount")}
          style={{ color: sortMode === "discount" ? "var(--series-1)" : "var(--text-secondary)", fontWeight: sortMode === "discount" ? 600 : 400 }}
        >
          Biggest discount
        </button>
      </div>

      {failedSources.length > 0 && (
        <div
          className="rounded-md px-3 py-2 text-xs"
          style={{ background: "var(--surface-1)", border: "1px solid var(--border-hairline)", color: "var(--text-muted)" }}
        >
          Not showing results from: {failedSources.map((s) => `${s.label} (${s.error})`).join(" · ")}
        </div>
      )}

      {error && (
        <div className="rounded-md px-3 py-2 text-sm" style={{ color: "var(--critical)" }}>
          {error}
        </div>
      )}

      <div className="flex flex-col gap-2">
        {!loading && visibleDeals.length === 0 && (
          <p className="text-sm py-8 text-center" style={{ color: "var(--text-muted)" }}>
            Nothing here — either everything&apos;s dismissed or no sources matched your filters.
          </p>
        )}
        {visibleDeals.map((deal) => (
          <DealRow key={deal.id} deal={deal} onDismiss={() => dismiss(deal.id)} />
        ))}
      </div>
    </div>
  );
}

function DealRow({ deal, onDismiss }: { deal: Deal; onDismiss: () => void }) {
  const sourceLabel = SOURCES.find((s) => s.name === deal.source)?.label ?? deal.source;

  return (
    <div
      className="rounded-lg p-3 flex gap-3 items-start"
      style={{ background: "var(--surface-1)", border: "1px solid var(--border-hairline)" }}
    >
      {deal.imageUrl && (
        // eslint-disable-next-line @next/next/no-img-element -- external, unpredictable source; next/image's domain allowlist isn't worth it for one field
        <img
          src={deal.imageUrl}
          alt=""
          className="w-12 h-12 rounded-md object-contain shrink-0"
          style={{ background: "#fff" }}
          loading="lazy"
          onError={(e) => {
            e.currentTarget.style.display = "none";
          }}
        />
      )}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 text-xs mb-1" style={{ color: "var(--text-muted)" }}>
          <span>{sourceLabel}</span>
          {deal.isStackable && (
            <span className="font-semibold" style={{ color: "var(--stack)" }}>
              ⭐ Stackable
            </span>
          )}
          {deal.pubDate && (
            <>
              <span>·</span>
              <span>{relativeTime(deal.pubDate)}</span>
            </>
          )}
          {deal.creator && (
            <>
              <span>·</span>
              <span>{deal.creator}</span>
            </>
          )}
        </div>
        <a
          href={deal.link}
          target="_blank"
          rel="noopener noreferrer"
          className="font-medium hover:underline"
          style={{ color: "var(--text-primary)" }}
        >
          {deal.title}
        </a>
        {deal.description && (
          <p className="text-sm mt-1 line-clamp-2" style={{ color: "var(--text-secondary)" }}>
            {deal.description}
          </p>
        )}
      </div>

      <div className="flex flex-col items-end gap-2 shrink-0">
        {deal.discountPercent != null && (
          <span className="text-sm font-semibold tabular-nums" style={{ color: "var(--good)" }}>
            {deal.discountPercent}% off
          </span>
        )}
        {deal.price != null && (
          <span className="text-sm tabular-nums" style={{ color: "var(--text-secondary)" }}>
            ${deal.price.toFixed(2)}
            {deal.originalPrice != null && (
              <span style={{ color: "var(--text-muted)", textDecoration: "line-through", marginLeft: 4 }}>
                ${deal.originalPrice.toFixed(2)}
              </span>
            )}
          </span>
        )}
        <button onClick={onDismiss} className="text-xs" style={{ color: "var(--text-muted)" }} aria-label="Dismiss">
          Dismiss
        </button>
      </div>
    </div>
  );
}
