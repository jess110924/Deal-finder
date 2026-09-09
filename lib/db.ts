import { Redis } from "@upstash/redis";

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

export async function getWatchlist(): Promise<string[]> {
  return (await getRedis().get<string[]>(WATCHLIST_KEY)) ?? [];
}

export async function addToWatchlist(name: string): Promise<string[]> {
  const current = await getWatchlist();
  if (current.some((c) => c.toLowerCase() === name.toLowerCase())) return current;
  const next = [...current, name];
  await getRedis().set(WATCHLIST_KEY, next);
  return next;
}

export async function removeFromWatchlist(name: string): Promise<string[]> {
  const current = await getWatchlist();
  const next = current.filter((c) => c.toLowerCase() !== name.toLowerCase());
  await getRedis().set(WATCHLIST_KEY, next);
  return next;
}

export type SavedFind = {
  itemId: string;
  title: string;
  priceDollars: number;
  itemWebUrl: string;
  imageUrl: string | null;
  condition: string | null;
  percentBelowReference: number;
  searchedFor: string;
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
