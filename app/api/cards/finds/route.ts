import { NextRequest, NextResponse } from "next/server";
import { getFinds, dismissFind } from "@/lib/db";

export async function GET() {
  try {
    return NextResponse.json({ finds: await getFinds() });
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
