import { formatNumber, type StockReportDto } from '@pallet/shared';
import { useQuery } from '@tanstack/react-query';
import { Link, createFileRoute, useNavigate } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import { FilterSwitch } from '@/components/app/list-controls';
import { QuantityText } from '@/components/app/quantity-text';
import { PageSkeleton, QueryErrorState } from '@/components/app/states';
import { LowStockBadge } from '@/features/items/item-badges';
import { useCanFilterBy } from '@/features/reports/report-filters';
import { ReportFrame } from '@/features/reports/report-frame';
import { ReportTable, type ReportColumn } from '@/features/reports/report-table';
import { apiFetch } from '@/lib/api-client';
import { flagSearch } from '@/lib/list-search';
import { qk } from '@/lib/query-keys';
import { requirePermission } from '@/lib/route-guards';

const SORTS = ['name', 'quantityOnHand', 'quantityOut', 'damagedTotal'] as const;
const SearchSchema = z.object({
  includeArchived: flagSearch,
  lowStockOnly: flagSearch,
  sort: z
    .enum([...SORTS, ...SORTS.map((field) => `-${field}` as const)])
    .optional()
    .catch(undefined),
});

export const Route = createFileRoute('/_app/reports/stock')({
  validateSearch: SearchSchema,
  beforeLoad: () => requirePermission('reports.viewStock'),
  component: StockReportPage,
});

type Row = StockReportDto['rows'][number];

/** Report 4 (§7.3.17, §12.5): stock per item now, with the low-stock flag in words as well as colour. */
function StockReportPage() {
  const { t } = useTranslation();
  const navigate = useNavigate({ from: Route.fullPath });
  const search = Route.useSearch();
  const canItems = useCanFilterBy('item');
  const params = { includeArchived: search.includeArchived, lowStockOnly: search.lowStockOnly };
  const report = useQuery({
    queryKey: [...qk.reports.all(), 'stock', params],
    queryFn: () => apiFetch<StockReportDto>('/reports/stock', { query: params }),
    staleTime: 0,
  });
  const setFilter = (patch: Partial<typeof search>) =>
    void navigate({ search: (prev) => ({ ...prev, ...patch }), replace: true });

  const columns: ReportColumn<Row>[] = [
    {
      id: 'name',
      header: t('reports.stock.item'),
      sortValue: (row) => row.item.name,
      cell: (row) => (
        <span className="flex flex-wrap items-center gap-2">
          {canItems ? (
            <Link
              to="/items/$itemId"
              params={{ itemId: String(row.item.id) }}
              className="underline-offset-4 hover:underline"
            >
              {row.item.name}
            </Link>
          ) : (
            row.item.name
          )}
          {row.isLowStock ? <LowStockBadge /> : null}
        </span>
      ),
    },
    {
      id: 'quantityOnHand',
      header: t('reports.stock.onHand'),
      align: 'end',
      sortValue: (row) => row.quantityOnHand,
      cell: (row) => <QuantityText value={row.quantityOnHand} />,
    },
    {
      id: 'quantityOut',
      header: t('reports.stock.out'),
      align: 'end',
      sortValue: (row) => row.quantityOut,
      cell: (row) => <QuantityText value={row.quantityOut} />,
    },
    {
      id: 'damagedTotal',
      header: t('reports.stock.damaged'),
      align: 'end',
      sortValue: (row) => row.damagedTotal,
      cell: (row) => <QuantityText value={row.damagedTotal} />,
    },
    {
      id: 'minStock',
      header: t('reports.stock.minStock'),
      align: 'end',
      cell: (row) => (row.minStock === null ? '—' : <QuantityText value={row.minStock} />),
    },
  ];

  return (
    <ReportFrame
      report="stock"
      generatedAt={report.data?.generatedAt}
      printedFilters={[
        ...(search.lowStockOnly ? [t('reports.stock.lowStockOnly')] : []),
        ...(search.includeArchived ? [t('common.includeArchived')] : []),
      ]}
      filters={
        <>
          <FilterSwitch
            id="lowStockOnly"
            label={t('reports.stock.lowStockOnly')}
            checked={search.lowStockOnly ?? false}
            onCheckedChange={(on) => setFilter({ lowStockOnly: on || undefined })}
          />
          <FilterSwitch
            id="includeArchived"
            label={t('common.includeArchived')}
            checked={search.includeArchived ?? false}
            onCheckedChange={(on) => setFilter({ includeArchived: on || undefined })}
          />
        </>
      }
    >
      {report.isPending ? (
        <PageSkeleton rows={4} />
      ) : report.isError ? (
        <QueryErrorState error={report.error} onRetry={() => void report.refetch()} />
      ) : (
        <ReportTable
          label={t('reports.stock.title')}
          columns={columns}
          rows={report.data.rows}
          rowKey={(row) => row.item.id}
          sort={search.sort}
          // The API's own order (StockReportQuery).
          defaultSort="name"
          onSortChange={(sort) => setFilter({ sort: sort as typeof search.sort })}
          totals={{
            quantityOnHand: <QuantityText value={report.data.totals.quantityOnHand} />,
            quantityOut: <QuantityText value={report.data.totals.quantityOut} />,
            damagedTotal: <QuantityText value={report.data.totals.damagedTotal} />,
            minStock:
              report.data.totals.lowStockCount > 0
                ? t('reports.stock.lowStockCount', { value: formatNumber(report.data.totals.lowStockCount) })
                : null,
          }}
          emptyText={t('reports.empty')}
        />
      )}
    </ReportFrame>
  );
}
