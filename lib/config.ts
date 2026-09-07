export type SourceConfig = {
  name: string;
  label: string;
  type: "rss" | "cheapshark" | "epic" | "keepa";
  url?: string;
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
  { name: "reddit-deals", label: "r/deals", type: "rss", url: "https://www.reddit.com/r/deals/new/.rss" },
  { name: "reddit-gamedeals", label: "r/GameDeals", type: "rss", url: "https://www.reddit.com/r/GameDeals/new/.rss" },
  {
    name: "reddit-buildapcsales",
    label: "r/buildapcsales",
    type: "rss",
    url: "https://www.reddit.com/r/buildapcsales/new/.rss",
  },
  { name: "dansdeals", label: "DansDeals", type: "rss", url: "https://www.dansdeals.com/feed/" },
  { name: "free-games-cheapshark", label: "CheapShark (free games)", type: "cheapshark" },
  { name: "free-games-epic", label: "Epic Games (free games)", type: "epic" },
  { name: "keepa", label: "Keepa (Amazon price drops)", type: "keepa" },
];
