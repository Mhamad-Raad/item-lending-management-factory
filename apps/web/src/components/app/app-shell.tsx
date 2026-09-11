import type { PermissionKey } from '@pallet/shared';
import { Link, useRouterState } from '@tanstack/react-router';
import { History, LayoutDashboard, LogOut, UserCircle, Users } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { authStore, useAuth } from '@/lib/auth';
import { cn } from '@/lib/utils';

interface NavItem {
  to: string;
  labelKey: string;
  icon: LucideIcon;
  /** Omitted for pages every signed-in user may open. */
  permission?: PermissionKey;
  adminOnly?: boolean;
}

/** Milestones after M1 add their entries here; the filtering below needs no change. */
const NAV_ITEMS: NavItem[] = [
  { to: '/', labelKey: 'nav.dashboard', icon: LayoutDashboard },
  { to: '/history', labelKey: 'nav.history', icon: History, permission: 'audit.view' },
  { to: '/users', labelKey: 'nav.users', icon: Users, adminOnly: true },
  { to: '/account', labelKey: 'nav.account', icon: UserCircle },
];

function visibleItems(isAdmin: boolean): NavItem[] {
  return NAV_ITEMS.filter((item) => {
    if (item.adminOnly) return isAdmin;
    return !item.permission || authStore.can(item.permission);
  });
}

/**
 * The authenticated frame: a sidebar on a wide screen, a bottom bar on a phone. Navigation is
 * filtered by permission, so nobody is invited to a page they would be refused.
 */
export function AppShell({ children, onLogout }: { children: React.ReactNode; onLogout: () => void }) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const items = visibleItems(user?.role === 'ADMIN');

  const isActive = (to: string): boolean => (to === '/' ? pathname === '/' : pathname.startsWith(to));

  return (
    <div className="bg-muted/30 flex min-h-dvh flex-col md:flex-row">
      <aside className="bg-card hidden w-60 shrink-0 flex-col border-e md:flex">
        <div className="flex h-14 items-center px-4 text-lg font-semibold">{t('common.appName')}</div>
        <nav aria-label={t('nav.primary')} className="flex flex-1 flex-col gap-1 p-2">
          {items.map((item) => (
            <Link
              key={item.to}
              to={item.to}
              className={cn(
                'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                isActive(item.to) ? 'bg-primary text-primary-foreground' : 'hover:bg-accent',
              )}
              aria-current={isActive(item.to) ? 'page' : undefined}
            >
              <item.icon className="size-4" aria-hidden />
              {t(item.labelKey)}
            </Link>
          ))}
        </nav>
        <div className="flex flex-col gap-2 border-t p-3">
          <span className="truncate text-sm font-medium">{user?.displayName}</span>
          <Button variant="outline" size="sm" onClick={onLogout} className="justify-start">
            <LogOut className="size-4" aria-hidden />
            {t('nav.logout')}
          </Button>
        </div>
      </aside>

      <main className="flex-1 pb-20 md:pb-0">{children}</main>

      <nav
        aria-label={t('nav.primary')}
        className="bg-card fixed inset-x-0 bottom-0 z-40 flex justify-around border-t py-1 md:hidden"
      >
        {items.map((item) => (
          <Link
            key={item.to}
            to={item.to}
            className={cn(
              'flex min-w-16 flex-col items-center gap-1 rounded-md px-3 py-2 text-xs font-medium',
              isActive(item.to) ? 'text-primary' : 'text-muted-foreground',
            )}
            aria-current={isActive(item.to) ? 'page' : undefined}
          >
            <item.icon className="size-5" aria-hidden />
            {t(item.labelKey)}
          </Link>
        ))}
      </nav>
    </div>
  );
}
