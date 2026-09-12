import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, createFileRoute, useNavigate } from '@tanstack/react-router';
import { Ban, Pencil, Printer, ShieldAlert } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { z } from 'zod';
import { ConfirmDialog } from '@/components/app/confirm-dialog';
import { DateText } from '@/components/app/date-text';
import { MoneyText } from '@/components/app/money-text';
import { PageHeader } from '@/components/app/page-header';
import { QuantityText } from '@/components/app/quantity-text';
import { PageSkeleton, QueryErrorState } from '@/components/app/states';
import { StatusBadge } from '@/components/app/status-badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { invalidateAfterOrderChange, orderQuery } from '@/features/orders/api';
import { OrderLinesTable, OrderMoney, OrderReturns } from '@/features/orders/order-sections';
import { orderLabel } from '@/features/orders/order-text';
import { usePageTitle } from '@/hooks/use-page-title';
import { apiFetch } from '@/lib/api-client';
import { useCan } from '@/lib/auth';
import { handleApiError } from '@/lib/errors';
import { qk } from '@/lib/query-keys';
import { requirePermission } from '@/lib/route-guards';
import { prefetch } from '@/lib/prefetch';

const SearchSchema = z.object({ created: z.boolean().optional().catch(undefined) });

export const Route = createFileRoute('/_app/orders/$orderId/')({
  validateSearch: SearchSchema,
  beforeLoad: () => requirePermission('orders.view'),
  loader: ({ context, params }) => prefetch(context.queryClient, orderQuery(Number(params.orderId))),
  component: OrderDetailPage,
});

/**
 * One order in full (§7.3.6). Recording a return or a payment, and undoing either, arrive with the
 * pages that do them (M4); until then the order shows what it has and offers edit, cancel and print.
 */
