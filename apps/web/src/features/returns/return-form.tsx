import {
  businessToday,
  formatMoney,
  formatOrderNumber,
  type OrderDetailDto,
  type ReturnCreateBody,
  type ReturnResultDto,
} from '@pallet/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { HandCoins, Loader2 } from 'lucide-react';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { DatePicker } from '@/components/app/date-picker';
import { Field, FieldError, FieldLabel } from '@/components/app/field';
import { MoneyText } from '@/components/app/money-text';
import { MoneyInput, QuantityInput } from '@/components/app/numeric-input';
import { QuantityText } from '@/components/app/quantity-text';
import { SummaryPanel } from '@/components/app/summary-panel';
import { Thumbnail } from '@/components/app/thumbnail';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { invalidateAfterOrderChange } from '@/features/orders/api';
import { apiFetch } from '@/lib/api-client';
import { ApiError } from '@/lib/api-error';
import { handleApiError } from '@/lib/errors';
import { useIdempotencyKey } from '@/lib/idempotency';
import { qk } from '@/lib/query-keys';
import { encodeValidationMessage } from '@/lib/validation-message';
import { returnBaseline, returnSummary } from './return-math';

interface RowValues {
  orderLineId: number;
  accepted: number | null;
  damaged: number | null;
  damagedRefund: number | null;
}

interface ReturnValues {
  date: string | null;
  notes: string;
  rows: RowValues[];
}

const count = (value: number | null): number => value ?? 0;

/**
 * Daily flow 2 (§7.4.2): what came back on an order, line by line, with what it credits and pays out
 * live. With `replaceReturnId` it corrects that return: the rows start from it, and everything is
 * checked and priced against the order as if it had never been recorded.
 */
