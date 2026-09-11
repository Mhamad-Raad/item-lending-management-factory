import { QueryClient } from '@tanstack/react-query';
import { ApiError } from './api-error';

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
