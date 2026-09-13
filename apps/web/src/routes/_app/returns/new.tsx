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
import { ReturnForm } from '@/features/returns/return-form';
import { usePageTitle } from '@/hooks/use-page-title';
import { prefetch } from '@/lib/prefetch';
import { requirePermission } from '@/lib/route-guards';

const id = z.coerce.number().int().min(1).optional().catch(undefined);
const SearchSchema = z.object({
  orderId: id,
  replaceReturnId: id,
  customerId: id,
  choose: z.boolean().optional().catch(undefined),
});

export const Route = createFileRoute('/_app/returns/new')({
  validateSearch: SearchSchema,
  beforeLoad: ({ search }) => {
    requirePermission('returns.create');
    // Correcting a return is its own permission (§7.4.2).
    if (search.replaceReturnId !== undefined) requirePermission('returns.edit');
  },
  loaderDeps: ({ search }) => ({ orderId: search.orderId }),
  loader: ({ context, deps }) =>
    deps.orderId === undefined ? undefined : prefetch(context.queryClient, orderQuery(deps.orderId)),
  component: NewReturnPage,
});

function NewReturnPage() {
  const { t } = useTranslation();
  const navigate = useNavigate({ from: Route.fullPath });
  const { orderId, replaceReturnId, customerId, choose } = Route.useSearch();
  const titleKey = replaceReturnId === undefined ? 'returns.new.title' : 'returns.new.titleReplace';
  usePageTitle(titleKey);

  const chooseOrder = useCallback(
    (next: number) => void navigate({ search: (prev) => ({ ...prev, orderId: next }), replace: true }),
    [navigate],
  );

  return (
    <>
      <PageHeader title={t(titleKey)} />
      {orderId === undefined ? (
        <OrderPicker
          customerId={customerId ?? null}
          onCustomerChange={(next) => void navigate({ search: { customerId: next ?? undefined }, replace: true })}
          eligible={(order) => order.outQuantityTotal > 0}
          onSelect={chooseOrder}
          autoSelect={!choose}
        />
      ) : (
        <ChosenOrder
          orderId={orderId}
          replaceReturnId={replaceReturnId}
          onChange={() =>
            void navigate({ search: (prev) => ({ customerId: prev.customerId, choose: true }), replace: true })
          }
        />
      )}
    </>
  );
}

function ChosenOrder({
  orderId,
  replaceReturnId,
  onChange,
}: {
  orderId: number;
  replaceReturnId?: number;
  onChange: () => void;
}) {
  const { t } = useTranslation();
  const order = useQuery(orderQuery(orderId));
  if (order.isPending) return <PageSkeleton rows={3} />;
  if (order.isError) return <QueryErrorState error={order.error} onRetry={() => void order.refetch()} />;

  const replaced = order.data.returns.find((pr) => pr.id === replaceReturnId);
  if (replaceReturnId !== undefined && (!replaced || replaced.reversed)) {
    return (
      <EmptyState
        title={t('returns.new.notReplaceable')}
        action={
          <Button asChild variant="outline">
            <Link to="/orders/$orderId" params={{ orderId: String(orderId) }}>
              {t('returns.new.backToOrder')}
            </Link>
          </Button>
        }
      />
    );
  }
  if (replaceReturnId === undefined && (order.data.cancelledAt !== null || order.data.outQuantityTotal === 0)) {
    // Everything came back meanwhile, or reached by Back: there is nothing a return could record.
    return (
      <EmptyState
        title={t('returns.new.nothingOut')}
        action={
          <Button asChild variant="outline">
            <Link to="/orders/$orderId" params={{ orderId: String(orderId) }}>
              {t('returns.new.backToOrder')}
            </Link>
          </Button>
        }
      />
    );
  }
  return (
    <div className="flex flex-col gap-6">
      {replaceReturnId === undefined ? <OrderHeaderCompact order={order.data} onChange={onChange} /> : null}
      {/* Not keyed by version: a reload after a refusal keeps the typed rows and their errors. */}
      <ReturnForm key={replaceReturnId ?? 'new'} order={order.data} replaceReturnId={replaceReturnId} />
    </div>
  );
}
