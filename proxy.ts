import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { AUTH_COOKIE, verifySessionToken } from "@/lib/auth";

// Protects the whole site (including /api/deals) behind a single shared
// password. This matters here specifically because /api/deals calls a
// paid, token-limited API (Keepa) on every hit — an unprotected public URL
// could burn through that budget just from bots/crawlers finding it.
export function proxy(request: NextRequest) {
  if (request.nextUrl.pathname === "/login") {
    return NextResponse.next();
  }

  // Called by a scheduled GitHub Actions workflow, not a browser — it has
  // no session cookie to present, so it's excluded from the cookie gate
  // here and instead checks its own bearer-style secret independently
  // (see app/api/cards/check-watchlist/route.ts).
  if (request.nextUrl.pathname === "/api/cards/check-watchlist") {
    return NextResponse.next();
  }

  // If no password is configured (e.g. local dev), don't lock the owner out.
  if (!process.env.SITE_PASSWORD) {
    return NextResponse.next();
  }

  const token = request.cookies.get(AUTH_COOKIE)?.value;
  if (!verifySessionToken(token)) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
