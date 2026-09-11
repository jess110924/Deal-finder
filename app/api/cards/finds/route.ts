import { NextRequest, NextResponse } from "next/server";
import { getFinds, dismissFind, confirmFind, flagMismatch } from "@/lib/db";

export async function GET() {
  try {
    return NextResponse.json({ finds: await getFinds() });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

// Moves a find into "My Picks" (confirmed exact match + real deal) or
// "Mismatches" (flagged as wrong, kept for debugging) instead of just
// dismissing it outright.
export async function POST(request: NextRequest) {
  try {
    const { itemId, action } = await request.json();
    if (!itemId || typeof itemId !== "string") {
      return NextResponse.json({ error: "Missing 'itemId'." }, { status: 400 });
    }
    if (action !== "confirm" && action !== "flag") {
      return NextResponse.json({ error: "'action' must be 'confirm' or 'flag'." }, { status: 400 });
    }
    const find = action === "confirm" ? await confirmFind(itemId) : await flagMismatch(itemId);
    if (!find) {
      return NextResponse.json({ error: "That find isn't in the review queue (already handled?)." }, { status: 404 });
    }
    return NextResponse.json({ ok: true, find });
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
    await dismissFind(itemId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
