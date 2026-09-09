import type { RawDeal } from "@/lib/types";

const USER_AGENT = "web:deal-finder:v1.0 (by /u/deal-finder-app)"; // Reddit requires a descriptive, unique User-Agent

/**
 * Reddit blocks (403) or aggressively rate-limits (429) anonymous/scraper
 * traffic from cloud hosting IP ranges — exactly what a Vercel serverless
 * function looks like to them, regardless of request volume. Their own
 * OAuth API (client_credentials grant, confirmed against their official
 * OAuth2 wiki doc) gets treated far more reliably even from the same IP,
 * since it's a legitimate authenticated API call rather than RSS scraping.
 * No Reddit user account/password needed — this is app-only, read-only
 * access, verified as supported for a "script"-type app used this way.
 */

let cachedToken: { token: string; expiresAt: number } | null = null;

async function getAccessToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) {
    return cachedToken.token;
  }

  const clientId = process.env.REDDIT_CLIENT_ID;
  const clientSecret = process.env.REDDIT_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error("REDDIT_CLIENT_ID / REDDIT_CLIENT_SECRET are not set.");
  }

  const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
  const res = await fetch("https://www.reddit.com/api/v1/access_token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${basicAuth}`,
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": USER_AGENT,
    },
    body: "grant_type=client_credentials",
    cache: "no-store", // token endpoint itself must never be cached
  });

  if (!res.ok) {
    throw new Error(`Reddit token request failed: ${res.status} ${res.statusText}`);
  }

  const json = await res.json();
  if (!json.access_token) {
    throw new Error(`Reddit token response missing access_token: ${JSON.stringify(json)}`);
  }

  cachedToken = { token: json.access_token, expiresAt: Date.now() + json.expires_in * 1000 };
  return cachedToken.token;
}

type RedditPost = {
  name: string;
  title: string;
  permalink: string;
  author: string;
  created_utc: number;
  selftext?: string;
  thumbnail?: string;
  preview?: { images?: { source?: { url?: string } }[] };
};

function extractImage(post: RedditPost): string | null {
  if (post.thumbnail && post.thumbnail.startsWith("http")) {
    return post.thumbnail;
  }
  const previewUrl = post.preview?.images?.[0]?.source?.url;
  return previewUrl ? previewUrl.replace(/&amp;/g, "&") : null;
}

export async function fetchDeals(subreddit: string): Promise<RawDeal[]> {
  const token = await getAccessToken();

  const res = await fetch(`https://oauth.reddit.com/r/${subreddit}/new?limit=25`, {
    headers: {
      Authorization: `bearer ${token}`,
      "User-Agent": USER_AGENT,
    },
    next: { revalidate: 600 },
  });

  if (!res.ok) {
    throw new Error(`Reddit request failed: ${res.status} ${res.statusText}`);
  }

  const json = await res.json();
  const posts: RedditPost[] = (json?.data?.children ?? []).map((c: { data: RedditPost }) => c.data);

  return posts.map((post) => ({
    id: post.name,
    title: post.title,
    link: `https://www.reddit.com${post.permalink}`,
    description: post.selftext ? post.selftext.slice(0, 300) : null,
    imageUrl: extractImage(post),
    pubDate: post.created_utc ? new Date(post.created_utc * 1000).toISOString() : null,
    creator: post.author || null,
    discountPercent: null,
    price: null,
    originalPrice: null,
  }));
}
