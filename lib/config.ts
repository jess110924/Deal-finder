export type SourceConfig = {
  name: string;
  label: string;
  type: "rss" | "reddit" | "cheapshark" | "epic" | "keepa";
  url?: string; // rss, single feed
  urls?: string[]; // rss, multiple feeds merged + deduped into one source (see "PC Parts" below)
  subreddit?: string; // reddit only
  // rss only: require this word to literally appear (word-boundary,
  // case-insensitive) in the title or description before keeping a
  // result. Needed for the Target/Walmart sources below — confirmed
  // live that Slickdeals' own search stems "Target" to also match
  // "targeted" ("could be targeted" promo language, nothing to do with
  // the retailer), which a plain keyword search alone can't filter out.
  retailerMatch?: string;
};

export const SOURCES: SourceConfig[] = [
  {
    name: "freebies",
    label: "Slickdeals Freebies",
    type: "rss",
    url: "https://slickdeals.net/newsearch.php?searchin=first&forumchoice%5B%5D=4&rss=1",
  },
  {
    name: "hot-deals",
    label: "Slickdeals Hot Deals",
    type: "rss",
    url: "https://slickdeals.net/newsearch.php?searchin=first&forumchoice%5B%5D=9&rss=1",
  },
  // Reddit sources disabled pending their app review (registered 2026-09-08,
  // awaiting approval) — re-enable once REDDIT_CLIENT_ID/SECRET are live.
  // { name: "reddit-deals", label: "r/deals", type: "reddit", subreddit: "deals" },
  // { name: "reddit-gamedeals", label: "r/GameDeals", type: "reddit", subreddit: "GameDeals" },
  // { name: "reddit-buildapcsales", label: "r/buildapcsales", type: "reddit", subreddit: "buildapcsales" },
  { name: "dansdeals", label: "DansDeals", type: "rss", url: "https://www.dansdeals.com/feed/" },
  // Slickdeals has no dedicated "PC parts" forum to filter by — its forums
  // are discussion sections (Hot Deals, Freebies, Tech Support, etc.), not
  // product categories. Its site-wide keyword search does work well for
  // this though (confirmed live per keyword: GPU, CPU, motherboard, SSD,
  // "power supply", and "RAM DDR5" each returned real, relevant PC
  // component/build deals — "OR"-joining terms into one query does not
  // work, it was tried and returned unrelated noise). Six separate
  // searches merged into one source (deduped by item id in aggregate.ts)
  // rather than six separate toggles in the feed UI — several of these
  // already return overlapping results for full-PC bundle deals that
  // mention multiple components at once.
  {
    name: "pc-parts",
    label: "Slickdeals PC Parts",
    type: "rss",
    urls: [
      "https://slickdeals.net/newsearch.php?q=GPU&rss=1",
      "https://slickdeals.net/newsearch.php?q=CPU&rss=1",
      "https://slickdeals.net/newsearch.php?q=motherboard&rss=1",
      "https://slickdeals.net/newsearch.php?q=SSD&rss=1",
      "https://slickdeals.net/newsearch.php?q=power%20supply&rss=1",
      "https://slickdeals.net/newsearch.php?q=RAM%20DDR5&rss=1",
    ],
  },
  // Both confirmed live before adding: real, currently-active RSS 2.0
  // feeds with genuine deal content and working images (verified through
  // the actual fetchDeals() parsing logic, not just that the URL 200s).
  { name: "dealnews", label: "DealNews", type: "rss", url: "https://www.dealnews.com/?rss=1&sort=time" },
  { name: "9to5toys", label: "9to5Toys", type: "rss", url: "https://9to5toys.com/deals/feed/" },
  { name: "bensbargains", label: "Ben's Bargains", type: "rss", url: "https://bensbargains.com/rss/" },
  // Retailer-specific, unlike PC Parts — kept as two separate sources
  // rather than merged, since Target and Walmart deals don't overlap
  // (a deal is at one store, not both) and toggling one off without the
  // other is a real, reasonable thing to want. Confirmed live: a title
  // not obviously mentioning the store (e.g. a plain "Kenmore Microwave"
  // listing) can still be a genuine match — Slickdeals' search matches
  // the deal's full body/link, not just the title, so a title-only
  // relevance check would have wrongly looked noisy; the actual linked
  // description confirmed target.com/walmart.com every time checked.
  // `retailerMatch` guards against the one real false positive found live:
  // Slickdeals' search stems "Target" to also match "targeted" (as in "may
  // be a targeted offer"), unrelated to the retailer.
  {
    name: "target",
    label: "Slickdeals: Target",
    type: "rss",
    url: "https://slickdeals.net/newsearch.php?q=Target&rss=1",
    retailerMatch: "target",
  },
  {
    name: "walmart",
    label: "Slickdeals: Walmart",
    type: "rss",
    url: "https://slickdeals.net/newsearch.php?q=Walmart&rss=1",
    retailerMatch: "walmart",
  },
  // Requested directly ("I also want deals for food and all others").
  // Slickdeals' 25-item cap on every RSS feed (confirmed live — no
  // parameter raises it) means less-frequent categories like food
  // already get crowded out of the generic Hot Deals firehose by
  // higher-volume ones; a dedicated search guarantees them their own
  // slice of visibility regardless. Checked for a dedicated grocery/food
  // deals site first (Krazy Coupon Lady, Groupon) — neither has a working
  // RSS feed (Krazy Coupon Lady's /feed/ just redirects to their
  // JS-rendered homepage; Groupon has none) — so this uses the same
  // keyword-search approach as PC Parts/Target/Walmart instead.
  {
    name: "food-grocery",
    label: "Slickdeals: Food & Grocery",
    type: "rss",
    urls: [
      "https://slickdeals.net/newsearch.php?q=grocery&rss=1",
      "https://slickdeals.net/newsearch.php?q=restaurant&rss=1",
    ],
  },
  // Broad, best-effort coverage of everything else — accepts more noise
  // than the more targeted sources above in exchange for breadth (same
  // tradeoff PC Parts already accepts for full-PC-bundle listings).
  // Unlike Target/Walmart, there's no single word to retailerMatch
  // against for a whole category, so this doesn't get that extra filter.
  {
    name: "more-categories",
    label: "Slickdeals: More Categories",
    type: "rss",
    urls: [
      "https://slickdeals.net/newsearch.php?q=clothing&rss=1",
      "https://slickdeals.net/newsearch.php?q=shoes&rss=1",
      "https://slickdeals.net/newsearch.php?q=kitchen&rss=1",
      "https://slickdeals.net/newsearch.php?q=toys&rss=1",
      "https://slickdeals.net/newsearch.php?q=beauty&rss=1",
      "https://slickdeals.net/newsearch.php?q=pet%20supplies&rss=1",
      "https://slickdeals.net/newsearch.php?q=travel&rss=1",
    ],
  },
  { name: "free-games-cheapshark", label: "CheapShark (free games)", type: "cheapshark" },
  { name: "free-games-epic", label: "Epic Games (free games)", type: "epic" },
  { name: "keepa", label: "Keepa (Amazon price drops)", type: "keepa" },
];
