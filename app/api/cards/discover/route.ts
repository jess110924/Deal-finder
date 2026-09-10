import { NextRequest, NextResponse } from "next/server";
import { discoverDeals } from "@/lib/cardDiscovery";

/**
 * Triggered by a scheduled GitHub Actions workflow (see
 * .github/workflows/discover-deals.yml), not a browser — same pattern as
 * check-watchlist: protected by its own secret rather than the site's
 * cookie-based login (excluded from that in proxy.ts), since a script has
 * no session to present.
 *
 * 60s is the max Vercel's Hobby plan allows a function to declare — a real
 * production run timed out with no response at all before this and the
 * concurrency fix in lib/cardDiscovery.ts were added, so this is a backstop
 * on top of that fix, not a substitute for it.
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

  const settled = await Promise.allSettled(
    (["sports", "pokemon"] as const).map((category) => discoverDeals(category))
  );
  const results = settled.map((r, i) => {
    const category = (["sports", "pokemon"] as const)[i];
    return r.status === "fulfilled"
      ? { category, ok: true, newFinds: r.value }
      : { category, ok: false, error: (r.reason as Error).message };
  });

  return NextResponse.json({ results });
}
