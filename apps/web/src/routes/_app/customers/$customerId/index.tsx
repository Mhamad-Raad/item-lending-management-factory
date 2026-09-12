import { formatOrderNumber, type CustomerHoldingDto } from '@pallet/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, createFileRoute } from '@tanstack/react-router';
import { Archive, Package, Pencil, Plus, TriangleAlert } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { ArchivedBadge } from '@/components/app/archived-badge';
import { ConfirmDialog } from '@/components/app/confirm-dialog';
import { DataTable, type DataColumn } from '@/components/app/data-table';
import { DateText } from '@/components/app/date-text';
import { MoneyText } from '@/components/app/money-text';
import { PageHeader } from '@/components/app/page-header';
import { QuantityText } from '@/components/app/quantity-text';
import { EmptyState, PageSkeleton, QueryErrorState } from '@/components/app/states';
import { Thumbnail } from '@/components/app/thumbnail';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { customerQuery, invalidateCustomers } from '@/features/customers/api';
import { CustomerLedgerTab, CustomerOrdersTab } from '@/features/customers/customer-tabs';
import { usePageTitle } from '@/hooks/use-page-title';
import { apiFetch } from '@/lib/api-client';
import { useCan } from '@/lib/auth';
import { handleApiError } from '@/lib/errors';
import { qk } from '@/lib/query-keys';
import { requirePermission } from '@/lib/route-guards';
import { z } from 'zod';

const TABS = ['orders', 'payments', 'refunds'] as const;
const SearchSchema = z.object({ tab: z.enum(TABS).optional().catch(undefined) });

export const Route = createFileRoute('/_app/customers/$customerId/')({
  validateSearch: SearchSchema,
  beforeLoad: () => requirePermission('customers.view'),
  component: CustomerProfilePage,
});

const HOLDING_COLUMNS: DataColumn<CustomerHoldingDto>[] = [
  {
    id: 'item',
    header: 'customers.holdings.item',
    cell: (holding) => (
      <span className="flex items-center gap-3">
        <Thumbnail url={holding.item.imageUrl} />
        {holding.item.name}
      </span>
    ),
  },
  {
    id: 'quantityOut',
    header: 'customers.holdings.quantityOut',
    cell: (holding) => <QuantityText value={holding.quantityOut} />,
    align: 'end',
  },
  {
    id: 'sources',
    header: 'customers.holdings.sources',
    cell: (holding) => (
      <span className="flex flex-wrap gap-1">
        {holding.sources.map((source) => (
          <Badge key={source.orderId} variant="outline" className="gap-1.5">
            <span dir="ltr">#{formatOrderNumber(source.orderNumber)}</span>·<DateText value={source.orderDate} />·
            <QuantityText value={source.quantityOut} />
          </Badge>
        ))}
      </span>
    ),
  },
];

/**
 * A customer's position (§7.3.12): what they hold and owe, their orders and their money. The history
 * tab, a timeline of hand-overs, returns and money, arrives with returns in M4.
 */
