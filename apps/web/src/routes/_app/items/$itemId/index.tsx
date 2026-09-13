import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, createFileRoute, useNavigate } from '@tanstack/react-router';
import { Archive, PackagePlus, Pencil, SlidersHorizontal } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { z } from 'zod';
import { ArchivedBadge } from '@/components/app/archived-badge';
import { ConfirmDialog } from '@/components/app/confirm-dialog';
import { MoneyText } from '@/components/app/money-text';
import { PageHeader } from '@/components/app/page-header';
import { QuantityText } from '@/components/app/quantity-text';
import { PageSkeleton, QueryErrorState } from '@/components/app/states';
import { Thumbnail } from '@/components/app/thumbnail';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { AdjustStockDialog } from '@/features/items/adjust-stock-dialog';
import { invalidateStock, itemQuery } from '@/features/items/api';
import { BatchDialog } from '@/features/items/batch-dialog';
import { BatchesTab } from '@/features/items/batches-tab';
import { LowStockBadge } from '@/features/items/item-badges';
import { MovementsTab } from '@/features/items/movements-tab';
import { usePageTitle } from '@/hooks/use-page-title';
import { isolate } from '@/lib/bidi';
import { apiFetch } from '@/lib/api-client';
import { useCan } from '@/lib/auth';
import { handleApiError } from '@/lib/errors';
import { qk } from '@/lib/query-keys';
import { requirePermission } from '@/lib/route-guards';
import { prefetch } from '@/lib/prefetch';

const SearchSchema = z.object({ tab: z.enum(['movements', 'batches']).optional().catch(undefined) });

export const Route = createFileRoute('/_app/items/$itemId/')({
  validateSearch: SearchSchema,
  beforeLoad: () => requirePermission('items.view'),
  loader: ({ context, params }) => prefetch(context.queryClient, itemQuery(Number(params.itemId))),
  component: ItemDetailPage,
});

type Dialog = 'batch' | 'adjust' | 'archive' | null;

function ItemDetailPage() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const navigate = useNavigate({ from: Route.fullPath });
  const { itemId } = Route.useParams();
  const search = Route.useSearch();
  const item = useQuery(itemQuery(Number(itemId)));
  const can = {
    viewBatches: useCan('purchases.view'),
    addBatch: useCan('purchases.create'),
    adjust: useCan('items.adjustStock'),
    edit: useCan('items.edit'),
    archive: useCan('items.delete'),
  };
  const [dialog, setDialog] = useState<Dialog>(null);
  usePageTitle('items.detail.title');

  const archive = useMutation({
    mutationFn: (version: number) => apiFetch(`/items/${itemId}`, { method: 'DELETE', query: { version } }),
    onSuccess: async () => {
      await invalidateStock(queryClient);
      toast.success(t('items.detail.archived'));
      setDialog(null);
    },
    onError: (error) => {
      setDialog(null);
      handleApiError(error, {
        onReload: () => void queryClient.invalidateQueries({ queryKey: qk.items.detail(Number(itemId)) }),
      });
    },
  });

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

  const data = item.data;
  const live = data.archivedAt === null;
  const tab = search.tab === 'batches' && can.viewBatches ? 'batches' : 'movements';
  const figures = [
    { label: 'items.fields.depositPrice', value: <MoneyText value={data.depositPrice} /> },
    { label: 'items.fields.quantityOnHand', value: <QuantityText value={data.quantityOnHand} /> },
    { label: 'items.fields.quantityOut', value: <QuantityText value={data.quantityOut} /> },
    { label: 'items.fields.damagedTotal', value: <QuantityText value={data.damagedTotal} /> },
    {
      label: 'items.fields.minStock',
      value: data.minStock === null ? t('items.detail.noMinStock') : <QuantityText value={data.minStock} />,
    },
  ] as const;

  return (
    <>
      <PageHeader
        title={data.name}
        actions={
          <div className="flex flex-wrap gap-2">
            {can.addBatch && live ? (
              <Button variant="outline" onClick={() => setDialog('batch')}>
                <PackagePlus aria-hidden />
                {t('items.detail.addBatch')}
              </Button>
            ) : null}
            {/* A recount is allowed on an archived item too (§6.15). */}
            {can.adjust ? (
              <Button variant="outline" onClick={() => setDialog('adjust')}>
                <SlidersHorizontal aria-hidden />
                {t('items.detail.adjustStock')}
              </Button>
            ) : null}
            {can.edit && live ? (
              <Button variant="outline" asChild>
                <Link to="/items/$itemId/edit" params={{ itemId }}>
                  <Pencil aria-hidden />
                  {t('common.actions.edit')}
                </Link>
              </Button>
            ) : null}
            {can.archive && live ? (
              <Button variant="outline" onClick={() => setDialog('archive')}>
                <Archive aria-hidden />
                {t('common.actions.archive')}
              </Button>
            ) : null}
          </div>
        }
      />

      {live ? null : (
        <Alert>
          <AlertDescription>{t('items.detail.archivedBanner')}</AlertDescription>
        </Alert>
      )}

      <Card>
        <CardContent className="flex flex-col gap-6 sm:flex-row">
          <Thumbnail url={data.imageUrl} size="lg" />
          <div className="flex flex-1 flex-col gap-3">
            <div className="flex flex-wrap gap-1">
              {data.isLowStock ? <LowStockBadge /> : null}
              {live ? null : <ArchivedBadge />}
            </div>
            <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3">
              {figures.map((figure) => (
                <div key={figure.label} className="flex flex-col gap-1">
                  <dt className="text-muted-foreground text-sm">{t(figure.label)}</dt>
                  <dd className="text-lg font-medium">{figure.value}</dd>
                </div>
              ))}
            </dl>
          </div>
        </CardContent>
      </Card>

      <Tabs
        value={tab}
        onValueChange={(next) =>
          void navigate({ search: { tab: next === 'batches' ? 'batches' : undefined }, replace: true })
        }
      >
        <TabsList>
          <TabsTrigger value="movements">{t('items.detail.tabs.movements')}</TabsTrigger>
          {can.viewBatches ? <TabsTrigger value="batches">{t('items.detail.tabs.batches')}</TabsTrigger> : null}
        </TabsList>
        <TabsContent value="movements">
          <MovementsTab itemId={data.id} />
        </TabsContent>
        {can.viewBatches ? (
          <TabsContent value="batches">
            <BatchesTab itemId={data.id} />
          </TabsContent>
        ) : null}
      </Tabs>

      {/* Mounted only while open, so its date defaults to the day it is opened, not the day the page was. */}
      {dialog === 'batch' ? (
        <BatchDialog itemId={data.id} open onOpenChange={(open) => setDialog(open ? 'batch' : null)} />
      ) : null}
      <AdjustStockDialog
        item={data}
        open={dialog === 'adjust'}
        onOpenChange={(open) => setDialog(open ? 'adjust' : null)}
      />
      <ConfirmDialog
        open={dialog === 'archive'}
        onOpenChange={(open) => setDialog(open ? 'archive' : null)}
        title={t('items.detail.archiveTitle', { name: isolate(data.name) })}
        description={t('items.detail.archiveBody')}
        confirmLabel={t('common.actions.archive')}
        pending={archive.isPending}
        onConfirm={() => archive.mutate(data.version)}
      />
    </>
  );
}
