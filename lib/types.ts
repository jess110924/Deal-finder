export type Deal = {
  id: string;
  source: string; // config name, e.g. "freebies", "reddit-deals", "keepa"
  title: string;
  link: string;
  description?: string | null;
  pubDate: string | null; // ISO string
  creator?: string | null;
  discountPercent?: number | null;
  price?: number | null; // dollars
  originalPrice?: number | null; // dollars
  isStackable?: boolean; // Subscribe & Save / coupon-stacking style deal — see lib/stackable.ts
};

export type RawDeal = Omit<Deal, "source" | "isStackable">;
