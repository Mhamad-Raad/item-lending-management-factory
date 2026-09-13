import { useQuery } from '@tanstack/react-query';
import { Link, createFileRoute, useNavigate } from '@tanstack/react-router';
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import { PageHeader } from '@/components/app/page-header';
import { EmptyState, PageSkeleton, QueryErrorState } from '@/components/app/states';
import { Button } from '@/components/ui/button';
import { orderQuery } from '@/features/orders/api';
import { OrderHeaderCompact, OrderPicker } from '@/features/orders/order-picker';
import { PaymentForm } from '@/features/payments/payment-form';
import { usePageTitle } from '@/hooks/use-page-title';
import { prefetch } from '@/lib/prefetch';
import { requirePermission } from '@/lib/route-guards';

const id = z.coerce.number().int().min(1).optional().catch(undefined);
const SearchSchema = z.object({ orderId: id, customerId: id, choose: z.boolean().optional().catch(undefined) });

export const Route = createFileRoute('/_app/payments/new')({
  validateSearch: SearchSchema,
  beforeLoad: () => requirePermission('payments.create'),
  loaderDeps: ({ search }) => ({ orderId: search.orderId }),
  loader: ({ context, deps }) =>
    deps.orderId === undefined ? undefined : prefetch(context.queryClient, orderQuery(deps.orderId)),
  component: NewPaymentPage,
});

function NewPaymentPage() {
  const { t } = useTranslation();
  const navigate = useNavigate({ from: Route.fullPath });
  const { orderId, customerId, choose } = Route.useSearch();
  usePageTitle('payments.new.title');

  const chooseOrder = useCallback(
    (next: number) => void navigate({ search: (prev) => ({ ...prev, orderId: next }), replace: true }),
    [navigate],
  );

  return (
    <>
      <PageHeader title={t('payments.new.title')} />
      {orderId === undefined ? (
        <OrderPicker
          customerId={customerId ?? null}
          onCustomerChange={(next) => void navigate({ search: { customerId: next ?? undefined }, replace: true })}
          query={{ paymentType: 'LENT' }}
          eligible={(order) => order.owed > 0}
          onSelect={chooseOrder}
          autoSelect={!choose}
          showOwedOnly
        />
      ) : (
        <ChosenOrder
          orderId={orderId}
          onChange={() =>
            void navigate({ search: (prev) => ({ customerId: prev.customerId, choose: true }), replace: true })
          }
        />
      )}
    </>
  );
}

function ChosenOrder({ orderId, onChange }: { orderId: number; onChange: () => void }) {
  const { t } = useTranslation();
  const order = useQuery(orderQuery(orderId));
  if (order.isPending) return <PageSkeleton rows={3} />;
  if (order.isError) return <QueryErrorState error={order.error} onRetry={() => void order.refetch()} />;
  const payable = order.data.cancelledAt === null && order.data.paymentType === 'LENT' && order.data.owed > 0;
  if (!payable) {
    // Paid off meanwhile, or reached by Back: there is nothing a payment form could record.
    return (
      <EmptyState
        title={t('payments.new.nothingOwed')}
        action={
          <Button asChild variant="outline">
            <Link to="/orders/$orderId" params={{ orderId: String(orderId) }}>
              {t('payments.new.backToOrder')}
            </Link>
          </Button>
        }
      />
    );
  }
  return (
    <div className="flex flex-col gap-6">
      <OrderHeaderCompact order={order.data} onChange={onChange} />
      {/* Not keyed by version: a reload after a refusal keeps the typed amount, its error and its key. */}
      <PaymentForm order={order.data} />
    </div>
  );
}
