import { NextRequest, NextResponse } from "next/server";
import { searchEndingAuctions } from "@/lib/auctionSnipe";
import type { CardCategory } from "@/lib/cardComparison";

// Paging forward to satisfy `minProfitable` (see lib/auctionSnipe.ts's
// MAX_PAGES_PER_SEARCH) can mean several eBay fetches plus their own
// batches of PriceCharting lookups in one request — same backstop reason
// as check-watchlist/discover (see their route files), just triggered by
// a filter choice here instead of a large watchlist.
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  const query = request.nextUrl.searchParams.get("q")?.trim();
  if (!query) {
    return NextResponse.json({ error: "Missing ?q= search term." }, { status: 400 });
  }
  const categoryParam = request.nextUrl.searchParams.get("category");
  const category: CardCategory = categoryParam === "pokemon" ? "pokemon" : "sports";
  const maxHoursParam = request.nextUrl.searchParams.get("maxHours");
  const maxHours = maxHoursParam ? Number(maxHoursParam) : undefined;
  const sortBy = request.nextUrl.searchParams.get("sortBy") === "price" ? "price" : "time";
  const offsetParam = request.nextUrl.searchParams.get("offset");
  const offset = offsetParam ? Number(offsetParam) : 0;
  const minProfitParam = request.nextUrl.searchParams.get("minProfit");
  const minProfitDollars = minProfitParam ? Number(minProfitParam) : undefined;
  const minProfitableParam = request.nextUrl.searchParams.get("minProfitable");
  const minProfitableTarget = minProfitableParam ? Number(minProfitableParam) : undefined;

  try {
    const result = await searchEndingAuctions(query, category, {
      maxHoursRemaining: Number.isFinite(maxHours) ? maxHours : undefined,
      sortBy,
      offset: Number.isFinite(offset) && offset > 0 ? offset : 0,
      minProfitDollars:
        minProfitDollars != null && Number.isFinite(minProfitDollars) && minProfitDollars >= 0
          ? minProfitDollars
          : undefined,
      minProfitableTarget:
        minProfitableTarget != null && Number.isFinite(minProfitableTarget) && minProfitableTarget > 0
          ? Math.floor(minProfitableTarget)
          : undefined,
    });
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
