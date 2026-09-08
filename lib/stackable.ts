// Detects the specific deal shape the user confirmed as their target case:
// a SheaMoisture body wash at 89¢ via a Subscribe & Save discount stacked
// on top of an on-page "clip coupon" / checkbox discount. Keyword-based
// against title + description — simple and transparent, easy to extend if
// real results miss something or catch too much noise.
const STACKABLE_PATTERNS = [
  /\bs\s?&\s?s\b/i, // "S&S", "S & S"
  /subscribe\s*(&|and)\s*save/i,
  /\bclip(ped)?\s+(the\s+)?coupon/i,
  /\bcheck\s?box\s+(coupon|discount)/i,
  /\bstack(able|ing)?\b.*\b(coupon|discount|deal|save|s&s)/i,
  /\b\d{1,2}%\s*off\s+coupon\b.*\b(s&s|subscribe)/i,
];

export function isStackableDeal(title: string, description?: string | null): boolean {
  const text = `${title} ${description ?? ""}`;
  return STACKABLE_PATTERNS.some((re) => re.test(text));
}
