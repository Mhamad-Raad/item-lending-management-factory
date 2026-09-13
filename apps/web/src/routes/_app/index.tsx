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
  Undo2,
  Wallet,
  XCircle,
  type LucideIcon,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { CountUp } from '@/components/app/count-up';
import { DateText } from '@/components/app/date-text';
import { MoneyText } from '@/components/app/money-text';
import { PageHeader } from '@/components/app/page-header';
import { QuantityText } from '@/components/app/quantity-text';
import { StatCard } from '@/components/app/stat-card';
import { EmptyState, PageSkeleton, QueryErrorState } from '@/components/app/states';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { orderLabel } from '@/features/orders/order-text';
import { usePageTitle } from '@/hooks/use-page-title';
import { apiFetch } from '@/lib/api-client';
import { useAuth, useCan } from '@/lib/auth';
import { qk } from '@/lib/query-keys';
import { cn } from '@/lib/utils';

export const Route = createFileRoute('/_app/')({ component: DashboardPage });

const EVENT_ICONS: Record<ActivityEventKind, LucideIcon> = {
  HANDOVER: PackageOpen,
  CANCELLATION: XCircle,
  RETURN: Undo2,
  PAYMENT: Wallet,
  REFUND: HandCoins,
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
    can.order ? { to: '/orders/new', icon: Plus, label: t('orders.list.new') } : null,
    can.return ? { to: '/returns/new', icon: Undo2, label: t('returns.new.title') } : null,
    can.payment ? { to: '/payments/new', icon: Banknote, label: t('payments.new.title') } : null,
  ].filter((action) => action !== null);

  return (
    <>
      <PageHeader
        title={t('dashboard.title')}
        description={t('dashboard.welcome', { name: user?.displayName ?? '' })}
      />

      {quickActions.length > 0 ? (
        <section aria-label={t('dashboard.quick.title')} className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {quickActions.map((action) => (
            <Button key={action.to} asChild size="lg" variant="outline" className="h-14 justify-start text-base">
              <Link to={action.to}>
                <action.icon aria-hidden />
                {action.label}
              </Link>
            </Button>
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
            label={t('dashboard.cards.palletsOut')}
            value={<CountUp value={data.positions.palletsOut} format="number" />}
            link={{ to: '/reports/positions' }}
          />
          <StatCard
            icon={ClipboardList}
            label={t('dashboard.cards.owed')}
            value={<CountUp value={data.positions.owed} format="money" />}
            link={{ to: '/reports/positions', search: { sort: '-owed' } }}
          />
          <StatCard
            icon={Wallet}
            label={t('dashboard.cards.held')}
            value={<CountUp value={data.positions.held} format="money" />}
            link={{ to: '/reports/positions', search: { sort: '-held' } }}
          />
        </>
      ) : null}
      {data.lowStock ? (
        <StatCard
          icon={data.lowStock.count > 0 ? TriangleAlert : Package}
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
                    <span className="truncate">{item.name}</span>
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
              const Icon = EVENT_ICONS[event.kind];
              return (
                <li
                  key={`${event.kind}-${event.at}-${event.orderId}`}
                  // A click anywhere on the row opens its order; the order link stays the keyboard's way in.
                  onClick={openOrderLink}
                  className={cn('cursor-pointer', event.reversed && 'opacity-60')}
                >
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
                    <Icon className="text-muted-foreground size-4 shrink-0" aria-hidden />
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
                    <span className="text-muted-foreground min-w-0 truncate">{event.customer.name}</span>
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
