import Parser from "rss-parser";
import type { RawDeal } from "@/lib/types";

// rss-parser's built-in Item type omits `description` and `author` even
// though both are populated at runtime (the latter for Atom feeds, e.g.
// Reddit) — extending the type here rather than casting at every use site.
type FeedItem = { description?: string; author?: string };

// A descriptive User-Agent is required by some feeds (Reddit and CheapShark
// both reject default/generic ones outright) and is good etiquette anyway.
const parser: Parser<Record<string, unknown>, FeedItem> = new Parser({
  headers: { "User-Agent": "DealFinder/1.0 (personal project)" },
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
  const feed = await parser.parseURL(feedUrl);
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
