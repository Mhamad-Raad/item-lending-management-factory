import { Outlet, createFileRoute } from '@tanstack/react-router';
import { useEffect } from 'react';
import { requireAuthenticated } from '@/lib/route-guards';

export const Route = createFileRoute('/_print')({
  beforeLoad: () => requireAuthenticated(),
  component: PrintLayout,
});

/** Print pages: no app shell, and always light — a dark theme must never reach paper (§7.16.1). */
function PrintLayout() {
  useEffect(() => {
    const root = document.documentElement;
    const wasDark = root.classList.contains('dark');
    const scheme = root.style.colorScheme;
    root.classList.remove('dark');
    root.style.colorScheme = 'light';
    return () => {
      if (wasDark) root.classList.add('dark');
      root.style.colorScheme = scheme;
    };
  }, []);

  return <Outlet />;
}
