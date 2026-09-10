import { Redis } from "@upstash/redis";
import type { CardCategory } from "@/lib/sources/pricecharting";

// Lazily constructed (not at module scope) so importing this file doesn't
// eagerly instantiate a client — Redis.fromEnv() logs noisy warnings (and
// would otherwise do so during every build/dev-server start, and for any
// route that merely imports this file) when KV_REST_API_URL/TOKEN aren't
// set, which is expected for local dev before the Upstash integration is
// connected. Same lazy/clear-error pattern as every other optional
// integration in this project (Keepa, eBay, etc.) — fails when actually
// called, not when imported.
let _redis: Redis | null = null;

function getRedis(): Redis {
  if (_redis) return _redis;
  if (!process.env.KV_REST_API_URL || !process.env.KV_REST_API_TOKEN) {
    throw new Error(
      "KV_REST_API_URL / KV_REST_API_TOKEN are not set — connect the Upstash Redis integration in Vercel's Storage tab."
    );
  }
  _redis = Redis.fromEnv();
  return _redis;
}

const WATCHLIST_KEY = "card-watchlist";
const FINDS_KEY = "card-finds";
const DISMISSED_KEY = "card-dismissed-ids";

const MAX_FINDS = 200;
const MAX_DISMISSED = 1000;

export type WatchlistEntry = { name: string; category: CardCategory };

// Raw stored value may still be string[] from before category support was
// added — treated as "sports" (the only category that existed then) so
// existing watchlists don't need a migration step.
function normalizeEntry(raw: string | WatchlistEntry): WatchlistEntry {
  return typeof raw === "string" ? { name: raw, category: "sports" } : raw;
}

export async function getWatchlist(): Promise<WatchlistEntry[]> {
  const raw = (await getRedis().get<(string | WatchlistEntry)[]>(WATCHLIST_KEY)) ?? [];
  return raw.map(normalizeEntry);
}

export async function addToWatchlist(name: string, category: CardCategory): Promise<WatchlistEntry[]> {
  const current = await getWatchlist();
  if (current.some((c) => c.category === category && c.name.toLowerCase() === name.toLowerCase())) return current;
  const next = [...current, { name, category }];
  await getRedis().set(WATCHLIST_KEY, next);
  return next;
}

export async function removeFromWatchlist(name: string, category: CardCategory): Promise<WatchlistEntry[]> {
  const current = await getWatchlist();
  const next = current.filter((c) => !(c.category === category && c.name.toLowerCase() === name.toLowerCase()));
  await getRedis().set(WATCHLIST_KEY, next);
  return next;
}

export type ReferenceInfo = {
  productName: string;
  ungradedPriceDollars: number;
  imageUrl: string | null;
  itemWebUrl: string | null;
  ebaySearchUrl: string;
  // The reference product's own page on PriceCharting/SportsCardsPro —
  // the primary "verify this is the right card" link, since it's the
  // actual source the reference price came from. Optional/absent on
  // finds saved before this field existed.
  productUrl?: string;
};

export type SavedFind = {
  itemId: string;
  title: string;
  priceDollars: number;
  itemWebUrl: string;
  imageUrl: string | null;
  condition: string | null;
  percentBelowReference: number;
  searchedFor: string;
  category: CardCategory;
  // "watchlist" = a card you explicitly added; "discovery" = surfaced
  // automatically by browsing eBay's live listings and checking each one
  // against PriceCharting, with no name given by you first. Discovery
  // matches are inherently noisier (a real search query vs. a freeform
  // eBay title), so double-check `reference` before trusting one.
  // Optional/absent on finds saved before this field existed — treat
  // missing as "watchlist" (the only source that existed then).
  source?: "watchlist" | "discovery";
  // What this find's price was actually compared against. Optional for
  // the same backward-compatibility reason as `source`.
  reference?: ReferenceInfo;
  foundAt: string;
};

export async function getFinds(): Promise<SavedFind[]> {
  return (await getRedis().get<SavedFind[]>(FINDS_KEY)) ?? [];
}

async function getDismissedIds(): Promise<Set<string>> {
  const ids = (await getRedis().get<string[]>(DISMISSED_KEY)) ?? [];
  return new Set(ids);
}

/** Merges newly-found underpriced listings into the saved list, skipping
 * anything already saved or already dismissed. Returns how many were
 * actually new (for the check endpoint's response/logging). */
export async function saveNewFinds(candidates: SavedFind[]): Promise<number> {
  const [existing, dismissed] = await Promise.all([getFinds(), getDismissedIds()]);
  const existingIds = new Set(existing.map((f) => f.itemId));

  const trulyNew = candidates.filter((c) => !existingIds.has(c.itemId) && !dismissed.has(c.itemId));
  if (trulyNew.length === 0) return 0;

  const merged = [...trulyNew, ...existing].slice(0, MAX_FINDS);
  await getRedis().set(FINDS_KEY, merged);
  return trulyNew.length;
}

/** Removes a find from the saved list AND remembers it as dismissed, so a
 * future check doesn't just re-add the same listing right back. */
export async function dismissFind(itemId: string): Promise<void> {
  const [existing, dismissedIds] = await Promise.all([getFinds(), getDismissedIds()]);
  await Promise.all([
    getRedis().set(
      FINDS_KEY,
      existing.filter((f) => f.itemId !== itemId)
    ),
    getRedis().set(DISMISSED_KEY, Array.from(dismissedIds).concat(itemId).slice(-MAX_DISMISSED)),
  ]);
}
