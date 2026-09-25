import { NextRequest, NextResponse } from "next/server";
import { searchElectronics } from "@/lib/electronicsSearch";

// Paging forward to satisfy `minProfitable` (see lib/electronicsSearch.ts's
// MAX_PAGES_PER_SEARCH) can mean several eBay fetches plus their own
// batches of peer-search lookups in one request — same backstop reason
// as check-watchlist/discover/auctions/player-search (see their route
// files).
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  const query = request.nextUrl.searchParams.get("q")?.trim();
  if (!query) {
    return NextResponse.json({ error: "Missing ?q= search term." }, { status: 400 });
  }

  const minParam = request.nextUrl.searchParams.get("min");
  const maxParam = request.nextUrl.searchParams.get("max");
  const minPriceDollars = minParam ? Number(minParam) : undefined;
  const maxPriceDollars = maxParam ? Number(maxParam) : undefined;
  const sortBy = request.nextUrl.searchParams.get("sortBy") === "price" ? "price" : "profit";
  const offsetParam = request.nextUrl.searchParams.get("offset");
  const offset = offsetParam ? Number(offsetParam) : 0;
  const minProfitParam = request.nextUrl.searchParams.get("minProfit");
  const minProfitDollars = minProfitParam ? Number(minProfitParam) : undefined;
  const minProfitableParam = request.nextUrl.searchParams.get("minProfitable");
  const minProfitableTarget = minProfitableParam ? Number(minProfitableParam) : undefined;

  try {
    const result = await searchElectronics(query, {
      minPriceDollars: Number.isFinite(minPriceDollars) ? minPriceDollars : undefined,
      maxPriceDollars: Number.isFinite(maxPriceDollars) ? maxPriceDollars : undefined,
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
