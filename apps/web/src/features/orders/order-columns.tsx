import type { OrderListItemDto } from '@pallet/shared';
import { Link } from '@tanstack/react-router';
import type { DataColumn } from '@/components/app/data-table';
import { DateText } from '@/components/app/date-text';
import { MoneyText } from '@/components/app/money-text';
import { QuantityText } from '@/components/app/quantity-text';
import { StatusBadge } from '@/components/app/status-badge';
import { PaymentTypeText } from './payment-type-text';
import { orderLabel } from './order-text';

/** The columns of an order list (§7.3.4), shared by `/orders` and a customer's orders tab. */
export const ORDER_COLUMNS: DataColumn<OrderListItemDto>[] = [
  {
    id: 'orderNumber',
    header: 'orders.fields.orderNumber',
    cell: (order) => orderLabel(order.orderNumber),
    sortKey: 'orderNumber',
  },
  { id: 'date', header: 'orders.fields.date', cell: (order) => <DateText value={order.date} />, sortKey: 'date' },
  { id: 'customer', header: 'orders.fields.customer', cell: (order) => order.customer.name, mobile: 'subtitle' },
  { id: 'driver', header: 'orders.fields.driver', cell: (order) => order.driver.name, hideBelow: 'lg' },
  {
    id: 'paymentType',
    header: 'orders.fields.paymentType',
    cell: (order) => <PaymentTypeText type={order.paymentType} />,
    hideBelow: 'lg',
  },
  {
    id: 'depositTotal',
    header: 'orders.fields.depositTotal',
    cell: (order) => <MoneyText value={order.depositTotal} />,
    align: 'end',
    hideBelow: 'lg',
  },
  {
    id: 'palletsOut',
    header: 'orders.fields.palletsOut',
    cell: (order) => <QuantityText value={order.outQuantityTotal} />,
    align: 'end',
  },
  {
    id: 'owed',
    header: 'orders.fields.owed',
    cell: (order) => <MoneyText value={order.owed} />,
    sortKey: 'owed',
    align: 'end',
  },
  {
    id: 'outValue',
    header: 'orders.fields.outValue',
    cell: (order) => <MoneyText value={order.outValue} />,
    sortKey: 'outValue',
    align: 'end',
    hideBelow: 'lg',
  },
  {
    id: 'held',
    header: 'orders.fields.held',
    cell: (order) => <MoneyText value={order.held} />,
    align: 'end',
    hideBelow: 'lg',
  },
  { id: 'status', header: 'orders.fields.status', cell: (order) => <StatusBadge status={order.status} /> },
];

/** The first cell of an order row: a link to the order, the row's tab stop (§7.15). */
export function orderRowLink(order: OrderListItemDto, children: React.ReactNode) {
  return (
    <Link to="/orders/$orderId" params={{ orderId: String(order.id) }} className="underline-offset-4 hover:underline">
      {children}
    </Link>
  );
}
