import { createFileRoute } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { PageHeader } from '@/components/app/page-header';
import { CustomerForm } from '@/features/customers/customer-form';
import { usePageTitle } from '@/hooks/use-page-title';
import { requirePermission } from '@/lib/route-guards';

export const Route = createFileRoute('/_app/customers/new')({
  beforeLoad: () => requirePermission('customers.create'),
  component: NewCustomerPage,
});

function NewCustomerPage() {
  const { t } = useTranslation();
  usePageTitle('customers.new.title');

  return (
    <>
      <PageHeader title={t('customers.new.title')} />
      <CustomerForm />
    </>
  );
}
