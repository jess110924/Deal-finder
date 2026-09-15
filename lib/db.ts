import { Redis } from "@upstash/redis";
import type { CardCategory } from "@/lib/sources/ebay";

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
const CONFIRMED_KEY = "card-confirmed";
const MISMATCH_KEY = "card-mismatches";
const FAVORITES_KEY = "card-favorites";

const MAX_FINDS = 200;
const MAX_DISMISSED = 1000;
const MAX_CONFIRMED = 500;
const MAX_MISMATCHES = 200;
const MAX_FAVORITES = 500;

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
  // What this specific listing charges for shipping — part of the real
  // cost to acquire it, needed to recompute `estimatedProfitDollars`
  // accurately on refresh. Absent on finds saved before this field
  // existed; treat missing as unknown/0, same default used elsewhere.
  shippingDollars?: number;
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
  // Estimated dollar profit after eBay's selling fee and this listing's
  // shipping cost — see lib/resaleProfit.ts. Absent on finds saved
  // before this field existed.
  estimatedProfitDollars?: number;
  // A handful of finds saved during this project's brief period of
  // comparing against real eBay sold prices instead of PriceCharting
  // carry a `soldComps` field too — not declared here since nothing
  // reads it anymore after reverting back to PriceCharting, but it's
  // harmless leftover data on those specific Redis records.
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

/**
 * Recomputes and overwrites just one find's stored `reference` (and the
 * `percentBelowReference`/`estimatedProfitDollars` derived from it) in
 * place. Requested directly: a saved find is a snapshot from whenever
 * it was found, so a later fix to the matching logic doesn't
 * retroactively apply to anything already sitting in the review queue —
 * a find saved with a since-fixed bug stays wrong until either dismissed
 * (losing it — not desirable for a real deal) or refreshed.
 */
export async function updateFindReference(
  itemId: string,
  reference: ReferenceInfo,
  percentBelowReference: number,
  estimatedProfitDollars?: number
): Promise<SavedFind | null> {
  const existing = await getFinds();
  const idx = existing.findIndex((f) => f.itemId === itemId);
  if (idx === -1) return null;
  const updated: SavedFind = { ...existing[idx], reference, percentBelowReference, estimatedProfitDollars };
  const next = [...existing];
  next[idx] = updated;
  await getRedis().set(FINDS_KEY, next);
  return updated;
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

export async function getConfirmedPicks(): Promise<SavedFind[]> {
  return (await getRedis().get<SavedFind[]>(CONFIRMED_KEY)) ?? [];
}

export async function getMismatches(): Promise<SavedFind[]> {
  return (await getRedis().get<SavedFind[]>(MISMATCH_KEY)) ?? [];
}

/**
 * Moves a find out of the review queue and into your confirmed picks —
 * for one you've personally checked and verified is an exact match and a
 * real deal. Also remembered as dismissed, same as dismissFind, so a
 * future scheduled check doesn't just re-add the same listing right back
 * into the review queue.
 */
export async function confirmFind(itemId: string): Promise<SavedFind | null> {
  const [existing, confirmed, dismissedIds] = await Promise.all([getFinds(), getConfirmedPicks(), getDismissedIds()]);
  const find = existing.find((f) => f.itemId === itemId);
  if (!find) return null;

  await Promise.all([
    getRedis().set(
      FINDS_KEY,
      existing.filter((f) => f.itemId !== itemId)
    ),
    getRedis().set(CONFIRMED_KEY, [find, ...confirmed].slice(0, MAX_CONFIRMED)),
    getRedis().set(DISMISSED_KEY, Array.from(dismissedIds).concat(itemId).slice(-MAX_DISMISSED)),
  ]);
  return find;
}

/**
 * Moves a find out of the review queue and into the mismatch list — for
 * one you've checked and found to be a wrong match — instead of just
 * losing it via a plain dismiss. Kept around specifically so real
 * mismatch examples can be reviewed later to actually fix the matching
 * logic, the same way every fix documented in this project so far
 * started from one concrete reported example. Also remembered as
 * dismissed, same reason as confirmFind.
 */
export async function flagMismatch(itemId: string): Promise<SavedFind | null> {
  const [existing, mismatches, dismissedIds] = await Promise.all([getFinds(), getMismatches(), getDismissedIds()]);
  const find = existing.find((f) => f.itemId === itemId);
  if (!find) return null;

  await Promise.all([
    getRedis().set(
      FINDS_KEY,
      existing.filter((f) => f.itemId !== itemId)
    ),
    getRedis().set(MISMATCH_KEY, [find, ...mismatches].slice(0, MAX_MISMATCHES)),
    getRedis().set(DISMISSED_KEY, Array.from(dismissedIds).concat(itemId).slice(-MAX_DISMISSED)),
  ]);
  return find;
}

/** Un-saves a confirmed pick. */
export async function removeConfirmed(itemId: string): Promise<void> {
  const confirmed = await getConfirmedPicks();
  await getRedis().set(
    CONFIRMED_KEY,
    confirmed.filter((f) => f.itemId !== itemId)
  );
}

/** Clears a mismatch entry once it's been reviewed/fixed. */
export async function removeMismatch(itemId: string): Promise<void> {
  const mismatches = await getMismatches();
  await getRedis().set(
    MISMATCH_KEY,
    mismatches.filter((f) => f.itemId !== itemId)
  );
}

// A starred listing from Player Search, kept to look at later — separate
// from the watchlist/finds flow above (that one's a name-driven,
// automatically-rechecked queue; this is "I saw this specific listing and
// want to remember it," no rechecking involved). Snapshotted at the time
// you star it, same reasoning as SavedFind: the price/listing shown later
// is whatever it was when you favorited it, not a live re-fetch.
export type FavoriteCard = {
  itemId: string;
  title: string;
  priceDollars: number;
  itemWebUrl: string;
  imageUrl: string | null;
  condition: string | null;
  category: CardCategory;
  // The player/search term this listing was found under — Player
  // Search's own query box, so a later look back at favorites still shows
  // what you were searching for when you starred it.
  searchedFor: string;
  favoritedAt: string;
};

export async function getFavorites(): Promise<FavoriteCard[]> {
  return (await getRedis().get<FavoriteCard[]>(FAVORITES_KEY)) ?? [];
}

/** Adds a favorite, most-recent first. No-op if this listing is already favorited. */
export async function addFavorite(card: Omit<FavoriteCard, "favoritedAt">): Promise<FavoriteCard[]> {
  const current = await getFavorites();
  if (current.some((f) => f.itemId === card.itemId)) return current;
  const next = [{ ...card, favoritedAt: new Date().toISOString() }, ...current].slice(0, MAX_FAVORITES);
  await getRedis().set(FAVORITES_KEY, next);
  return next;
}

export async function removeFavorite(itemId: string): Promise<FavoriteCard[]> {
  const current = await getFavorites();
  const next = current.filter((f) => f.itemId !== itemId);
  await getRedis().set(FAVORITES_KEY, next);
  return next;
}
