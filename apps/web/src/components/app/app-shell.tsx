import { LANGUAGES, type Language, type PermissionKey } from '@pallet/shared';
import { Link, useRouterState } from '@tanstack/react-router';
import {
  BarChart3,
  Boxes,
  Building2,
  ClipboardList,
  History,
  Languages,
  LayoutDashboard,
  Menu,
  Moon,
  Package,
  Settings,
  Sun,
  Truck,
  UserCircle,
  Users,
} from 'lucide-react';
import { LogOut } from '@/components/app/dir-icon';
import type { LucideIcon } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TranslationKey } from '@/i18n/keys';
import i18n from '@/i18n';
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
import { LANGUAGE_NATIVE_NAMES, setPreferences, usePreferences, useResolvedTheme } from '@/lib/preferences';
import { cn } from '@/lib/utils';

interface NavItem {
  to: string;
  labelKey: TranslationKey;
  icon: LucideIcon;
  /** Omitted for pages every signed-in user may open. */
  permission?: PermissionKey;
  /** Shown when the user holds any of these, as for the reports entry point (§7.2). */
  anyPermission?: readonly PermissionKey[];
  adminOnly?: boolean;
}

interface NavGroup {
  labelKey: TranslationKey;
  items: NavItem[];
}

/**
 * The navigation in the groups the factory works in: the day's work, the records it keeps, what it looks back on, and
 * administration. The account page is not listed: it lives in the user menu, next to signing out (§7.5).
 */
const NAV_GROUPS: NavGroup[] = [
  {
    labelKey: 'nav.groups.daily',
    items: [
      { to: '/', labelKey: 'nav.dashboard', icon: LayoutDashboard },
      { to: '/orders', labelKey: 'nav.orders', icon: ClipboardList, permission: 'orders.view' },
    ],
  },
  {
    labelKey: 'nav.groups.records',
    items: [
      { to: '/customers', labelKey: 'nav.customers', icon: Building2, permission: 'customers.view' },
      { to: '/items', labelKey: 'nav.items', icon: Package, permission: 'items.view' },
      { to: '/drivers', labelKey: 'nav.drivers', icon: Truck, permission: 'drivers.view' },
    ],
  },
  {
    labelKey: 'nav.groups.insight',
    items: [
      {
        to: '/reports',
        labelKey: 'nav.reports',
        icon: BarChart3,
        anyPermission: ['reports.viewPositions', 'reports.viewPurchases', 'reports.viewActivity', 'reports.viewStock'],
      },
      { to: '/history', labelKey: 'nav.history', icon: History, permission: 'audit.view' },
    ],
  },
  {
    labelKey: 'nav.groups.admin',
    items: [
      { to: '/users', labelKey: 'nav.users', icon: Users, adminOnly: true },
      // Every user's screen preferences live here; the factory details on it stay an admin's (Q50).
      { to: '/settings', labelKey: 'nav.settings', icon: Settings },
    ],
  },
];

function visible(item: NavItem, isAdmin: boolean): boolean {
  if (item.adminOnly) return isAdmin;
  if (item.anyPermission) return item.anyPermission.some((key) => authStore.can(key));
  return !item.permission || authStore.can(item.permission);
}

function NavLinks({ onNavigate }: { onNavigate?: () => void }) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const isActive = (to: string): boolean =>
    to === '/' ? pathname === '/' : pathname === to || pathname.startsWith(`${to}/`);
  const isAdmin = user?.role === 'ADMIN';

  return (
    <nav aria-label={t('nav.primary')} className="flex flex-1 flex-col gap-4 px-3 py-2">
      {NAV_GROUPS.map((group) => {
        const items = group.items.filter((item) => visible(item, isAdmin));
        if (items.length === 0) return null;
        return (
          <div key={group.labelKey} className="flex flex-col gap-1">
            <p className="text-muted-foreground px-3 pb-1 text-xs font-semibold tracking-wide uppercase">
              {t(group.labelKey)}
            </p>
            {items.map((item) => {
              const active = isActive(item.to);
              return (
                <Link
                  key={item.to}
                  to={item.to}
                  onClick={onNavigate}
                  aria-current={active ? 'page' : undefined}
                  className={cn(
                    'relative flex h-10 items-center gap-3 rounded-lg px-3 text-sm font-medium transition-colors md:h-9',
                    'focus-visible:ring-ring focus-visible:ring-offset-sidebar focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none',
                    active
                      ? 'bg-sidebar-accent text-sidebar-accent-foreground font-semibold'
                      : 'text-sidebar-foreground/80 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground',
                  )}
                >
                  {/* The current page is marked by more than its colour: a bar at the reading start (§7.15). */}
                  {active ? (
                    <span aria-hidden className="bg-primary absolute inset-y-2 start-0 w-1 rounded-full" />
                  ) : null}
                  <item.icon className={cn('size-4 shrink-0', active && 'text-primary')} aria-hidden />
                  <span className="truncate">{t(item.labelKey)}</span>
                </Link>
              );
            })}
          </div>
        );
      })}
    </nav>
  );
}

/** The name of the app with its mark, at the top of the sidebar and of the navigation sheet. */
function Brand() {
  const { t } = useTranslation();
  return (
    <span className="flex min-w-0 items-center gap-3">
      <span className="bg-primary text-primary-foreground flex size-9 shrink-0 items-center justify-center rounded-lg shadow-sm">
        <Boxes className="size-5" aria-hidden />
      </span>
      <span className="flex min-w-0 flex-col">
        <span className="truncate text-base leading-tight font-semibold">{t('common.appName')}</span>
        <span className="text-muted-foreground truncate text-xs font-normal">{t('common.appTagline')}</span>
      </span>
    </span>
  );
}

