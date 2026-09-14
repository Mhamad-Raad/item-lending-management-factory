import type { ActivityEventDto, ActivityEventKind, DashboardDto } from '@pallet/shared';
import { useQuery } from '@tanstack/react-query';
import { Link, createFileRoute } from '@tanstack/react-router';
import {
  Ban,
  Banknote,
  ClipboardList,
  HandCoins,
  History,
  Package,
  PackageOpen,
  Plus,
  TriangleAlert,
  Wallet,
  XCircle,
  type LucideIcon,
} from 'lucide-react';
import { ChevronRight, Undo2 } from '@/components/app/dir-icon';
import { useTranslation } from 'react-i18next';
import { CountUp } from '@/components/app/count-up';
import { DateText } from '@/components/app/date-text';
import { MoneyText } from '@/components/app/money-text';
import { PageHeader } from '@/components/app/page-header';
import { QuantityText } from '@/components/app/quantity-text';
import { StatCard } from '@/components/app/stat-card';
import { EmptyState, PageSkeleton, QueryErrorState } from '@/components/app/states';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { orderLabel } from '@/features/orders/order-text';
import { usePageTitle } from '@/hooks/use-page-title';
import { apiFetch } from '@/lib/api-client';
import { useAuth, useCan } from '@/lib/auth';
import { isolate } from '@/lib/bidi';
import { qk } from '@/lib/query-keys';
import { TONE_CHIP, type Tone } from '@/lib/tones';
import { cn } from '@/lib/utils';

export const Route = createFileRoute('/_app/')({ component: DashboardPage });

const EVENT_ICONS: Record<ActivityEventKind, { icon: LucideIcon; tone: Tone }> = {
  HANDOVER: { icon: PackageOpen, tone: 'primary' },
  CANCELLATION: { icon: XCircle, tone: 'destructive' },
  RETURN: { icon: Undo2, tone: 'info' },
  PAYMENT: { icon: Wallet, tone: 'success' },
  REFUND: { icon: HandCoins, tone: 'warning' },
};

/**
 * The home page (§7.3.3): the positions in four figures, the three daily flows one tap away, and what
 * happened last. A section the viewer may not see is absent from the response and not drawn (Q12).
 */
function DashboardPage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  usePageTitle('dashboard.title');
  const dashboard = useQuery({
    queryKey: qk.dashboard(),
    queryFn: () => apiFetch<DashboardDto>('/dashboard'),
    // Fresher than the 30 s default: the home page is where the day's figures are read (§7.8).
    staleTime: 15_000,
  });
  const can = { order: useCan('orders.create'), return: useCan('returns.create'), payment: useCan('payments.create') };

  const quickActions = [
    can.order ? { to: '/orders/new', icon: Plus, label: t('orders.list.new'), tone: 'primary' as const } : null,
    can.return ? { to: '/returns/new', icon: Undo2, label: t('returns.new.title'), tone: 'info' as const } : null,
    can.payment
      ? { to: '/payments/new', icon: Banknote, label: t('payments.new.title'), tone: 'success' as const }
      : null,
  ].filter((action) => action !== null);

  return (
    <>
      <PageHeader
        title={t('dashboard.title')}
        description={t('dashboard.welcome', { name: isolate(user?.displayName ?? '') })}
      />

      {quickActions.length > 0 ? (
        <section aria-label={t('dashboard.quick.title')} className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {quickActions.map((action) => (
            <Link
              key={action.to}
              to={action.to}
              className={cn(
                // Presses in like a button (§7.14).
                'group bg-card flex min-h-16 items-center gap-3 rounded-xl border p-3 text-base font-medium shadow-sm transition-[box-shadow,border-color,scale] active:scale-[0.98]',
                'hover:border-primary/40 hover:shadow-md',
                'focus-visible:ring-ring focus-visible:ring-offset-background focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none',
              )}
            >
              <span
                aria-hidden
                className={cn('flex size-10 shrink-0 items-center justify-center rounded-lg', TONE_CHIP[action.tone])}
              >
                <action.icon className="size-5" />
              </span>
              {action.label}
              {/* Points the reading direction: mirrored in Kurdish and Arabic. */}
              <ChevronRight aria-hidden className="text-muted-foreground group-hover:text-foreground ms-auto size-4" />
            </Link>
          ))}
        </section>
      ) : null}

      {dashboard.isPending ? (
        <PageSkeleton rows={4} />
      ) : dashboard.isError ? (
        <QueryErrorState error={dashboard.error} onRetry={() => void dashboard.refetch()} />
      ) : (
        <>
          <Figures data={dashboard.data} />
          {dashboard.data.recentActivity ? <RecentActivity events={dashboard.data.recentActivity} /> : null}
        </>
      )}
    </>
  );
}

