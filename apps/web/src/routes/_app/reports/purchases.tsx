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
import { defaultPeriod } from '@/features/reports/report-dates';
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

type Row = PurchasesReportDto['rows'][number];

/** Report 2 (§7.3.17, §12.3): the batches of a period with their cost, subtotalled per item, never averaged. */
function PurchasesReportPage() {
  const { t } = useTranslation();
  const navigate = useNavigate({ from: Route.fullPath });
  const search = Route.useSearch();
  const period = defaultPeriod();
  const dateFrom = search.dateFrom ?? period.dateFrom;
  const dateTo = search.dateTo ?? period.dateTo;
  const rangeInvalid = dateFrom > dateTo;
  const canItems = useCanFilterBy('item');
  const itemName = useFilterName('item', search.itemId);
  const params = { dateFrom, dateTo, itemId: search.itemId };
  const report = useQuery({
    queryKey: [...qk.reports.all(), 'purchases', params],
    queryFn: () => apiFetch<PurchasesReportDto>('/reports/purchases', { query: params }),
    staleTime: 0,
    enabled: !rangeInvalid,
  });

  const columns: ReportColumn<Row>[] = [
    { id: 'date', header: t('reports.purchases.date'), cell: (row) => <DateText value={row.date} /> },
    { id: 'item', header: t('reports.purchases.item'), cell: (row) => row.item.name },
    {
      id: 'quantity',
      header: t('reports.purchases.quantity'),
      align: 'end',
      cell: (row) => <QuantityText value={row.quantity} />,
    },
    {
      id: 'unitCost',
      header: t('reports.purchases.unitCost'),
      align: 'end',
      cell: (row) => <MoneyText value={row.unitCost} />,
    },
    {
      id: 'totalCost',
      header: t('reports.purchases.totalCost'),
      align: 'end',
      cell: (row) => <MoneyText value={row.totalCost} />,
    },
    { id: 'note', header: t('reports.purchases.note'), cell: (row) => row.note ?? '' },
  ];
  // Subtotals follow the last batch of each item in the period (rows are by date, so an item's
  // subtotal row closes its batches rather than grouping them together).
  const lastOfItem = new Map(report.data?.rows.map((row) => [row.item.id, row.batchId]) ?? []);

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
            error={rangeInvalid ? t('errors.DATE_RANGE_INVALID') : undefined}
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
      {rangeInvalid ? null : report.isPending ? (
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
            rows={report.data.rows}
            rowKey={(row) => row.batchId}
            expanded={(row) => {
              const subtotal = report.data.perItem.find((item) => item.item.id === row.item.id);
              if (lastOfItem.get(row.item.id) !== row.batchId || !subtotal) return null;
              return (
                <tr
                  aria-label={t('reports.purchases.subtotal', { name: row.item.name })}
                  className="bg-muted/30 border-b font-medium"
                >
                  <td className="px-3 py-2" colSpan={2}>
                    {t('reports.purchases.subtotal', { name: row.item.name })}
                  </td>
                  <td className="px-3 py-2 text-end tabular-nums">
                    <QuantityText value={subtotal.quantity} />
                  </td>
                  <td />
                  <td className="px-3 py-2 text-end tabular-nums">
                    <MoneyText value={subtotal.totalCost} />
                  </td>
                  <td />
                </tr>
              );
            }}
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
