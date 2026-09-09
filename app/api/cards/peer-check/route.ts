import { NextRequest, NextResponse } from "next/server";
import { comparePeerListings } from "@/lib/playerSearch";
import type { CardCategory } from "@/lib/cardComparison";

export async function GET(request: NextRequest) {
  const title = request.nextUrl.searchParams.get("title")?.trim();
  if (!title) {
    return NextResponse.json({ error: "Missing ?title= exact listing title." }, { status: 400 });
  }
  const categoryParam = request.nextUrl.searchParams.get("category");
  const category: CardCategory = categoryParam === "pokemon" ? "pokemon" : "sports";
  const subject = request.nextUrl.searchParams.get("subject")?.trim() || null;

  try {
    const comparison = await comparePeerListings(title, category, subject);
    return NextResponse.json({ comparison });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
