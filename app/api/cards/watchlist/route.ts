import { NextRequest, NextResponse } from "next/server";
import { getWatchlist, addToWatchlist, removeFromWatchlist } from "@/lib/db";

export async function GET() {
  return NextResponse.json({ watchlist: await getWatchlist() });
}

export async function POST(request: NextRequest) {
  const { name } = await request.json();
  if (!name || typeof name !== "string") {
    return NextResponse.json({ error: "Missing 'name'." }, { status: 400 });
  }
  return NextResponse.json({ watchlist: await addToWatchlist(name.trim()) });
}

export async function DELETE(request: NextRequest) {
  const { name } = await request.json();
  if (!name || typeof name !== "string") {
    return NextResponse.json({ error: "Missing 'name'." }, { status: 400 });
  }
  return NextResponse.json({ watchlist: await removeFromWatchlist(name.trim()) });
}
