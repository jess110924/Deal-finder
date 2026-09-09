import { NextRequest, NextResponse } from "next/server";
import { getWatchlist, saveNewFinds, type SavedFind } from "@/lib/db";
import { searchUnderpricedCards } from "@/lib/cardComparison";

/**
 * Triggered by a scheduled GitHub Actions workflow (see
 * .github/workflows/check-watchlist.yml), not a browser — protected by its
 * own secret rather than the site's cookie-based login (excluded from that
 * in proxy.ts), since a script has no session to present.
 */
export async function POST(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "CRON_SECRET is not set." }, { status: 500 });
  }
  if (request.headers.get("x-cron-secret") !== secret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const watchlist = await getWatchlist();
  const results: { card: string; ok: boolean; newFinds?: number; error?: string }[] = [];

  for (const card of watchlist) {
    try {
      const result = await searchUnderpricedCards(card);
      const candidates: SavedFind[] = result.listings
        .filter((l) => l.isUnderpriced)
        .map((l) => ({
          itemId: l.itemId,
          title: l.title,
          priceDollars: l.priceDollars,
          itemWebUrl: l.itemWebUrl,
          imageUrl: l.imageUrl,
          condition: l.condition,
          percentBelowReference: l.percentBelowReference!,
          searchedFor: card,
          foundAt: new Date().toISOString(),
        }));
      const newCount = await saveNewFinds(candidates);
      results.push({ card, ok: true, newFinds: newCount });
    } catch (err) {
      results.push({ card, ok: false, error: (err as Error).message });
    }
  }

  return NextResponse.json({ checked: watchlist.length, results });
}
