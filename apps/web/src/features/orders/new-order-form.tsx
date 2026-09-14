import { zodResolver } from '@hookform/resolvers/zod';
import {
  businessToday,
  checkCreditLimit,
  formatOrderNumber,
  type OrderCreateBody,
  type OrderDetailDto,
} from '@pallet/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { Banknote, HandCoins, Loader2 } from 'lucide-react';
import { useState } from 'react';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { ConfirmDialog } from '@/components/app/confirm-dialog';
import { EntityCombobox } from '@/components/app/entity-combobox';
import { Field, FieldError, FieldLabel } from '@/components/app/field';
import { MoneyText } from '@/components/app/money-text';
import { SegmentedRadio } from '@/components/app/segmented-radio';
import { SummaryPanel } from '@/components/app/summary-panel';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { customerQuery } from '@/features/customers/api';
import { useUnsavedChangesGuard } from '@/hooks/use-unsaved-changes-guard';
import { apiFetch } from '@/lib/api-client';
import { ApiError } from '@/lib/api-error';
import { useAuth, useCan } from '@/lib/auth';
import { handleApiError } from '@/lib/errors';
import { useIdempotencyKey } from '@/lib/idempotency';
import { qk } from '@/lib/query-keys';
import { encodeValidationMessage } from '@/lib/validation-message';
import { invalidateAfterOrderChange } from './api';
import { CreditAlert } from './credit-alert';
import { creditMessageParams, type CreditExcess } from './order-text';
import { OrderFormSchema, useOrderItems, type OrderFormValues } from './order-form';
import { OrderLinesEditor } from './order-lines-editor';
import { EMPTY_LINE, asOrderLines, depositTotalOf, toRequestLines } from './order-lines';
import { CreditCheckUnavailable, OrderDateField, OrderDriverField, OrderNotesField } from './order-fields';

