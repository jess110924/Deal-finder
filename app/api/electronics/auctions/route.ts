import { NextRequest, NextResponse } from "next/server";
import { searchElectronicsAuctions } from "@/lib/electronicsAuctionSnipe";

// Up to AUCTION_MAX_LISTINGS_TO_EVALUATE sequential batches of a
// third-party scraper API (SOLD_COMPS_API_KEY) whose real latency
// hasn't been measured here — kept as a safety margin against Vercel's
// much shorter default function timeout, same reason the electronics
// search route sets this.
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  const query = request.nextUrl.searchParams.get("q")?.trim();
  if (!query) {
    return NextResponse.json({ error: "Missing ?q= search term." }, { status: 400 });
  }
  const maxHoursParam = request.nextUrl.searchParams.get("maxHours");
  const maxHours = maxHoursParam ? Number(maxHoursParam) : undefined;
  const sortBy = request.nextUrl.searchParams.get("sortBy") === "price" ? "price" : "time";
  const offsetParam = request.nextUrl.searchParams.get("offset");
  const offset = offsetParam ? Number(offsetParam) : 0;
  const minProfitParam = request.nextUrl.searchParams.get("minProfit");
  const minProfitDollars = minProfitParam ? Number(minProfitParam) : undefined;

  try {
    const result = await searchElectronicsAuctions(query, {
      maxHoursRemaining: Number.isFinite(maxHours) ? maxHours : undefined,
      sortBy,
      offset: Number.isFinite(offset) && offset > 0 ? offset : 0,
      minProfitDollars:
        minProfitDollars != null && Number.isFinite(minProfitDollars) && minProfitDollars >= 0
          ? minProfitDollars
          : undefined,
    });
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
