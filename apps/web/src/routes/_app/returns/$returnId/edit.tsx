import type { CustomerReturnEditableDto } from '@pallet/shared';
import { useQuery } from '@tanstack/react-query';
import { Link, createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { PageHeader } from '@/components/app/page-header';
import { EmptyState, PageSkeleton, QueryErrorState } from '@/components/app/states';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { returnEditableQuery } from '@/features/returns/api';
import { orderLabel } from '@/features/orders/order-text';
import { CustomerReturnForm } from '@/features/returns/customer-return-form';
import { usePageTitle } from '@/hooks/use-page-title';
import { isApiError } from '@/lib/api-error';
import { isolate } from '@/lib/bidi';
import { prefetch } from '@/lib/prefetch';
import { WHILE_EDITING } from '@/lib/query-client';
import { requirePermission } from '@/lib/route-guards';

/** The return's id from the address; anything but a whole number above zero names no return. */
function idOf(raw: string): number | null {
  const id = Number(raw);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

export const Route = createFileRoute('/_app/returns/$returnId/edit')({
  beforeLoad: () => requirePermission('returns.edit'),
  loader: ({ context, params }) => {
    const id = idOf(params.returnId);
    return id === null ? undefined : prefetch(context.queryClient, returnEditableQuery(id));
  },
  component: EditReturnPage,
});

/**
 * A return edited from the returns list (Q174), on the customer screen it was recorded on: every pallet the customer
 * holds as if it had never been recorded, its counts typed in, and a save replaces it — a visit over several orders
 * whole.
 */
function EditReturnPage() {
  const { t } = useTranslation();
  const { returnId } = Route.useParams();
  usePageTitle('returns.edit.title');
  const id = idOf(returnId);
  const query = useQuery({ ...returnEditableQuery(id ?? 0), ...WHILE_EDITING, enabled: id !== null });
  // Once saved, the list stays as it was beneath the saved dialog, as on the new-return screen.
  const [held, setHeld] = useState<CustomerReturnEditableDto | null>(null);
  const data = held ?? query.data;

  let body;
  if (data === undefined) {
    body =
      id === null ||
      (query.isError &&
        (isApiError(query.error, 'RETURN_ALREADY_REVERSED') ||
          isApiError(query.error, 'RETURN_NOT_FOUND') ||
          isApiError(query.error, 'ORDER_CANCELLED'))) ? (
        <EmptyState
          title={t('returns.new.notReplaceable')}
          action={
            <Button asChild variant="outline">
              <Link to="/returns">{t('returns.edit.backToList')}</Link>
            </Button>
          }
        />
      ) : query.isError ? (
        <QueryErrorState error={query.error} onRetry={() => void query.refetch()} />
      ) : (
        <PageSkeleton rows={3} />
      );
  } else {
    body = (
      <div className="flex flex-col gap-6">
        <Card>
          <CardContent className="flex flex-col gap-1">
            <span className="text-muted-foreground text-sm">{t('orders.fields.customer')}</span>
            <bdi className="font-medium">{data.customer.name}</bdi>
            {/* Recorded from an order's page (Q175): the edit keeps it. */}
            {data.withOrder ? (
              <span className="text-muted-foreground text-sm">
                {t('returns.withOrder.tag', { orderNumber: isolate(orderLabel(data.withOrder.orderNumber)) })}
              </span>
            ) : null}
          </CardContent>
        </Card>
        <CustomerReturnForm
          data={data}
          edit={data}
          withOrder={data.withOrder ?? undefined}
          onSaved={() => setHeld(data)}
        />
      </div>
    );
  }
  return (
    <>
      <PageHeader title={t('returns.edit.title')} />
      {body}
    </>
  );
}
