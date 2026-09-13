import { BusinessDate, businessToday, formatBusinessDate, type PurchasesReportDto } from '@pallet/shared';
import { useQuery } from '@tanstack/react-query';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import { DateRangePicker } from '@/components/app/date-picker';
import { DateText } from '@/components/app/date-text';
import { EntityCombobox } from '@/components/app/entity-combobox';
import { MoneyText } from '@/components/app/money-text';
import { QuantityText } from '@/components/app/quantity-text';
import { PageSkeleton, QueryErrorState } from '@/components/app/states';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { useCanFilterBy, useFilterName } from '@/features/reports/report-filters';
import { ReportFrame } from '@/features/reports/report-frame';
import { periodRefusalOf, reportPeriod } from '@/features/reports/report-dates';
import { ReportTable, type ReportColumn } from '@/features/reports/report-table';
import { apiFetch } from '@/lib/api-client';
import { qk } from '@/lib/query-keys';
import { requirePermission } from '@/lib/route-guards';

const SearchSchema = z.object({
  dateFrom: BusinessDate.optional().catch(undefined),
  dateTo: BusinessDate.optional().catch(undefined),
  itemId: z.coerce.number().int().min(1).optional().catch(undefined),
});

export const Route = createFileRoute('/_app/reports/purchases')({
  validateSearch: SearchSchema,
  beforeLoad: () => requirePermission('reports.viewPurchases'),
  component: PurchasesReportPage,
});

type Batch = PurchasesReportDto['rows'][number];
type Subtotal = PurchasesReportDto['perItem'][number];
type Row = { kind: 'batch'; batch: Batch } | { kind: 'subtotal'; subtotal: Subtotal };

/**
 * Each item's batches (by date, as the API sends them) followed by its subtotal, items in the API's order.
 * Subtotals come from the complete per-item totals, so an item whose batches all fell past the row cap
 * still has its line, and the subtotals always add up to the total below them.
 */
function groupByItem(report: PurchasesReportDto): Row[] {
  return report.perItem.flatMap((subtotal) => [
    ...report.rows
      .filter((batch) => batch.item.id === subtotal.item.id)
      .map((batch): Row => ({ kind: 'batch', batch })),
    { kind: 'subtotal', subtotal },
  ]);
}

/** Report 2 (§7.3.17, §12.3): the batches of a period with their cost, subtotalled per item, never averaged. */
function PurchasesReportPage() {
  const { t } = useTranslation();
  const navigate = useNavigate({ from: Route.fullPath });
  const search = Route.useSearch();
  const { dateFrom, dateTo, refusal } = reportPeriod(search);
  const canItems = useCanFilterBy('item');
  const itemName = useFilterName('item', search.itemId);
  const params = { dateFrom, dateTo, itemId: search.itemId };
  const report = useQuery({
    queryKey: [...qk.reports.all(), 'purchases', params],
    queryFn: () => apiFetch<PurchasesReportDto>('/reports/purchases', { query: params }),
    staleTime: 0,
    enabled: refusal === null,
  });
  const dateRefusal = refusal ?? periodRefusalOf(report.error);

  const columns: ReportColumn<Row>[] = [
    {
      id: 'item',
      header: t('reports.purchases.item'),
      cell: (row) =>
        row.kind === 'batch' ? row.batch.item.name : t('reports.purchases.subtotal', { name: row.subtotal.item.name }),
    },
    {
      id: 'date',
      header: t('reports.purchases.date'),
      cell: (row) => (row.kind === 'batch' ? <DateText value={row.batch.date} /> : null),
    },
    {
      id: 'quantity',
      header: t('reports.purchases.quantity'),
      align: 'end',
      cell: (row) => <QuantityText value={row.kind === 'batch' ? row.batch.quantity : row.subtotal.quantity} />,
    },
    {
      id: 'unitCost',
      header: t('reports.purchases.unitCost'),
      align: 'end',
      cell: (row) => (row.kind === 'batch' ? <MoneyText value={row.batch.unitCost} /> : null),
    },
    {
      id: 'totalCost',
      header: t('reports.purchases.totalCost'),
      align: 'end',
      cell: (row) => <MoneyText value={row.kind === 'batch' ? row.batch.totalCost : row.subtotal.totalCost} />,
    },
    {
      id: 'note',
      header: t('reports.purchases.note'),
      cell: (row) => (row.kind === 'batch' ? (row.batch.note ?? '') : null),
    },
  ];

  return (
    <ReportFrame
      report="purchases"
      generatedAt={report.data?.generatedAt}
      printedFilters={[
        t('reports.period', { from: formatBusinessDate(dateFrom), to: formatBusinessDate(dateTo) }),
        ...(itemName ? [`${t('reports.purchases.item')}: ${itemName}`] : []),
      ]}
      filters={
        <>
          <DateRangePicker
            idPrefix="purchases-date"
            from={dateFrom}
            to={dateTo}
            max={businessToday()}
            onChange={({ from, to }) =>
              void navigate({ search: (prev) => ({ ...prev, dateFrom: from, dateTo: to }), replace: true })
            }
            error={dateRefusal ? t(`errors.${dateRefusal}`) : undefined}
          />
          {canItems ? (
            <div className="w-full md:w-56">
              <EntityCombobox
                kind="item"
                includeArchived
                aria-label={t('reports.purchases.item')}
                value={search.itemId ?? null}
                onChange={(itemId) =>
                  void navigate({ search: (prev) => ({ ...prev, itemId: itemId ?? undefined }), replace: true })
                }
                placeholder={t('reports.allItems')}
              />
            </div>
          ) : null}
        </>
      }
    >
      {dateRefusal ? null : report.isPending ? (
        <PageSkeleton rows={4} />
      ) : report.isError ? (
        <QueryErrorState error={report.error} onRetry={() => void report.refetch()} />
      ) : (
        <>
          {report.data.truncated ? (
            <Alert>
              <AlertDescription>{t('reports.truncated')}</AlertDescription>
            </Alert>
          ) : null}
          <ReportTable
            label={t('reports.purchases.title')}
            columns={columns}
            rows={groupByItem(report.data)}
            rowKey={(row) => (row.kind === 'batch' ? `b${row.batch.batchId}` : `s${row.subtotal.item.id}`)}
            rowClassName={(row) => (row.kind === 'subtotal' ? 'bg-muted/30 font-medium' : undefined)}
            totals={{
              quantity: <QuantityText value={report.data.totals.quantity} />,
              totalCost: <MoneyText value={report.data.totals.totalCost} />,
            }}
            emptyText={t('reports.empty')}
          />
        </>
      )}
    </ReportFrame>
  );
}
