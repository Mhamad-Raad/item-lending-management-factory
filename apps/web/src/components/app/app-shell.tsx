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
import { LogOut, PanelLeftClose, PanelLeftOpen } from '@/components/app/dir-icon';
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
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { useCurrentPageTitleKey } from '@/hooks/use-page-title';
import { authStore, useAuth } from '@/lib/auth';
import { LANGUAGE_NATIVE_NAMES, isRtl, setPreferences, usePreferences, useResolvedTheme } from '@/lib/preferences';
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

/**
 * A label for a control the collapsed sidebar shows as an icon alone: at the reading end, on hover and on
 * focus. The control keeps its accessible name itself (`sr-only` text or `aria-label`), so the tip is for eyes only.
 */
function SidebarTip({ label, children }: { label: string; children: React.ReactElement }) {
  const rtl = isRtl(usePreferences().language);
  const side = rtl ? 'left' : 'right'; // rtl-ok: the reading end, chosen by direction
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side={side} sideOffset={16}>
        {label}
      </TooltipContent>
    </Tooltip>
  );
}

function NavLinks({ onNavigate, collapsed = false }: { onNavigate?: () => void; collapsed?: boolean }) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const isActive = (to: string): boolean =>
    to === '/' ? pathname === '/' : pathname === to || pathname.startsWith(`${to}/`);
  const isAdmin = user?.role === 'ADMIN';
  const groups = NAV_GROUPS.map((group) => ({
    ...group,
    items: group.items.filter((item) => visible(item, isAdmin)),
  })).filter((group) => group.items.length > 0);

  return (
    <nav
      aria-label={t('nav.primary')}
      className={cn('flex flex-1 flex-col gap-4 py-2', collapsed ? 'items-center px-2' : 'px-3')}
    >
      {groups.map((group, index) => (
        <div key={group.labelKey} className={cn('flex flex-col gap-1', collapsed && 'items-center')}>
          {collapsed ? (
            <>
              {/* Collapsed, a group keeps its name for screen readers and shows a rule where the next one starts. */}
              {index > 0 ? <span aria-hidden className="bg-border mb-1 h-px w-8 rounded-full" /> : null}
              <p className="sr-only">{t(group.labelKey)}</p>
            </>
          ) : (
            <p className="text-muted-foreground px-3 pb-1 text-xs font-semibold tracking-wide uppercase">
              {t(group.labelKey)}
            </p>
          )}
          {group.items.map((item) => {
            const active = isActive(item.to);
            const label = t(item.labelKey);
            const link = (
              <Link
                key={item.to}
                to={item.to}
                onClick={onNavigate}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'relative flex items-center rounded-lg text-sm font-medium transition-colors',
                  collapsed ? 'size-10 justify-center' : 'h-10 gap-3 px-3 md:h-9',
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
                <span className={collapsed ? 'sr-only' : 'truncate'}>{label}</span>
              </Link>
            );
            return collapsed ? (
              <SidebarTip key={item.to} label={label}>
                {link}
              </SidebarTip>
            ) : (
              link
            );
          })}
        </div>
      ))}
    </nav>
  );
}

/** Reduces the desktop sidebar to its icons and back; the choice is kept with the other screen preferences (Q51). */
function SidebarToggle({ collapsed }: { collapsed: boolean }) {
  const { t } = useTranslation();
  const label = t(collapsed ? 'nav.expandSidebar' : 'nav.collapseSidebar');
  const Icon = collapsed ? PanelLeftOpen : PanelLeftClose;
  const button = (
    <Button
      variant="ghost"
      aria-label={label}
      aria-expanded={!collapsed}
      aria-controls="sidebar"
      className={cn(
        'text-sidebar-foreground/80 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground',
        collapsed ? 'size-10 px-0' : 'h-9 w-full justify-start gap-3 px-3',
      )}
      onClick={() => setPreferences({ sidebarCollapsed: !collapsed })}
    >
      <Icon className="size-4 shrink-0" aria-hidden />
      {collapsed ? null : <span className="truncate">{label}</span>}
    </Button>
  );
  return collapsed ? <SidebarTip label={label}>{button}</SidebarTip> : button;
}

/** The name of the app with its mark, at the top of the sidebar and of the navigation sheet. */
function Brand({ collapsed = false }: { collapsed?: boolean }) {
  const { t } = useTranslation();
  return (
    <span className="flex min-w-0 items-center gap-3">
      <span className="bg-primary text-primary-foreground flex size-9 shrink-0 items-center justify-center rounded-lg shadow-sm">
        <Boxes className="size-5" aria-hidden />
      </span>
      <span className={cn('flex min-w-0 flex-col', collapsed && 'sr-only')}>
        <span className="truncate text-base leading-tight font-semibold">{t('common.appName')}</span>
        <span className="text-muted-foreground truncate text-xs font-normal">{t('common.appTagline')}</span>
      </span>
    </span>
  );
}

/**
 * Who is signed in, their account page and signing out; a full-width row in the sidebar (their initial alone when
 * it is collapsed), an icon in the top bar.
 */
function UserMenu({ onLogout, compact, collapsed }: { onLogout: () => void; compact?: boolean; collapsed?: boolean }) {
  const { t } = useTranslation();
  const { user } = useAuth();
  if (!user) return null;
  const role = t(`enums.role.${user.role}`);
  const initial = user.displayName.trim().charAt(0).toUpperCase() || '?';

  const trigger = (
    <DropdownMenuTrigger asChild>
      {compact ? (
        <Button variant="ghost" size="icon" aria-label={user.displayName}>
          <UserCircle className="size-5" aria-hidden />
        </Button>
      ) : collapsed ? (
        <Button
          variant="ghost"
          size="icon"
          aria-label={user.displayName}
          className="hover:bg-sidebar-accent/60 md:size-10"
        >
          <span
            aria-hidden
            className="bg-primary/15 text-primary flex size-8 items-center justify-center rounded-full text-sm font-semibold"
          >
            {initial}
          </span>
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
  );

  return (
    <DropdownMenu>
      {collapsed ? <SidebarTip label={user.displayName}>{trigger}</SidebarTip> : trigger}
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
  const { sidebarCollapsed } = usePreferences();

  return (
    <TooltipProvider delayDuration={300}>
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
          id="sidebar"
          data-print="hide"
          data-state={sidebarCollapsed ? 'collapsed' : 'expanded'}
          className={cn(
            'bg-sidebar text-sidebar-foreground fixed inset-y-0 start-0 z-30 hidden flex-col border-e transition-[width] duration-200 ease-out lg:flex',
            sidebarCollapsed ? 'w-16' : 'w-64',
          )}
        >
          <div className={cn('flex h-16 shrink-0 items-center', sidebarCollapsed ? 'justify-center' : 'px-5')}>
            <Brand collapsed={sidebarCollapsed} />
          </div>
          <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
            <NavLinks collapsed={sidebarCollapsed} />
          </div>
          <div className={cn('flex flex-col gap-1 border-t p-2', sidebarCollapsed && 'items-center')}>
            <SidebarToggle collapsed={sidebarCollapsed} />
            <UserMenu onLogout={onLogout} collapsed={sidebarCollapsed} />
          </div>
        </aside>

        <div
          className={cn(
            'flex min-h-dvh flex-col transition-[padding] duration-200 ease-out print:ps-0',
            sidebarCollapsed ? 'lg:ps-16' : 'lg:ps-64',
          )}
        >
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
            <div className="mx-auto flex w-full max-w-[112rem] flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
              {children}
            </div>
          </main>
        </div>
      </div>
    </TooltipProvider>
  );
}
