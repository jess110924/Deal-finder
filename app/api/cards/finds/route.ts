import { NextRequest, NextResponse } from "next/server";
import { getFinds, dismissFind } from "@/lib/db";

export async function GET() {
  return NextResponse.json({ finds: await getFinds() });
}

export async function DELETE(request: NextRequest) {
  const { itemId } = await request.json();
  if (!itemId || typeof itemId !== "string") {
    return NextResponse.json({ error: "Missing 'itemId'." }, { status: 400 });
  }
  await dismissFind(itemId);
  return NextResponse.json({ ok: true });
}
