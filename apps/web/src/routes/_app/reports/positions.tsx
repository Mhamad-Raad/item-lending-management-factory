import type { PositionsReportDto } from '@pallet/shared';
import { useQuery } from '@tanstack/react-query';
import { Link, createFileRoute, useNavigate } from '@tanstack/react-router';
import { ChevronDown } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import { EntityCombobox } from '@/components/app/entity-combobox';
import { MoneyText } from '@/components/app/money-text';
import { QuantityText } from '@/components/app/quantity-text';
import { PageSkeleton, QueryErrorState } from '@/components/app/states';
import { useCanFilterBy, useFilterName } from '@/features/reports/report-filters';
import { ReportFrame } from '@/features/reports/report-frame';
import { ReportTable, type ReportColumn } from '@/features/reports/report-table';
import { isolate } from '@/lib/bidi';
import { apiFetch } from '@/lib/api-client';
import { qk } from '@/lib/query-keys';
import { requirePermission } from '@/lib/route-guards';
import { cn } from '@/lib/utils';
import { REPORT_QUERY } from '@/lib/query-client';

const SORTS = ['customerName', 'palletsOut', 'outValue', 'owed', 'held'] as const;
const SearchSchema = z.object({
  customerId: z.coerce.number().int().min(1).optional().catch(undefined),
  sort: z
    .enum([...SORTS, ...SORTS.map((field) => `-${field}` as const)])
    .optional()
    .catch(undefined),
});

export const Route = createFileRoute('/_app/reports/positions')({
  validateSearch: SearchSchema,
  beforeLoad: () => requirePermission('reports.viewPositions'),
  component: PositionsReportPage,
});

type Row = PositionsReportDto['rows'][number];

/** Report 1 (§7.3.17, §12.2): what each customer holds and owes right now, sorted on the page. */
function PositionsReportPage() {
  const { t } = useTranslation();
  const navigate = useNavigate({ from: Route.fullPath });
  const search = Route.useSearch();
  const [open, setOpen] = useState<ReadonlySet<number>>(new Set());
  const canCustomers = useCanFilterBy('customer');
  const customerName = useFilterName('customer', search.customerId);
  // A customer chosen by name is shown even with nothing out, owed or held.
  const params = { customerId: search.customerId, includeZero: search.customerId ? true : undefined };
  const report = useQuery({
    queryKey: [...qk.reports.all(), 'positions', params],
    queryFn: () => apiFetch<PositionsReportDto>('/reports/positions', { query: params }),
    ...REPORT_QUERY,
  });
  const toggle = (customerId: number) =>
    setOpen((current) => {
      const next = new Set(current);
      if (next.has(customerId)) next.delete(customerId);
      else next.add(customerId);
      return next;
    });

  const columns: ReportColumn<Row>[] = [
    {
      id: 'customerName',
      header: t('reports.positions.customer'),
      sortValue: (row) => row.customer.name,
      cell: (row) => (
        <span className="flex items-center gap-2">
          <button
            type="button"
            data-print="hide"
            aria-expanded={open.has(row.customer.id)}
            aria-label={t('reports.positions.perItem', { name: row.customer.name })}
            onClick={() => toggle(row.customer.id)}
            className="hover:bg-accent flex size-10 shrink-0 items-center justify-center rounded-md md:size-8"
          >
            <ChevronDown
              className={cn('size-4 transition-transform', open.has(row.customer.id) && 'rotate-180')}
              aria-hidden
            />
          </button>
          {canCustomers ? (
            <Link
              to="/customers/$customerId"
              params={{ customerId: String(row.customer.id) }}
              className="underline-offset-4 hover:underline"
            >
              <bdi>{row.customer.name}</bdi>
            </Link>
          ) : (
            <bdi>{row.customer.name}</bdi>
          )}
        </span>
      ),
    },
    {
      id: 'palletsOut',
      header: t('reports.positions.palletsOut'),
      align: 'end',
      sortValue: (row) => row.palletsOut,
      cell: (row) => <QuantityText value={row.palletsOut} />,
    },
    {
      id: 'outValue',
      header: t('reports.positions.outValue'),
      align: 'end',
      sortValue: (row) => row.outValue,
      cell: (row) => <MoneyText value={row.outValue} />,
    },
    {
      id: 'owed',
      header: t('reports.positions.owed'),
      align: 'end',
      sortValue: (row) => row.owed,
      cell: (row) => <MoneyText value={row.owed} />,
    },
    {
      id: 'held',
      header: t('reports.positions.held'),
      align: 'end',
      sortValue: (row) => row.held,
      cell: (row) => <MoneyText value={row.held} />,
    },
  ];

  const data = report.data;
  const itemName = (itemId: number) => data?.columns.find((item) => item.id === itemId)?.name ?? '';
  const perItem = (cells: { itemId: number; quantityOut: number }[]) => (
    <ul className="text-muted-foreground flex flex-wrap gap-x-4 gap-y-1 text-sm font-normal">
      {cells
        .filter((cell) => cell.quantityOut > 0)
        .map((cell) => (
          <li key={cell.itemId}>
            <bdi>{itemName(cell.itemId)}</bdi>: <QuantityText value={cell.quantityOut} />
          </li>
        ))}
    </ul>
  );

  return (
    <ReportFrame
      report="positions"
      generatedAt={data?.generatedAt}
      printedFilters={customerName ? [`${t('reports.positions.customer')}: ${isolate(customerName)}`] : []}
      filters={
        canCustomers ? (
          <div className="w-full md:w-64">
            <EntityCombobox
              kind="customer"
              includeArchived
              aria-label={t('reports.positions.customer')}
              value={search.customerId ?? null}
              onChange={(customerId) =>
                void navigate({ search: (prev) => ({ ...prev, customerId: customerId ?? undefined }), replace: true })
              }
              placeholder={t('reports.allCustomers')}
            />
          </div>
        ) : undefined
      }
    >
      {report.isPending ? (
        <PageSkeleton rows={4} />
      ) : report.isError ? (
        <QueryErrorState error={report.error} onRetry={() => void report.refetch()} />
      ) : (
        <ReportTable
          label={t('reports.positions.title')}
          columns={columns}
          rows={report.data.rows}
          rowKey={(row) => row.customer.id}
          sort={search.sort}
          // The API's own order (PositionsReportQuery).
          defaultSort="-owed"
          onSortChange={(sort) =>
            void navigate({ search: (prev) => ({ ...prev, sort: sort as typeof prev.sort }), replace: true })
          }
          expanded={(row) =>
            open.has(row.customer.id) ? (
              <tr className="bg-muted/30 border-b">
                <td colSpan={columns.length} className="px-3 py-2 ps-14">
                  {perItem(row.palletsOutByItem)}
                </td>
              </tr>
            ) : null
          }
          totals={{
            palletsOut: <QuantityText value={report.data.totals.palletsOut} />,
            outValue: <MoneyText value={report.data.totals.outValue} />,
            owed: <MoneyText value={report.data.totals.owed} />,
            held: <MoneyText value={report.data.totals.held} />,
          }}
          emptyText={t('reports.empty')}
        />
      )}
      {data && data.totals.palletsOut > 0 ? (
        <section className="flex flex-col gap-1">
          <h2 className="text-sm font-semibold">{t('reports.positions.totalPerItem')}</h2>
          {perItem(data.totals.palletsOutByItem)}
        </section>
      ) : null}
    </ReportFrame>
  );
}
