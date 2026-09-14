import { useQuery } from '@tanstack/react-query';
import { Link, createFileRoute } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { PageHeader } from '@/components/app/page-header';
import { PageSkeleton, QueryErrorState } from '@/components/app/states';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { itemQuery } from '@/features/items/api';
import { ItemForm } from '@/features/items/item-form';
import { usePageTitle } from '@/hooks/use-page-title';
import { requirePermission } from '@/lib/route-guards';
import { prefetch } from '@/lib/prefetch';
import { WHILE_EDITING } from '@/lib/query-client';

export const Route = createFileRoute('/_app/items/$itemId/edit')({
  beforeLoad: () => requirePermission('items.edit'),
  loader: ({ context, params }) => prefetch(context.queryClient, itemQuery(Number(params.itemId))),
  component: EditItemPage,
});

function EditItemPage() {
  const { t } = useTranslation();
  const { itemId } = Route.useParams();
  const item = useQuery({ ...itemQuery(Number(itemId)), ...WHILE_EDITING });
  usePageTitle('items.edit.title');

  if (item.isPending) return <PageSkeleton />;
  if (item.isError) {
    return (
      <QueryErrorState
        error={item.error}
        onRetry={() => void item.refetch()}
        backLink={<Link to="/items">{t('items.detail.backToList')}</Link>}
      />
    );
  }

  return (
    <>
      <PageHeader title={t('items.edit.title')} description={item.data.name} />
      {item.data.archivedAt ? (
        // The API refuses edits to an archived item (§6.15); say so instead of offering a form.
        <Alert>
          <AlertDescription>{t('items.detail.archivedBanner')}</AlertDescription>
        </Alert>
      ) : (
        // Keyed by version: a save elsewhere remounts the form with what is stored.
        <ItemForm key={item.data.version} item={item.data} />
      )}
    </>
  );
}
