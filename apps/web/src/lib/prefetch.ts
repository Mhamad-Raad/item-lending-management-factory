import type { FetchQueryOptions, QueryClient, QueryKey } from '@tanstack/react-query';

/**
 * A route loader's prefetch (§7.8.3): the page's primary query is in the cache before the page
 * mounts, so opening a record from a list renders it without a skeleton.
 *
 * One attempt, without the client's retry backoff: the page's own query retries a failure before
 * showing its error state, and retrying here first would double that wait. A failure is swallowed
 * for the page to report, and a slow answer gives way to the router's pending skeleton.
 */
export async function prefetch<T, K extends QueryKey>(
  queryClient: QueryClient,
  options: FetchQueryOptions<T, Error, T, K>,
): Promise<void> {
  try {
    await queryClient.ensureQueryData({ ...options, retry: false });
  } catch {
    // Rendered by the page from its own query.
  }
}
