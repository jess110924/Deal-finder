import type { RawDeal } from "@/lib/types";

const API_BASE = "https://www.cheapshark.com/api/1.0";
const USER_AGENT = "DealFinder/1.0 (personal project)"; // CheapShark rejects generic/missing User-Agents

// Confirmed against GET /api/1.0/stores — only including stores worth
// alerting on (well-known PC game storefronts).
const STORE_NAMES: Record<number, string> = {
  1: "Steam",
  7: "GOG",
  8: "Origin",
  11: "Humble Store",
  13: "Uplay",
  15: "Fanatical",
  25: "Epic Games Store",
  31: "Blizzard Shop",
};

type CheapSharkDeal = {
  dealID: string;
  title: string;
  salePrice: string;
  normalPrice: string;
  storeID: string;
};

/**
 * Free, no API key. Finds PC game deals currently priced at $0 (temporary
 * full giveaways, not "up to 100% off" marketing language — verified by
 * requiring salePrice === "0.00", not just the presence of a discount).
 */
export async function fetchDeals(): Promise<RawDeal[]> {
  const url = `${API_BASE}/deals?upperPrice=0&pageSize=60`;
  const res = await fetch(url, { headers: { "User-Agent": USER_AGENT }, cache: "no-store" });
  if (!res.ok) {
    throw new Error(`CheapShark request failed: ${res.status} ${res.statusText}`);
  }
  const deals = (await res.json()) as CheapSharkDeal[];

  return deals
    .filter((d) => Number(d.salePrice) === 0)
    .map((d) => ({
      id: `cheapshark-${d.dealID}`,
      title: d.title,
      link: `https://www.cheapshark.com/redirect?dealID=${d.dealID}`,
      description: `${STORE_NAMES[Number(d.storeID)] || "PC store"} · normally $${d.normalPrice}`,
      pubDate: null,
      creator: null,
      discountPercent: 100,
      price: 0,
      originalPrice: Number(d.normalPrice),
    }));
}
