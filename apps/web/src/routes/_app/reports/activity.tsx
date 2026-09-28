import {
  ACTIVITY_PAGE_SIZE_MAX,
  BusinessDate,
  businessToday,
  formatBusinessDate,
  formatMoney,
  PAGE_MAX,
  type ActivityMoneyRowDto,
  type ActivityReportDto,
  type ActivitySection,
  type ReportSectionDto,
} from '@pallet/shared';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { Fragment } from 'react';
import { Ban } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import { DateRangePicker } from '@/components/app/date-picker';
import { DateText } from '@/components/app/date-text';
import { EntityCombobox } from '@/components/app/entity-combobox';
import { MoneyText } from '@/components/app/money-text';
import { QuantityText } from '@/components/app/quantity-text';
import { Pagination } from '@/components/app/pagination';
import { PageSkeleton, QueryErrorState } from '@/components/app/states';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { orderLabel } from '@/features/orders/order-text';
import { periodRefusalOf, reportPeriod } from '@/features/reports/report-dates';
import { useCanFilterBy, useFilterName } from '@/features/reports/report-filters';
import { ReportFrame } from '@/features/reports/report-frame';
import { ReportTable, type ReportColumn } from '@/features/reports/report-table';
import { apiFetch } from '@/lib/api-client';
import { isolate } from '@/lib/bidi';
import { qk } from '@/lib/query-keys';
import { requirePermission } from '@/lib/route-guards';
import { REPORT_QUERY } from '@/lib/query-client';

const id = z.coerce.number().int().min(1).optional().catch(undefined);
const sectionPage = z.coerce.number().int().min(2).max(PAGE_MAX).optional().catch(undefined);
/** Rows per section page (Q99): the page shown is the page printed. */
const PAGE_SIZES = [100, 250, ACTIVITY_PAGE_SIZE_MAX] as const;
const DEFAULT_PAGE_SIZE = PAGE_SIZES[0];
const SearchSchema = z.object({
  dateFrom: BusinessDate.optional().catch(undefined),
  dateTo: BusinessDate.optional().catch(undefined),
  customerId: id,
  itemId: id,
  driverId: id,
  // Each section keeps its own page; page 1 is left out of the URL.
  handoversPage: sectionPage,
  returnsPage: sectionPage,
  paymentsPage: sectionPage,
  refundsPage: sectionPage,
  compensationPage: sectionPage,
  pageSize: z.coerce
    .number()
    .refine((size) => (PAGE_SIZES as readonly number[]).includes(size))
    .optional()
    .catch(undefined),
});

type Search = z.infer<typeof SearchSchema>;
const pageKey = (section: ActivitySection) => `${section}Page` as const;
const FIRST_PAGES = {
  handoversPage: undefined,
  returnsPage: undefined,
  paymentsPage: undefined,
  refundsPage: undefined,
  compensationPage: undefined,
} satisfies Partial<Search>;

export const Route = createFileRoute('/_app/reports/activity')({
  validateSearch: SearchSchema,
  beforeLoad: () => requirePermission('reports.viewActivity'),
  component: ActivityReportPage,
});

/**
 * Report 3 (§7.3.17, §12.4): what moved in a period, one table per kind, reversals as their own rows. Each
 * table is one page of its section (Q99), with the section's totals over the whole period.
 */
