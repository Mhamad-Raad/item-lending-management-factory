import { useQuery } from '@tanstack/react-query';
import { Link, createFileRoute, useNavigate } from '@tanstack/react-router';
import type { CustomerReturnableDto, OrderDetailDto } from '@pallet/shared';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import { PageHeader } from '@/components/app/page-header';
import { EntityCombobox } from '@/components/app/entity-combobox';
import { Field, FieldLabel } from '@/components/app/field';
import { EmptyState, PageSkeleton, QueryErrorState } from '@/components/app/states';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { orderQuery } from '@/features/orders/api';
import { OrderHeaderCompact } from '@/features/orders/order-picker';
import { customerReturnableQuery } from '@/features/returns/api';
import { CustomerReturnForm } from '@/features/returns/customer-return-form';
import { ReturnForm } from '@/features/returns/return-form';
import { usePageTitle } from '@/hooks/use-page-title';
import { prefetch } from '@/lib/prefetch';
import { requirePermission } from '@/lib/route-guards';

const id = z.coerce.number().int().min(1).optional().catch(undefined);
const SearchSchema = z.object({
  orderId: id,
  replaceReturnId: id,
  customerId: id,
});

export const Route = createFileRoute('/_app/returns/new')({
  validateSearch: SearchSchema,
  beforeLoad: ({ search }) => {
    requirePermission('returns.create');
    // Correcting a return is its own permission (§7.4.2).
    if (search.replaceReturnId !== undefined) requirePermission('returns.edit');
  },
  loaderDeps: ({ search }) => ({ orderId: search.orderId, customerId: search.customerId }),
  loader: ({ context, deps }) =>
    deps.orderId !== undefined
      ? prefetch(context.queryClient, orderQuery(deps.orderId))
      : deps.customerId !== undefined
        ? prefetch(context.queryClient, customerReturnableQuery(deps.customerId))
        : undefined,
  component: NewReturnPage,
});

function NewReturnPage() {
  const { t } = useTranslation();
  const navigate = useNavigate({ from: Route.fullPath });
  const { orderId, replaceReturnId, customerId } = Route.useSearch();
  const titleKey = replaceReturnId === undefined ? 'returns.new.title' : 'returns.new.titleReplace';
  usePageTitle(titleKey);

  return (
    <>
      <PageHeader title={t(titleKey)} />
      {orderId === undefined ? (
        <div className="flex flex-col gap-6">
          <Card>
            <CardContent>
              <Field>
                <FieldLabel htmlFor="customerId">{t('orders.fields.customer')}</FieldLabel>
                <EntityCombobox
                  id="customerId"
                  kind="customer"
                  // Returns stay possible on an archived customer's open orders.
                  includeArchived
                  autoFocus={customerId === undefined}
                  value={customerId ?? null}
                  onChange={(next) => void navigate({ search: { customerId: next ?? undefined }, replace: true })}
                  placeholder={t('orders.fields.chooseCustomer')}
                />
              </Field>
            </CardContent>
          </Card>
          {/* Keyed by customer: another customer starts from empty rows. */}
          {customerId === undefined ? null : <CustomerHoldings key={customerId} customerId={customerId} />}
        </div>
      ) : (
        <ChosenOrder orderId={orderId} replaceReturnId={replaceReturnId} />
      )}
    </>
  );
}

/** Everything the customer still holds, to return from (Q156). */
function CustomerHoldings({ customerId }: { customerId: number }) {
  const holdings = useQuery(customerReturnableQuery(customerId));
  // Once saved, the list stays as it was beneath the saved dialog: refreshed, it would lose the rows just returned.
  const [held, setHeld] = useState<CustomerReturnableDto | null>(null);
  const data = held ?? holdings.data;
  if (data === undefined) {
    if (holdings.isError) return <QueryErrorState error={holdings.error} onRetry={() => void holdings.refetch()} />;
    return <PageSkeleton rows={3} />;
  }
  // An empty list is the form's to say: after a reload it may still have counts to name.
  return <CustomerReturnForm data={data} onSaved={() => setHeld(data)} />;
}

function ChosenOrder({ orderId, replaceReturnId }: { orderId: number; replaceReturnId?: number }) {
  const { t } = useTranslation();
  const navigate = useNavigate({ from: Route.fullPath });
  const query = useQuery(orderQuery(orderId));
  // Once saved, the order stays as it was beneath the saved dialog (Q166), as the customer screen's list does: a
  // refetch (a print's focus coming back) would otherwise find nothing out, drop the form and its dialog with it.
  const [held, setHeld] = useState<OrderDetailDto | null>(null);
  if (query.isPending && !held) return <PageSkeleton rows={3} />;
  if (query.isError && !held) return <QueryErrorState error={query.error} onRetry={() => void query.refetch()} />;
  const order = { data: held ?? (query.data as OrderDetailDto) };

  const replaced = order.data.returns.find((pr) => pr.id === replaceReturnId);
  if (!held && replaceReturnId !== undefined && (!replaced || replaced.reversed)) {
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
  if (
    !held &&
    replaceReturnId === undefined &&
    (order.data.cancelledAt !== null || order.data.outQuantityTotal === 0)
  ) {
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
      {/* A correction belongs to its return's order: the order shows, with no way to choose another. */}
      <OrderHeaderCompact
        order={order.data}
        // "Change order": everything this order's customer holds, to return from (Q156).
        onChange={
          replaceReturnId === undefined
            ? () => void navigate({ search: { customerId: order.data.customer.id }, replace: true })
            : undefined
        }
      />
      {/* Not keyed by version: a reload after a refusal keeps the typed rows and their errors. */}
      <ReturnForm
        key={replaceReturnId ?? 'new'}
        order={order.data}
        replaceReturnId={replaceReturnId}
        onSaved={() => setHeld(order.data)}
      />
    </div>
  );
}
