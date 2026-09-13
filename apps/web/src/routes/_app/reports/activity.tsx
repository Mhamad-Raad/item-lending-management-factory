import {
  BusinessDate,
  businessToday,
  formatBusinessDate,
  formatMoney,
  formatNumber,
  type ActivityReportDto,
  type LedgerEntryDto,
} from '@pallet/shared';
import { useQuery } from '@tanstack/react-query';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { Ban } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import { DateRangePicker } from '@/components/app/date-picker';
import { DateText } from '@/components/app/date-text';
import { EntityCombobox } from '@/components/app/entity-combobox';
import { MoneyText } from '@/components/app/money-text';
import { QuantityText } from '@/components/app/quantity-text';
import { PageSkeleton, QueryErrorState } from '@/components/app/states';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { orderLabel } from '@/features/orders/order-text';
import { defaultPeriod } from '@/features/reports/report-dates';
import { useCanFilterBy, useFilterName } from '@/features/reports/report-filters';
import { ReportFrame } from '@/features/reports/report-frame';
import { ReportTable, type ReportColumn } from '@/features/reports/report-table';
import { apiFetch } from '@/lib/api-client';
import { qk } from '@/lib/query-keys';
import { requirePermission } from '@/lib/route-guards';

const id = z.coerce.number().int().min(1).optional().catch(undefined);
const SearchSchema = z.object({
  dateFrom: BusinessDate.optional().catch(undefined),
  dateTo: BusinessDate.optional().catch(undefined),
  customerId: id,
  itemId: id,
  driverId: id,
});

export const Route = createFileRoute('/_app/reports/activity')({
  validateSearch: SearchSchema,
  beforeLoad: () => requirePermission('reports.viewActivity'),
  component: ActivityReportPage,
});

/** Report 3 (§7.3.17, §12.4): what moved in a period, one table per kind, reversals as their own rows. */
function ActivityReportPage() {
  const { t } = useTranslation();
  const navigate = useNavigate({ from: Route.fullPath });
  const search = Route.useSearch();
  const period = defaultPeriod();
  const dateFrom = search.dateFrom ?? period.dateFrom;
  const dateTo = search.dateTo ?? period.dateTo;
  const rangeInvalid = dateFrom > dateTo;
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
  const params = { dateFrom, dateTo, customerId: search.customerId, itemId: search.itemId, driverId: search.driverId };
  const report = useQuery({
    queryKey: [...qk.reports.all(), 'activity', params],
    queryFn: () => apiFetch<ActivityReportDto>('/reports/activity', { query: params }),
    staleTime: 0,
    enabled: !rangeInvalid,
  });
  const setFilter = (patch: Partial<typeof search>) =>
    void navigate({ search: (prev) => ({ ...prev, ...patch }), replace: true });

  const moneyColumns: ReportColumn<LedgerEntryDto>[] = [
    { id: 'date', header: t('reports.activity.date'), cell: (row) => <DateText value={row.effectiveDate} /> },
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
          names[kind] ? [`${t(`reports.activity.${kind}`)}: ${names[kind]}`] : [],
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
            error={rangeInvalid ? t('errors.DATE_RANGE_INVALID') : undefined}
          />
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
      {rangeInvalid ? null : report.isPending ? (
        <PageSkeleton rows={6} />
      ) : report.isError || !data ? (
        <QueryErrorState error={report.error} onRetry={() => void report.refetch()} />
      ) : (
        <div className="flex flex-col gap-6">
          {data.truncated ? (
            <Alert>
              <AlertDescription>{t('reports.truncated')}</AlertDescription>
            </Alert>
          ) : null}

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
                  cell: (row) =>
                    row.lines.map((line) => `${line.item.name} × ${formatNumber(line.quantity)}`).join(', '),
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
              rows={data.handovers}
              rowKey={(row) => row.orderId}
              totals={{
                quantity: <QuantityText value={data.totals.handoverQuantity} />,
                depositTotal: <MoneyText value={data.totals.handoverDepositTotal} />,
              }}
              emptyText={t('reports.empty')}
            />
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
              rows={data.returns}
              rowKey={(row) => row.returnId}
              totals={{
                accepted: <QuantityText value={data.totals.returnedAccepted} />,
                damaged: <QuantityText value={data.totals.returnedDamaged} />,
                refundDue: <MoneyText value={data.totals.refundDueTotal} />,
              }}
              emptyText={t('reports.empty')}
            />
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
                  rows={data.payments}
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
              </Section>
              <Section title={t('reports.activity.refunds')}>
                <ReportTable
                  label={t('reports.activity.refunds')}
                  columns={moneyColumns}
                  rows={data.refunds}
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
              rows={data.compensation}
              rowKey={(row) => `${row.returnId}-${row.item.id}`}
              totals={{ compensation: <MoneyText value={data.totals.compensationAssessed} /> }}
              emptyText={t('reports.empty')}
            />
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
