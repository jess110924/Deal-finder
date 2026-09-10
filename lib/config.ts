export type SourceConfig = {
  name: string;
  label: string;
  type: "rss" | "reddit" | "cheapshark" | "epic" | "keepa";
  url?: string; // rss, single feed
  urls?: string[]; // rss, multiple feeds merged + deduped into one source (see "PC Parts" below)
  subreddit?: string; // reddit only
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
  { name: "free-games-cheapshark", label: "CheapShark (free games)", type: "cheapshark" },
  { name: "free-games-epic", label: "Epic Games (free games)", type: "epic" },
  { name: "keepa", label: "Keepa (Amazon price drops)", type: "keepa" },
];
