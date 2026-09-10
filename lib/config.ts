export type SourceConfig = {
  name: string;
  label: string;
  type: "rss" | "reddit" | "cheapshark" | "epic" | "keepa";
  url?: string; // rss only
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
  // Both confirmed live before adding: real, currently-active RSS 2.0
  // feeds with genuine deal content and working images (verified through
  // the actual fetchDeals() parsing logic, not just that the URL 200s).
  { name: "dealnews", label: "DealNews", type: "rss", url: "https://www.dealnews.com/?rss=1&sort=time" },
  { name: "9to5toys", label: "9to5Toys", type: "rss", url: "https://9to5toys.com/deals/feed/" },
  { name: "free-games-cheapshark", label: "CheapShark (free games)", type: "cheapshark" },
  { name: "free-games-epic", label: "Epic Games (free games)", type: "epic" },
  { name: "keepa", label: "Keepa (Amazon price drops)", type: "keepa" },
];
