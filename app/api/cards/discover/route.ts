import { NextRequest, NextResponse } from "next/server";
import { discoverDeals } from "@/lib/cardDiscovery";

/**
 * Triggered by a scheduled GitHub Actions workflow (see
 * .github/workflows/discover-deals.yml), not a browser — same pattern as
 * check-watchlist: protected by its own secret rather than the site's
 * cookie-based login (excluded from that in proxy.ts), since a script has
 * no session to present.
 */
export async function POST(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "CRON_SECRET is not set." }, { status: 500 });
  }
  if (request.headers.get("x-cron-secret") !== secret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const results: { category: string; ok: boolean; newFinds?: number; error?: string }[] = [];
  for (const category of ["sports", "pokemon"] as const) {
    try {
      const newFinds = await discoverDeals(category);
      results.push({ category, ok: true, newFinds });
    } catch (err) {
      results.push({ category, ok: false, error: (err as Error).message });
    }
  }

  return NextResponse.json({ results });
}