export function ReturnForm({ order, replaceReturnId }: { order: OrderDetailDto; replaceReturnId?: number }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const idempotency = useIdempotencyKey();
  const replaced = order.returns.find((pr) => pr.id === replaceReturnId);
  const base = returnBaseline(order, replaced?.id);
  // One form row per order line, in the order's line order, so a reloaded order (another return
  // recorded meanwhile) keeps every typed row in its place; only rows that can take a return show.
  const out = order.lines.map((_, index) => base.lines[index]?.outQuantity ?? 0);

  const form = useForm<ReturnValues>({
    defaultValues: {
      date: replaced?.date ?? businessToday(),
      notes: replaced?.notes ?? '',
      rows: order.lines.map((line) => {
        const previous = replaced?.lines.find((entry) => entry.orderLineId === line.id);
        return {
          orderLineId: line.id,
          accepted: previous?.acceptedQuantity ?? 0,
          damaged: previous?.damagedQuantity ?? 0,
          damagedRefund: previous?.damagedRefund ?? 0,
        };
      }),
    },
  });
  const rows = useWatch({ control: form.control, name: 'rows' });
  const typed = (index: number): number => count(rows[index]?.accepted ?? null) + count(rows[index]?.damaged ?? null);
  const lines = order.lines
    .map((line, index) => ({ line, index, out: out[index] ?? 0 }))
    .filter(({ index, out: lineOut }) => lineOut > 0 || typed(index) > 0);
  const errors = form.formState.errors;
  const priced = lines.map(({ line, index }) => ({
    acceptedQuantity: count(rows[index]?.accepted ?? null),
    damagedQuantity: count(rows[index]?.damaged ?? null),
    damagedRefund: count(rows[index]?.damagedRefund ?? null),
    unitDeposit: line.unitDeposit,
  }));
  const summary = returnSummary(base, priced);

  const exceedsOut = (limit: number) => encodeValidationMessage('returnExceedsOut', { out: limit });
  const refundTooHigh = (maximum: number) =>
    encodeValidationMessage('damagedRefundTooHigh', { maximum: formatMoney(maximum) });
  const rowIndex = (orderLineId: number): number => order.lines.findIndex((line) => line.id === orderLineId);

  const record = useMutation({
    mutationFn: (body: ReturnCreateBody) =>
      replaced
        ? apiFetch<ReturnResultDto>(`/returns/${replaced.id}/replace`, { method: 'POST', body })
        : apiFetch<ReturnResultDto>(`/orders/${order.id}/returns`, {
            method: 'POST',
            body,
            idempotencyKey: idempotency.getKey(body),
          }),
    onSuccess: async (result) => {
      idempotency.reset();
      const orderNumber = formatOrderNumber(result.order.orderNumber);
      toast.success(t(replaced ? 'returns.new.replaced' : 'returns.new.created', { orderNumber }));
      await invalidateAfterOrderChange(queryClient);
      await navigate({ to: '/orders/$orderId', params: { orderId: String(order.id) } });
    },
    onError: async (error) => {
      if (error instanceof ApiError && error.code === 'RETURN_ALREADY_REVERSED') {
        // Corrected or deleted from another screen meanwhile: the order shows what stands now.
        toast.error(t('errors.RETURN_ALREADY_REVERSED'));
        await invalidateAfterOrderChange(queryClient);
        await navigate({ to: '/orders/$orderId', params: { orderId: String(order.id) } });
        return;
      }
      if (error instanceof ApiError && error.code === 'RETURN_EXCEEDS_OUT') {
        const over = (error.details?.lines as { orderLineId: number; outQuantity: number }[] | undefined) ?? [];
        for (const line of over) {
          const index = rowIndex(line.orderLineId);
          if (index >= 0) form.setError(`rows.${index}.accepted`, { message: exceedsOut(line.outQuantity) });
        }
        void queryClient.invalidateQueries({ queryKey: qk.orders.detail(order.id) });
        return;
      }
      if (error instanceof ApiError && error.code === 'DAMAGED_REFUND_TOO_HIGH') {
        const index = rowIndex(Number(error.details?.orderLineId));
        if (index >= 0) {
          form.setError(`rows.${index}.damagedRefund`, { message: refundTooHigh(Number(error.details?.maximum ?? 0)) });
          return;
        }
      }
      handleApiError(error, {
        setError: form.setError,
        fields: ['date', 'notes'],
        fieldMap: { BUSINESS_DATE_IN_FUTURE: 'date', RETURN_DATE_BEFORE_ORDER_DATE: 'date' },
      });
    },
  });

  const submit = form.handleSubmit((values) => {
    form.clearErrors();
    let valid = true;
    if (!values.date) {
      form.setError('date', { message: encodeValidationMessage('required') });
      valid = false;
    }
    values.rows.forEach((row, index) => {
      const line = order.lines[index];
      if (!line) return;
      const lineOut = out[index] ?? 0;
      if (count(row.accepted) + count(row.damaged) > lineOut) {
        form.setError(`rows.${index}.accepted`, { message: exceedsOut(lineOut) });
        valid = false;
      }
      const maximum = count(row.damaged) * line.unitDeposit;
      if (count(row.damagedRefund) > maximum) {
        form.setError(`rows.${index}.damagedRefund`, { message: refundTooHigh(maximum) });
        valid = false;
      }
    });
    const returned = values.rows.filter((row) => count(row.accepted) + count(row.damaged) > 0);
    if (valid && returned.length === 0) {
      form.setError('root', { message: encodeValidationMessage('returnEmpty') });
      valid = false;
    }
    if (!valid) return;
    const notes = values.notes.trim();
    record.mutate({
      date: values.date ?? '',
      notes: notes === '' ? null : notes,
      lines: returned.map((row) => ({
        orderLineId: row.orderLineId,
        acceptedQuantity: count(row.accepted),
        damagedQuantity: count(row.damaged),
        damagedRefund: count(row.damagedRefund),
      })),
    });
  });

  const allAccepted = (index: number): void => {
    const lineOut = out[index] ?? 0;
    form.setValue(`rows.${index}.accepted`, lineOut);
    form.setValue(`rows.${index}.damaged`, 0);
    form.setValue(`rows.${index}.damagedRefund`, 0);
    form.clearErrors(`rows.${index}`);
  };

  const submitButton = (
    <Button type="submit" form="new-return" disabled={record.isPending}>
      {record.isPending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
      {t(replaced ? 'returns.new.submitReplace' : 'returns.new.submit')}
    </Button>
  );

  return (
    <div className="grid grid-cols-1 gap-6 pb-24 lg:grid-cols-[minmax(0,1fr)_22rem] lg:pb-0">
      <form id="new-return" onSubmit={(event) => void submit(event)} className="flex flex-col gap-6" noValidate>
        <Card>
          <CardContent className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="font-semibold">{t('returns.new.lines')}</h2>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => lines.forEach(({ index }) => allAccepted(index))}
              >
                {t('returns.new.everythingAccepted')}
              </Button>
            </div>
            {lines.map(({ line, index, out: lineOut }) => {
              const damaged = count(rows[index]?.damaged ?? null);
              const rowErrors = errors.rows?.[index];
              return (
                <fieldset key={line.id} className="flex flex-col gap-3 rounded-md border p-3">
                  <legend className="sr-only">{line.item.name}</legend>
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex min-w-0 items-center gap-3">
                      <Thumbnail url={line.item.imageUrl} size="sm" />
                      <span className="min-w-0 font-medium break-words" aria-hidden>
                        {line.item.name}
                      </span>
                    </div>
                    <div className="flex shrink-0 items-center justify-between gap-3">
                      <span className="text-muted-foreground text-sm">
                        {t('returns.new.out')}: <QuantityText value={lineOut} /> ·{' '}
                        <MoneyText value={line.unitDeposit} />
                      </span>
                      <Button type="button" variant="ghost" size="sm" onClick={() => allAccepted(index)}>
                        {t('returns.new.allAccepted')}
                      </Button>
                    </div>
                  </div>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                    <Field>
                      <FieldLabel htmlFor={`accepted-${line.id}`}>{t('returns.fields.accepted')}</FieldLabel>
                      <Controller
                        control={form.control}
                        name={`rows.${index}.accepted`}
                        render={({ field }) => (
                          <QuantityInput
                            id={`accepted-${line.id}`}
                            value={field.value}
                            onChange={field.onChange}
                            aria-invalid={Boolean(rowErrors?.accepted)}
                            aria-describedby={`accepted-${line.id}-error`}
                          />
                        )}
                      />
                      <FieldError id={`accepted-${line.id}-error`} message={rowErrors?.accepted?.message} />
                    </Field>
                    <Field>
                      <FieldLabel htmlFor={`damaged-${line.id}`}>{t('returns.fields.damaged')}</FieldLabel>
                      <Controller
                        control={form.control}
                        name={`rows.${index}.damaged`}
                        render={({ field }) => (
                          <QuantityInput
                            id={`damaged-${line.id}`}
                            value={field.value}
                            onChange={(next) => {
                              field.onChange(next);
                              // No damaged pallets, nothing to refund for them.
                              if (!next) form.setValue(`rows.${index}.damagedRefund`, 0);
                            }}
                          />
                        )}
                      />
                    </Field>
                    <Field>
                      <FieldLabel htmlFor={`refund-${line.id}`}>{t('returns.fields.damagedRefund')}</FieldLabel>
                      <Controller
                        control={form.control}
                        name={`rows.${index}.damagedRefund`}
                        render={({ field }) => (
                          <MoneyInput
                            id={`refund-${line.id}`}
                            value={field.value}
                            onChange={field.onChange}
                            disabled={damaged === 0}
                            aria-invalid={Boolean(rowErrors?.damagedRefund)}
                            aria-describedby={`refund-${line.id}-error`}
                          />
                        )}
                      />
                      <FieldError id={`refund-${line.id}-error`} message={rowErrors?.damagedRefund?.message} />
                    </Field>
                  </div>
                </fieldset>
              );
            })}
            <FieldError id="lines-error" message={errors.root?.message} />
          </CardContent>
        </Card>

        <Card>
          <CardContent className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <Field>
              <FieldLabel htmlFor="date">{t('returns.fields.date')}</FieldLabel>
              <Controller
                control={form.control}
                name="date"
                render={({ field }) => (
                  <DatePicker
                    id="date"
                    value={field.value}
                    onChange={field.onChange}
                    onBlur={field.onBlur}
                    min={order.date}
                    max={businessToday()}
                    invalid={Boolean(errors.date)}
                    describedBy="date-error"
                  />
                )}
              />
              <FieldError id="date-error" message={errors.date?.message} />
            </Field>
            <Field className="md:col-span-2">
              <FieldLabel htmlFor="notes">{t('returns.fields.notes')}</FieldLabel>
              <Textarea id="notes" rows={2} maxLength={1000} {...form.register('notes')} />
            </Field>
          </CardContent>
        </Card>
      </form>

      <SummaryPanel
        title={t('returns.new.summary')}
        keyLabel={t(summary.cashRefund > 0 ? 'returns.new.cashRefund' : 'returns.new.refundDue')}
        keyFigure={<MoneyText value={summary.cashRefund > 0 ? summary.cashRefund : summary.refundDue} />}
        submit={submitButton}
      >
        <dl className="flex flex-col gap-3 text-sm">
          {(
            [
              ['returns.new.refundDue', <MoneyText key="refundDue" value={summary.refundDue} />],
              ['returns.new.owedBefore', <MoneyText key="owedBefore" value={summary.owedBefore} />],
              ['returns.new.owedAfter', <MoneyText key="owedAfter" value={summary.owedAfter} />],
              ['returns.new.outAfter', <QuantityText key="outAfter" value={summary.outAfter} />],
              ['returns.new.compensation', <MoneyText key="compensation" value={summary.compensation} />],
            ] as const
          ).map(([label, value]) => (
            <div key={label} className="flex justify-between gap-2">
              <dt className="text-muted-foreground">{t(label)}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
        {summary.cashRefund > 0 ? (
          <p className="bg-success/12 text-success flex items-center gap-2 rounded-md p-3 font-semibold dark:bg-success/20">
            <HandCoins className="size-5 shrink-0" aria-hidden />
            {t('returns.new.cashHandover', { amount: formatMoney(summary.cashRefund) })}
          </p>
        ) : summary.owedAfter > 0 ? (
          <p className="text-info text-sm">{t('returns.new.stillOwes', { amount: formatMoney(summary.owedAfter) })}</p>
        ) : null}
      </SummaryPanel>
    </div>
  );
}
