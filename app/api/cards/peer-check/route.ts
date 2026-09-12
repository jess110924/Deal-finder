import { NextRequest, NextResponse } from "next/server";
import { getSoldComps } from "@/lib/soldComps";

export async function GET(request: NextRequest) {
  const title = request.nextUrl.searchParams.get("title")?.trim();
  if (!title) {
    return NextResponse.json({ error: "Missing ?title= exact listing title." }, { status: 400 });
  }
  const priceParam = request.nextUrl.searchParams.get("price");
  const priceDollars = priceParam ? Number(priceParam) : null;

  try {
    const comparison = await getSoldComps(title, Number.isFinite(priceDollars) ? priceDollars : null);
    return NextResponse.json({ comparison });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
