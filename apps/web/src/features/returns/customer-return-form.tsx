import {
  businessToday,
  formatMoney,
  formatNumber,
  formatOrderNumber,
  type CustomerReturnCreateBody,
  type CustomerReturnResultDto,
  type CustomerReturnableDto,
  type OrderLineDto,
} from '@pallet/shared';
import { useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { ExternalLink, HandCoins, Loader2, Minus, Plus, TriangleAlert } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { DateField } from '@/components/app/date-field';
import { DateText } from '@/components/app/date-text';
import { Field, FieldDescription, FieldError, FieldLabel } from '@/components/app/field';
import { MoneyText } from '@/components/app/money-text';
import { MoneyInput, QuantityInput } from '@/components/app/numeric-input';
import { QuantityText } from '@/components/app/quantity-text';
import { SummaryPanel } from '@/components/app/summary-panel';
import { Thumbnail } from '@/components/app/thumbnail';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { invalidateAfterOrderChange } from '@/features/orders/api';
import { orderLabel } from '@/features/orders/order-text';
import { PaymentTypeBadge } from '@/features/orders/payment-type-text';
import { useFlowMutation } from '@/hooks/use-flow-mutation';
import { apiFetch } from '@/lib/api-client';
import { detailsOf, isApiError } from '@/lib/api-error';
import { isolate } from '@/lib/bidi';
import { handleApiError } from '@/lib/errors';
import { qk } from '@/lib/query-keys';
import { encodeValidationMessage } from '@/lib/validation-message';
import { returnSummary } from './return-math';
import { ReturnsSavedDialog } from './returns-saved-dialog';

interface RowValues {
  accepted: number | null;
  damaged: number | null;
  damagedRefund: number | null;
}

interface CustomerReturnValues {
  date: string | null;
  notes: string;
  /** Keyed `l<orderLineId>`: line ids are unique across orders, and a reloaded list keeps each row on its line. */
  rows: Record<string, RowValues>;
}

const rowKey = (orderLineId: number): `l${number}` => `l${orderLineId}`;

const count = (value: number | null | undefined): number => value ?? 0;

const EMPTY_ROW: RowValues = { accepted: 0, damaged: 0, damagedRefund: 0 };

/** Each line's order number and item name, by line id. */
function namesOf(data: CustomerReturnableDto): Map<number, { orderNumber: number; itemName: string }> {
  return new Map(
    data.orders.flatMap((order) =>
      order.lines.map((line) => [line.id, { orderNumber: order.orderNumber, itemName: line.item.name }] as const),
    ),
  );
}

/**
 * Daily flow 2 from the customer (Q156): everything the customer still holds, order by order, each order's number
 * opening the order in a new tab. Pallets back in good condition are counted with − and +, or "All"; damaged ones
 * under "Damaged". One save records a return on every order with a row, each priced against its own order, so the
 * summary adds up what each order's return would be on its own.
 */
export function CustomerReturnForm({ data, onSaved }: { data: CustomerReturnableDto; onSaved: () => void }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const customerId = data.customer.id;
  const form = useForm<CustomerReturnValues>({
    defaultValues: {
      date: businessToday(),
      notes: '',
      rows: Object.fromEntries(
        data.orders.flatMap((order) => order.lines.map((line) => [rowKey(line.id), { ...EMPTY_ROW }])),
      ),
    },
  });
  const rows = useWatch({ control: form.control, name: 'rows' });
  const date = useWatch({ control: form.control, name: 'date' });
  const errors = form.formState.errors;
  // Every line this form has shown, so a count left on one that is no longer out can still be named; added to when
  // a reload brings a new list (state adjusted during render, as React has it for props that change).
  const [seen, setSeen] = useState(() => namesOf(data));
  const [seenFor, setSeenFor] = useState(data);
  if (seenFor !== data) {
    setSeenFor(data);
    setSeen((previous) => new Map([...previous, ...namesOf(data)]));
  }
  // Lines whose damaged boxes were opened; a line with damaged pallets typed stays open.
  const [damageOpen, setDamageOpen] = useState<ReadonlySet<number>>(() => new Set());

  // The return just recorded, kept through the dialog's exit; closing it lets the flow go on (Q139).
  const [saved, setSaved] = useState<CustomerReturnResultDto | null>(null);
  const [savedOpen, setSavedOpen] = useState(false);
  const closeSaved = useRef<(() => void) | null>(null);
  useEffect(() => () => closeSaved.current?.(), []);

  const exceedsOut = (limit: number) => encodeValidationMessage('returnExceedsOut', { out: limit });
  const refundTooHigh = (maximum: number) =>
    encodeValidationMessage('damagedRefundTooHigh', { maximum: formatMoney(maximum) });
  const money = (amount: number): string => isolate(`${formatMoney(amount)} ${t('common.currency')}`);
  const lineIds = new Set(data.orders.flatMap((order) => order.lines.map((line) => line.id)));

  const orders = data.orders.map((order) => {
    const lines = order.lines.map((line) => {
      const key = rowKey(line.id);
      const typed = rows[key];
      const row = {
        accepted: count(typed?.accepted),
        damaged: count(typed?.damaged),
        damagedRefund: count(typed?.damagedRefund),
      };
      const returning = row.accepted + row.damaged;
      // Refused as typed, or by the server for a list not yet reloaded (Q141, Q146).
      const overOut = returning > line.outQuantity || Boolean(errors.rows?.[key]?.accepted);
      const maximum = row.damaged * line.unitDeposit;
      const refundOver = row.damagedRefund > maximum || Boolean(errors.rows?.[key]?.damagedRefund);
      return { line, key, row, returning, overOut, maximum, refundOver, invalid: overOut || refundOver };
    });
    // A refused row prices nothing: the summary never offers a figure the server would refuse.
    const summary = returnSummary(
      order,
      lines.map(({ line, row, invalid }) => ({
        acceptedQuantity: invalid ? 0 : row.accepted,
        damagedQuantity: invalid ? 0 : row.damaged,
        damagedRefund: invalid ? 0 : row.damagedRefund,
        unitDeposit: line.unitDeposit,
      })),
    );
    const touched = lines.some(({ returning, row }) => returning > 0 || row.damagedRefund > 0);
    return { order, lines, summary, returning: order.outQuantityTotal - summary.outAfter, touched };
  });
  const touched = orders.filter((entry) => entry.touched);
  // Counts on lines a reload no longer lists — returned or cancelled meanwhile: never sent, and said so until they
  // are let go, so a count typed is never dropped without a word.
  const gone = Object.entries(rows).flatMap(([key, typed]) => {
    const lineId = Number(key.slice(1));
    const returning = count(typed.accepted) + count(typed.damaged);
    const was = seen.get(lineId);
    return returning > 0 && !lineIds.has(lineId) && was ? [{ key, returning, ...was }] : [];
  });
  const sum = (pick: (entry: (typeof orders)[number]) => number): number =>
    touched.reduce((total, entry) => total + pick(entry), 0);
  const totals = {
    returning: sum((entry) => entry.returning),
    refundDue: sum((entry) => entry.summary.refundDue),
    owedBefore: sum((entry) => entry.summary.owedBefore),
    owedAfter: sum((entry) => entry.summary.owedAfter),
    cashRefund: sum((entry) => entry.summary.cashRefund),
    compensation: sum((entry) => entry.summary.compensation),
  };
  const outBefore = data.orders.reduce((total, order) => total + order.outQuantityTotal, 0);
  // One date for every return: not before the latest of the orders it is recorded on, refused as typed.
  const minDate = touched.reduce((latest, entry) => (entry.order.date > latest ? entry.order.date : latest), '');
  const dateTooEarly = date !== null && minDate !== '' && date < minDate;
  useEffect(() => {
    if (dateTooEarly) {
      form.setError('date', { type: 'tooEarly', message: 'errors.RETURN_DATE_BEFORE_ORDER_DATE' });
    } else if (form.getFieldState('date').error?.type === 'tooEarly') {
      form.clearErrors('date');
    }
  }, [dateTooEarly, form]);
  const anyInvalid =
    orders.some((entry) => entry.lines.some(({ invalid }) => invalid)) || gone.length > 0 || dateTooEarly;

  const record = useFlowMutation({
    request: (body: CustomerReturnCreateBody, idempotencyKey) =>
      apiFetch<CustomerReturnResultDto>(`/customers/${customerId}/returns`, {
        method: 'POST',
        body,
        idempotencyKey: idempotencyKey(),
      }),
    // Cash paid back gets the dialog with each refund's receipt, for the customer to sign for (Q137, Q139).
    showSaved: (result) => {
      if (!result.returns.some((entry) => entry.refundEntryId !== null)) {
        const [only] = result.returns;
        toast.success(
          result.returns.length === 1 && only
            ? t('returns.new.created', { orderNumber: formatOrderNumber(only.orderNumber) })
            : t('returns.customer.created', { orders: result.returns.length }),
        );
        return Promise.resolve();
      }
      return new Promise<void>((close) => {
        closeSaved.current = close;
        onSaved();
        setSaved(result);
        setSavedOpen(true);
      });
    },
    invalidate: () => invalidateAfterOrderChange(queryClient),
    // Leave first: refreshed here, the list would lose the rows just returned before the navigation.
    refresh: 'after-navigate',
    destination: (result) => {
      const [only] = result.returns;
      return result.returns.length === 1 && only
        ? { to: '/orders/$orderId', params: { orderId: String(only.orderId) } }
        : { to: '/customers/$customerId', params: { customerId: String(customerId) } };
    },
    onError: (error) => {
      const reload = (): void => void queryClient.invalidateQueries({ queryKey: qk.orders.returnable(customerId) });
      const over = detailsOf(error, 'RETURN_EXCEEDS_OUT');
      if (over) {
        for (const line of over.lines) {
          if (lineIds.has(line.orderLineId)) {
            form.setError(`rows.${rowKey(line.orderLineId)}.accepted`, { message: exceedsOut(line.outQuantity) });
          }
        }
        reload();
        return;
      }
      const refund = detailsOf(error, 'DAMAGED_REFUND_TOO_HIGH');
      if (refund && lineIds.has(refund.orderLineId)) {
        form.setError(`rows.${rowKey(refund.orderLineId)}.damagedRefund`, { message: refundTooHigh(refund.maximum) });
        reload();
        return;
      }
      // An order cancelled or settled meanwhile: the list as it stands now.
      if (isApiError(error, 'ORDER_CANCELLED') || isApiError(error, 'ORDER_NOT_FOUND')) {
        toast.error(t('returns.customer.ordersChanged'));
        reload();
        return;
      }
      handleApiError(error, {
        setError: form.setError,
        fields: ['date', 'notes'],
        fieldMap: { BUSINESS_DATE_IN_FUTURE: 'date', RETURN_DATE_BEFORE_ORDER_DATE: 'date' },
      });
    },
  });

  // Every row rule is checked as it is typed and keeps the save off (`anyInvalid`); a submit only adds the date and
  // the rule that something must come back.
  const submit = form.handleSubmit((values) => {
    form.clearErrors('root');
    // A date refused as typed stays refused; one the server refused is tried again.
    if (form.getFieldState('date').error?.type !== 'tooEarly') form.clearErrors('date');
    if (!values.date) {
      form.setError('date', { message: encodeValidationMessage('required') });
      return;
    }
    if (anyInvalid) return;
    const body = orders.flatMap(({ order, lines }) => {
      const sent = lines
        .filter(({ returning }) => returning > 0)
        .map(({ line, row }) => ({
          orderLineId: line.id,
          acceptedQuantity: row.accepted,
          damagedQuantity: row.damaged,
          damagedRefund: row.damagedRefund,
        }));
      return sent.length > 0 ? [{ orderId: order.id, lines: sent }] : [];
    });
    if (body.length === 0) {
      form.setError('root', { message: encodeValidationMessage('returnEmpty') });
      return;
    }
    const notes = values.notes.trim();
    record.mutate({ date: values.date, notes: notes === '' ? null : notes, orders: body });
  });

  const setRow = (line: OrderLineDto, next: RowValues): void => {
    const key = rowKey(line.id);
    form.setValue(`rows.${key}`, next);
    form.clearErrors(`rows.${key}`);
    form.clearErrors('root');
  };
  const allBack = (line: OrderLineDto): void =>
    setRow(line, { accepted: line.outQuantity, damaged: 0, damagedRefund: 0 });
  const toggleDamage = (lineId: number): void =>
    setDamageOpen((open) => {
      const next = new Set(open);
      if (next.has(lineId)) next.delete(lineId);
      else next.add(lineId);
      return next;
    });

  const cashNow = !anyInvalid && totals.cashRefund > 0;
  const submitButton = (
    <Button type="submit" form="customer-return" disabled={record.isPending || anyInvalid}>
      {record.isPending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
      {t('returns.new.submit')}
    </Button>
  );

  return (
    <div className="grid grid-cols-1 gap-6 pb-24 lg:grid-cols-[minmax(0,1fr)_22rem] lg:pb-0">
      <form id="customer-return" onSubmit={(event) => void submit(event)} className="flex flex-col gap-6" noValidate>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-semibold">
            {t('returns.customer.heading', {
              pallets: formatNumber(outBefore),
              orders: formatNumber(data.orders.length),
            })}
          </h2>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="w-full sm:w-auto"
            onClick={() => data.orders.forEach((order) => order.lines.forEach(allBack))}
          >
            {t('returns.customer.everythingBack')}
          </Button>
        </div>

        {gone.length > 0 ? (
          <div role="alert" className="border-warning bg-warning/10 flex flex-col gap-2 rounded-lg border p-4 text-sm">
            <p className="font-medium">{t('returns.customer.goneTitle')}</p>
            <ul className="flex flex-col gap-1">
              {gone.map((entry) => (
                <li key={entry.key}>
                  <span dir="ltr">{orderLabel(entry.orderNumber)}</span> · <bdi>{entry.itemName}</bdi> ·{' '}
                  <QuantityText value={entry.returning} />
                </li>
              ))}
            </ul>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="self-start"
              onClick={() => gone.forEach((entry) => form.setValue(`rows.${entry.key}`, { ...EMPTY_ROW }))}
            >
              {t('returns.customer.goneDismiss')}
            </Button>
          </div>
        ) : null}

        {orders.map(({ order, lines }) => (
          <Card key={order.id}>
            <CardContent className="flex flex-col gap-1">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
                  {/* A new tab: the counts typed here stay while the order is looked at. */}
                  <Link
                    to="/orders/$orderId"
                    params={{ orderId: String(order.id) }}
                    target="_blank"
                    rel="noopener"
                    className="text-primary inline-flex items-center gap-1 font-semibold underline-offset-4 hover:underline"
                  >
                    <span dir="ltr">{orderLabel(order.orderNumber)}</span>
                    <ExternalLink className="size-3.5" aria-hidden />
                    <span className="sr-only">{t('returns.customer.opensInNewTab')}</span>
                  </Link>
                  <span className="text-muted-foreground text-sm">
                    <DateText value={order.date} />
                  </span>
                  <PaymentTypeBadge type={order.paymentType} />
                  {order.owed > 0 ? (
                    <span className="text-muted-foreground text-sm">
                      {t('orders.fields.owed')}: <MoneyText value={order.owed} />
                    </span>
                  ) : null}
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  // At the end even when it wraps under the order's details.
                  className="ms-auto w-full sm:w-auto"
                  onClick={() => order.lines.forEach(allBack)}
                >
                  {t('returns.customer.orderAllBack')}
                </Button>
              </div>

              <ul className="flex flex-col divide-y">
                {lines.map(({ line, key, row, overOut, maximum, refundOver }) => {
                  const rowErrors = errors.rows?.[key];
                  const acceptedError =
                    rowErrors?.accepted?.message ?? (overOut ? exceedsOut(line.outQuantity) : undefined);
                  const refundError =
                    rowErrors?.damagedRefund?.message ?? (refundOver ? refundTooHigh(maximum) : undefined);
                  const showDamage = damageOpen.has(line.id) || row.damaged > 0;
                  const accepted = (next: number | null): void => {
                    form.setValue(`rows.${key}.accepted`, next);
                    form.clearErrors(`rows.${key}.accepted`);
                    form.clearErrors('root');
                  };
                  return (
                    <li key={line.id} className="flex flex-col gap-3 py-3">
                      {/* On a phone the damaged toggle shares the item's line and the count takes the width beneath. */}
                      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 md:grid-cols-[minmax(0,1fr)_auto_auto]">
                        <div className="flex min-w-0 items-center gap-3">
                          <Thumbnail url={line.item.imageUrl} size="sm" />
                          <div className="flex min-w-0 flex-col">
                            <span className="font-medium break-words">
                              <bdi>{line.item.name}</bdi>
                            </span>
                            <span className="text-muted-foreground text-sm">
                              {t('returns.new.out')}: <QuantityText value={line.outQuantity} /> ·{' '}
                              <MoneyText value={line.unitDeposit} />
                            </span>
                          </div>
                        </div>
                        <div className="col-span-2 row-start-2 flex items-end gap-2 md:col-span-1 md:row-start-auto">
                          <Field className="min-w-0 flex-1 gap-1 md:flex-none">
                            <FieldLabel htmlFor={`accepted-${line.id}`} className="text-xs">
                              {t('returns.fields.accepted')}
                            </FieldLabel>
                            <div dir="ltr" className="flex items-center gap-1">
                              <Button
                                type="button"
                                variant="outline"
                                size="icon"
                                className="size-10"
                                aria-label={t('returns.customer.less')}
                                disabled={row.accepted <= 0}
                                onClick={() => accepted(Math.max(0, row.accepted - 1))}
                              >
                                <Minus aria-hidden />
                              </Button>
                              <Controller
                                control={form.control}
                                name={`rows.${key}.accepted`}
                                render={({ field }) => (
                                  <QuantityInput
                                    id={`accepted-${line.id}`}
                                    className="h-10 min-w-0 flex-1 text-center md:w-20 md:flex-none"
                                    value={field.value ?? 0}
                                    onChange={(next) => accepted(next)}
                                    aria-invalid={Boolean(acceptedError)}
                                    aria-describedby={`row-${line.id}-error`}
                                  />
                                )}
                              />
                              <Button
                                type="button"
                                variant="outline"
                                size="icon"
                                className="size-10"
                                aria-label={t('returns.customer.more')}
                                disabled={row.accepted + row.damaged >= line.outQuantity}
                                onClick={() => accepted(row.accepted + 1)}
                              >
                                <Plus aria-hidden />
                              </Button>
                            </div>
                          </Field>
                          <Button type="button" variant="outline" size="sm" onClick={() => allBack(line)}>
                            {t('returns.customer.all')}
                          </Button>
                        </div>
                        <Button
                          type="button"
                          variant={showDamage ? 'secondary' : 'ghost'}
                          size="sm"
                          className="justify-self-end md:self-end"
                          aria-expanded={showDamage}
                          aria-controls={`damage-${line.id}`}
                          // Closed only while nothing damaged is typed: the boxes never hide a count.
                          disabled={row.damaged > 0}
                          onClick={() => toggleDamage(line.id)}
                        >
                          <TriangleAlert aria-hidden />
                          {t('returns.fields.damaged')}
                        </Button>
                      </div>
                      {showDamage ? (
                        <div id={`damage-${line.id}`} className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                          <Field>
                            <FieldLabel htmlFor={`damaged-${line.id}`}>{t('returns.fields.damaged')}</FieldLabel>
                            <Controller
                              control={form.control}
                              name={`rows.${key}.damaged`}
                              render={({ field }) => (
                                <QuantityInput
                                  id={`damaged-${line.id}`}
                                  value={field.value ?? 0}
                                  onChange={(next) => {
                                    field.onChange(next);
                                    form.clearErrors(`rows.${key}`);
                                    form.clearErrors('root');
                                    // No damaged pallets, nothing to refund for them.
                                    if (!next) form.setValue(`rows.${key}.damagedRefund`, 0);
                                  }}
                                  aria-invalid={Boolean(acceptedError)}
                                  aria-describedby={`row-${line.id}-error`}
                                />
                              )}
                            />
                          </Field>
                          <Field>
                            <FieldLabel htmlFor={`refund-${line.id}`}>{t('returns.fields.damagedRefund')}</FieldLabel>
                            <Controller
                              control={form.control}
                              name={`rows.${key}.damagedRefund`}
                              render={({ field }) => (
                                <MoneyInput
                                  id={`refund-${line.id}`}
                                  value={field.value ?? 0}
                                  onChange={(next) => {
                                    field.onChange(next);
                                    form.clearErrors(`rows.${key}.damagedRefund`);
                                  }}
                                  disabled={row.damaged === 0}
                                  suffix={t('common.currency')}
                                  aria-invalid={Boolean(refundError)}
                                  aria-describedby={`refund-${line.id}-split refund-${line.id}-error`}
                                />
                              )}
                            />
                            <FieldError id={`refund-${line.id}-error`} message={refundError} />
                            {row.damaged > 0 && !overOut && !refundOver ? (
                              <FieldDescription id={`refund-${line.id}-split`}>
                                {t('returns.new.damageSplit', {
                                  deposit: money(maximum),
                                  refund: money(row.damagedRefund),
                                  kept: money(maximum - row.damagedRefund),
                                })}
                              </FieldDescription>
                            ) : null}
                          </Field>
                        </div>
                      ) : null}
                      <FieldError id={`row-${line.id}-error`} message={acceptedError} />
                    </li>
                  );
                })}
              </ul>
            </CardContent>
          </Card>
        ))}
        <FieldError id="lines-error" message={errors.root?.message} />

        <Card>
          <CardContent className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <DateField
              control={form.control}
              name="date"
              id="date"
              label={t('returns.fields.date')}
              min={minDate === '' ? undefined : minDate}
            />
            <Field className="md:col-span-2">
              <FieldLabel htmlFor="notes">{t('returns.fields.notes')}</FieldLabel>
              <Textarea id="notes" rows={2} maxLength={1000} {...form.register('notes')} />
            </Field>
          </CardContent>
        </Card>
      </form>

      <SummaryPanel
        title={t('returns.new.summary')}
        keyLabel={t(cashNow ? 'returns.new.cashRefund' : 'returns.new.refundDue')}
        keyFigure={<MoneyText value={cashNow ? totals.cashRefund : totals.refundDue} />}
        submit={submitButton}
      >
        <dl className="flex flex-col gap-3 text-sm">
          {(
            [
              ['returns.customer.palletsBack', <QuantityText key="returning" value={totals.returning} />],
              ['returns.new.refundDue', <MoneyText key="refundDue" value={totals.refundDue} />],
              ['returns.new.owedBefore', <MoneyText key="owedBefore" value={totals.owedBefore} />],
              ['returns.new.owedAfter', <MoneyText key="owedAfter" value={totals.owedAfter} />],
              ['returns.new.outAfter', <QuantityText key="outAfter" value={outBefore - totals.returning} />],
              ['returns.new.compensation', <MoneyText key="compensation" value={totals.compensation} />],
            ] as const
          ).map(([label, value]) => (
            <div key={label} className="flex justify-between gap-2">
              <dt className="text-muted-foreground">{t(label)}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
        {/* Each order's return is its own: where the cash comes from, order by order. */}
        {touched.length > 1 && !anyInvalid ? (
          <ul aria-label={t('returns.customer.byOrder')} className="flex flex-col gap-1 border-t pt-3 text-sm">
            {touched.map(({ order, returning, summary }) => (
              <li key={order.id} className="flex justify-between gap-2">
                <span dir="ltr" className="font-medium">
                  {orderLabel(order.orderNumber)}
                </span>
                <span className="text-muted-foreground text-end">
                  {t('returns.customer.orderBack', { pallets: formatNumber(returning) })}
                  {summary.cashRefund > 0 ? (
                    <>
                      {' · '}
                      <MoneyText value={summary.cashRefund} />
                    </>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
        ) : null}
        {anyInvalid ? null : (
          <>
            {totals.cashRefund > 0 ? (
              <p className="bg-success/12 text-success flex items-center gap-2 rounded-md p-3 font-semibold dark:bg-success/20">
                <HandCoins className="size-5 shrink-0" aria-hidden />
                {t('returns.new.cashHandover', { amount: formatMoney(totals.cashRefund) })}
              </p>
            ) : null}
            {totals.owedAfter > 0 ? (
              <p className="text-info text-sm">
                {t('returns.new.stillOwes', { amount: formatMoney(totals.owedAfter) })}
              </p>
            ) : null}
          </>
        )}
      </SummaryPanel>
      {saved ? (
        <ReturnsSavedDialog
          result={saved}
          open={savedOpen}
          onClose={() => {
            setSavedOpen(false);
            closeSaved.current?.();
          }}
        />
      ) : null}
    </div>
  );
}