function OrderDetailPage() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const navigate = useNavigate({ from: Route.fullPath });
  const { orderId } = Route.useParams();
  const search = Route.useSearch();
  const order = useQuery(orderQuery(Number(orderId)));
  const canEdit = useCan('orders.edit');
  const canCancel = useCan('orders.cancel');
  const [confirmingCancel, setConfirmingCancel] = useState(false);
  usePageTitle('orders.detail.title');

  const cancel = useMutation({
    mutationFn: (version: number) => apiFetch(`/orders/${orderId}/cancel`, { method: 'POST', body: { version } }),
    onSuccess: async () => {
      await invalidateAfterOrderChange(queryClient);
      toast.success(t('orders.detail.cancelled'));
      setConfirmingCancel(false);
    },
    onError: (error) => {
      setConfirmingCancel(false);
      handleApiError(error, {
        onReload: () => void queryClient.invalidateQueries({ queryKey: qk.orders.detail(Number(orderId)) }),
      });
      void queryClient.invalidateQueries({ queryKey: qk.orders.detail(Number(orderId)) });
    },
  });

  if (order.isPending) return <PageSkeleton />;
  if (order.isError) {
    return (
      <QueryErrorState
        error={order.error}
        onRetry={() => void order.refetch()}
        backLink={<Link to="/orders">{t('orders.detail.backToList')}</Link>}
      />
    );
  }

  const data = order.data;
  const cancelled = data.cancelledAt !== null;
  const printReceipt = (): void => void window.open(`/print/orders/${data.id}`, '_blank', 'noopener');
  const figures = [
    { label: 'orders.fields.depositTotal', value: <MoneyText value={data.depositTotal} /> },
    { label: 'orders.fields.owed', value: <MoneyText value={data.owed} /> },
    { label: 'orders.fields.held', value: <MoneyText value={data.held} /> },
    { label: 'orders.fields.palletsOut', value: <QuantityText value={data.outQuantityTotal} /> },
  ] as const;

  return (
    <>
      {search.created && !cancelled ? (
        <Alert className="flex flex-wrap items-center justify-between gap-3">
          <AlertDescription>
            {t('orders.detail.createdBanner', { orderNumber: orderLabel(data.orderNumber) })}
          </AlertDescription>
          <div className="flex gap-2">
            <Button onClick={printReceipt}>
              <Printer aria-hidden />
              {t('orders.detail.printReceipt')}
            </Button>
            <Button variant="ghost" onClick={() => void navigate({ search: {}, replace: true })}>
              {t('common.actions.close')}
            </Button>
          </div>
        </Alert>
      ) : null}

      <PageHeader
        title={orderLabel(data.orderNumber)}
        actions={
          cancelled ? null : (
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={printReceipt}>
                <Printer aria-hidden />
                {t('orders.detail.printReceipt')}
              </Button>
              {canEdit ? (
                <Button variant="outline" asChild>
                  <Link to="/orders/$orderId/edit" params={{ orderId }}>
                    <Pencil aria-hidden />
                    {t('common.actions.edit')}
                  </Link>
                </Button>
              ) : null}
              {canCancel && data.canCancel ? (
                <Button variant="outline" onClick={() => setConfirmingCancel(true)}>
                  <Ban aria-hidden />
                  {t('orders.detail.cancelOrder')}
                </Button>
              ) : null}
            </div>
          )
        }
      />

      {cancelled ? (
        <Alert>
          <AlertDescription>
            {t('orders.detail.cancelledBanner', { name: data.cancelledBy?.displayName ?? '' })}{' '}
            <DateText value={data.cancelledAt ?? ''} withTime />
          </AlertDescription>
        </Alert>
      ) : null}

      <Card>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge status={data.status} />
            <Badge variant="outline">{t(`enums.paymentType.${data.paymentType}`)}</Badge>
            {data.creditOverride ? (
              <Badge variant="outline">
                <ShieldAlert aria-hidden />
                {t('orders.detail.creditOverridden', { name: data.creditOverride.by.displayName })}{' '}
                <DateText value={data.creditOverride.at} withTime />
              </Badge>
            ) : null}
          </div>
          <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
            <div className="flex flex-col gap-1">
              <dt className="text-muted-foreground text-sm">{t('orders.fields.customer')}</dt>
              <dd>
                <Link
                  to="/customers/$customerId"
                  params={{ customerId: String(data.customer.id) }}
                  className="text-primary underline-offset-4 hover:underline"
                >
                  {data.customer.name}
                </Link>
              </dd>
            </div>
            <div className="flex flex-col gap-1">
              <dt className="text-muted-foreground text-sm">{t('orders.fields.driver')}</dt>
              <dd className="flex flex-wrap gap-x-2">
                <span>{data.driver.name}</span>
                <span dir="ltr">{data.driver.phone}</span>
                <span dir="ltr">{data.driver.carNumber}</span>
              </dd>
            </div>
            <div className="flex flex-col gap-1">
              <dt className="text-muted-foreground text-sm">{t('orders.fields.date')}</dt>
              <dd>
                <DateText value={data.date} />
              </dd>
            </div>
            {figures.map((figure) => (
              <div key={figure.label} className="flex flex-col gap-1">
                <dt className="text-muted-foreground text-sm">{t(figure.label)}</dt>
                <dd className="text-lg font-medium">{figure.value}</dd>
              </div>
            ))}
          </dl>
          {data.notes ? <p className="text-muted-foreground whitespace-pre-line">{data.notes}</p> : null}
        </CardContent>
      </Card>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">{t('orders.lines.title')}</h2>
        <OrderLinesTable order={data} />
      </section>
      <OrderReturns returns={data.returns} />
      <OrderMoney entries={data.ledgerEntries} />

      <ConfirmDialog
        open={confirmingCancel}
        onOpenChange={setConfirmingCancel}
        title={t('orders.cancel.confirmTitle', { orderNumber: orderLabel(data.orderNumber) })}
        description={t('orders.cancel.confirmBody')}
        confirmLabel={t('orders.detail.cancelOrder')}
        pending={cancel.isPending}
        onConfirm={() => cancel.mutate(data.version)}
      />
    </>
  );
}
