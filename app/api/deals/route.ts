import { NextResponse } from "next/server";
import { aggregateDeals } from "@/lib/aggregate";

export async function GET() {
  const { deals, results } = await aggregateDeals();
  return NextResponse.json({ deals, results, fetchedAt: new Date().toISOString() });
}
