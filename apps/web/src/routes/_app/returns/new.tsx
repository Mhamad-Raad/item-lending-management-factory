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
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { orderQuery } from '@/features/orders/api';
import { OrderHeaderCompact } from '@/features/orders/order-picker';
import { orderLabel } from '@/features/orders/order-text';
import { customerReturnableQuery } from '@/features/returns/api';
import { CustomerReturnForm } from '@/features/returns/customer-return-form';
import { ReturnForm } from '@/features/returns/return-form';
import { usePageTitle } from '@/hooks/use-page-title';
import { isolate } from '@/lib/bidi';
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
      ? // From an order (Q175): its customer's holdings too, as soon as the order names the customer.
        prefetch(context.queryClient, orderQuery(deps.orderId)).then(() => {
          const order = context.queryClient.getQueryData(orderQuery(deps.orderId as number).queryKey);
          return order ? prefetch(context.queryClient, customerReturnableQuery(order.customer.id)) : undefined;
        })
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
      ) : replaceReturnId === undefined ? (
        <WithOrder orderId={orderId} />
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

/**
 * A return recorded from an order's page (Q175): everything the order's customer holds, by item, oldest order first, as
 * the customer screen; each part lands on its own order and remembers this one, whose receipt then lists it.
 */
function WithOrder({ orderId }: { orderId: number }) {
  const { t } = useTranslation();
  const order = useQuery(orderQuery(orderId));
  const customerId = order.data?.customer.id;
  const holdings = useQuery({ ...customerReturnableQuery(customerId ?? 0), enabled: customerId !== undefined });
  // Once saved, the list stays as it was beneath the saved dialog, as on the customer screen.
  const [held, setHeld] = useState<CustomerReturnableDto | null>(null);
  if (order.isError && !held) return <QueryErrorState error={order.error} onRetry={() => void order.refetch()} />;
  if (order.data && order.data.cancelledAt !== null && !held) {
    return (
      <EmptyState
        // Cancelled meanwhile, or reached by Back: nothing can be recorded with it.
        title={t('errors.ORDER_CANCELLED')}
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
  const data = held ?? holdings.data;
  if (!order.data || data === undefined) {
    if (holdings.isError) return <QueryErrorState error={holdings.error} onRetry={() => void holdings.refetch()} />;
    return <PageSkeleton rows={3} />;
  }
  const withOrder = { id: order.data.id, orderNumber: order.data.orderNumber, date: order.data.date };
  return (
    <div className="flex flex-col gap-6">
      <Alert>
        <AlertDescription>
          {t('returns.withOrder.banner', { orderNumber: isolate(orderLabel(withOrder.orderNumber)) })}
        </AlertDescription>
      </Alert>
      <CustomerReturnForm data={data} withOrder={withOrder} onSaved={() => setHeld(data)} />
    </div>
  );
}

/** A correction of one of the order's returns (§4.8.5), on its own order's form. */
function ChosenOrder({ orderId, replaceReturnId }: { orderId: number; replaceReturnId: number }) {
  const { t } = useTranslation();
  const query = useQuery(orderQuery(orderId));
  // Once saved, the order stays as it was beneath the saved dialog (Q166), as the customer screen's list does: a
  // refetch (a print's focus coming back) would otherwise find nothing out, drop the form and its dialog with it.
  const [held, setHeld] = useState<OrderDetailDto | null>(null);
  if (query.isPending && !held) return <PageSkeleton rows={3} />;
  if (query.isError && !held) return <QueryErrorState error={query.error} onRetry={() => void query.refetch()} />;
  const order = { data: held ?? (query.data as OrderDetailDto) };

  const replaced = order.data.returns.find((pr) => pr.id === replaceReturnId);
  if (!held && (!replaced || replaced.reversed)) {
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
  return (
    <div className="flex flex-col gap-6">
      {/* A correction belongs to its return's order: the order shows, with no way to choose another. */}
      <OrderHeaderCompact order={order.data} />
      {/* Not keyed by version: a reload after a refusal keeps the typed rows and their errors. */}
      <ReturnForm
        key={replaceReturnId}
        order={order.data}
        replaceReturnId={replaceReturnId}
        onSaved={() => setHeld(order.data)}
      />
    </div>
  );
}
