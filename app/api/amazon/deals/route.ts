import { NextRequest, NextResponse } from "next/server";
import { searchAmazonDeals } from "@/lib/amazonDeals";

export async function GET(request: NextRequest) {
  const minDiscountParam = request.nextUrl.searchParams.get("minDiscount");
  const minDiscountPercent = minDiscountParam ? Number(minDiscountParam) : undefined;
  const checkCoupons = request.nextUrl.searchParams.get("checkCoupons") === "1";

  try {
    const deals = await searchAmazonDeals({
      minDiscountPercent:
        minDiscountPercent != null && Number.isFinite(minDiscountPercent) && minDiscountPercent >= 0
          ? minDiscountPercent
          : undefined,
      checkCoupons,
    });
    return NextResponse.json({ deals });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
