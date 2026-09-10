import { SOURCES } from "@/lib/config";
import * as rss from "@/lib/sources/rss";
import * as reddit from "@/lib/sources/reddit";
import * as cheapshark from "@/lib/sources/cheapshark";
import * as epic from "@/lib/sources/epic";
import * as keepa from "@/lib/sources/keepa";
import { isStackableDeal } from "@/lib/stackable";
import type { Deal, RawDeal } from "@/lib/types";

export type SourceResult = { name: string; label: string; ok: boolean; error?: string; count: number };

function matchesRetailer(deal: RawDeal, retailer: string): boolean {
  const pattern = new RegExp(`\\b${retailer}\\b`, "i");
  return pattern.test(deal.title) || pattern.test(deal.description ?? "");
}

export async function aggregateDeals(): Promise<{ deals: Deal[]; results: SourceResult[] }> {
  const deals: Deal[] = [];
  const results: SourceResult[] = [];

  await Promise.all(
    SOURCES.map(async (source) => {
      try {
        let raw: RawDeal[];
        switch (source.type) {
          case "rss":
            if (source.urls) {
              // Multiple feeds merged into one source (e.g. Slickdeals PC
              // Parts' six keyword searches) — isolates one bad feed from
              // the rest the same way per-source isolation already works
              // at the top level, instead of failing the whole merged
              // source over one flaky sub-fetch. Deduped by id since the
              // same deal often matches more than one keyword search
              // (a full-PC bundle mentioning both a GPU and a motherboard,
              // for instance).
              const settled = await Promise.allSettled(source.urls.map((u) => rss.fetchDeals(u)));
              const succeeded = settled.filter(
                (r): r is PromiseFulfilledResult<RawDeal[]> => r.status === "fulfilled"
              );
              if (succeeded.length === 0) {
                const firstError = (settled[0] as PromiseRejectedResult).reason as Error;
                throw new Error(firstError?.message ?? "All feeds failed");
              }
              const seen = new Set<string>();
              raw = succeeded.flatMap((r) => r.value).filter((d) => (seen.has(d.id) ? false : (seen.add(d.id), true)));
            } else {
              raw = await rss.fetchDeals(source.url!);
            }
            if (source.retailerMatch) {
              raw = raw.filter((d) => matchesRetailer(d, source.retailerMatch!));
            }
            break;
          case "reddit":
            raw = await reddit.fetchDeals(source.subreddit!);
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

        for (const d of raw) {
          deals.push({ ...d, source: source.name, isStackable: isStackableDeal(d.title, d.description) });
        }
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
