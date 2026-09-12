import { createFileRoute } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import { PageHeader } from '@/components/app/page-header';
import { NewOrderForm } from '@/features/orders/new-order-form';
import { usePageTitle } from '@/hooks/use-page-title';
import { requirePermission } from '@/lib/route-guards';

const SearchSchema = z.object({ customerId: z.coerce.number().int().min(1).optional().catch(undefined) });

export const Route = createFileRoute('/_app/orders/new')({
  validateSearch: SearchSchema,
  beforeLoad: () => requirePermission('orders.create'),
  component: NewOrderPage,
});

function NewOrderPage() {
  const { t } = useTranslation();
  const { customerId } = Route.useSearch();
  usePageTitle('orders.new.title');

  return (
    <>
      <PageHeader title={t('orders.new.title')} />
      <NewOrderForm initialCustomerId={customerId} />
    </>
  );
}
