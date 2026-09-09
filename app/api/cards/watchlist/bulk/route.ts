import { NextRequest, NextResponse } from "next/server";
import { addToWatchlist, type WatchlistEntry } from "@/lib/db";
import type { CardCategory } from "@/lib/cardComparison";

/**
 * Adds many cards at once, all under the same category. Deliberately skips
 * the immediate per-card check that the single-add route (POST
 * /api/cards/watchlist) does — running that eBay + PriceCharting search
 * for 15-20 cards sequentially would risk a serverless function timeout.
 * These just get picked up by the next scheduled run instead (see
 * check-watchlist route + the GitHub Action).
 */
export async function POST(request: NextRequest) {
  try {
    const { names, category } = await request.json();
    if (!Array.isArray(names) || names.length === 0) {
      return NextResponse.json({ error: "Missing 'names' (non-empty array)." }, { status: 400 });
    }
    const cat: CardCategory = category === "pokemon" ? "pokemon" : "sports";

    let watchlist: WatchlistEntry[] = [];
    for (const name of names) {
      if (typeof name === "string" && name.trim()) {
        watchlist = await addToWatchlist(name.trim(), cat);
      }
    }

    return NextResponse.json({ watchlist });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