/** Daily flow 1 (§7.4.1): a hand-over on one screen, with its totals and the credit rule live. */
export function NewOrderForm({ initialCustomerId }: { initialCustomerId?: number }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const isAdmin = useAuth().user?.role === 'ADMIN';
  const canPrice = useCan('orders.editUnitDeposit');
  const idempotency = useIdempotencyKey();
  // A refusal the server reported: a concurrent order may have used the headroom since the page loaded.
  const [serverCredit, setServerCredit] = useState<CreditExcess | null>(null);
  const [confirmingOverride, setConfirmingOverride] = useState(false);

  const form = useForm<OrderFormValues>({
    resolver: zodResolver(OrderFormSchema),
    mode: 'onTouched',
    defaultValues: {
      customerId: initialCustomerId ?? null,
      driverId: null,
      date: businessToday(),
      paymentType: null,
      notes: '',
      lines: [{ ...EMPTY_LINE }],
    },
  });
  const [customerId, paymentType, rows] = useWatch({
    control: form.control,
    name: ['customerId', 'paymentType', 'lines'],
  });
  const errors = form.formState.errors;
  const guard = useUnsavedChangesGuard(form.formState.isDirty);

  const items = useOrderItems(rows.map((row) => row.itemId));
  const defaultDeposit = (itemId: number): number | undefined => items.get(itemId)?.depositPrice;
  const available = (itemId: number): number | undefined => items.get(itemId)?.quantityOnHand;
  const customer = useQuery({ ...customerQuery(customerId ?? 0), enabled: customerId !== null });

  const depositTotal = depositTotalOf(rows, defaultDeposit);
  const creditLimit = customer.data?.creditLimit ?? null;
  const currentOutValue = customer.data?.summary.outValue ?? 0;
  const liveCredit = checkCreditLimit({ creditLimit, customerOutValue: currentOutValue, depositDelta: depositTotal });
  // A server refusal holds only for the total it refused; once the lines change, the live check decides.
  const standingRefusal = serverCredit?.depositDelta === depositTotal ? serverCredit : null;
  const credit: CreditExcess | null =
    standingRefusal ??
    (liveCredit.allowed || creditLimit === null
      ? null
      : { creditLimit, customerOutValue: currentOutValue, depositDelta: depositTotal, excess: liveCredit.excess });
  const overStock = rows.some((row) => {
    const limit = row.itemId === null ? undefined : available(row.itemId);
    return limit !== undefined && row.quantity !== null && row.quantity > limit;
  });

  const create = useMutation({
    mutationFn: (body: OrderCreateBody) =>
      apiFetch<OrderDetailDto>('/orders', { method: 'POST', body, idempotencyKey: idempotency.getKey(body) }),
    onSuccess: async (order) => {
      idempotency.reset();
      toast.success(t('orders.new.created', { orderNumber: formatOrderNumber(order.orderNumber) }));
      await invalidateAfterOrderChange(queryClient);
      guard.allowLeave();
      await navigate({ to: '/orders/$orderId', params: { orderId: String(order.id) }, search: { created: true } });
    },
    onError: (error) => {
      if (error instanceof ApiError && error.code === 'CREDIT_LIMIT_EXCEEDED') {
        const details = error.details as unknown as CreditExcess & { canOverride: boolean };
        setServerCredit(details);
        // The out value moved under the page; show the figures the server used.
        void queryClient.invalidateQueries({ queryKey: qk.customers.all() });
        if (details.canOverride) setConfirmingOverride(true);
        return;
      }
      if (error instanceof ApiError && error.code === 'STOCK_INSUFFICIENT') {
        // Someone took the pallets first: point at the rows, and let the stock figures refresh.
        const short = (error.details?.items as { itemId: number; available: number }[] | undefined) ?? [];
        for (const shortage of short) {
          const index = form.getValues('lines').findIndex((row) => row.itemId === shortage.itemId);
          if (index >= 0) {
            form.setError(`lines.${index}.quantity`, {
              message: encodeValidationMessage('stockExceeded', { available: shortage.available }),
            });
          }
        }
        void queryClient.invalidateQueries({ queryKey: qk.items.all() });
        return;
      }
      if (error instanceof ApiError && ['CUSTOMER_ARCHIVED', 'DRIVER_ARCHIVED', 'ITEM_ARCHIVED'].includes(error.code)) {
        void Promise.all(
          [qk.customers.all(), qk.drivers.all(), qk.items.all()].map((queryKey) =>
            queryClient.invalidateQueries({ queryKey }),
          ),
        );
      }
      handleApiError(error, {
        setError: form.setError,
        fields: [
          'customerId',
          'driverId',
          'date',
          'paymentType',
          'notes',
          ...rows.flatMap((_, index) => [
            `lines.${index}.itemId`,
            `lines.${index}.quantity`,
            `lines.${index}.unitDeposit`,
          ]),
        ],
        fieldMap: { BUSINESS_DATE_IN_FUTURE: 'date' },
      });
    },
  });

  const submit = (confirmCreditOverride: boolean) =>
    form.handleSubmit((values) => {
      setConfirmingOverride(false);
      create.mutate({
        customerId: values.customerId ?? 0,
        driverId: values.driverId ?? 0,
        date: values.date ?? '',
        paymentType: values.paymentType ?? 'LENT',
        notes: values.notes.trim() === '' ? null : values.notes,
        lines: asOrderLines(toRequestLines(values.lines, defaultDeposit, canPrice)),
        confirmCreditOverride,
      });
    });

  // An employee cannot pass the limit; an admin is asked first (§4.4).
  const blockedByCredit = credit !== null && !isAdmin;
  const submitButton = (
    <Button
      type={credit && isAdmin ? 'button' : 'submit'}
      form="new-order"
      disabled={create.isPending || blockedByCredit || overStock}
      onClick={credit && isAdmin ? () => void form.handleSubmit(() => setConfirmingOverride(true))() : undefined}
    >
      {create.isPending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
      {t(credit && isAdmin ? 'orders.new.submitWithOverride' : 'orders.new.submit')}
    </Button>
  );

  return (
    <div className="grid grid-cols-1 gap-6 pb-24 lg:grid-cols-[minmax(0,1fr)_22rem] lg:pb-0">
      <form id="new-order" onSubmit={submit(false)} className="flex flex-col gap-6" noValidate>
        <Card>
          <CardContent className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <Field>
              <FieldLabel htmlFor="customerId">{t('orders.fields.customer')}</FieldLabel>
              <Controller
                control={form.control}
                name="customerId"
                render={({ field }) => (
                  <EntityCombobox
                    id="customerId"
                    kind="customer"
                    autoFocus
                    value={field.value}
                    onChange={(next) => {
                      field.onChange(next);
                      setServerCredit(null);
                    }}
                    invalid={Boolean(errors.customerId)}
                    placeholder={t('orders.fields.chooseCustomer')}
                  />
                )}
              />
              <FieldError id="customerId-error" message={errors.customerId?.message} />
            </Field>
            <CreditCheckUnavailable failed={customerId !== null && customer.isError} />
            <OrderDriverField form={form} />
            <OrderDateField form={form} />
            <Field className="md:col-span-2">
              <FieldLabel htmlFor="paymentType">{t('orders.fields.paymentType')}</FieldLabel>
              <Controller
                control={form.control}
                name="paymentType"
                render={({ field }) => (
                  <SegmentedRadio
                    id="paymentType"
                    label={t('orders.fields.paymentType')}
                    value={field.value ?? undefined}
                    onChange={field.onChange}
                    invalid={Boolean(errors.paymentType)}
                    describedBy="paymentType-error"
                    options={[
                      { value: 'CASH', label: t('orders.new.paidCash'), icon: Banknote },
                      { value: 'LENT', label: t('orders.new.lent'), icon: HandCoins },
                    ]}
                  />
                )}
              />
              <FieldError id="paymentType-error" message={errors.paymentType?.message} />
            </Field>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="flex flex-col gap-4">
            <h2 className="font-semibold">{t('orders.lines.title')}</h2>
            <OrderLinesEditor form={form} defaultDeposit={defaultDeposit} available={available} canPrice={canPrice} />
          </CardContent>
        </Card>

        <Card>
          <CardContent>
            <OrderNotesField form={form} />
          </CardContent>
        </Card>
      </form>

      <SummaryPanel
        title={t('orders.new.summary.title')}
        keyFigure={<MoneyText value={depositTotal} />}
        submit={submitButton}
      >
        <dl className="flex flex-col gap-3 text-sm">
          <div className="flex flex-col gap-1">
            <dt className="text-muted-foreground">{t('orders.fields.depositTotal')}</dt>
            <dd className="text-2xl font-semibold">
              <MoneyText value={depositTotal} />
            </dd>
          </div>
          {paymentType ? (
            <p>{t(paymentType === 'CASH' ? 'orders.new.summary.paysNow' : 'orders.new.summary.willOwe')}</p>
          ) : null}
          {customer.data ? (
            <>
              <div className="flex justify-between gap-2">
                <dt className="text-muted-foreground">{t('customers.fields.creditLimit')}</dt>
                <dd>{creditLimit === null ? t('customers.noLimit') : <MoneyText value={creditLimit} />}</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-muted-foreground">{t('customers.fields.outValue')}</dt>
                <dd>
                  <MoneyText value={currentOutValue} />
                </dd>
              </div>
              {creditLimit === null ? null : (
                <div className="flex justify-between gap-2">
                  <dt className="text-muted-foreground">{t('orders.new.summary.headroomAfter')}</dt>
                  <dd dir="ltr" className="tabular-nums">
                    {creditLimit - currentOutValue - depositTotal < 0 ? '−' : ''}
                    <MoneyText value={Math.abs(creditLimit - currentOutValue - depositTotal)} />
                  </dd>
                </div>
              )}
            </>
          ) : null}
        </dl>
        {credit ? <CreditAlert credit={credit} kind="order" /> : null}
      </SummaryPanel>

      <ConfirmDialog
        open={confirmingOverride}
        onOpenChange={setConfirmingOverride}
        destructive={false}
        title={t('orders.new.overrideTitle')}
        description={credit ? t('orders.new.overrideBody', creditMessageParams(credit)) : ''}
        confirmLabel={t('orders.new.submitWithOverride')}
        pending={create.isPending}
        onConfirm={() => void submit(true)()}
      />
      {guard.dialog}
    </div>
  );
}
