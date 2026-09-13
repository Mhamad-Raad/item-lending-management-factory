import type { OrderDetailDto, OrderListItemDto, PageDto } from '@pallet/shared';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { DateText } from '@/components/app/date-text';
import { EntityCombobox } from '@/components/app/entity-combobox';
import { Field, FieldLabel } from '@/components/app/field';
import { MoneyText } from '@/components/app/money-text';
import { QuantityText } from '@/components/app/quantity-text';
import { EmptyState, PageSkeleton, QueryErrorState } from '@/components/app/states';
import { Card, CardContent } from '@/components/ui/card';
import { apiFetch } from '@/lib/api-client';
import { qk } from '@/lib/query-keys';
import { orderLabel } from './order-text';
import { PaymentTypeText } from './payment-type-text';

/**
 * The first step of daily flows 2 and 3 (§7.4.2, §7.4.3): a customer, then that customer's open orders
 * the flow applies to, as cards. Choosing never navigates away — the caller writes the choice into the
 * search params — and a single qualifying order is chosen at once.
 */
export function OrderPicker({
  customerId,
  onCustomerChange,
  query,
  eligible,
  onSelect,
  showOwedOnly,
  autoSelect = true,
}: {
  customerId: number | null;
  onCustomerChange: (customerId: number | null) => void;
  /** Extra list filters, e.g. `{ paymentType: 'LENT' }` for payments. */
  query?: Record<string, string>;
  eligible: (order: OrderListItemDto) => boolean;
  onSelect: (orderId: number) => void;
  /** A payment card needs only the date and what is owed; a return card also shows pallets out. */
  showOwedOnly?: boolean;
  /**
   * Choose a single qualifying order at once. Off when the user has just asked to change the order,
   * or the one order would be chosen again before they could pick another.
   */
  autoSelect?: boolean;
}) {
  const { t } = useTranslation();
  const params = { customerId: customerId ?? undefined, status: 'OPEN', pageSize: 100, ...query };
  const orders = useQuery({
    queryKey: qk.orders.list(params),
    queryFn: () => apiFetch<PageDto<OrderListItemDto>>('/orders', { query: params }),
    enabled: customerId !== null,
  });
  const choices = orders.data?.items.filter(eligible) ?? [];
  const only = autoSelect && choices.length === 1 ? choices[0]?.id : undefined;

  useEffect(() => {
    if (only !== undefined) onSelect(only);
  }, [only, onSelect]);

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardContent>
          <Field>
            <FieldLabel htmlFor="customerId">{t('orders.fields.customer')}</FieldLabel>
            <EntityCombobox
              id="customerId"
              kind="customer"
              // Returns and payments stay possible on an archived customer's open orders.
              includeArchived
              autoFocus
              value={customerId}
              onChange={onCustomerChange}
              placeholder={t('orders.fields.chooseCustomer')}
            />
          </Field>
        </CardContent>
      </Card>

      {customerId === null ? null : orders.isPending ? (
        <PageSkeleton rows={2} />
      ) : orders.isError ? (
        <QueryErrorState error={orders.error} onRetry={() => void orders.refetch()} />
      ) : choices.length === 0 ? (
        <EmptyState title={t('orders.picker.empty')} />
      ) : (
        <section className="flex flex-col gap-3">
          <h2 className="font-semibold">{t('orders.picker.title')}</h2>
          <ul className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {choices.map((order) => (
              <li key={order.id}>
                <button
                  type="button"
                  onClick={() => onSelect(order.id)}
                  className="bg-card hover:bg-accent/40 focus-visible:ring-ring flex w-full flex-col gap-2 rounded-lg border p-4 text-start focus-visible:ring-2 focus-visible:outline-none"
                >
                  <span className="flex flex-wrap items-center justify-between gap-2">
                    <span dir="ltr" className="font-semibold">
                      {orderLabel(order.orderNumber)}
                    </span>
                    <DateText value={order.date} />
                  </span>
                  <span className="text-muted-foreground flex flex-wrap gap-x-4 gap-y-1 text-sm">
                    {showOwedOnly ? null : (
                      <>
                        <PaymentTypeText type={order.paymentType} />
                        <span>
                          {t('orders.fields.palletsOut')}: <QuantityText value={order.outQuantityTotal} />
                        </span>
                      </>
                    )}
                    <span>
                      {t('orders.fields.owed')}: <MoneyText value={order.owed} />
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

/** The chosen order, compactly, with the way back to choosing another (§7.4.2 step 2). */
export function OrderHeaderCompact({ order, onChange }: { order: OrderDetailDto; onChange: () => void }) {
  const { t } = useTranslation();
  return (
    <Card>
      <CardContent className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Link
            to="/orders/$orderId"
            params={{ orderId: String(order.id) }}
            dir="ltr"
            className="text-lg font-semibold underline-offset-4 hover:underline"
          >
            {orderLabel(order.orderNumber)}
          </Link>
          <button
            type="button"
            onClick={onChange}
            className="text-primary min-h-10 text-sm underline-offset-4 hover:underline md:min-h-0"
          >
            {t('orders.picker.change')}
          </button>
        </div>
        <dl className="text-muted-foreground grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-3">
          <div className="col-span-2 sm:col-span-3">
            <dt className="sr-only">{t('orders.fields.customer')}</dt>
            <dd className="text-foreground">{order.customer.name}</dd>
          </div>
          <div>
            <dt className="sr-only">{t('orders.fields.date')}</dt>
            <dd>
              <DateText value={order.date} />
            </dd>
          </div>
          <div>
            <dt className="sr-only">{t('orders.fields.paymentType')}</dt>
            <dd>
              <PaymentTypeText type={order.paymentType} />
            </dd>
          </div>
          <div>
            <dt className="inline">{t('orders.fields.owed')}: </dt>
            <dd className="inline">
              <MoneyText value={order.owed} />
            </dd>
          </div>
          <div>
            <dt className="inline">{t('orders.fields.palletsOut')}: </dt>
            <dd className="inline">
              <QuantityText value={order.outQuantityTotal} />
            </dd>
          </div>
        </dl>
      </CardContent>
    </Card>
  );
}
