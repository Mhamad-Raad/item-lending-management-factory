import { createFileRoute } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { PageHeader } from '@/components/app/page-header';
import { ItemForm } from '@/features/items/item-form';
import { usePageTitle } from '@/hooks/use-page-title';
import { requirePermission } from '@/lib/route-guards';

export const Route = createFileRoute('/_app/items/new')({
  beforeLoad: () => requirePermission('items.create'),
  component: NewItemPage,
});

function NewItemPage() {
  const { t } = useTranslation();
  usePageTitle('items.new.title');

  return (
    <>
      <PageHeader title={t('items.new.title')} />
      <ItemForm />
    </>
  );
}