function CustomerProfilePage() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { customerId } = Route.useParams();
  const customer = useQuery(customerQuery(Number(customerId)));
  const canEdit = useCan('customers.edit');
  const canArchive = useCan('customers.delete');
  const canViewOrders = useCan('orders.view');
  const canCreateOrder = useCan('orders.create');
  const navigate = Route.useNavigate();
  const tab = Route.useSearch().tab ?? 'orders';
  const [confirming, setConfirming] = useState(false);
  usePageTitle('customers.detail.title');

  const archive = useMutation({
    mutationFn: (version: number) => apiFetch(`/customers/${customerId}`, { method: 'DELETE', query: { version } }),
    onSuccess: async () => {
      await invalidateCustomers(queryClient);
      toast.success(t('customers.detail.archived'));
      setConfirming(false);
    },
    onError: (error) => {
      setConfirming(false);
      handleApiError(error, {
        onReload: () => void queryClient.invalidateQueries({ queryKey: qk.customers.detail(Number(customerId)) }),
      });
    },
  });

  if (customer.isPending) return <PageSkeleton />;
  if (customer.isError) {
    return (
      <QueryErrorState
        error={customer.error}
        onRetry={() => void customer.refetch()}
        backLink={<Link to="/customers">{t('customers.detail.backToList')}</Link>}
      />
    );
  }

  const data = customer.data;
  const { summary } = data;
  const live = data.archivedAt === null;
  const cards = [
    {
      label: 'customers.fields.palletsOut',
      value: <QuantityText value={summary.palletsOut} />,
      extra:
        data.palletsOutByItem.length > 0 ? (
          <ul className="text-muted-foreground flex flex-col gap-0.5 text-sm">
            {data.palletsOutByItem.map((row) => (
              <li key={row.itemId} className="flex justify-between gap-2">
                <span>{row.itemName}</span>
                <QuantityText value={row.quantityOut} />
              </li>
            ))}
          </ul>
        ) : null,
    },
    { label: 'customers.fields.outValue', value: <MoneyText value={summary.outValue} /> },
    { label: 'customers.fields.owed', value: <MoneyText value={summary.owed} /> },
    { label: 'customers.fields.held', value: <MoneyText value={summary.held} /> },
    {
      label: 'customers.fields.creditLimit',
      value: summary.creditLimit === null ? t('customers.noLimit') : <MoneyText value={summary.creditLimit} />,
    },
    {
      label: 'customers.fields.headroom',
      value:
        summary.headroom === null ? (
          t('customers.noLimit')
        ) : summary.headroom < 0 ? (
          // Negative only after an admin override (§4.5); shown as it is, with a badge that says so.
          <span className="flex flex-wrap items-center gap-2">
            <span dir="ltr" className="tabular-nums">
              −<MoneyText value={-summary.headroom} />
            </span>
            <Badge variant="destructive">
              <TriangleAlert aria-hidden />
              {t('customers.detail.overLimit')}
            </Badge>
          </span>
        ) : (
          <MoneyText value={summary.headroom} />
        ),
    },
  ];

  return (
    <>
      <PageHeader
        title={data.name}
        actions={
          <div className="flex flex-wrap gap-2">
            {canCreateOrder && live ? (
              <Button asChild>
                <Link to="/orders/new" search={{ customerId: data.id }}>
                  <Plus aria-hidden />
                  {t('orders.list.new')}
                </Link>
              </Button>
            ) : null}
            {canEdit && live ? (
              <Button variant="outline" asChild>
                <Link to="/customers/$customerId/edit" params={{ customerId }}>
                  <Pencil aria-hidden />
                  {t('common.actions.edit')}
                </Link>
              </Button>
            ) : null}
            {canArchive && live ? (
              <Button variant="outline" onClick={() => setConfirming(true)}>
                <Archive aria-hidden />
                {t('common.actions.archive')}
              </Button>
            ) : null}
          </div>
        }
      />

      {live ? null : (
        <Alert>
          <AlertDescription className="flex items-center gap-2">
            <ArchivedBadge />
            {t('customers.detail.archivedBanner')}
          </AlertDescription>
        </Alert>
      )}
      {/* Phone numbers read left to right in every language (§7.11). */}
      <p className="text-muted-foreground flex flex-wrap gap-x-3 gap-y-1 text-sm">
        <span dir="ltr">{data.phone}</span>
        {data.altPhone ? <span dir="ltr">{data.altPhone}</span> : null}
        <span>{data.address}</span>
      </p>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {cards.map((card) => (
          <Card key={card.label}>
            <CardHeader>
              <CardTitle className="text-muted-foreground text-sm font-normal">{t(card.label)}</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-2">
              <span className="text-xl font-semibold">{card.value}</span>
              {card.extra}
            </CardContent>
          </Card>
        ))}
      </div>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">{t('customers.holdings.title')}</h2>
        <DataTable
          label={t('customers.holdings.title')}
          columns={HOLDING_COLUMNS}
          rows={data.holdings}
          rowKey={(holding) => holding.item.id}
          total={data.holdings.length}
          page={1}
          pageSize={Math.max(data.holdings.length, 1)}
          onPageChange={() => undefined}
          empty={<EmptyState icon={Package} title={t('customers.holdings.empty')} />}
        />
      </section>

      {canViewOrders ? (
        <Tabs
          value={tab}
          onValueChange={(next) => void navigate({ search: { tab: next as (typeof TABS)[number] }, replace: true })}
        >
          <TabsList>
            <TabsTrigger value="orders">{t('customers.tabs.orders')}</TabsTrigger>
            <TabsTrigger value="payments">{t('customers.tabs.payments')}</TabsTrigger>
            <TabsTrigger value="refunds">{t('customers.tabs.refunds')}</TabsTrigger>
          </TabsList>
          <TabsContent value="orders">
            <CustomerOrdersTab customerId={data.id} />
          </TabsContent>
          <TabsContent value="payments">
            <CustomerLedgerTab customerId={data.id} types={['PAYMENT', 'PAYMENT_REVERSAL']} />
          </TabsContent>
          <TabsContent value="refunds">
            <CustomerLedgerTab customerId={data.id} types={['REFUND', 'REFUND_REVERSAL']} />
          </TabsContent>
        </Tabs>
      ) : null}

      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={t('customers.detail.archiveTitle', { name: data.name })}
        description={t('customers.detail.archiveBody')}
        confirmLabel={t('common.actions.archive')}
        pending={archive.isPending}
        onConfirm={() => archive.mutate(data.version)}
      />
    </>
  );
}
