import { NextRequest, NextResponse } from "next/server";
import { searchEndingAuctions } from "@/lib/auctionSnipe";
import type { CardCategory } from "@/lib/cardComparison";

export async function GET(request: NextRequest) {
  const query = request.nextUrl.searchParams.get("q")?.trim();
  if (!query) {
    return NextResponse.json({ error: "Missing ?q= search term." }, { status: 400 });
  }
  const categoryParam = request.nextUrl.searchParams.get("category");
  const category: CardCategory = categoryParam === "pokemon" ? "pokemon" : "sports";
  const maxHoursParam = request.nextUrl.searchParams.get("maxHours");
  const maxHours = maxHoursParam ? Number(maxHoursParam) : undefined;

  try {
    const auctions = await searchEndingAuctions(query, category, Number.isFinite(maxHours) ? maxHours : undefined);
    return NextResponse.json({ auctions });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
