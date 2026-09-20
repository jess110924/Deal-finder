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
  // Indexed by SOURCES' own position, not fetch-completion order —
  // Promise.all resolves whenever each source happens to finish, which
  // isn't a stable order to dedupe against (see below).
  const perSourceRaw: (RawDeal[] | null)[] = new Array(SOURCES.length).fill(null);
  const results: (SourceResult | null)[] = new Array(SOURCES.length).fill(null);

  await Promise.all(
    SOURCES.map(async (source, index) => {
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
            // KEEPA_MAX_PAGES defaults to 1 (unchanged behavior) — each
            // extra page is its own metered Keepa API call, so this is
            // opt-in, not a default increase in token spend. See
            // fetchDeals' doc comment in lib/sources/keepa.ts.
            raw = await keepa.fetchDeals(Number(process.env.KEEPA_MIN_DISCOUNT) || 40, Number(process.env.KEEPA_MAX_PAGES) || 1);
            break;
        }

        perSourceRaw[index] = raw;
        results[index] = { name: source.name, label: source.label, ok: true, count: raw.length };
      } catch (err) {
        perSourceRaw[index] = [];
        results[index] = { name: source.name, label: source.label, ok: false, error: (err as Error).message, count: 0 };
      }
    })
  );

  // Global dedupe across ALL sources, not just within one merged
  // multi-URL source (PC Parts/More Categories above already dedupe
  // internally, but that only covers collisions between that one
  // source's own sub-searches). Reported directly ("when I disable all
  // filters I still get search results") and confirmed live: the same
  // real Slickdeals thread frequently matches more than one *separate*
  // SourceConfig entry's keyword search (e.g. a deal in the generic Hot
  // Deals firehose that also matches the Electronics search), producing
  // the identical `id` from two different sources with nothing here to
  // catch it — 128 duplicate-key React warnings confirmed this live, not
  // a rare edge case. Beyond just double-counting one real deal in "N
  // shown," undetected duplicate keys corrupted React's list
  // reconciliation badly enough that toggling every source off left
  // stale rows on screen instead of actually clearing the list — this
  // fixes both.
  //
  // Deduped in `SOURCES`' own declared order (not fetch-completion
  // order, which the `Promise.all` above doesn't preserve and which
  // would otherwise make which source "wins" a collision unpredictable
  // between refreshes) — whichever source is listed first in
  // `lib/config.ts` keeps the deal.
  const deals: Deal[] = [];
  const seenIds = new Set<string>();
  for (let i = 0; i < SOURCES.length; i++) {
    const source = SOURCES[i];
    for (const d of perSourceRaw[i] ?? []) {
      if (seenIds.has(d.id)) continue;
      seenIds.add(d.id);
      deals.push({ ...d, source: source.name, isStackable: isStackableDeal(d.title, d.description) });
    }
  }

  // Newest first when a real publish date is known; undated deals (CheapShark,
  // Epic, Keepa — none of these carry a "posted at" timestamp) sort after
  // everything dated. The UI's sort control can reorder by discount instead.
  deals.sort((a, b) => {
    if (a.pubDate && b.pubDate) return new Date(b.pubDate).getTime() - new Date(a.pubDate).getTime();
    if (a.pubDate) return -1;
    if (b.pubDate) return 1;
    return 0;
  });

  return { deals, results: results.filter((r): r is SourceResult => r !== null) };
}
