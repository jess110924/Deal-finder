import { NextRequest, NextResponse } from "next/server";
import { getWatchlist, addToWatchlist, removeFromWatchlist, getFinds } from "@/lib/db";
import { checkCardAndSaveFinds, type CardCategory } from "@/lib/cardComparison";

function parseCategory(value: unknown): CardCategory {
  return value === "pokemon" ? "pokemon" : "sports";
}

export async function GET() {
  try {
    return NextResponse.json({ watchlist: await getWatchlist() });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const { name, category } = await request.json();
    if (!name || typeof name !== "string") {
      return NextResponse.json({ error: "Missing 'name'." }, { status: 400 });
    }
    const cat = parseCategory(category);

    const watchlist = await addToWatchlist(name.trim(), cat);

    // Immediate check on add — otherwise there's zero feedback until the
    // next scheduled run, up to 30 minutes away. This is a real eBay
    // search + sold-comps check, so it takes a few seconds; the
    // checkbox-style instant response isn't possible here, but "wait a
    // few seconds" beats "wait up to 30 minutes with nothing to look at"
    // by a lot.
    let checkError: string | null = null;
    try {
      await checkCardAndSaveFinds(name.trim(), cat);
    } catch (err) {
      // Don't fail the whole add if the immediate check has trouble — the
      // card is still on the watchlist and will get picked up by the next
      // scheduled run regardless.
      checkError = (err as Error).message;
    }

    return NextResponse.json({ watchlist, finds: await getFinds(), checkError });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { name, category } = await request.json();
    if (!name || typeof name !== "string") {
      return NextResponse.json({ error: "Missing 'name'." }, { status: 400 });
    }
    return NextResponse.json({ watchlist: await removeFromWatchlist(name.trim(), parseCategory(category)) });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
