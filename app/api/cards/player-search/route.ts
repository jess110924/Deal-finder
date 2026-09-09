import { NextRequest, NextResponse } from "next/server";
import { searchPlayerCards } from "@/lib/playerSearch";
import type { CardCategory } from "@/lib/cardComparison";

export async function GET(request: NextRequest) {
  const query = request.nextUrl.searchParams.get("q")?.trim();
  if (!query) {
    return NextResponse.json({ error: "Missing ?q= player name." }, { status: 400 });
  }
  const categoryParam = request.nextUrl.searchParams.get("category");
  const category: CardCategory = categoryParam === "pokemon" ? "pokemon" : "sports";

  const minParam = request.nextUrl.searchParams.get("min");
  const maxParam = request.nextUrl.searchParams.get("max");
  const minPriceDollars = minParam ? Number(minParam) : undefined;
  const maxPriceDollars = maxParam ? Number(maxParam) : undefined;

  try {
    const listings = await searchPlayerCards(query, category, { minPriceDollars, maxPriceDollars });
    return NextResponse.json({ listings });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
