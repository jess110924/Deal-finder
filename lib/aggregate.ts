import { SOURCES } from "@/lib/config";
import * as rss from "@/lib/sources/rss";
import * as cheapshark from "@/lib/sources/cheapshark";
import * as epic from "@/lib/sources/epic";
import * as keepa from "@/lib/sources/keepa";
import type { Deal, RawDeal } from "@/lib/types";

export type SourceResult = { name: string; label: string; ok: boolean; error?: string; count: number };

export async function aggregateDeals(): Promise<{ deals: Deal[]; results: SourceResult[] }> {
  const deals: Deal[] = [];
  const results: SourceResult[] = [];

  await Promise.all(
    SOURCES.map(async (source) => {
      try {
        let raw: RawDeal[];
        switch (source.type) {
          case "rss":
            raw = await rss.fetchDeals(source.url!);
            break;
          case "cheapshark":
            raw = await cheapshark.fetchDeals();
            break;
          case "epic":
            raw = await epic.fetchDeals();
            break;
          case "keepa":
            raw = await keepa.fetchDeals(Number(process.env.KEEPA_MIN_DISCOUNT) || 40);
            break;
        }

        for (const d of raw) deals.push({ ...d, source: source.name });
        results.push({ name: source.name, label: source.label, ok: true, count: raw.length });
      } catch (err) {
        results.push({ name: source.name, label: source.label, ok: false, error: (err as Error).message, count: 0 });
      }
    })
  );

  // Newest first when a real publish date is known; undated deals (CheapShark,
  // Epic, Keepa — none of these carry a "posted at" timestamp) sort after
  // everything dated. The UI's sort control can reorder by discount instead.
  deals.sort((a, b) => {
    if (a.pubDate && b.pubDate) return new Date(b.pubDate).getTime() - new Date(a.pubDate).getTime();
    if (a.pubDate) return -1;
    if (b.pubDate) return 1;
    return 0;
  });

  return { deals, results };
}