function ActivityReportPage() {
  const { t } = useTranslation();
  const navigate = useNavigate({ from: Route.fullPath });
  const search = Route.useSearch();
  const { dateFrom, dateTo, refusal } = reportPeriod(search);
  const allowed = {
    customer: useCanFilterBy('customer'),
    item: useCanFilterBy('item'),
    driver: useCanFilterBy('driver'),
  };
  const names = {
    customer: useFilterName('customer', search.customerId),
    item: useFilterName('item', search.itemId),
    driver: useFilterName('driver', search.driverId),
  };
  const pageSize = search.pageSize ?? DEFAULT_PAGE_SIZE;
  const params = {
    dateFrom,
    dateTo,
    customerId: search.customerId,
    itemId: search.itemId,
    driverId: search.driverId,
    handoversPage: search.handoversPage,
    returnsPage: search.returnsPage,
    paymentsPage: search.paymentsPage,
    refundsPage: search.refundsPage,
    compensationPage: search.compensationPage,
    pageSize,
  };
  const report = useQuery({
    queryKey: [...qk.reports.all(), 'activity', params],
    queryFn: () => apiFetch<ActivityReportDto>('/reports/activity', { query: params }),
    ...REPORT_QUERY,
    // A new page keeps the other tables on screen while it loads.
    placeholderData: keepPreviousData,
    enabled: refusal === null,
  });
  const dateRefusal = refusal ?? periodRefusalOf(report.error);
  // A new filter or page size starts every section on its first page again.
  const setFilter = (patch: Partial<Search>) =>
    void navigate({ search: (prev) => ({ ...prev, ...FIRST_PAGES, ...patch }), replace: true });
  const setPage = (section: ActivitySection, page: number) =>
    void navigate({ search: (prev) => ({ ...prev, [pageKey(section)]: page > 1 ? page : undefined }) });
  const pager = <T,>(name: ActivitySection, section: ReportSectionDto<T>) => (
    <SectionPager section={section} onPageChange={(page) => setPage(name, page)} />
  );

  const moneyColumns: ReportColumn<ActivityMoneyRowDto>[] = [
    { id: 'date', header: t('reports.activity.date'), cell: (row) => <DateText value={row.date} /> },
    {
      id: 'order',
      header: t('reports.activity.order'),
      cell: (row) => <span dir="ltr">{orderLabel(row.orderNumber)}</span>,
    },
    { id: 'customer', header: t('reports.activity.customer'), cell: (row) => row.customer.name },
    {
      id: 'type',
      header: t('reports.activity.type'),
      cell: (row) => (
        <span className="flex flex-wrap items-center gap-2">
          {t(`enums.ledgerEntryType.${row.type}`)}
          {row.reversesEntryId ? (
            <Badge variant="secondary">
              <Ban aria-hidden />
              {t('reports.activity.reversal')}
            </Badge>
          ) : null}
        </span>
      ),
    },
    {
      id: 'amount',
      header: t('reports.activity.amount'),
      align: 'end',
      cell: (row) => <MoneyText value={row.amount} />,
    },
  ];

  const data = report.data;
  return (
    <ReportFrame
      report="activity"
      landscape
      generatedAt={data?.generatedAt}
      printedFilters={[
        t('reports.period', { from: formatBusinessDate(dateFrom), to: formatBusinessDate(dateTo) }),
        ...(['customer', 'item', 'driver'] as const).flatMap((kind) =>
          names[kind] ? [`${t(`reports.activity.${kind}`)}: ${isolate(names[kind])}`] : [],
        ),
      ]}
      filters={
        <>
          <DateRangePicker
            idPrefix="activity-date"
            from={dateFrom}
            to={dateTo}
            max={businessToday()}
            onChange={({ from, to }) => setFilter({ dateFrom: from, dateTo: to })}
            error={dateRefusal ? t(`errors.${dateRefusal}`) : undefined}
          />
          <Select value={String(pageSize)} onValueChange={(value) => setFilter({ pageSize: Number(value) })}>
            <SelectTrigger className="w-full md:w-32" aria-label={t('common.pagination.pageSize')}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PAGE_SIZES.map((size) => (
                <SelectItem key={size} value={String(size)}>
                  {size}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {(['customer', 'item', 'driver'] as const)
            .filter((kind) => allowed[kind])
            .map((kind) => (
              <div key={kind} className="w-full md:w-56">
                <EntityCombobox
                  kind={kind}
                  includeArchived
                  aria-label={t(`reports.activity.${kind}`)}
                  value={search[`${kind}Id`] ?? null}
                  onChange={(next) => setFilter({ [`${kind}Id`]: next ?? undefined })}
                  placeholder={t(
                    `reports.${kind === 'customer' ? 'allCustomers' : kind === 'item' ? 'allItems' : 'allDrivers'}`,
                  )}
                />
              </div>
            ))}
        </>
      }
    >
      {dateRefusal ? null : report.isPending ? (
        <PageSkeleton rows={6} />
      ) : report.isError || !data ? (
        <QueryErrorState error={report.error} onRetry={() => void report.refetch()} />
      ) : (
        <div className="flex flex-col gap-6">
          <p className="text-muted-foreground text-sm">{t('reports.activity.pagedNote')}</p>

          <Section title={t('reports.activity.handovers')}>
            <ReportTable
              label={t('reports.activity.handovers')}
              columns={[
                { id: 'date', header: t('reports.activity.date'), cell: (row) => <DateText value={row.date} /> },
                {
                  id: 'order',
                  header: t('reports.activity.order'),
                  cell: (row) => <span dir="ltr">{orderLabel(row.orderNumber)}</span>,
                },
                { id: 'customer', header: t('reports.activity.customer'), cell: (row) => row.customer.name },
                { id: 'driver', header: t('reports.activity.driver'), cell: (row) => row.driver.name },
                {
                  id: 'lines',
                  header: t('reports.activity.pallets'),
                  // An element, not a string: each name is isolated on its own, and the list keeps the page's
                  // direction whatever script the first item's name is in.
                  cell: (row) => (
                    <span>
                      {row.lines.map((line, index) => (
                        <Fragment key={line.item.id}>
                          {index > 0 ? ', ' : null}
                          <bdi>{line.item.name}</bdi> × <QuantityText value={line.quantity} />
                        </Fragment>
                      ))}
                    </span>
                  ),
                },
                {
                  id: 'quantity',
                  header: t('reports.activity.quantity'),
                  align: 'end',
                  cell: (row) => <QuantityText value={row.quantity} />,
                },
                {
                  id: 'depositTotal',
                  header: t('reports.activity.deposit'),
                  align: 'end',
                  cell: (row) => <MoneyText value={row.depositTotal} />,
                },
              ]}
              rows={data.handovers.rows}
              rowKey={(row) => row.orderId}
              totals={{
                quantity: <QuantityText value={data.totals.handoverQuantity} />,
                depositTotal: <MoneyText value={data.totals.handoverDepositTotal} />,
              }}
              emptyText={t('reports.empty')}
            />
            {pager('handovers', data.handovers)}
          </Section>

          <Section title={t('reports.activity.returns')}>
            <ReportTable
              label={t('reports.activity.returns')}
              columns={[
                { id: 'date', header: t('reports.activity.date'), cell: (row) => <DateText value={row.date} /> },
                {
                  id: 'order',
                  header: t('reports.activity.order'),
                  cell: (row) => <span dir="ltr">{orderLabel(row.orderNumber)}</span>,
                },
                { id: 'customer', header: t('reports.activity.customer'), cell: (row) => row.customer.name },
                {
                  id: 'accepted',
                  header: t('reports.activity.accepted'),
                  align: 'end',
                  cell: (row) => <QuantityText value={row.acceptedQuantity} />,
                },
                {
                  id: 'damaged',
                  header: t('reports.activity.damaged'),
                  align: 'end',
                  cell: (row) => <QuantityText value={row.damagedQuantity} />,
                },
                {
                  id: 'refundDue',
                  header: t('reports.activity.refundDue'),
                  align: 'end',
                  cell: (row) => <MoneyText value={row.refundDue} />,
                },
              ]}
              rows={data.returns.rows}
              rowKey={(row) => row.returnId}
              totals={{
                accepted: <QuantityText value={data.totals.returnedAccepted} />,
                damaged: <QuantityText value={data.totals.returnedDamaged} />,
                refundDue: <MoneyText value={data.totals.refundDueTotal} />,
              }}
              emptyText={t('reports.empty')}
            />
            {pager('returns', data.returns)}
          </Section>

          {data.moneyOmitted ? (
            <Alert>
              <AlertDescription>{t('reports.activity.moneyOmitted')}</AlertDescription>
            </Alert>
          ) : (
            <>
              <Section title={t('reports.activity.payments')}>
                <ReportTable
                  label={t('reports.activity.payments')}
                  columns={moneyColumns}
                  rows={data.payments.rows}
                  rowKey={(row) => row.id}
                  totals={{
                    type: t('reports.activity.grossReversals', {
                      gross: formatMoney(data.totals.paymentsGross),
                      reversals: formatMoney(data.totals.paymentReversals),
                    }),
                    amount: <MoneyText value={data.totals.paymentsNet} />,
                  }}
                  emptyText={t('reports.empty')}
                />
                {pager('payments', data.payments)}
              </Section>
              <Section title={t('reports.activity.refunds')}>
                <ReportTable
                  label={t('reports.activity.refunds')}
                  columns={moneyColumns}
                  rows={data.refunds.rows}
                  rowKey={(row) => row.id}
                  totals={{
                    type: t('reports.activity.grossReversals', {
                      gross: formatMoney(data.totals.refundsGross),
                      reversals: formatMoney(data.totals.refundReversals),
                    }),
                    amount: <MoneyText value={data.totals.refundsNet} />,
                  }}
                  emptyText={t('reports.empty')}
                />
                {pager('refunds', data.refunds)}
              </Section>
            </>
          )}

          <Section title={t('reports.activity.compensationAssessed')} note={t('reports.activity.compensationNote')}>
            <ReportTable
              label={t('reports.activity.compensationAssessed')}
              columns={[
                { id: 'date', header: t('reports.activity.date'), cell: (row) => <DateText value={row.date} /> },
                {
                  id: 'order',
                  header: t('reports.activity.order'),
                  cell: (row) => <span dir="ltr">{orderLabel(row.orderNumber)}</span>,
                },
                { id: 'customer', header: t('reports.activity.customer'), cell: (row) => row.customer.name },
                { id: 'item', header: t('reports.activity.item'), cell: (row) => row.item.name },
                {
                  id: 'damaged',
                  header: t('reports.activity.damaged'),
                  align: 'end',
                  cell: (row) => <QuantityText value={row.damagedQuantity} />,
                },
                {
                  id: 'damagedRefund',
                  header: t('reports.activity.damagedRefund'),
                  align: 'end',
                  cell: (row) => <MoneyText value={row.damagedRefund} />,
                },
                {
                  id: 'compensation',
                  header: t('reports.activity.compensation'),
                  align: 'end',
                  cell: (row) => <MoneyText value={row.compensation} />,
                },
              ]}
              rows={data.compensation.rows}
              rowKey={(row) => row.returnLineId}
              totals={{ compensation: <MoneyText value={data.totals.compensationAssessed} /> }}
              emptyText={t('reports.empty')}
            />
            {pager('compensation', data.compensation)}
          </Section>
        </div>
      )}
    </ReportFrame>
  );
}

function Section({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-lg font-semibold">{title}</h2>
      {note ? <p className="text-muted-foreground text-sm">{note}</p> : null}
      {children}
    </section>
  );
}

/**
 * A section's paging (Q99): on screen, the record count and the way to the next page; on paper, which rows
 * of how many the printed page holds, so a short table is not mistaken for the whole period.
 */
function SectionPager<T>({
  section,
  onPageChange,
}: {
  section: ReportSectionDto<T>;
  onPageChange: (page: number) => void;
}) {
  const { t } = useTranslation();
  if (section.total === 0) return null;
  const first = Math.min((section.page - 1) * section.pageSize + 1, section.total);
  const last = Math.min(first + section.rows.length - 1, section.total);
  return (
    <>
      <div data-print="hide">
        <Pagination page={section.page} pageSize={section.pageSize} total={section.total} onPageChange={onPageChange} />
      </div>
      <p className="hidden text-sm print:block">
        {t('reports.activity.rowsShown', { from: first, to: last, total: section.total })}
      </p>
    </>
  );
}
