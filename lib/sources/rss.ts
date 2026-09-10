import Parser from "rss-parser";
import type { RawDeal } from "@/lib/types";

// rss-parser's built-in Item type omits `description` and `author` even
// though both are populated at runtime (the latter for Atom feeds, e.g.
// Reddit) — extending the type here rather than casting at every use site.
// `content:encoded` is RSS 2.0's full-HTML field (Slickdeals, DansDeals);
// Atom feeds (Reddit) have no such field and put full HTML directly in
// `content` instead — both are read when looking for an image, see below.
type FeedItem = { description?: string; author?: string; "content:encoded"?: string };

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

// A CDATA-wrapped <description> (common in WordPress feeds — 9to5Toys)
// is opaque text to the XML parser, so entities inside it never get
// decoded the way a normal element's text would — confirmed live: a
// 9to5Toys image URL came through with literal "&#038;" in its query
// string instead of "&", which a browser sends to the image CDN as-is,
// not as the "&" it's supposed to mean.
function decodeHtmlEntities(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

// `content:encoded` (RSS 2.0) carries the full post HTML, usually with a
// thumbnail <img> right at the top; `content` is Atom's equivalent for
// Reddit. Checked in that order since a feed with both would have the
// richer content:encoded version. Verified against live data for all three
// RSS-based sources — this only misses the shot for a post with no image
// at all, which just leaves imageUrl unset (handled fine downstream).
function extractImage(html: string | undefined): string | null {
  if (!html) return null;
  const match = /<img[^>]+src=["']([^"']+)["']/i.exec(html);
  return match ? decodeHtmlEntities(match[1]) : null;
}

// Most RSS-based sources here don't expose structured price data — this
// pulls it from the title text instead, needed for any price-ceiling
// filter (e.g. "$5 and under") to work across the whole feed rather
// than just Keepa (the only source with a real structured price).
// Takes the FIRST dollar amount in the title: checked against a broad
// real sample before writing this, and titles consistently lead or
// close with the actual deal price, with secondary amounts (free-
// shipping thresholds like "on $35+", multi-buy math) appearing after
// it, not before — no "reg $X ... now $Y" ordering was found in
// practice. A title with no dollar amount but the standalone word
// "free" (not "free shipping"/"freebie" as part of another word) is
// priced at $0 — covers the Freebies-forum case where a deal's title
// never states a price because it doesn't have one.
function extractPrice(title: string): number | null {
  const match = title.match(/\$(\d[\d,]*\.?\d*)/);
  if (match) {
    const value = Number(match[1].replace(/,/g, ""));
    return Number.isFinite(value) ? value : null;
  }
  return /\bfree\b/i.test(title) ? 0 : null;
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
    imageUrl: extractImage(item["content:encoded"] || item.content),
    pubDate: item.pubDate ? new Date(item.pubDate).toISOString() : null,
    // dc:creator covers Slickdeals-style RSS 2.0 feeds; Atom feeds (Reddit)
    // expose the author as `author` instead, often prefixed "/u/".
    creator: (item.creator || item.author || "").replace(/^\/u\//, "") || null,
    discountPercent: null,
    price: extractPrice(item.title || ""),
    originalPrice: null,
  }));
}
