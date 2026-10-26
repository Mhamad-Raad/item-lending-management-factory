import { useQuery } from '@tanstack/react-query';
import { ClipboardList } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { DataTable } from '@/components/app/data-table';
import { EmptyState, PageSkeleton, QueryErrorState } from '@/components/app/states';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { orderListQuery } from '@/features/orders/api';
import { ORDER_COLUMNS, orderRowLink } from '@/features/orders/order-columns';

const STATUSES = ['OPEN', 'SETTLED', 'CANCELLED', 'ALL'] as const;
type Status = (typeof STATUSES)[number];

/**
 * One customer's or one driver's orders, with a status choice of their own (§7.3.12, Q149). The column naming the
 * record the page is about is left out: on its own page it would say the same name on every row.
 */
export function RelatedOrders({
  filter,
  label,
  defaultStatus,
}: {
  filter: { customerId: number } | { driverId: number };
  label: string;
  defaultStatus: Status;
}) {
  const { t } = useTranslation();
  const [status, setStatus] = useState<Status>(defaultStatus);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const params = { ...filter, status, page, pageSize };
  const orders = useQuery(orderListQuery(params));
  const hidden = 'customerId' in filter ? 'customer' : 'driver';

  return (
    <div className="flex flex-col gap-3">
      <Select
        value={status}
        onValueChange={(next) => {
          setStatus(next as Status);
          setPage(1);
        }}
      >
        <SelectTrigger className="w-44" aria-label={t('orders.fields.status')}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {STATUSES.map((value) => (
            <SelectItem key={value} value={value}>
              {t(value === 'ALL' ? 'orders.list.allStatuses' : `enums.orderStatus.${value}`)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {orders.isPending ? (
        <PageSkeleton rows={3} />
      ) : orders.isError ? (
        <QueryErrorState error={orders.error} onRetry={() => void orders.refetch()} />
      ) : (
        <DataTable
          label={label}
          columns={ORDER_COLUMNS.filter((column) => column.id !== hidden)}
          rows={orders.data.items}
          rowKey={(order) => order.id}
          rowLink={orderRowLink}
          total={orders.data.total}
          page={orders.data.page}
          pageSize={orders.data.pageSize}
          onPageChange={setPage}
          // The size picker of the main lists, so the paging reads the same here (it pages from the first record).
          onPageSizeChange={(size) => {
            setPageSize(size);
            setPage(1);
          }}
          isFetching={orders.isFetching}
          empty={<EmptyState icon={ClipboardList} title={t('orders.list.empty')} />}
        />
      )}
    </div>
  );
}