/** Who is signed in, their account page and signing out; a full-width row in the sidebar, an icon in the top bar. */
function UserMenu({ onLogout, compact }: { onLogout: () => void; compact?: boolean }) {
  const { t } = useTranslation();
  const { user } = useAuth();
  if (!user) return null;
  const role = t(`enums.role.${user.role}`);
  const initial = user.displayName.trim().charAt(0).toUpperCase() || '?';

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        {compact ? (
          <Button variant="ghost" size="icon" aria-label={user.displayName}>
            <UserCircle className="size-5" aria-hidden />
          </Button>
        ) : (
          <Button
            variant="ghost"
            className="hover:bg-sidebar-accent/60 h-auto w-full justify-start gap-3 px-2 py-2 text-start"
          >
            <span
              aria-hidden
              className="bg-primary/15 text-primary flex size-9 shrink-0 items-center justify-center rounded-full text-sm font-semibold"
            >
              {initial}
            </span>
            <span className="flex min-w-0 flex-col">
              {/* The block keeps the page's direction and alignment; only the name inside is isolated. */}
              <span className="truncate">
                <bdi>{user.displayName}</bdi>
              </span>
              <span className="text-muted-foreground truncate text-xs font-normal">{role}</span>
            </span>
          </Button>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" side={compact ? 'bottom' : 'top'} className="max-w-[calc(100vw-2rem)]">
        <DropdownMenuLabel className="flex flex-col">
          <span className="truncate font-medium">
            <bdi>{user.displayName}</bdi>
          </span>
          <span className="text-muted-foreground truncate text-xs">{role}</span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link to="/account">
            <UserCircle aria-hidden />
            {t('nav.account')}
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link to="/settings">
            <Settings aria-hidden />
            {t('nav.settings')}
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

/** Light or dark in one press; the full choice, with the colour theme and typeface, is on the settings page. */
function ThemeToggle() {
  const { t } = useTranslation();
  const resolved = useResolvedTheme();
  const next = resolved === 'dark' ? 'light' : 'dark';
  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label={t(next === 'dark' ? 'nav.useDark' : 'nav.useLight')}
      onClick={() => setPreferences({ theme: next })}
    >
      {resolved === 'dark' ? <Sun className="size-5" aria-hidden /> : <Moon className="size-5" aria-hidden />}
    </Button>
  );
}

function LanguageMenu() {
  const { t } = useTranslation();
  const { language: current } = usePreferences();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={t('nav.language')}>
          <Languages className="size-5" aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {LANGUAGES.map((language: Language) => (
          <DropdownMenuItem
            key={language}
            lang={language}
            aria-current={language === current ? 'true' : undefined}
            className={cn(language === current && 'text-primary font-semibold')}
            onSelect={() => {
              setPreferences({ language });
              void i18n.changeLanguage(language);
            }}
          >
            {LANGUAGE_NATIVE_NAMES[language]}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * The authenticated frame (§7.5): a fixed sidebar from `lg`, and a top bar at every width with the page title and
 * the quick light/dark and language switches; below `lg` its menu button opens the same navigation in a sheet.
 * Navigation is filtered by permission, so nobody is invited to a page they would be refused.
 */
export function AppShell({ children, onLogout }: { children: React.ReactNode; onLogout: () => void }) {
  const { t } = useTranslation();
  const titleKey = useCurrentPageTitleKey();
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <div className="bg-background min-h-dvh">
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

      <aside
        data-print="hide"
        className="bg-sidebar text-sidebar-foreground fixed inset-y-0 start-0 z-30 hidden w-64 flex-col border-e lg:flex"
      >
        <div className="flex h-16 shrink-0 items-center px-5">
          <Brand />
        </div>
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
          <NavLinks />
        </div>
        <div className="border-t p-2">
          <UserMenu onLogout={onLogout} />
        </div>
      </aside>

      <div className="flex min-h-dvh flex-col lg:ps-64 print:ps-0">
        <header
          data-print="hide"
          className="bg-background/85 sticky top-0 z-30 flex h-14 items-center gap-1 border-b px-2 backdrop-blur-md lg:px-8"
        >
          <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" aria-label={t('nav.openMenu')} className="lg:hidden">
                <Menu className="size-5" aria-hidden />
              </Button>
            </SheetTrigger>
            <SheetContent
              side="start"
              closeLabel={t('common.actions.close')}
              aria-describedby={undefined}
              className="bg-sidebar text-sidebar-foreground"
            >
              <SheetTitle className="flex h-16 shrink-0 items-center px-5">
                <Brand />
              </SheetTitle>
              <NavLinks onNavigate={() => setMenuOpen(false)} />
            </SheetContent>
          </Sheet>
          <span className="text-muted-foreground min-w-0 flex-1 truncate px-1 text-sm font-medium">
            {t(titleKey ?? 'common.appName')}
          </span>
          <LanguageMenu />
          <ThemeToggle />
          <span className="lg:hidden">
            <UserMenu onLogout={onLogout} compact />
          </span>
        </header>

        <main id="main" tabIndex={-1} className="flex-1 outline-none">
          <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
