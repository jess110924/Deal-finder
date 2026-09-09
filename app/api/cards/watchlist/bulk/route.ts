import { NextRequest, NextResponse } from "next/server";
import { addToWatchlist } from "@/lib/db";

/**
 * Adds many cards at once. Deliberately skips the immediate per-card check
 * that the single-add route (POST /api/cards/watchlist) does — running
 * that eBay + PriceCharting search for 15-20 cards sequentially would risk
 * a serverless function timeout. These just get picked up by the next
 * scheduled run instead (see check-watchlist route + the GitHub Action).
 */
export async function POST(request: NextRequest) {
  try {
    const { names } = await request.json();
    if (!Array.isArray(names) || names.length === 0) {
      return NextResponse.json({ error: "Missing 'names' (non-empty array)." }, { status: 400 });
    }

    let watchlist: string[] = [];
    for (const name of names) {
      if (typeof name === "string" && name.trim()) {
        watchlist = await addToWatchlist(name.trim());
      }
    }

    return NextResponse.json({ watchlist });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
