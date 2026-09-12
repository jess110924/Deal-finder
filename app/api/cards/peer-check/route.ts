import { NextRequest, NextResponse } from "next/server";
import { getSoldComps } from "@/lib/playerSearch";
import type { CardCategory } from "@/lib/cardComparison";

export async function GET(request: NextRequest) {
  const title = request.nextUrl.searchParams.get("title")?.trim();
  if (!title) {
    return NextResponse.json({ error: "Missing ?title= exact listing title." }, { status: 400 });
  }
  const categoryParam = request.nextUrl.searchParams.get("category");
  const category: CardCategory = categoryParam === "pokemon" ? "pokemon" : "sports";
  const priceParam = request.nextUrl.searchParams.get("price");
  const priceDollars = priceParam ? Number(priceParam) : null;

  try {
    const comparison = await getSoldComps(title, category, Number.isFinite(priceDollars) ? priceDollars : null);
    return NextResponse.json({ comparison });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
