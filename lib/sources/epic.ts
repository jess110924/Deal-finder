import type { RawDeal } from "@/lib/types";

const API_URL =
  "https://store-site-backend-static.ak.epicgames.com/freeGamesPromotions?locale=en-US&country=US&allowCountries=US";

type EpicElement = {
  id: string;
  title: string;
  description?: string;
  effectiveDate?: string;
  urlSlug?: string;
  catalogNs?: { mappings?: { pageSlug?: string }[] };
  offerMappings?: { pageSlug?: string }[];
  price?: { totalPrice?: { discountPrice?: number; originalPrice?: number } };
};

/**
 * Free, no API key, undocumented but stable — the same endpoint
 * store.epicgames.com's own free-games section calls. Only counts a game as
 * free when its actual current price is $0 (`discountPrice === 0`); Epic's
 * response also includes regular percent-off sales in the same list, which
 * this deliberately excludes.
 */
export async function fetchDeals(): Promise<RawDeal[]> {
  const res = await fetch(API_URL, { next: { revalidate: 600 } });
  if (!res.ok) {
    throw new Error(`Epic Games request failed: ${res.status} ${res.statusText}`);
  }
  const json = await res.json();
  const elements: EpicElement[] = json?.data?.Catalog?.searchStore?.elements ?? [];

  return elements
    .filter((g) => g.price?.totalPrice?.discountPrice === 0)
    .map((g) => {
      const slug = g.catalogNs?.mappings?.[0]?.pageSlug || g.offerMappings?.[0]?.pageSlug || g.urlSlug;
      const originalCents = g.price?.totalPrice?.originalPrice ?? 0;
      return {
        id: `epic-${g.id}`,
        title: g.title,
        link: slug ? `https://store.epicgames.com/en-US/p/${slug}` : "https://store.epicgames.com/en-US/free-games",
        description: g.description || null,
        pubDate: g.effectiveDate ? new Date(g.effectiveDate).toISOString() : null,
        creator: null,
        discountPercent: 100,
        price: 0,
        originalPrice: originalCents / 100,
      };
    });
}
