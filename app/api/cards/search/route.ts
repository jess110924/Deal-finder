import { NextRequest, NextResponse } from "next/server";
import { searchUnderpricedCards, SEARCH_MAX_LISTINGS_TO_EVALUATE, type CardCategory } from "@/lib/cardComparison";

export async function GET(request: NextRequest) {
  const query = request.nextUrl.searchParams.get("q")?.trim();
  if (!query) {
    return NextResponse.json({ error: "Missing ?q= search term." }, { status: 400 });
  }
  const categoryParam = request.nextUrl.searchParams.get("category");
  const category: CardCategory = categoryParam === "pokemon" ? "pokemon" : "sports";

  try {
    const result = await searchUnderpricedCards(query, category, SEARCH_MAX_LISTINGS_TO_EVALUATE);
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
