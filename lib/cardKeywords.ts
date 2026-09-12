// Feeding a full, messy eBay title into PriceCharting's (or eBay's own)
// search frequently returns the wrong product — confirmed live in two
// separate ways: PriceCharting matching a rare autographed jersey against
// an unrelated $6.50 base card, and eBay's own search returning a $2.25
// "Blue Shimmer Prizm" as a "peer" of a "Gold Wave Prizms" card just
// because both titles mention "Prizm". A short, deliberate query built
// from just the subject + the color/finish words that actually identify
// the specific parallel + the serial number cuts through this — reported
// live example: "Jalen Johnson 2025-26 Topps Chrome ORANGE Leather
// Refractor /25 Serial Numbered" -> "Jalen Johnson orange refractor /25".

// "mint" deliberately excluded — it's an extremely common condition term
// ("Near Mint", "Gem Mint") that would falsely match as a color on a huge
// fraction of listings, unrelated to any actual "Mint" parallel.
const COLOR_WORDS = [
  "red", "white", "blue", "orange", "yellow", "green", "purple", "pink", "black", "silver", "gold",
  "teal", "bronze", "copper", "magenta", "lime", "navy", "maroon", "sky", "aqua", "crimson", "emerald",
  "sapphire", "ruby", "amber", "violet", "indigo", "coral", "rose", "charcoal", "platinum",
  "rainbow", "camo", "clear", "cosmic", "galaxy", "neon",
];

const FINISH_WORDS = [
  "refractor", "prizm", "wave", "shimmer", "pulsar", "mojo", "scope", "disco", "velocity",
  "mosaic", "holo", "cracked ice", "sparkle", "laser", "checker", "fusion", "kaboom",
  "fast break", "dragon", "tie-dye", "tiedye", "pandora", "hyper",
];

/** Pulls a print-run denominator like "/150" out of a title, or null if there isn't one. */
export function extractSerialDenominator(title: string): string | null {
  const m = title.match(/\/(\d{1,4})\b/);
  return m ? `/${m[1]}` : null;
}

// A "lot of 5" (or similar bundle) listing's price covers multiple cards,
// not the one being searched for — comparing its total price against a
// single-card reference price is meaningless, not just ungraded-vs-graded
// mismatched. Caught this from a real result: a 5-card lot spanning three
// different products (Hoops, Chronicles, Prizm Emergent) at $350 sitting
// in results for a Prizm-only search, condition "New" so the grading
// filter didn't (and shouldn't have) caught it. Lives here (not
// cardComparison.ts) so both cardComparison.ts and lib/soldComps.ts can
// use it without an import cycle between the two.
const LOT_PATTERN = /\b(lot of|lot\/|\(\d+\)|\d+[- ]card lot|bundle)\b/i;

export function isBundle(title: string): boolean {
  return LOT_PATTERN.test(title);
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Word-boundary matching, not a plain substring check — confirmed live
// this matters: "Serial Numbered" contains the literal substring "red"
// (numbe-RED), which a naive .includes() falsely matched as the color
// "red" on every single listing carrying that boilerplate phrase.
//
// Finish words get an optional trailing "s" ("Prizms", plural, is
// extremely common) — colors don't, since pluralizing a color risks
// matching a team name instead (e.g. "Blues" as in the St. Louis Blues,
// a real listing possibility since Sports Trading Cards spans hockey too).
function findKeepWords(title: string, list: string[], allowPlural = false): string[] {
  const lower = title.toLowerCase();
  const suffix = allowPlural ? "s?" : "";
  return list.filter((word) => new RegExp(`\\b${escapeRegExp(word)}${suffix}\\b`).test(lower));
}

// Manufacturer names only — never a real subject, but can legitimately
// sit right before the year in a title ("Panini 2024-25 Noir..."),
// which guessLeadingSubject would otherwise happily hand back as the
// "subject". Confirmed live this is a real, serious failure mode, not
// theoretical: "Panini 2024-25 Noir Shadow Signatures Jalen Johnson
// Hawks SHA-JJO Auto 58/99" guessed "Panini" as the subject, producing
// the query "Panini /99" — every actual identifying word (the player)
// gone — which matched a completely unrelated Josh Allen card.
const BRAND_WORDS = new Set(["panini", "topps", "bowman", "donruss", "leaf", "upper", "deck", "score", "fleer"]);

/**
 * Best-effort only, used when the caller doesn't already know the
 * subject (e.g. Discover, which has nothing but a raw eBay title to work
 * from): takes the run of words before the first year or serial number,
 * if short enough to plausibly just be a name. Real titles are
 * inconsistently ordered — some start with the player, some with the
 * year — so this often can't tell, and returns null rather than guess
 * wrong. Callers that already know the subject (Player Search, which has
 * the name right from the search box) should always pass it instead.
 */
function guessLeadingSubject(title: string): string | null {
  const yearMatch = title.match(/\b(19|20)\d{2}(-\d{2})?\b/);
  const slashIndex = title.indexOf("/");
  const cutoff = yearMatch ? yearMatch.index! : slashIndex >= 0 ? slashIndex : -1;
  if (cutoff > 3) {
    const lead = title.slice(0, cutoff).replace(/[-–—]/g, " ").trim();
    const words = lead.split(/\s+/).filter(Boolean);
    // Reject only when EVERY word is a known brand name (just "Panini"
    // alone) — a mixed lead ("Panini Jalen Johnson", say) still has a
    // real word to go on, so it's kept as before.
    const allBrandWords = words.length > 0 && words.every((w) => BRAND_WORDS.has(w.toLowerCase()));
    if (lead && words.length <= 4 && !allBrandWords) return lead;
  }
  return null;
}

/**
 * Rewrites a raw eBay title into a short, targeted search query: subject
 * + whatever color/finish words identify the specific parallel + serial
 * number, dropping year/brand/set noise. Only activates when there's an
 * actual parallel/serial signal to preserve — for a plain base card
 * there's nothing to disambiguate, and the full title (already validated
 * to work fine elsewhere in this app) is safer than guessing a subject
 * and accidentally dropping the year/set that base card actually needs.
 * Returns the original title unchanged whenever it can't confidently do
 * better, rather than risk making the query worse.
 */
export function extractSearchKeywords(title: string, knownSubject?: string | null): string {
  const colorMatches = findKeepWords(title, COLOR_WORDS);
  const finishMatches = findKeepWords(title, FINISH_WORDS, true);
  const serial = extractSerialDenominator(title);

  if (colorMatches.length === 0 && finishMatches.length === 0 && !serial) {
    return title;
  }

  const subject = knownSubject ?? guessLeadingSubject(title);
  if (!subject) return title;

  const parts = [subject, ...colorMatches, ...finishMatches, serial].filter((p): p is string => Boolean(p));
  return parts.join(" ");
}
