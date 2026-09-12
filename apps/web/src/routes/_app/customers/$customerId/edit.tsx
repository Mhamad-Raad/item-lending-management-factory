import { useQuery } from '@tanstack/react-query';
import { Link, createFileRoute } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { PageHeader } from '@/components/app/page-header';
import { PageSkeleton, QueryErrorState } from '@/components/app/states';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { customerQuery } from '@/features/customers/api';
import { CustomerForm } from '@/features/customers/customer-form';
import { usePageTitle } from '@/hooks/use-page-title';
import { requirePermission } from '@/lib/route-guards';
import { prefetch } from '@/lib/prefetch';

export const Route = createFileRoute('/_app/customers/$customerId/edit')({
  beforeLoad: () => requirePermission('customers.edit'),
  loader: ({ context, params }) => prefetch(context.queryClient, customerQuery(Number(params.customerId))),
  component: EditCustomerPage,
});

function EditCustomerPage() {
  const { t } = useTranslation();
  const { customerId } = Route.useParams();
  const customer = useQuery(customerQuery(Number(customerId)));
  usePageTitle('customers.edit.title');

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

  return (
    <>
      <PageHeader title={t('customers.edit.title')} description={customer.data.name} />
      {customer.data.archivedAt ? (
        // The API refuses edits to an archived customer (§6.17); say so instead of offering a form.
        <Alert>
          <AlertDescription>{t('customers.detail.archivedBanner')}</AlertDescription>
        </Alert>
      ) : (
        <CustomerForm key={customer.data.version} customer={customer.data} />
      )}
    </>
  );
}
