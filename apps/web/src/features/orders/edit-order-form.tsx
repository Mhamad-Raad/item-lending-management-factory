import { zodResolver } from '@hookform/resolvers/zod';
import {
  checkCreditLimit,
  formatNumber,
  type OrderDetailDto,
  type OrderUpdateBody,
  type PalletCreditBalanceDto,
} from '@pallet/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { ConfirmDialog } from '@/components/app/confirm-dialog';
import { FieldDescription } from '@/components/app/field';
import { MoneyText } from '@/components/app/money-text';
import { SummaryPanel } from '@/components/app/summary-panel';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { customerQuery } from '@/features/customers/api';
import { useFlowMutation } from '@/hooks/use-flow-mutation';
import { useUnsavedChangesGuard } from '@/hooks/use-unsaved-changes-guard';
import { apiFetch } from '@/lib/api-client';
import { isolate } from '@/lib/bidi';
import { detailsOf, isApiError } from '@/lib/api-error';
import { useAuth, useCan } from '@/lib/auth';
import { handleApiError } from '@/lib/errors';
import { qk } from '@/lib/query-keys';
import { invalidateAfterOrderChange } from './api';
import { CreditAlert } from './credit-alert';
import { creditMessageParams, orderLabel, type CreditExcess } from './order-text';
import { OrderFormSchema, useOrderItems, type OrderFormValues } from './order-form';
import { OrderLinesEditor } from './order-lines-editor';
import { asOrderLines, depositTotalOf, fromCreditOf, toRequestLines, type LineRow } from './order-lines';
import { OrderLinesTable } from './order-sections';
import { CreditCheckUnavailable, OrderDateField, OrderDriverField, OrderNotesField } from './order-fields';

/** A line set as the server compares it: by item, with each line's deposit. */
function lineKey(
  lines: readonly { itemId: number | null; quantity: number | null; unitDeposit: number | undefined }[],
): string {
  return JSON.stringify(
    lines.map((line) => [line.itemId, line.quantity, line.unitDeposit]).sort((a, b) => Number(a[0]) - Number(b[0])),
  );
}

