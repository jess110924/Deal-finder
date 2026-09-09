import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Deal Finder",
  description: "Fast-scanning feed of deals aggregated from multiple free sources plus Keepa.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <header
          className="w-full px-6 py-3 flex items-center gap-6"
          style={{ borderBottom: "1px solid var(--border-hairline)" }}
        >
          <Link href="/" className="font-semibold" style={{ color: "var(--text-primary)" }}>
            Deal Finder
          </Link>
          <Link href="/cards" className="text-sm" style={{ color: "var(--text-secondary)" }}>
            Trading Cards
          </Link>
        </header>
        <main className="flex-1 flex flex-col">{children}</main>
      </body>
    </html>
  );
}
