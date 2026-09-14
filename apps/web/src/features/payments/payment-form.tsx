import {
  businessToday,
  formatMoney,
  formatOrderNumber,
  type OrderDetailDto,
  type PaymentCreateBody,
  type PaymentResultDto,
} from '@pallet/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { Loader2 } from 'lucide-react';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { DateField } from '@/components/app/date-field';
import { Field, FieldError, FieldLabel } from '@/components/app/field';
import { MoneyText } from '@/components/app/money-text';
import { MoneyInput } from '@/components/app/numeric-input';
import { SummaryPanel } from '@/components/app/summary-panel';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { invalidateAfterPayment } from '@/features/orders/api';
import { apiFetch } from '@/lib/api-client';
import { ApiError } from '@/lib/api-error';
import { handleApiError } from '@/lib/errors';
import { useIdempotencyKey } from '@/lib/idempotency';
import { qk } from '@/lib/query-keys';
import { encodeValidationMessage } from '@/lib/validation-message';

interface PaymentValues {
  amount: number | null;
  date: string | null;
  note: string;
}

/** Daily flow 3 (§7.4.3): a payment on a credit order, with what it leaves owing live. */
export function PaymentForm({ order }: { order: OrderDetailDto }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const idempotency = useIdempotencyKey();
  const form = useForm<PaymentValues>({
    mode: 'onTouched',
    defaultValues: { amount: order.owed, date: businessToday(), note: '' },
  });
  const amount = useWatch({ control: form.control, name: 'amount' }) ?? 0;
  const errors = form.formState.errors;
  const owedAfter = Math.max(0, order.owed - amount);
  const exceedsOwed = (owed: number) => encodeValidationMessage('paymentExceedsOwed', { owed: formatMoney(owed) });

  const record = useMutation({
    mutationFn: (body: PaymentCreateBody) =>
      apiFetch<PaymentResultDto>(`/orders/${order.id}/payments`, {
        method: 'POST',
        body,
        idempotencyKey: idempotency.getKey(body),
      }),
    onSuccess: async (result) => {
      idempotency.reset();
      toast.success(t('payments.new.created', { orderNumber: formatOrderNumber(result.order.orderNumber) }));
      // Leave first: refreshed here, a paid-off order would show "nothing owed" before the navigation.
      await navigate({ to: '/orders/$orderId', params: { orderId: String(order.id) } });
      void invalidateAfterPayment(queryClient, result.order);
    },
    onError: (error) => {
      if (error instanceof ApiError && error.code === 'PAYMENT_EXCEEDS_OWED') {
        // Something was paid or returned since the page loaded: say what is owed now, and reload it.
        form.setError('amount', { message: exceedsOwed(Number(error.details?.owed ?? 0)) });
        void queryClient.invalidateQueries({ queryKey: qk.orders.detail(order.id) });
        return;
      }
      handleApiError(error, {
        setError: form.setError,
        fields: ['amount', 'date', 'note'],
        fieldMap: { BUSINESS_DATE_IN_FUTURE: 'date', PAYMENT_DATE_BEFORE_ORDER_DATE: 'date' },
      });
    },
  });

  const submit = form.handleSubmit((values) => {
    if (values.amount === null || values.amount < 1) {
      form.setError('amount', { message: encodeValidationMessage('too_small', { minimum: 1 }) });
      return;
    }
    if (values.amount > order.owed) {
      form.setError('amount', { message: exceedsOwed(order.owed) });
      return;
    }
    if (!values.date) {
      form.setError('date', { message: encodeValidationMessage('required') });
      return;
    }
    const note = values.note.trim();
    record.mutate({ amount: values.amount, date: values.date, note: note === '' ? null : note });
  });

  const submitButton = (
    <Button type="submit" form="new-payment" disabled={record.isPending}>
      {record.isPending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
      {t('payments.new.submit')}
    </Button>
  );

  return (
    <div className="grid grid-cols-1 gap-6 pb-24 lg:grid-cols-[minmax(0,1fr)_22rem] lg:pb-0">
      <form id="new-payment" onSubmit={(event) => void submit(event)} className="flex flex-col gap-6" noValidate>
        <Card>
          <CardContent className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <Field className="md:col-span-2">
              <FieldLabel htmlFor="amount">{t('payments.fields.amount')}</FieldLabel>
              <Controller
                control={form.control}
                name="amount"
                render={({ field }) => (
                  <MoneyInput
                    id="amount"
                    autoFocus
                    value={field.value}
                    onChange={(next) => {
                      field.onChange(next);
                      form.clearErrors('amount');
                    }}
                    onBlur={field.onBlur}
                    aria-invalid={Boolean(errors.amount)}
                    aria-describedby="amount-error"
                  />
                )}
              />
              <div className="flex flex-wrap gap-2">
                <Button type="button" variant="outline" size="sm" onClick={() => form.setValue('amount', order.owed)}>
                  {t('payments.new.full')}
                </Button>
                {order.owed >= 2 ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => form.setValue('amount', Math.floor(order.owed / 2))}
                  >
                    {t('payments.new.half')}
                  </Button>
                ) : null}
              </div>
              <FieldError id="amount-error" message={errors.amount?.message} />
            </Field>
            <DateField
              control={form.control}
              name="date"
              id="date"
              label={t('payments.fields.date')}
              min={order.date}
            />
            <Field>
              <FieldLabel htmlFor="note">{t('payments.fields.note')}</FieldLabel>
              <Input id="note" maxLength={500} aria-describedby="note-error" {...form.register('note')} />
              <FieldError id="note-error" message={errors.note?.message} />
            </Field>
          </CardContent>
        </Card>
      </form>

      <SummaryPanel
        title={t('payments.new.summary')}
        keyLabel={t('payments.new.owedAfter')}
        keyFigure={<MoneyText value={owedAfter} />}
        submit={submitButton}
      >
        <dl className="flex flex-col gap-3 text-sm">
          <div className="flex justify-between gap-2">
            <dt className="text-muted-foreground">{t('payments.new.owedBefore')}</dt>
            <dd>
              <MoneyText value={order.owed} />
            </dd>
          </div>
          <div className="flex justify-between gap-2">
            <dt className="text-muted-foreground">{t('payments.new.payment')}</dt>
            <dd>
              <MoneyText value={amount} />
            </dd>
          </div>
          <div className="flex justify-between gap-2 text-base font-semibold">
            <dt>{t('payments.new.owedAfter')}</dt>
            <dd>
              <MoneyText value={owedAfter} />
            </dd>
          </div>
        </dl>
        {owedAfter === 0 && order.outQuantityTotal === 0 ? (
          <p className="text-success text-sm font-medium">{t('payments.new.willSettle')}</p>
        ) : null}
      </SummaryPanel>
    </div>
  );
}
