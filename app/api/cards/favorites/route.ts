import { NextRequest, NextResponse } from "next/server";
import { getFavorites, addFavorite, removeFavorite, type FavoriteCard } from "@/lib/db";

export async function GET() {
  try {
    return NextResponse.json({ favorites: await getFavorites() });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const card = body as Omit<FavoriteCard, "favoritedAt">;
    if (!card.itemId || !card.title || !card.itemWebUrl || !card.category || !card.searchedFor) {
      return NextResponse.json({ error: "Missing required favorite fields." }, { status: 400 });
    }
    const favorites = await addFavorite(card);
    return NextResponse.json({ favorites });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { itemId } = await request.json();
    if (!itemId || typeof itemId !== "string") {
      return NextResponse.json({ error: "Missing 'itemId'." }, { status: 400 });
    }
    const favorites = await removeFavorite(itemId);
    return NextResponse.json({ favorites });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
