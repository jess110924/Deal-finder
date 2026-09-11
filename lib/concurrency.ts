/**
 * Runs `fn` over `items` with at most `concurrency` in flight at once —
 * parallel, but capped. Fully sequential (one at a time) is too slow for
 * anything checking more than a handful of listings against PriceCharting
 * (confirmed live: it was slow enough to blow past Vercel's serverless
 * function timeout outright); fully unbounded concurrency risks looking
 * like abusive traffic to PriceCharting's API instead. A small fixed
 * number of workers pulling from a shared queue is the middle ground.
 */
export async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let nextIndex = 0;
  async function worker() {
    while (nextIndex < items.length) {
      const i = nextIndex++;
      results[i] = await fn(items[i]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return results;
}
