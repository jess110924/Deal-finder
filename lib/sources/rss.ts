import Parser from "rss-parser";
import type { RawDeal } from "@/lib/types";

// rss-parser's built-in Item type omits `description` and `author` even
// though both are populated at runtime (the latter for Atom feeds, e.g.
// Reddit) — extending the type here rather than casting at every use site.
type FeedItem = { description?: string; author?: string };

const USER_AGENT = "DealFinder/1.0 (personal project)"; // Reddit and CheapShark both reject default/generic ones outright

// Constructed with no request options — the actual HTTP fetch happens
// separately via the global `fetch` below (see fetchDeals), specifically so
// it can go through Next.js's fetch cache. rss-parser's own parseURL() uses
// its own internal HTTP client, which bypasses that cache entirely; feeding
// it pre-fetched text via parseString() instead keeps the parsing logic but
// makes the network call cacheable.
const parser: Parser<Record<string, unknown>, FeedItem> = new Parser({
  customFields: { item: [["dc:creator", "creator"]] },
});

// Reddit's RSS content is just "submitted by /u/x [link] [comments]" for
// link posts — no real information, so it's dropped rather than shown.
const REDDIT_BOILERPLATE = /^\s*submitted by\s.*\[link\]\s*\[comments\]\s*$/i;

function cleanDescription(raw: string): string {
  const text = raw.replace(/<[^>]*>/g, "").trim();
  return REDDIT_BOILERPLATE.test(text) ? "" : text;
}

/**
 * Works for any RSS 2.0 or Atom feed — Slickdeals category feeds, Reddit
 * subreddit feeds (`https://www.reddit.com/r/<sub>/new/.rss`), DansDeals,
 * or any other blog/forum feed.
 */
export async function fetchDeals(feedUrl: string): Promise<RawDeal[]> {
  // Cached for 10 minutes at the Next.js/hosting layer — protects against
  // Reddit's aggressive per-IP rate limiting under real traffic, and is
  // generally polite to free sources that don't expect bot-speed polling.
  const res = await fetch(feedUrl, {
    headers: { "User-Agent": USER_AGENT },
    next: { revalidate: 600 },
  });
  if (!res.ok) {
    throw new Error(`Feed request failed: ${res.status} ${res.statusText}`);
  }
  const xml = await res.text();
  const feed = await parser.parseString(xml);
  return feed.items.map((item) => ({
    id: item.guid || item.link || item.title || "",
    title: item.title || "(untitled deal)",
    link: item.link || "",
    description: cleanDescription(item.contentSnippet || item.description || ""),
    pubDate: item.pubDate ? new Date(item.pubDate).toISOString() : null,
    // dc:creator covers Slickdeals-style RSS 2.0 feeds; Atom feeds (Reddit)
    // expose the author as `author` instead, often prefixed "/u/".
    creator: (item.creator || item.author || "").replace(/^\/u\//, "") || null,
    discountPercent: null,
    price: null,
    originalPrice: null,
  }));
}
