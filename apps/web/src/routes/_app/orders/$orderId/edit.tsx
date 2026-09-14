import { useQuery } from '@tanstack/react-query';
import { Link, createFileRoute } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { PageHeader } from '@/components/app/page-header';
import { PageSkeleton, QueryErrorState } from '@/components/app/states';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { orderQuery } from '@/features/orders/api';
import { EditOrderForm } from '@/features/orders/edit-order-form';
import { usePageTitle } from '@/hooks/use-page-title';
import { requirePermission } from '@/lib/route-guards';
import { prefetch } from '@/lib/prefetch';
import { WHILE_EDITING } from '@/lib/query-client';

export const Route = createFileRoute('/_app/orders/$orderId/edit')({
  beforeLoad: () => requirePermission('orders.edit'),
  loader: ({ context, params }) => prefetch(context.queryClient, orderQuery(Number(params.orderId))),
  component: EditOrderPage,
});

function EditOrderPage() {
  const { t } = useTranslation();
  const { orderId } = Route.useParams();
  const order = useQuery({ ...orderQuery(Number(orderId)), ...WHILE_EDITING });
  usePageTitle('orders.edit.title');

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

  return (
    <>
      <PageHeader title={t('orders.edit.title')} />
      {order.data.cancelledAt ? (
        // A cancelled order takes no edits (§6.19); say so instead of offering a form.
        <Alert>
          <AlertDescription>{t('errors.ORDER_CANCELLED')}</AlertDescription>
        </Alert>
      ) : (
        // Keyed by version: a change recorded elsewhere remounts the form with what is stored.
        <EditOrderForm key={order.data.version} order={order.data} />
      )}
    </>
  );
}
