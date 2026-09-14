import { Outlet, createFileRoute } from '@tanstack/react-router';
import { useEffect } from 'react';
import { applyPreferences, getPreferences } from '@/lib/preferences';
import { requireAuthenticated } from '@/lib/route-guards';

export const Route = createFileRoute('/_print')({
  beforeLoad: () => requireAuthenticated(),
  component: PrintLayout,
});

/** Print pages: no app shell, and always light — a dark theme must never reach paper (§7.16.1). */
function PrintLayout() {
  useEffect(() => {
    const root = document.documentElement;
    // Marked, so a theme set to follow the device cannot turn the page dark again while it is open.
    root.dataset.forceLight = 'true';
    applyPreferences(getPreferences());
    return () => {
      delete root.dataset.forceLight;
      applyPreferences(getPreferences());
    };
  }, []);

  return <Outlet />;
}
