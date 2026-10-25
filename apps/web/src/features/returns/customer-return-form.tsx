import {
  CUSTOMER_RETURN_MAX_ORDERS,
  businessToday,
  formatMoney,
  formatBusinessDate,
  formatNumber,
  formatOrderNumber,
  type CustomerReturnCreateBody,
  type CustomerReturnResultDto,
  type CustomerReturnableDto,
} from '@pallet/shared';
import { useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { ExternalLink, HandCoins, Loader2, Minus, Plus, TriangleAlert } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { DateField } from '@/components/app/date-field';
import { EmptyState } from '@/components/app/states';
import { Field, FieldDescription, FieldError, FieldLabel } from '@/components/app/field';
import { MoneyText } from '@/components/app/money-text';
import { MoneyInput, QuantityInput } from '@/components/app/numeric-input';
import { QuantityText } from '@/components/app/quantity-text';
import { SummaryCard, SummaryFigures, SummaryPanel } from '@/components/app/summary-panel';
import { ItemName } from '@/components/app/item-name';
import { Thumbnail } from '@/components/app/thumbnail';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { invalidateAfterOrderChange } from '@/features/orders/api';
import { orderLabel } from '@/features/orders/order-text';
import { useFlowMutation } from '@/hooks/use-flow-mutation';
import { apiFetch } from '@/lib/api-client';
import { detailsOf, isApiError } from '@/lib/api-error';
import { isolate } from '@/lib/bidi';
import { handleApiError } from '@/lib/errors';
import { qk } from '@/lib/query-keys';
import { encodeValidationMessage, translateValidationMessage } from '@/lib/validation-message';
import {
  allocate,
  isAfterReturn,
  isOrderAfterReturn,
  olderOrderFirst,
  itemHoldings,
  outBy,
  refundMaximum,
  type ItemHolding,
  type LineShare,
} from './allocate';
import { returnSummary } from './return-math';
import { checkRow, count, pricedRow, restAccepted, typedRow, useRowMessages, type RowCounts } from './return-rows';
import { ReturnsSavedDialog } from './returns-saved-dialog';

interface CustomerReturnValues {
  date: string | null;
  notes: string;
  /** Keyed `i<itemId>` (Q160): one row per item, whatever orders it is out on; a reloaded list keeps it on its item. */
  rows: Record<string, RowCounts>;
}

const EMPTY_ROW: RowCounts = { accepted: 0, damaged: 0, damagedRefund: 0 };

const itemKey = (itemId: number): `i${number}` => `i${itemId}`;

/** A split as one comparable string: which line takes what. */
const splitOf = (shares: readonly LineShare[]): string =>
  shares
    .filter((share) => share.accepted + share.damaged + share.damagedRefund > 0)
    .map((share) => `${share.orderLineId}:${share.accepted}:${share.damaged}:${share.damagedRefund}`)
    .join(',');

/** Each item's name, by item id. */
function namesOf(holdings: readonly ItemHolding[]): Map<number, string> {
  return new Map(holdings.map((holding) => [holding.item.id, holding.item.name] as const));
}

/**
 * Daily flow 2 from the customer (Q156, Q160): everything the customer still holds, one row per item over all their
 * open orders. Pallets back in good condition are counted with − and +, or "All"; damaged ones under "Damaged". A row
 * is placed on the item's orders oldest first (`allocate`), not shown under it (Q164) — the orders it comes from are
 * listed once under the items, and the summary says what comes back on each — and one save records a return on every
 * order that takes a share, each priced against its own order, so the summary adds up what each order's return would
 * be on its own.
 */
export function CustomerReturnForm({ data, onSaved }: { data: CustomerReturnableDto; onSaved: () => void }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const customerId = data.customer.id;
  // Grouped and sorted once per list, not on every key typed.
  const holdings = useMemo(() => itemHoldings(data), [data]);
  const form = useForm<CustomerReturnValues>({
    defaultValues: {
      date: businessToday(),
      notes: '',
      rows: Object.fromEntries(holdings.map((holding) => [itemKey(holding.item.id), { ...EMPTY_ROW }])),
    },
  });
  const rows = useWatch({ control: form.control, name: 'rows' });
  const date = useWatch({ control: form.control, name: 'date' });
  const errors = form.formState.errors;
  // Items whose damaged boxes were opened; an item with damaged pallets typed stays open.
  const [damageOpen, setDamageOpen] = useState<ReadonlySet<number>>(() => new Set());

  // The return just recorded, kept through the dialog's exit; closing it lets the flow go on (Q139).
  const [saved, setSaved] = useState<CustomerReturnResultDto | null>(null);
  const [savedOpen, setSavedOpen] = useState(false);
  const closeSaved = useRef<(() => void) | null>(null);
  useEffect(() => () => closeSaved.current?.(), []);
  // An item a reload adds gets its row at 0, as the first list's did; set here, not passed as a fallback value, so a
  // box cleared while typing stays empty instead of springing back to 0 under the caret.
  useEffect(() => {
    for (const order of data.orders) {
      for (const line of order.lines) {
        const key = itemKey(line.item.id);
        if (form.getValues(`rows.${key}`) === undefined) form.setValue(`rows.${key}`, { ...EMPTY_ROW });
      }
    }
  }, [data, form]);

  const { exceedsOut, refundTooHigh, money } = useRowMessages();
  const itemOfLine = useMemo(
    () => new Map(holdings.flatMap((holding) => holding.lines.map((line) => [line.orderLineId, holding]))),
    [holdings],
  );
  // When the list is read again for any reason — a refused save, the tab coming back into view, an order opened beside
  // it — the list before is compared with the new one as it arrives (state adjusted during render, as React has it for
  // props that change). Two things follow from it:
  // - every item shown is remembered by name, so a count left on one no longer out can still be named;
  // - an item with a count whose split moved — or that comes back after a reload had dropped it — is held for a look
  //   before saving, so a count meant for one order never moves to another without a word (Q160).
  const [seen, setSeen] = useState(() => namesOf(holdings));
  const [recheck, setRecheck] = useState<ReadonlySet<number>>(() => new Set());
  const [previous, setPrevious] = useState({ data, holdings });
  if (previous.data !== data) {
    const moved = holdings.flatMap((holding) => {
      const row = typedRow(rows[itemKey(holding.item.id)]);
      if (row.accepted + row.damaged === 0) return [];
      const before = previous.holdings.find((entry) => entry.item.id === holding.item.id);
      if (!before) return [holding.item.id];
      return splitOf(allocate(before.lines, row, date)) === splitOf(allocate(holding.lines, row, date))
        ? []
        : [holding.item.id];
    });
    setPrevious({ data, holdings });
    setSeen((names) => new Map([...names, ...namesOf(holdings)]));
    if (moved.length > 0) setRecheck((ids) => new Set([...ids, ...moved]));
  }
  const checked = (itemId: number): void =>
    setRecheck((previous) => {
      if (!previous.has(itemId)) return previous;
      const next = new Set(previous);
      next.delete(itemId);
      return next;
    });

  // Each item's row, checked as typed (Q141, Q146) against what it had out by the return date, and placed oldest
  // first on those orders (Q160).
  const items = holdings.map((holding) => {
    const key = itemKey(holding.item.id);
    const row = typedRow(rows[key]);
    const shares = allocate(holding.lines, row, date);
    const outQuantity = outBy(holding.lines, date);
    // While the count is over what is out, it is the row's one error: the refund's limit would be measured on the
    // damaged pallets that happened to fit, a figure that changes once the count is put right.
    const countOver = row.accepted + row.damaged > outQuantity;
    const maximum = countOver ? Number.MAX_SAFE_INTEGER : refundMaximum(shares);
    const check = checkRow(row, { outQuantity, maximum }, errors.rows?.[key]);
    // The row's messages, as its fields show them and as the notice that holds a save repeats them: what a save or
    // the server said, else what the live check finds (Q141, Q146).
    const acceptedError =
      errors.rows?.[key]?.accepted?.message ?? (check.overOut ? exceedsOut(outQuantity) : undefined);
    const refundError =
      errors.rows?.[key]?.damagedRefund?.message ?? (check.refundOver ? refundTooHigh(maximum) : undefined);
    return { holding, key, row, shares, outQuantity, acceptedError, refundError, ...check };
  });
  // Each order's return is its share of the items; a refused row places nothing, so the summary never offers a figure
  // the server would refuse.
  const sharesByOrder = new Map<number, { share: LineShare; invalid: boolean }[]>();
  for (const { shares: itemShares, invalid } of items) {
    for (const share of itemShares) {
      sharesByOrder.set(share.orderId, [...(sharesByOrder.get(share.orderId) ?? []), { share, invalid }]);
    }
  }
  const orders = data.orders.map((order) => {
    const shares = sharesByOrder.get(order.id) ?? [];
    const summary = returnSummary(
      order,
      shares.map(({ share, invalid }) =>
        pricedRow(
          { accepted: share.accepted, damaged: share.damaged, damagedRefund: share.damagedRefund },
          share.unitDeposit,
          invalid,
        ),
      ),
    );
    const sent = shares.filter(({ share, invalid }) => !invalid && share.accepted + share.damaged > 0);
    return { order, sent, summary, returning: order.outQuantityTotal - summary.outAfter, touched: sent.length > 0 };
  });
  const touched = orders.filter((entry) => entry.touched);
  // Counts on items a reload no longer lists — returned or cancelled meanwhile: never sent, and said so until they
  // are let go, so a count typed is never dropped without a word.
  const listed = new Set(holdings.map((holding) => holding.item.id));
  const gone = Object.entries(rows).flatMap(([key, typed]) => {
    const itemId = Number(key.slice(1));
    const returning = count(typed.accepted) + count(typed.damaged);
    const itemName = seen.get(itemId);
    return returning > 0 && !listed.has(itemId) && itemName !== undefined ? [{ key, returning, itemName }] : [];
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
  // One save takes so many orders (Q156); more is refused as they are ticked, the rest go in a second return.
  const tooManyOrders = touched.length > CUSTOMER_RETURN_MAX_ORDERS;
  // Only items still listed wait for a look; one gone altogether is named by the notice above instead.
  const toRecheck = items.filter(({ holding }) => recheck.has(holding.item.id));
  const anyInvalid = items.some(({ invalid }) => invalid) || gone.length > 0 || toRecheck.length > 0 || tooManyOrders;

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
    onError: (error, body) => {
      const reload = (): void => void queryClient.invalidateQueries({ queryKey: qk.orders.returnable(customerId) });
      // Every refusal below means the orders changed meanwhile, and the list is read again: an item whose count no
      // longer fits is refused with the figure; any other is placed again on the new list, and if its split moves it
      // is held for a look (`recheck`). Judged on what was sent, not on what may have been typed since.
      const sent = new Map(body.orders.flatMap((order) => order.lines.map((line) => [line.orderLineId, line])));
      const sentOf = (holding: ItemHolding) => holding.lines.flatMap((line) => sent.get(line.orderLineId) ?? []);
      const over = detailsOf(error, 'RETURN_EXCEEDS_OUT');
      if (over) {
        for (const holding of new Set(over.lines.flatMap((line) => itemOfLine.get(line.orderLineId) ?? []))) {
          // What the item has out now: its lines, the refused ones as the server has them.
          const outNow = outBy(
            holding.lines.map((line) => ({
              ...line,
              outQuantity:
                over.lines.find((refused) => refused.orderLineId === line.orderLineId)?.outQuantity ?? line.outQuantity,
            })),
            body.date,
          );
          const returning = sentOf(holding).reduce(
            (total, line) => total + line.acceptedQuantity + line.damagedQuantity,
            0,
          );
          if (returning > outNow) {
            form.setError(`rows.${itemKey(holding.item.id)}.accepted`, { message: exceedsOut(outNow) });
          }
        }
        reload();
        return;
      }
      const refund = detailsOf(error, 'DAMAGED_REFUND_TOO_HIGH');
      const refundHolding = refund ? itemOfLine.get(refund.orderLineId) : undefined;
      if (refund && refundHolding) {
        // The item's limit as sent, with the refused line's part as the server has it now (its deposit changed).
        const lines = sentOf(refundHolding);
        const limitNow = refundHolding.lines.reduce((total, line) => {
          if (line.orderLineId === refund.orderLineId) return total + refund.maximum;
          return total + (sent.get(line.orderLineId)?.damagedQuantity ?? 0) * line.unitDeposit;
        }, 0);
        const refunded = lines.reduce((total, line) => total + line.damagedRefund, 0);
        if (refunded > limitNow) {
          form.setError(`rows.${itemKey(refundHolding.item.id)}.damagedRefund`, { message: refundTooHigh(limitNow) });
        }
        reload();
        return;
      }
      // An order cancelled, a line taken off an order, or an order's date moved after the return's, meanwhile.
      if (
        isApiError(error, 'ORDER_CANCELLED') ||
        isApiError(error, 'ORDER_NOT_FOUND') ||
        isApiError(error, 'RETURN_LINE_NOT_IN_ORDER') ||
        isApiError(error, 'RETURN_DATE_BEFORE_ORDER_DATE')
      ) {
        toast.error(t('returns.customer.ordersChanged'));
        reload();
        return;
      }
      handleApiError(error, {
        setError: form.setError,
        fields: ['date', 'notes'],
        fieldMap: { BUSINESS_DATE_IN_FUTURE: 'date' },
      });
    },
  });

  // Every row rule is checked as it is typed and keeps the save off (`anyInvalid`); a submit only adds the date and
  // the rule that something must come back.
  const submit = form.handleSubmit((values) => {
    form.clearErrors('root');
    form.clearErrors('date');
    if (!values.date) {
      form.setError('date', { message: encodeValidationMessage('required') });
      return;
    }
    if (anyInvalid) return;
    // Each order gets its share of every item, as `allocate` placed it.
    const body = touched.map(({ order, sent }) => ({
      orderId: order.id,
      lines: sent.map(({ share }) => ({
        orderLineId: share.orderLineId,
        acceptedQuantity: share.accepted,
        damagedQuantity: share.damaged,
        damagedRefund: share.damagedRefund,
      })),
    }));
    if (body.length === 0) {
      form.setError('root', { message: encodeValidationMessage('returnEmpty') });
      return;
    }
    const notes = values.notes.trim();
    record.mutate({ date: values.date, notes: notes === '' ? null : notes, orders: body });
  });

  // "All" and "Everything came back" count the rest of an item as accepted: pallets already typed as damaged, and
  // their refund, stay as typed — never put back into stock without a word. Only the count's error goes: a refund the
  // server refused is still the refund typed, and stays refused.
  const allBack = (holding: ItemHolding): void => {
    const key = itemKey(holding.item.id);
    form.setValue(`rows.${key}`, restAccepted(form.getValues(`rows.${key}`), outBy(holding.lines, date)));
    checked(holding.item.id);
    form.clearErrors(`rows.${key}.accepted`);
    form.clearErrors('root');
  };
  const toggleDamage = (itemId: number): void =>
    setDamageOpen((open) => {
      const next = new Set(open);
      if (next.has(itemId)) next.delete(itemId);
      else next.add(itemId);
      return next;
    });

  const cashNow = !anyInvalid && totals.cashRefund > 0;
  // The orders the pallets can come from, oldest first as they are placed (Q160, Q164): none dated after the return.
  const fromOrders = useMemo(
    () => data.orders.filter((order) => !isOrderAfterReturn(order.date, date)).sort(olderOrderFirst),
    [data, date],
  );
  // Counts on items no longer listed, named until they are let go.
  const goneNotice =
    gone.length > 0 ? (
      <div role="alert" className="border-warning bg-warning/10 flex flex-col gap-2 rounded-lg border p-4 text-sm">
        <p className="font-medium">{t('returns.customer.goneTitle')}</p>
        <ul className="flex flex-col gap-1">
          {gone.map((entry) => (
            <li key={entry.key}>
              <bdi>{entry.itemName}</bdi> · <QuantityText value={entry.returning} />
            </li>
          ))}
        </ul>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="self-start"
          onClick={() =>
            gone.forEach((entry) => {
              form.setValue(`rows.${entry.key}`, { ...EMPTY_ROW });
              // Let go: should the item come back later, there is no count of its to look at.
              checked(Number(entry.key.slice(1)));
            })
          }
        >
          {t('returns.customer.goneDismiss')}
        </Button>
      </div>
    ) : null;
  // Nothing out (at first, or after a reload): only what there is to say — the counts left to name, else that nothing
  // is out — with no heading, quick buttons or save that could not apply.
  if (data.orders.length === 0) return goneNotice ?? <EmptyState title={t('returns.customer.nothingOut')} />;
  const submitButton = (
    <Button type="submit" form="customer-return" disabled={record.isPending || anyInvalid}>
      {record.isPending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
      {t('returns.new.submit')}
    </Button>
  );

  const figures = [
    ['returns.customer.palletsBack', <QuantityText value={totals.returning} />],
    ['returns.new.refundDue', <MoneyText value={totals.refundDue} />],
    ['returns.new.owedBefore', <MoneyText value={totals.owedBefore} />],
    ['returns.new.owedAfter', <MoneyText value={totals.owedAfter} />],
    ['returns.new.outAfter', <QuantityText value={outBefore - totals.returning} />],
    ['returns.new.compensation', <MoneyText value={totals.compensation} />],
  ] as const;
  // One summary, drawn in the side panel and its sheet; below `lg` the page's card shows its fixed figures (Q162).
  const summaryView = (
    <>
      <SummaryFigures rows={figures} />
      {/* Each order's own return (Q160: the items no longer show their orders' money): what comes back on it, and
        the cash it pays out or what it still owes. */}
      {touched.length > 0 && !anyInvalid ? (
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
                ) : summary.owedAfter > 0 ? (
                  <>
                    {' · '}
                    {t('returns.customer.orderOwes', { amount: isolate(formatMoney(summary.owedAfter)) })}
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
            <p className="text-info text-sm">{t('returns.new.stillOwes', { amount: formatMoney(totals.owedAfter) })}</p>
          ) : null}
        </>
      )}
    </>
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
            onClick={() => holdings.forEach(allBack)}
          >
            {t('returns.customer.everythingBack')}
          </Button>
        </div>
        <SummaryCard title={t('returns.new.summary')} figures={figures} cashRefund={cashNow ? totals.cashRefund : 0} />

        {tooManyOrders ? (
          <p role="alert" className="text-destructive text-sm font-medium">
            {t('returns.customer.tooManyOrders', {
              orders: formatNumber(touched.length),
              max: formatNumber(CUSTOMER_RETURN_MAX_ORDERS),
            })}
          </p>
        ) : null}
        {goneNotice}
        {toRecheck.length > 0 ? (
          <div role="alert" className="border-warning bg-warning/10 flex flex-col gap-2 rounded-lg border p-4 text-sm">
            <p className="font-medium">{t('returns.customer.recheckTitle')}</p>
            <ul className="flex flex-col gap-1">
              {/* Where each count goes now, by order, since nothing under the items shows it (Q164); a count that no
                  longer fits what is out says so instead, as its row does. */}
              {/* Where each count goes now, by order, since nothing under the items shows it (Q164), and beside it
                  whatever keeps the row from being sent, as its fields say it: a fix there also releases the hold, so
                  the placing must already be in view (but for a count over what is out, which places nothing). */}
              {toRecheck.map(({ holding, shares, overOut, acceptedError, refundError }) => (
                <li key={holding.item.id}>
                  <bdi>{holding.item.name}</bdi>:{' '}
                  {/* One line per order: an order holds an item on one line only (order_lines is unique on both). */}
                  {/* A count over what is out places nothing: its message alone, as its row prices nothing. */}
                  {overOut
                    ? null
                    : shares
                        .filter((share) => share.accepted + share.damaged > 0)
                        .map((share) => (
                          <span key={share.orderLineId} className="me-3 inline-block">
                            <span dir="ltr">{orderLabel(share.orderNumber)}</span> ·{' '}
                            <QuantityText value={share.accepted + share.damaged} />
                          </span>
                        ))}
                  {[acceptedError, refundError].flatMap((message) =>
                    message === undefined
                      ? []
                      : [
                          <span key={message} className="text-destructive me-3 inline-block">
                            {translateValidationMessage(t, message)}
                          </span>,
                        ],
                  )}
                </li>
              ))}
            </ul>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="self-start"
              onClick={() => setRecheck(new Set())}
            >
              {t('returns.customer.recheckDone')}
            </Button>
          </div>
        ) : null}

        <Card>
          <CardContent>
            <ul className="flex flex-col divide-y">
              {items.map(
                ({ holding, key, row, outQuantity, overOut, maximum, refundOver, acceptedError, refundError }) => {
                  const itemId = holding.item.id;
                  const showDamage = damageOpen.has(itemId) || row.damaged > 0;
                  // Its deposits beside what is out, on the orders the return can take from: one, or each, lowest first.
                  const prices = [
                    ...new Set(
                      holding.lines.filter((line) => !isAfterReturn(line, date)).map((line) => line.unitDeposit),
                    ),
                  ].sort((a, b) => a - b);
                  const accepted = (next: number | null): void => {
                    checked(itemId);
                    form.setValue(`rows.${key}.accepted`, next);
                    form.clearErrors(`rows.${key}.accepted`);
                    form.clearErrors('root');
                  };
                  return (
                    <li key={itemId} className="flex flex-col gap-3 py-3">
                      {/* On a phone the damaged toggle shares the item's line and the count takes the width beneath. */}
                      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 md:grid-cols-[minmax(0,1fr)_auto_auto]">
                        <div className="flex min-w-0 items-center gap-3">
                          <Thumbnail url={holding.item.imageUrl} size="sm" />
                          <div className="flex min-w-0 flex-col">
                            <ItemName name={holding.item.name} className="font-medium" expandable />
                            <span className="text-muted-foreground text-sm">
                              {t('returns.new.out')}: <QuantityText value={holding.outQuantity} />
                              {/* A back-dated return can take only what was out by its date (Q160). */}
                              {date !== null && outQuantity < holding.outQuantity ? (
                                <>
                                  {' · '}
                                  {t('returns.customer.outByDate', {
                                    out: isolate(formatNumber(outQuantity)),
                                    date: isolate(formatBusinessDate(date)),
                                  })}
                                </>
                              ) : null}
                              {prices.length > 0 ? ' · ' : null}
                              {prices.map((price, index) => (
                                <span key={price}>
                                  {index > 0 ? ' / ' : null}
                                  <MoneyText value={price} />
                                </span>
                              ))}
                            </span>
                          </div>
                        </div>
                        <div className="col-span-2 row-start-2 flex items-end gap-2 md:col-span-1 md:row-start-auto">
                          <Field className="min-w-0 flex-1 gap-1 md:flex-none">
                            <FieldLabel htmlFor={`accepted-${itemId}`} className="text-xs">
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
                                    id={`accepted-${itemId}`}
                                    className="h-10 min-w-0 flex-1 text-center md:w-20 md:flex-none"
                                    value={field.value}
                                    onChange={(next) => accepted(next)}
                                    aria-invalid={Boolean(acceptedError)}
                                    aria-describedby={`row-${itemId}-error`}
                                  />
                                )}
                              />
                              <Button
                                type="button"
                                variant="outline"
                                size="icon"
                                className="size-10"
                                aria-label={t('returns.customer.more')}
                                disabled={row.accepted + row.damaged >= outQuantity}
                                onClick={() => accepted(row.accepted + 1)}
                              >
                                <Plus aria-hidden />
                              </Button>
                            </div>
                          </Field>
                          <Button type="button" variant="outline" size="sm" onClick={() => allBack(holding)}>
                            {t('returns.customer.all')}
                          </Button>
                        </div>
                        <Button
                          type="button"
                          variant={showDamage ? 'secondary' : 'ghost'}
                          size="sm"
                          className="justify-self-end md:self-end"
                          aria-expanded={showDamage}
                          aria-controls={`damage-${itemId}`}
                          // Closed only while nothing damaged is typed: the boxes never hide a count.
                          disabled={row.damaged > 0}
                          onClick={() => toggleDamage(itemId)}
                        >
                          <TriangleAlert aria-hidden />
                          {t('returns.fields.damaged')}
                        </Button>
                      </div>
                      {showDamage ? (
                        <div id={`damage-${itemId}`} className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                          <Field>
                            <FieldLabel htmlFor={`damaged-${itemId}`}>{t('returns.fields.damaged')}</FieldLabel>
                            <Controller
                              control={form.control}
                              name={`rows.${key}.damaged`}
                              render={({ field }) => (
                                <QuantityInput
                                  id={`damaged-${itemId}`}
                                  value={field.value}
                                  onChange={(next) => {
                                    checked(itemId);
                                    field.onChange(next);
                                    form.clearErrors(`rows.${key}`);
                                    form.clearErrors('root');
                                    // No damaged pallets, nothing to refund for them.
                                    if (!next) form.setValue(`rows.${key}.damagedRefund`, 0);
                                  }}
                                  aria-invalid={Boolean(acceptedError)}
                                  aria-describedby={`row-${itemId}-error`}
                                />
                              )}
                            />
                          </Field>
                          <Field>
                            <FieldLabel htmlFor={`refund-${itemId}`}>{t('returns.fields.damagedRefund')}</FieldLabel>
                            <Controller
                              control={form.control}
                              name={`rows.${key}.damagedRefund`}
                              render={({ field }) => (
                                <MoneyInput
                                  id={`refund-${itemId}`}
                                  value={field.value}
                                  onChange={(next) => {
                                    checked(itemId);
                                    field.onChange(next);
                                    form.clearErrors(`rows.${key}.damagedRefund`);
                                  }}
                                  disabled={row.damaged === 0}
                                  suffix={t('common.currency')}
                                  aria-invalid={Boolean(refundError)}
                                  aria-describedby={`refund-${itemId}-split refund-${itemId}-error`}
                                />
                              )}
                            />
                            <FieldError id={`refund-${itemId}-error`} message={refundError} />
                            {row.damaged > 0 && !overOut && !refundOver ? (
                              <FieldDescription id={`refund-${itemId}-split`}>
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
                      <FieldError id={`row-${itemId}-error`} message={acceptedError} />
                    </li>
                  );
                },
              )}
            </ul>
          </CardContent>
        </Card>
        {/* The orders these pallets come from, oldest first, by number alone (Q164); each opens in a new tab, so the
            counts typed here stay. How a count is placed on them reads in the summary's list by order. */}
        {fromOrders.length > 0 ? (
          <section aria-labelledby="from-orders" className="flex flex-col gap-2 text-sm">
            <h3 id="from-orders" className="text-muted-foreground">
              {t('returns.customer.fromOrders')}
            </h3>
            <ul className="flex flex-wrap gap-x-4 gap-y-1">
              {fromOrders.map((order) => (
                <li key={order.id}>
                  <Link
                    to="/orders/$orderId"
                    params={{ orderId: String(order.id) }}
                    target="_blank"
                    rel="noopener"
                    className="text-primary inline-flex items-center gap-0.5 font-medium underline-offset-4 hover:underline"
                  >
                    <span dir="ltr">{orderLabel(order.orderNumber)}</span>
                    <ExternalLink className="size-3" aria-hidden />
                    <span className="sr-only">{t('returns.customer.opensInNewTab')}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
        <FieldError id="lines-error" message={errors.root?.message} />

        <Card>
          <CardContent className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <DateField control={form.control} name="date" id="date" label={t('returns.fields.date')} />
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
        {summaryView}
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
