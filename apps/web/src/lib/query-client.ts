import { QueryClient } from '@tanstack/react-query';
import { ApiError } from './api-error';
import { authStore } from './auth-store';

/** A 4xx is the server's considered answer; retrying it only wastes a round trip. */
function retry(failureCount: number, error: unknown): boolean {
  if (error instanceof ApiError && error.status >= 400 && error.status < 500) return false;
  return failureCount < 2;
}

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { staleTime: 30_000, gcTime: 5 * 60_000, refetchOnWindowFocus: true, retry },
      mutations: { retry: 0 },
    },
  });
}

/**
 * Drops every cached response whenever the session ends — sign-out, sign-out everywhere, or a
 * session the server refused — so whoever signs in next at the same screen never sees the last
 * person's data. Returns the unsubscribe function.
 */
export function clearCacheOnSignOut(queryClient: QueryClient): () => void {
  return authStore.subscribe(() => {
    if (authStore.getSnapshot().status === 'anonymous') queryClient.clear();
  });
}

/**
 * For the record behind an edit form, which is keyed by the record's version: a refetch when the tab regains focus or
 * the network returns would remount the form and wipe what the user is typing. The record is read when the page opens
 * and after the user's own save; a save on a version someone else has moved meets the version-conflict dialog.
 */
export const WHILE_EDITING = { refetchOnWindowFocus: false, refetchOnReconnect: false } as const;
