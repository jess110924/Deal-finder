import crypto from "crypto";

export const AUTH_COOKIE = "df_session";

function getSecret(): string {
  const secret = process.env.SITE_PASSWORD;
  if (!secret) {
    throw new Error("SITE_PASSWORD is not set — required once this site is deployed publicly.");
  }
  return secret;
}

export function createSessionToken(): string {
  const payload = `ok:${Date.now()}`;
  const sig = crypto.createHmac("sha256", getSecret()).update(payload).digest("hex");
  return Buffer.from(`${payload}.${sig}`).toString("base64url");
}

export function verifySessionToken(token: string | undefined | null): boolean {
  if (!token) return false;
  try {
    const decoded = Buffer.from(token, "base64url").toString("utf8");
    const dot = decoded.lastIndexOf(".");
    if (dot === -1) return false;
    const payload = decoded.slice(0, dot);
    const sig = decoded.slice(dot + 1);
    const expected = crypto.createHmac("sha256", getSecret()).update(payload).digest("hex");
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}
