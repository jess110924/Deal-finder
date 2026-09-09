import { NextRequest, NextResponse } from "next/server";
import { getWatchlist, addToWatchlist, removeFromWatchlist } from "@/lib/db";

export async function GET() {
  try {
    return NextResponse.json({ watchlist: await getWatchlist() });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const { name } = await request.json();
    if (!name || typeof name !== "string") {
      return NextResponse.json({ error: "Missing 'name'." }, { status: 400 });
    }
    return NextResponse.json({ watchlist: await addToWatchlist(name.trim()) });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { name } = await request.json();
    if (!name || typeof name !== "string") {
      return NextResponse.json({ error: "Missing 'name'." }, { status: 400 });
    }
    return NextResponse.json({ watchlist: await removeFromWatchlist(name.trim()) });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
