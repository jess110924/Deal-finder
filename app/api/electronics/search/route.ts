import { NextRequest, NextResponse } from "next/server";
import { searchElectronics } from "@/lib/electronicsSearch";

// No multi-page auto-search anymore (see lib/electronicsSearch.ts), but
// up to MAX_LISTINGS_TO_EVALUATE sequential batches of a third-party
// scraper API (SOLD_COMPS_API_KEY) whose real latency hasn't been
// measured here — kept as a safety margin against Vercel's much shorter
// default function timeout, same reason the other multi-lookup routes
// set this.
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
    });
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