function Figures({ data }: { data: DashboardDto }) {
  const { t } = useTranslation();
  if (!data.positions && !data.lowStock) return null;
  return (
    <section aria-label={t('dashboard.cards.title')} className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {data.positions ? (
        <>
          <StatCard
            icon={Package}
            tone="info"
            label={t('dashboard.cards.palletsOut')}
            value={<CountUp value={data.positions.palletsOut} format="number" />}
            link={{ to: '/reports/positions' }}
          />
          <StatCard
            icon={ClipboardList}
            tone="primary"
            label={t('dashboard.cards.owed')}
            value={<CountUp value={data.positions.owed} format="money" />}
            link={{ to: '/reports/positions', search: { sort: '-owed' } }}
          />
          <StatCard
            icon={Wallet}
            tone="success"
            label={t('dashboard.cards.held')}
            value={<CountUp value={data.positions.held} format="money" />}
            link={{ to: '/reports/positions', search: { sort: '-held' } }}
          />
        </>
      ) : null}
      {data.lowStock ? (
        <StatCard
          icon={data.lowStock.count > 0 ? TriangleAlert : Package}
          tone={data.lowStock.count > 0 ? 'warning' : 'success'}
          label={t('dashboard.cards.lowStock')}
          value={<CountUp value={data.lowStock.count} format="number" />}
          link={{ to: '/items', search: { lowStockOnly: true } }}
        >
          {data.lowStock.count > 0 ? (
            <div className="flex flex-col gap-1 text-sm">
              <span className="text-warning font-medium">{t('dashboard.lowStock.attention')}</span>
              <ul className="text-muted-foreground flex flex-col gap-0.5">
                {data.lowStock.items.slice(0, 5).map((item) => (
                  <li key={item.id} className="flex justify-between gap-2">
                    <bdi className="truncate">{item.name}</bdi>
                    <span dir="ltr" className="shrink-0 tabular-nums">
                      <QuantityText value={item.quantityOnHand} /> / <QuantityText value={item.minStock} />
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </StatCard>
      ) : null}
    </section>
  );
}

function openOrderLink(event: React.MouseEvent<HTMLElement>): void {
  if ((event.target as HTMLElement).closest('a, button')) return;
  event.currentTarget.querySelector<HTMLAnchorElement>('a[href]')?.click();
}

function RecentActivity({ events }: { events: ActivityEventDto[] }) {
  const { t } = useTranslation();
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <History className="size-4" aria-hidden />
          {t('dashboard.recent.title')}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {events.length === 0 ? (
          <EmptyState title={t('dashboard.recent.empty')} />
        ) : (
          <ul aria-label={t('dashboard.recent.title')} className="flex flex-col divide-y">
            {events.map((event) => {
              const { icon: Icon, tone } = EVENT_ICONS[event.kind];
              return (
                <li
                  key={`${event.kind}-${event.at}-${event.orderId}`}
                  // A click anywhere on the row opens its order; the order link stays the keyboard's way in.
                  onClick={openOrderLink}
                  className={cn('cursor-pointer', event.reversed && 'opacity-60')}
                >
                  <div className="hover:bg-accent/50 -mx-2 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md px-2 py-2.5 transition-colors">
                    <span
                      aria-hidden
                      className={cn('flex size-8 shrink-0 items-center justify-center rounded-md', TONE_CHIP[tone])}
                    >
                      <Icon className="size-4" />
                    </span>
                    <span className="font-medium">{t(`enums.activityEventKind.${event.kind}`)}</span>
                    {event.reversed ? (
                      <Badge variant="secondary">
                        <Ban aria-hidden />
                        {t('orders.detail.reversed')}
                      </Badge>
                    ) : null}
                    <Link
                      to="/orders/$orderId"
                      params={{ orderId: String(event.orderId) }}
                      dir="ltr"
                      className="text-primary underline-offset-4 hover:underline"
                    >
                      {orderLabel(event.orderNumber)}
                    </Link>
                    <bdi className="text-muted-foreground min-w-0 truncate">{event.customer.name}</bdi>
                    <span className="ms-auto flex items-center gap-3 text-sm">
                      {event.amount !== null ? (
                        <MoneyText value={event.amount} />
                      ) : event.quantity !== null ? (
                        <QuantityText value={event.quantity} />
                      ) : null}
                      <span className="text-muted-foreground">
                        <DateText value={event.date} />
                      </span>
                    </span>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