/** Edit an order (§7.3.7): header fields always; lines only until something has happened on it. */
export function EditOrderForm({ order }: { order: OrderDetailDto }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const isAdmin = useAuth().user?.role === 'ADMIN';
  const canPrice = useCan('orders.editUnitDeposit');
  const [serverCredit, setServerCredit] = useState<CreditExcess | null>(null);
  const [confirmingOverride, setConfirmingOverride] = useState(false);

  const stored = new Map(order.lines.map((line) => [line.item.id, line]));
  // Q181: a row is all that went out of its item — lent and from the pallets owed — as on a new order.
  const tookOwed = new Map(order.fromCredit.map((entry) => [entry.item.id, entry.quantity]));
  const outBefore = new Map(tookOwed);
  for (const line of order.lines) outBefore.set(line.item.id, (outBefore.get(line.item.id) ?? 0) + line.quantity);
  // A row's `unitDeposit` is null while it follows its default — the stored deposit here.
  const storedRows: LineRow[] = [
    ...order.lines.map((line) => line.item.id),
    ...order.fromCredit.map((entry) => entry.item.id).filter((itemId) => !stored.has(itemId)),
  ].map((itemId) => ({ itemId, quantity: outBefore.get(itemId) ?? 0, unitDeposit: null }));
  const form = useForm<OrderFormValues>({
    resolver: zodResolver(OrderFormSchema),
    mode: 'onTouched',
    defaultValues: {
      customerId: order.customer.id,
      driverId: order.driver.id,
      date: order.date,
      paymentType: order.paymentType,
      notes: order.notes ?? '',
      lines: storedRows,
    },
  });
  const [driverId, date, notes, rows] = useWatch({
    control: form.control,
    name: ['driverId', 'date', 'notes', 'lines'],
  });
  const guard = useUnsavedChangesGuard(form.formState.isDirty);

  const items = useOrderItems(rows.map((row) => row.itemId));
  // A line already on the order keeps its stored deposit (Q15); a new one starts at the item's.
  const defaultDeposit = (itemId: number): number | undefined =>
    stored.get(itemId)?.unitDeposit ?? items.get(itemId)?.depositPrice;
  // The pallets this order already holds are part of what it may keep.
  const available = (itemId: number): number | undefined => {
    const onHand = items.get(itemId)?.quantityOnHand;
    return onHand === undefined ? undefined : onHand + (outBefore.get(itemId) ?? 0);
  };
  // What may go out from the pallets owed: what is owed now, with what this order took already (Q181).
  const credits = useQuery({
    queryKey: qk.customers.palletCredits(order.customer.id),
    queryFn: () => apiFetch<PalletCreditBalanceDto[]>(`/customers/${order.customer.id}/pallet-credits`),
    retry: false,
  });
  const owed = new Map(tookOwed);
  for (const entry of credits.data ?? []) owed.set(entry.item.id, (owed.get(entry.item.id) ?? 0) + entry.quantity);
  const fromCredit = fromCreditOf(rows, owed);
  const customer = useQuery(customerQuery(order.customer.id));

  const requestLines = toRequestLines(rows, defaultDeposit, canPrice);
  const linesChanged =
    order.canEditLines &&
    lineKey(
      rows.map((row) => ({
        ...row,
        unitDeposit: row.itemId === null ? undefined : (row.unitDeposit ?? defaultDeposit(row.itemId)),
      })),
    ) !==
      lineKey(
        storedRows.map((row) => ({
          ...row,
          unitDeposit: row.itemId === null ? undefined : defaultDeposit(row.itemId),
        })),
      );
  const newTotal = depositTotalOf(rows, defaultDeposit, owed);
  const delta = newTotal - order.depositTotal;
  const creditLimit = customer.data?.creditLimit ?? null;
  const outValue = customer.data?.summary.outValue ?? 0;
  // The new deposit needs what is owed: until it is read the live check waits, and if it cannot be read the server
  // alone checks the limit (it is said, as when the customer cannot be read).
  const owedKnown = credits.isSuccess;
  const liveCredit = checkCreditLimit({
    creditLimit,
    customerOutValue: outValue,
    depositDelta: linesChanged && owedKnown ? delta : 0,
  });
  // A server refusal holds only for the change it refused; once the lines change, the live check decides.
  const standingRefusal = serverCredit?.depositDelta === delta ? serverCredit : null;
  const credit: CreditExcess | null =
    standingRefusal ??
    (liveCredit.allowed || creditLimit === null || !owedKnown
      ? null
      : { creditLimit, customerOutValue: outValue, depositDelta: delta, excess: liveCredit.excess });
  const changed = {
    driverId: driverId !== order.driver.id,
    date: date !== order.date,
    notes: notes !== (order.notes ?? ''),
    lines: linesChanged,
  };
  const anyChange = Object.values(changed).some(Boolean);

  const save = useFlowMutation({
    request: (body: OrderUpdateBody) => apiFetch<OrderDetailDto>(`/orders/${order.id}`, { method: 'PATCH', body }),
    successMessage: () => t('orders.edit.saved'),
    invalidate: () => invalidateAfterOrderChange(queryClient),
    refresh: 'before-navigate',
    beforeLeave: () => guard.allowLeave(),
    destination: (saved) => ({ to: '/orders/$orderId', params: { orderId: String(saved.id) } }),
    onError: (error) => {
      const reload = () => void queryClient.invalidateQueries({ queryKey: qk.orders.detail(order.id) });
      const credit = detailsOf(error, 'CREDIT_LIMIT_EXCEEDED');
      if (credit) {
        const { canOverride, ...details } = credit;
        setServerCredit(details);
        void queryClient.invalidateQueries({ queryKey: qk.customers.all() });
        if (canOverride) setConfirmingOverride(true);
        return;
      }
      if (isApiError(error, 'ORDER_HAS_ACTIVITY')) {
        // Something was recorded on the order meanwhile: its lines are locked now.
        toast.error(t('errors.ORDER_HAS_ACTIVITY'));
        reload();
        return;
      }
      handleApiError(error, {
        setError: form.setError,
        fields: [
          'driverId',
          'date',
          'notes',
          ...rows.flatMap((_, index) => [
            `lines.${index}.itemId`,
            `lines.${index}.quantity`,
            `lines.${index}.unitDeposit`,
          ]),
        ],
        fieldMap: { ORDER_DATE_AFTER_ACTIVITY: 'date', BUSINESS_DATE_IN_FUTURE: 'date' },
        onReload: reload,
      });
    },
  });

  const submit = (confirmCreditOverride: boolean) =>
    form.handleSubmit((values) => {
      setConfirmingOverride(false);
      // Only what changed is sent, and `lines` only when the lines did (§7.3.7).
      save.mutate({
        version: order.version,
        ...(changed.driverId ? { driverId: values.driverId ?? undefined } : {}),
        ...(changed.date ? { date: values.date ?? undefined } : {}),
        notes: changed.notes ? (values.notes.trim() === '' ? null : values.notes) : undefined,
        ...(changed.lines ? { lines: asOrderLines(requestLines), linesCountOwed: true as const } : {}),
        confirmCreditOverride,
      });
    });

  const overStock = rows.some((row) => {
    const limit = row.itemId === null ? undefined : available(row.itemId);
    return limit !== undefined && row.quantity !== null && row.quantity > limit;
  });
  // Q170's one rule, refused as typed (Q141): a type the factory would still owe after the edit while the customer has
  // it out on another order. Read from what is owed now and what they hold, this order's own lent pallets set apart.
  const outElsewhere = (itemId: number): number =>
    (customer.data?.palletsOutByItem.find((entry) => entry.itemId === itemId)?.quantityOut ?? 0) -
    (stored.get(itemId)?.outQuantity ?? 0);
  const owedAfter = (itemId: number): number => {
    const quantity = rows.reduce((sum, row) => (row.itemId === itemId ? sum + (row.quantity ?? 0) : sum), 0);
    return (owed.get(itemId) ?? 0) - Math.min(owed.get(itemId) ?? 0, quantity);
  };
  // Only the types the edit names or the order took of what is owed: those the server checks.
  const touched = new Set([...rows.flatMap((row) => (row.itemId === null ? [] : [row.itemId])), ...tookOwed.keys()]);
  const owedWhileOut =
    linesChanged &&
    owedKnown &&
    customer.isSuccess &&
    [...touched].some((itemId) => owedAfter(itemId) > 0 && outElsewhere(itemId) > 0);
  const submitButton = (
    <Button
      type={credit && isAdmin ? 'button' : 'submit'}
      form="edit-order"
      disabled={
        save.isPending ||
        !anyChange ||
        (credit !== null && !isAdmin) ||
        overStock ||
        owedWhileOut ||
        (linesChanged && (credits.isPending || customer.isPending))
      }
      onClick={credit && isAdmin ? () => void form.handleSubmit(() => setConfirmingOverride(true))() : undefined}
    >
      {save.isPending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
      {t(credit && isAdmin ? 'orders.new.submitWithOverride' : 'common.actions.save')}
    </Button>
  );

  return (
    <div className="grid grid-cols-1 gap-6 pb-24 lg:grid-cols-[minmax(0,1fr)_22rem] lg:pb-0">
      <form id="edit-order" onSubmit={(event) => void submit(false)(event)} className="flex flex-col gap-6" noValidate>
        <Card>
          <CardContent className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div className="flex flex-col gap-1 md:col-span-2">
              <span className="text-muted-foreground text-sm">
                {orderLabel(order.orderNumber)} · <bdi>{order.customer.name}</bdi> ·{' '}
                {t(`enums.paymentType.${order.paymentType}`)}
              </span>
              <FieldDescription>{t('orders.edit.immutableHint')}</FieldDescription>
            </div>
            <CreditCheckUnavailable failed={customer.isError || (linesChanged && credits.isError)} />
            <OrderDriverField form={form} />
            <OrderDateField form={form} />
            <OrderNotesField form={form} className="md:col-span-2" />
          </CardContent>
        </Card>

        <Card>
          <CardContent className="flex flex-col gap-4">
            <h2 className="font-semibold">{t('orders.lines.title')}</h2>
            {order.canEditLines ? (
              <OrderLinesEditor form={form} defaultDeposit={defaultDeposit} available={available} canPrice={canPrice} />
            ) : (
              <>
                <Alert>
                  <AlertDescription>{t('orders.edit.linesLocked')}</AlertDescription>
                </Alert>
                <OrderLinesTable order={order} />
              </>
            )}
          </CardContent>
        </Card>
      </form>

      <SummaryPanel
        title={t('orders.edit.summary.title')}
        keyFigure={<MoneyText value={newTotal} />}
        submit={submitButton}
      >
        <dl className="flex flex-col gap-3 text-sm">
          <div className="flex flex-col gap-1">
            <dt className="text-muted-foreground">{t('orders.edit.summary.newTotal')}</dt>
            <dd className="text-2xl font-semibold">
              <MoneyText value={newTotal} />
            </dd>
          </div>
          <div className="flex justify-between gap-2">
            <dt className="text-muted-foreground">{t('orders.edit.summary.delta')}</dt>
            <dd dir="ltr" className="tabular-nums">
              {delta > 0 ? '+' : delta < 0 ? '−' : ''}
              <MoneyText value={Math.abs(delta)} />
            </dd>
          </div>
        </dl>
        {order.paymentType === 'CASH' && linesChanged ? (
          <Alert>
            <AlertDescription>{t('orders.edit.cashReissueNotice')}</AlertDescription>
          </Alert>
        ) : null}
        {credit ? <CreditAlert credit={credit} kind="change" /> : null}
        {owedWhileOut ? (
          <p role="alert" className="text-destructive text-sm font-medium">
            {t('errors.PALLET_CREDIT_OUTSTANDING')}
          </p>
        ) : null}
        {fromCredit.length > 0 ? (
          <p role="status" className="bg-warning/12 text-warning rounded-md p-3 font-semibold dark:bg-warning/20">
            {t('orders.new.summary.fromCredit', {
              items: fromCredit
                .map(({ itemId, quantity }) => {
                  const name =
                    items.get(itemId)?.name ??
                    order.fromCredit.find((entry) => entry.item.id === itemId)?.item.name ??
                    (credits.data ?? []).find((entry) => entry.item.id === itemId)?.item.name ??
                    '';
                  return `${formatNumber(quantity)} × ${isolate(name)}`;
                })
                .join(t('common.listSeparator')),
            })}
          </p>
        ) : null}
      </SummaryPanel>

      <ConfirmDialog
        open={confirmingOverride}
        onOpenChange={setConfirmingOverride}
        destructive={false}
        title={t('orders.new.overrideTitle')}
        description={credit ? t('orders.edit.overrideBody', creditMessageParams(credit)) : ''}
        confirmLabel={t('orders.new.submitWithOverride')}
        pending={save.isPending}
        onConfirm={() => void submit(true)()}
      />
      {guard.dialog}
    </div>
  );
}
