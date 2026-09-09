import { NextRequest, NextResponse } from "next/server";
import { getWatchlist } from "@/lib/db";
import { checkCardAndSaveFinds } from "@/lib/cardComparison";

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

  for (const entry of watchlist) {
    try {
      const newCount = await checkCardAndSaveFinds(entry.name, entry.category);
      results.push({ card: entry.name, ok: true, newFinds: newCount });
    } catch (err) {
      results.push({ card: entry.name, ok: false, error: (err as Error).message });
    }
  }

  return NextResponse.json({ checked: watchlist.length, results });
}
