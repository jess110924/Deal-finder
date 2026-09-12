import { NextRequest, NextResponse } from "next/server";
import { searchUnderpricedCards, type CardCategory } from "@/lib/cardComparison";

export async function GET(request: NextRequest) {
  const query = request.nextUrl.searchParams.get("q")?.trim();
  if (!query) {
    return NextResponse.json({ error: "Missing ?q= search term." }, { status: 400 });
  }
  const categoryParam = request.nextUrl.searchParams.get("category");
  const category: CardCategory = categoryParam === "pokemon" ? "pokemon" : "sports";

  try {
    const result = await searchUnderpricedCards(query, category, true, true);
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
