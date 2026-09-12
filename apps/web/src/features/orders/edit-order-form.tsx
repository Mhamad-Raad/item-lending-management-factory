import { zodResolver } from '@hookform/resolvers/zod';
import {
  businessToday,
  checkCreditLimit,
  MIN_BUSINESS_DATE,
  type OrderDetailDto,
  type OrderUpdateBody,
} from '@pallet/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { Loader2 } from 'lucide-react';
import { useState } from 'react';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { ConfirmDialog } from '@/components/app/confirm-dialog';
import { DatePicker } from '@/components/app/date-picker';
import { EntityCombobox } from '@/components/app/entity-combobox';
import { Field, FieldDescription, FieldError, FieldLabel } from '@/components/app/field';
import { MoneyText } from '@/components/app/money-text';
import { SummaryPanel } from '@/components/app/summary-panel';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { customerQuery } from '@/features/customers/api';
import { useUnsavedChangesGuard } from '@/hooks/use-unsaved-changes-guard';
import { apiFetch } from '@/lib/api-client';
import { ApiError } from '@/lib/api-error';
import { useAuth, useCan } from '@/lib/auth';
import { handleApiError } from '@/lib/errors';
import { qk } from '@/lib/query-keys';
import { invalidateAfterOrderChange } from './api';
import { CreditAlert } from './credit-alert';
import { creditMessageParams, orderLabel, type CreditExcess } from './order-text';
import { OrderFormSchema, useOrderItems, type OrderFormValues } from './order-form';
import { OrderLinesEditor } from './order-lines-editor';
import { asOrderLines, depositTotalOf, toRequestLines, type LineRow } from './order-lines';
import { OrderLinesTable } from './order-sections';

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
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const isAdmin = useAuth().user?.role === 'ADMIN';
  const canPrice = useCan('orders.editUnitDeposit');
  const [serverCredit, setServerCredit] = useState<CreditExcess | null>(null);
  const [confirmingOverride, setConfirmingOverride] = useState(false);

  const stored = new Map(order.lines.map((line) => [line.item.id, line]));
  // A row's `unitDeposit` is null while it follows its default — the stored deposit here.
  const storedRows: LineRow[] = order.lines.map((line) => ({
    itemId: line.item.id,
    quantity: line.quantity,
    unitDeposit: null,
  }));
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
  const errors = form.formState.errors;
  const guard = useUnsavedChangesGuard(form.formState.isDirty);

  const items = useOrderItems(rows.map((row) => row.itemId));
  // A line already on the order keeps its stored deposit (Q15); a new one starts at the item's.
  const defaultDeposit = (itemId: number): number | undefined =>
    stored.get(itemId)?.unitDeposit ?? items.get(itemId)?.depositPrice;
  // The pallets this order already holds are part of what it may keep.
  const available = (itemId: number): number | undefined => {
    const onHand = items.get(itemId)?.quantityOnHand;
    return onHand === undefined ? undefined : onHand + (stored.get(itemId)?.quantity ?? 0);
  };
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
        order.lines.map((line) => ({ itemId: line.item.id, quantity: line.quantity, unitDeposit: line.unitDeposit })),
      );
  const newTotal = depositTotalOf(rows, defaultDeposit);
  const delta = newTotal - order.depositTotal;
  const creditLimit = customer.data?.creditLimit ?? null;
  const outValue = customer.data?.summary.outValue ?? 0;
  const liveCredit = checkCreditLimit({
    creditLimit,
    customerOutValue: outValue,
    depositDelta: linesChanged ? delta : 0,
  });
  // A server refusal holds only for the change it refused; once the lines change, the live check decides.
  const standingRefusal = serverCredit?.depositDelta === delta ? serverCredit : null;
  const credit: CreditExcess | null =
    standingRefusal ??
    (liveCredit.allowed || creditLimit === null
      ? null
      : { creditLimit, customerOutValue: outValue, depositDelta: delta, excess: liveCredit.excess });
  const changed = {
    driverId: driverId !== order.driver.id,
    date: date !== order.date,
    notes: notes !== (order.notes ?? ''),
    lines: linesChanged,
  };
  const anyChange = Object.values(changed).some(Boolean);

  const save = useMutation({
    mutationFn: (body: OrderUpdateBody) => apiFetch<OrderDetailDto>(`/orders/${order.id}`, { method: 'PATCH', body }),
    onSuccess: async (saved) => {
      toast.success(t('orders.edit.saved'));
      await invalidateAfterOrderChange(queryClient);
      guard.allowLeave();
      await navigate({ to: '/orders/$orderId', params: { orderId: String(saved.id) } });
    },
    onError: (error) => {
      const reload = () => void queryClient.invalidateQueries({ queryKey: qk.orders.detail(order.id) });
      if (error instanceof ApiError && error.code === 'CREDIT_LIMIT_EXCEEDED') {
        const details = error.details as unknown as CreditExcess & { canOverride: boolean };
        setServerCredit(details);
        void queryClient.invalidateQueries({ queryKey: qk.customers.all() });
        if (details.canOverride) setConfirmingOverride(true);
        return;
      }
      if (error instanceof ApiError && error.code === 'ORDER_HAS_ACTIVITY') {
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
        ...(changed.lines ? { lines: asOrderLines(requestLines) } : {}),
        confirmCreditOverride,
      });
    });

  const overStock = rows.some((row) => {
    const limit = row.itemId === null ? undefined : available(row.itemId);
    return limit !== undefined && row.quantity !== null && row.quantity > limit;
  });
  const submitButton = (
    <Button
      type={credit && isAdmin ? 'button' : 'submit'}
      form="edit-order"
      disabled={save.isPending || !anyChange || (credit !== null && !isAdmin) || overStock}
      onClick={credit && isAdmin ? () => void form.handleSubmit(() => setConfirmingOverride(true))() : undefined}
    >
      {save.isPending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
      {t(credit && isAdmin ? 'orders.new.submitWithOverride' : 'common.actions.save')}
    </Button>
  );

  return (
    <div className="grid grid-cols-1 gap-6 pb-24 lg:grid-cols-[minmax(0,1fr)_22rem] lg:pb-0">
      <form id="edit-order" onSubmit={submit(false)} className="flex flex-col gap-6" noValidate>
        <Card>
          <CardContent className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div className="flex flex-col gap-1 md:col-span-2">
              <span className="text-muted-foreground text-sm">
                {orderLabel(order.orderNumber)} · {order.customer.name} · {t(`enums.paymentType.${order.paymentType}`)}
              </span>
              <FieldDescription>{t('orders.edit.immutableHint')}</FieldDescription>
            </div>
            <Field>
              <FieldLabel htmlFor="driverId">{t('orders.fields.driver')}</FieldLabel>
              <Controller
                control={form.control}
                name="driverId"
                render={({ field }) => (
                  <EntityCombobox
                    id="driverId"
                    kind="driver"
                    value={field.value}
                    onChange={field.onChange}
                    invalid={Boolean(errors.driverId)}
                    placeholder={t('orders.fields.chooseDriver')}
                  />
                )}
              />
              <FieldError id="driverId-error" message={errors.driverId?.message} />
            </Field>
            <Field>
              <FieldLabel htmlFor="date">{t('orders.fields.date')}</FieldLabel>
              <Controller
                control={form.control}
                name="date"
                render={({ field }) => (
                  <DatePicker
                    id="date"
                    value={field.value}
                    onChange={field.onChange}
                    onBlur={field.onBlur}
                    min={MIN_BUSINESS_DATE}
                    max={businessToday()}
                    invalid={Boolean(errors.date)}
                    describedBy="date-error"
                  />
                )}
              />
              <FieldError id="date-error" message={errors.date?.message} />
            </Field>
            <Field className="md:col-span-2">
              <FieldLabel htmlFor="notes">{t('orders.fields.notes')}</FieldLabel>
              <Textarea id="notes" rows={3} aria-describedby="notes-error" {...form.register('notes')} />
              <FieldError id="notes-error" message={errors.notes?.message} />
            </Field>
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
