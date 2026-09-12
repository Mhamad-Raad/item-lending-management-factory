import type { PermissionKey } from '@pallet/shared';
import { Link, useRouterState } from '@tanstack/react-router';
import {
  Building2,
  ClipboardList,
  History,
  LayoutDashboard,
  LogOut,
  Menu,
  Package,
  Settings,
  Truck,
  UserCircle,
  Users,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { useCurrentPageTitleKey } from '@/hooks/use-page-title';
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

/**
 * Later milestones add their entries here; the filtering and both layouts need no change. The
 * account page is not listed: it lives in the user menu, next to signing out (§7.5).
 */
const NAV_ITEMS: NavItem[] = [
  { to: '/', labelKey: 'nav.dashboard', icon: LayoutDashboard },
  { to: '/orders', labelKey: 'nav.orders', icon: ClipboardList, permission: 'orders.view' },
  { to: '/customers', labelKey: 'nav.customers', icon: Building2, permission: 'customers.view' },
  { to: '/items', labelKey: 'nav.items', icon: Package, permission: 'items.view' },
  { to: '/drivers', labelKey: 'nav.drivers', icon: Truck, permission: 'drivers.view' },
  { to: '/history', labelKey: 'nav.history', icon: History, permission: 'audit.view' },
  { to: '/users', labelKey: 'nav.users', icon: Users, adminOnly: true },
  { to: '/settings', labelKey: 'nav.settings', icon: Settings, adminOnly: true },
];

function visibleItems(isAdmin: boolean): NavItem[] {
  return NAV_ITEMS.filter((item) => {
    if (item.adminOnly) return isAdmin;
    return !item.permission || authStore.can(item.permission);
  });
}

function NavLinks({ onNavigate }: { onNavigate?: () => void }) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const isActive = (to: string): boolean =>
    to === '/' ? pathname === '/' : pathname === to || pathname.startsWith(`${to}/`);

  return (
    <nav aria-label={t('nav.primary')} className="flex flex-1 flex-col gap-1 p-2">
      {visibleItems(user?.role === 'ADMIN').map((item) => {
        const active = isActive(item.to);
        return (
          <Link
            key={item.to}
            to={item.to}
            onClick={onNavigate}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'flex h-10 items-center gap-3 rounded-md px-3 text-sm font-medium transition-colors md:h-9',
              'focus-visible:ring-ring focus-visible:ring-offset-background focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none',
              active
                ? 'bg-accent text-accent-foreground font-semibold'
                : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground',
            )}
          >
            <item.icon className="size-4 shrink-0" aria-hidden />
            <span className="truncate">{t(item.labelKey)}</span>
          </Link>
        );
      })}
    </nav>
  );
}

/** Who is signed in, their account page and signing out; a full-width row in the sidebar, an icon in the top bar. */
function UserMenu({ onLogout, compact }: { onLogout: () => void; compact?: boolean }) {
  const { t } = useTranslation();
  const { user } = useAuth();
  if (!user) return null;
  const role = t(`enums.role.${user.role}`);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        {compact ? (
          <Button variant="ghost" size="icon" className="size-10" aria-label={user.displayName}>
            <UserCircle className="size-5" aria-hidden />
          </Button>
        ) : (
          <Button variant="ghost" className="h-auto w-full justify-start gap-3 px-3 py-2 text-start">
            <UserCircle className="size-5" aria-hidden />
            <span className="flex min-w-0 flex-col">
              <span className="truncate">{user.displayName}</span>
              <span className="text-muted-foreground truncate text-xs font-normal">{role}</span>
            </span>
          </Button>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" side={compact ? 'bottom' : 'top'} className="max-w-[calc(100vw-2rem)]">
        <DropdownMenuLabel className="flex flex-col">
          <span className="truncate font-medium">{user.displayName}</span>
          <span className="text-muted-foreground truncate text-xs">{role}</span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link to="/account">
            <UserCircle aria-hidden />
            {t('nav.account')}
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={onLogout}>
          <LogOut aria-hidden />
          {t('nav.logout')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * The authenticated frame (§7.5): a fixed sidebar from `lg`; below it a top bar with the page title,
 * whose menu button opens the same navigation in a sheet. Navigation is filtered by permission, so
 * nobody is invited to a page they would be refused.
 */
export function AppShell({ children, onLogout }: { children: React.ReactNode; onLogout: () => void }) {
  const { t } = useTranslation();
  const titleKey = useCurrentPageTitleKey();
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <div className="bg-muted/30 min-h-dvh">
      <a
        href="#main"
        className="bg-background focus-visible:ring-ring sr-only z-[60] rounded-md border px-4 py-2 text-sm font-medium focus:not-sr-only focus:fixed focus:start-2 focus:top-2 focus-visible:ring-2 focus-visible:outline-none"
        onClick={(event) => {
          // Moves focus without writing `#main` into the address the router owns.
          event.preventDefault();
          document.getElementById('main')?.focus();
        }}
      >
        {t('nav.skipToContent')}
      </a>

      <aside className="bg-card fixed inset-y-0 start-0 z-30 hidden w-64 flex-col border-e lg:flex">
        <div className="flex h-14 shrink-0 items-center px-5 text-lg font-semibold">{t('common.appName')}</div>
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
          <NavLinks />
        </div>
        <div className="border-t p-2">
          <UserMenu onLogout={onLogout} />
        </div>
      </aside>

      <div className="flex min-h-dvh flex-col lg:ps-64">
        <header className="bg-card sticky top-0 z-30 flex h-14 items-center gap-1 border-b px-2 lg:hidden">
          <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" className="size-10" aria-label={t('nav.openMenu')}>
                <Menu className="size-5" aria-hidden />
              </Button>
            </SheetTrigger>
            <SheetContent side="start" closeLabel={t('common.actions.close')} aria-describedby={undefined}>
              <SheetTitle className="flex h-14 shrink-0 items-center px-5 text-lg font-semibold">
                {t('common.appName')}
              </SheetTitle>
              <NavLinks onNavigate={() => setMenuOpen(false)} />
            </SheetContent>
          </Sheet>
          <span className="min-w-0 flex-1 truncate px-1 font-semibold">{t(titleKey ?? 'common.appName')}</span>
          <UserMenu onLogout={onLogout} compact />
        </header>

        <main id="main" tabIndex={-1} className="flex-1 outline-none">
          <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8">{children}</div>
        </main>
      </div>
    </div>
  );
}
