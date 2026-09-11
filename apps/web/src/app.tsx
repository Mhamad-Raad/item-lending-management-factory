import { useEffect, useState } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import { MotionConfig } from 'motion/react';
import { Direction } from 'radix-ui';
import { Skeleton } from '@/components/ui/skeleton';
import { VersionConflictDialog } from '@/components/app/version-conflict-dialog';
import { Toaster } from '@/components/ui/sonner';
import { setSessionEndedHandler } from '@/lib/api-client';
import { bootstrapAuth, useAuth } from '@/lib/auth';
import { isRtl, usePreferences } from '@/lib/preferences';
import { queryClient, router } from './router';

/** Shown while the refresh cookie is exchanged for a session: no spinner, just the page shape. */
function BootScreen() {
  return (
    <div className="mx-auto flex min-h-dvh max-w-6xl flex-col gap-4 p-6" aria-busy="true">
      <Skeleton className="h-10 w-48" />
      <Skeleton className="h-40 w-full" />
    </div>
  );
}

export function App() {
  const { language } = usePreferences();
  const { status } = useAuth();
  const [booted, setBooted] = useState(false);

  useEffect(() => {
    // A 401 that survives a refresh means the session is gone: drop cached data and send the user
    // to the login page with the address they were on (§7.7.2).
    setSessionEndedHandler(() => {
      queryClient.clear();
      void router.navigate({ to: '/login', search: { redirect: window.location.pathname + window.location.search } });
    });

    // One bootstrap per page load; the router only mounts once the session is known, so a guard
    // never sees `booting` and bounces an authenticated user to the login page.
    void bootstrapAuth().finally(() => setBooted(true));
  }, []);

  return (
    <Direction.Provider dir={isRtl(language) ? 'rtl' : 'ltr'}>
      <QueryClientProvider client={queryClient}>
        <MotionConfig reducedMotion="user">
          {booted && status !== 'booting' ? <RouterProvider router={router} /> : <BootScreen />}
          <VersionConflictDialog />
          <Toaster />
        </MotionConfig>
      </QueryClientProvider>
    </Direction.Provider>
  );
}
