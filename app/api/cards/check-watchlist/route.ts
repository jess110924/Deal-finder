import { NextRequest, NextResponse } from "next/server";
import { getWatchlist } from "@/lib/db";
import { checkCardAndSaveFinds } from "@/lib/cardComparison";
import { mapWithConcurrency } from "@/lib/concurrency";

/**
 * Triggered by a scheduled GitHub Actions workflow (see
 * .github/workflows/check-watchlist.yml), not a browser — protected by its
 * own secret rather than the site's cookie-based login (excluded from that
 * in proxy.ts), since a script has no session to present.
 *
 * Each watchlist card does its own per-listing sold-comps lookups (see
 * evaluateListing in lib/cardComparison.ts — up to ~30 per card) to give
 * each listing its own accurate comparison, which makes this route
 * meaningfully slower per card than a single shared lookup would be. 60s
 * is the max Vercel's Hobby plan allows a function to declare — a
 * backstop against a large watchlist exceeding it, the same fix Discover
 * already needed for the same underlying reason (see
 * app/api/cards/discover/route.ts).
 */
export const maxDuration = 60;

export async function POST(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "CRON_SECRET is not set." }, { status: 500 });
  }
  if (request.headers.get("x-cron-secret") !== secret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const watchlist = await getWatchlist();

  // Each card takes several seconds on its own since each one does its
  // own per-listing sold-comps lookups instead of one shared figure —
  // sequential (the original design) would put a 10-card watchlist right
  // up against the 60s ceiling with zero safety margin. A modest
  // concurrency here keeps a realistic watchlist size comfortably inside
  // that window without piling on so many simultaneous requests to the
  // sold-comps API (each card's own lookups are already concurrent
  // internally) that it starts looking like abusive traffic.
  const WATCHLIST_CONCURRENCY = 3;

  const results = await mapWithConcurrency(watchlist, WATCHLIST_CONCURRENCY, async (entry) => {
    try {
      const newCount = await checkCardAndSaveFinds(entry.name, entry.category);
      return { card: entry.name, ok: true, newFinds: newCount };
    } catch (err) {
      return { card: entry.name, ok: false, error: (err as Error).message };
    }
  });

  return NextResponse.json({ checked: watchlist.length, results });
}
