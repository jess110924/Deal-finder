import { NextRequest, NextResponse } from "next/server";
import { searchUnderpricedCards } from "@/lib/cardComparison";

export async function GET(request: NextRequest) {
  const query = request.nextUrl.searchParams.get("q")?.trim();
  if (!query) {
    return NextResponse.json({ error: "Missing ?q= search term." }, { status: 400 });
  }

  try {
    const result = await searchUnderpricedCards(query);
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
