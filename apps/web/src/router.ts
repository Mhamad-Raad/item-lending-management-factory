import { createRouter } from '@tanstack/react-router';
import { RouteError } from '@/components/app/route-error';
import { createQueryClient } from '@/lib/query-client';
import { routeTree } from './routeTree.gen';

export const queryClient = createQueryClient();

export const router = createRouter({
  routeTree,
  context: { queryClient },
  // TanStack resolves `errorComponent` per match and does not walk up the tree, so a guard that
  // throws in a child route only reaches this one as the router-wide default.
  defaultErrorComponent: RouteError,
  defaultPreload: 'intent',
  defaultPendingMs: 150,
  defaultPendingMinMs: 300,
  scrollRestoration: true,
});

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
