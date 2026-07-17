/**
 * Runs `mapper` over `items` with at most `limit` in flight at once. Used anywhere a discovery
 * scan fans out per-repo GitLab API calls — unbounded `Promise.all` across dozens of repos (each
 * itself making several requests, e.g. a build-file fetch + a recursive tree listing + one fetch
 * per source file found) can burst into hundreds of simultaneous connections, which real GitLab
 * instances/corporate proxies throttle or drop — silently starving individual repos of results
 * rather than raising a visible error.
 */
export async function mapWithConcurrency<T, R>(items: T[], limit: number, mapper: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (true) {
      const index = nextIndex++;
      if (index >= items.length) return;
      results[index] = await mapper(items[index], index);
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}
