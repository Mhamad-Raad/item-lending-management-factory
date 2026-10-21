import {
  businessToday,
  formatMoney,
  formatOrderNumber,
  type OrderDetailDto,
  type ReturnCreateBody,
  type ReturnResultDto,
} from '@pallet/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { HandCoins, Loader2 } from 'lucide-react';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { DateField } from '@/components/app/date-field';
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
import { printMoneyReceipt } from '@/features/receipt/print-receipt';
import { useFlowMutation } from '@/hooks/use-flow-mutation';
import { apiFetch } from '@/lib/api-client';
import { detailsOf, isApiError } from '@/lib/api-error';
import { handleApiError } from '@/lib/errors';
import { qk } from '@/lib/query-keys';
import { encodeValidationMessage } from '@/lib/validation-message';
import { isStandingRefundOf, returnBaseline, returnSummary } from './return-math';
import {
  checkRow,
  count,
  pricedRow,
  restAccepted,
  rowKey,
  typedRow,
  useRowMessages,
  type RowCounts,
} from './return-rows';

interface RowValues extends RowCounts {
  orderLineId: number;
}

interface ReturnValues {
  date: string | null;
  notes: string;
  /** Keyed `l<orderLineId>`: a reloaded order with lines added or removed keeps each row on its line. */
  rows: Record<string, RowValues>;
}

/**
 * Daily flow 2 (§7.4.2): what came back on an order, line by line, with what it credits and pays out
 * live. With `replaceReturnId` it corrects that return: the rows start from it, and everything is
 * checked and priced against the order as if it had never been recorded.
 */
export function ReturnForm({ order, replaceReturnId }: { order: OrderDetailDto; replaceReturnId?: number }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const replaced = order.returns.find((pr) => pr.id === replaceReturnId);
  const base = returnBaseline(order, replaced?.id);
  // One form row per order line, found by the line's id: a reloaded order (another return recorded,
  // a line taken off meanwhile) keeps every typed row on its own line; only rows that can take a
  // return, or already hold one, show.
  const outOf = (orderLineId: number): number => base.lines.find((line) => line.id === orderLineId)?.outQuantity ?? 0;

  const form = useForm<ReturnValues>({
    defaultValues: {
      date: replaced?.date ?? businessToday(),
      notes: replaced?.notes ?? '',
      rows: Object.fromEntries(
        order.lines.map((line) => {
          const previous = replaced?.lines.find((entry) => entry.orderLineId === line.id);
          return [
            rowKey(line.id),
            {
              orderLineId: line.id,
              accepted: previous?.acceptedQuantity ?? 0,
              damaged: previous?.damagedQuantity ?? 0,
              damagedRefund: previous?.damagedRefund ?? 0,
            },
          ];
        }),
      ),
    },
  });
  const rows = useWatch({ control: form.control, name: 'rows' });
  const rowOf = (orderLineId: number) => typedRow(rows[rowKey(orderLineId)]);
  const errors = form.formState.errors;
  const lines = order.lines
    .map((line) => {
      const key = rowKey(line.id);
      const row = rowOf(line.id);
      const out = outOf(line.id);
      // Over what is out here, or refused by the server for an order not yet reloaded (Q141, Q146).
      return {
        line,
        key,
        row,
        out,
        ...checkRow(row, { outQuantity: out, maximum: row.damaged * line.unitDeposit }, errors.rows?.[key]),
      };
    })
    .filter(({ out, returning }) => out > 0 || returning > 0);
  // A row asking back more than is out, or refunding more than its damaged pallets' deposit, is refused as it is
  // typed and prices nothing: the summary never offers a figure the server would refuse (Q141, Q146).
  const priced = lines.map(({ line, row, invalid }) => pricedRow(row, line.unitDeposit, invalid));
  const summary = returnSummary(base, priced);
  // Nothing can be recorded while a row is refused, so nothing is to be handed over or owed yet.
  const anyInvalid = lines.some(({ invalid }) => invalid);

  const { exceedsOut, refundTooHigh, money } = useRowMessages();
  const hasLine = (orderLineId: number): boolean => order.lines.some((line) => line.id === orderLineId);

  const record = useFlowMutation({
    request: (body: ReturnCreateBody, idempotencyKey) =>
      replaced
        ? apiFetch<ReturnResultDto>(`/returns/${replaced.id}/replace`, { method: 'POST', body })
        : apiFetch<ReturnResultDto>(`/orders/${order.id}/returns`, {
            method: 'POST',
            body,
            idempotencyKey: idempotencyKey(),
          }),
    successMessage: (result) =>
      t(replaced ? 'returns.new.replaced' : 'returns.new.created', {
        orderNumber: formatOrderNumber(result.order.orderNumber),
      }),
    // A return that pays cash back offers the refund's receipt, for the customer to sign for (Q137).
    successAction: (result) => {
      const refund = result.order.ledgerEntries.find((entry) => isStandingRefundOf(entry, result.returnId));
      return refund ? { label: t('orders.money.printReceipt'), onClick: () => printMoneyReceipt(refund.id) } : null;
    },
    invalidate: () => invalidateAfterOrderChange(queryClient),
    // Leave first: refreshed here, the order would show this page's "cannot be corrected" or
    // "nothing out" state for a moment before the navigation.
    refresh: 'after-navigate',
    destination: () => ({ to: '/orders/$orderId', params: { orderId: String(order.id) } }),
    onError: async (error) => {
      if (isApiError(error, 'RETURN_ALREADY_REVERSED')) {
        // Corrected or deleted from another screen meanwhile: the order shows what stands now.
        toast.error(t('errors.RETURN_ALREADY_REVERSED'));
        await invalidateAfterOrderChange(queryClient);
        await navigate({ to: '/orders/$orderId', params: { orderId: String(order.id) } });
        return;
      }
      const over = detailsOf(error, 'RETURN_EXCEEDS_OUT');
      if (over) {
        for (const line of over.lines) {
          if (hasLine(line.orderLineId)) {
            form.setError(`rows.${rowKey(line.orderLineId)}.accepted`, { message: exceedsOut(line.outQuantity) });
          }
        }
        void queryClient.invalidateQueries({ queryKey: qk.orders.detail(order.id) });
        return;
      }
      const refund = detailsOf(error, 'DAMAGED_REFUND_TOO_HIGH');
      if (refund) {
        if (hasLine(refund.orderLineId)) {
          form.setError(`rows.${rowKey(refund.orderLineId)}.damagedRefund`, {
            message: refundTooHigh(refund.maximum),
          });
          // The line's deposit may have changed meanwhile: the live check needs the order as it is now.
          void queryClient.invalidateQueries({ queryKey: qk.orders.detail(order.id) });
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
    for (const line of order.lines) {
      const row = values.rows[rowKey(line.id)];
      const accepted = count(row?.accepted ?? null);
      const damaged = count(row?.damaged ?? null);
      const lineOut = outOf(line.id);
      if (accepted + damaged > lineOut) {
        form.setError(`rows.${rowKey(line.id)}.accepted`, { message: exceedsOut(lineOut) });
        valid = false;
      }
      const maximum = damaged * line.unitDeposit;
      if (count(row?.damagedRefund ?? null) > maximum) {
        form.setError(`rows.${rowKey(line.id)}.damagedRefund`, { message: refundTooHigh(maximum) });
        valid = false;
      }
    }
    // Only the order's current lines: a row left from a line removed meanwhile is not sent.
    const returned = order.lines
      .map((line) => values.rows[rowKey(line.id)])
      .filter((row): row is RowValues => row !== undefined && count(row.accepted) + count(row.damaged) > 0);
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

  // The rest of the line accepted, damage already typed kept (Q156). Only the count's error goes: a refund the server
  // refused is still the refund typed, and stays refused until it changes.
  const allAccepted = (orderLineId: number): void => {
    const key = rowKey(orderLineId);
    form.setValue(`rows.${key}`, { orderLineId, ...restAccepted(form.getValues(`rows.${key}`), outOf(orderLineId)) });
    form.clearErrors(`rows.${key}.accepted`);
  };

  const submitButton = (
    // A refused row cannot be recorded, so it cannot be sent either (Q141, Q146).
    <Button type="submit" form="new-return" disabled={record.isPending || anyInvalid}>
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
                onClick={() => lines.forEach(({ line }) => allAccepted(line.id))}
              >
                {t('returns.new.everythingAccepted')}
              </Button>
            </div>
            {lines.map(({ line, key, row, out: lineOut, overOut, maximum, refundOver }) => {
              const damaged = row.damaged;
              const rowErrors = errors.rows?.[key];
              const acceptedError = rowErrors?.accepted?.message ?? (overOut ? exceedsOut(lineOut) : undefined);
              const refundError =
                rowErrors?.damagedRefund?.message ?? (refundOver ? refundTooHigh(maximum) : undefined);
              // A count changed settles what a save or the server said about the old one.
              const countChanged = (): void => form.clearErrors(`rows.${key}.accepted`);
              return (
                <fieldset key={line.id} className="flex flex-col gap-3 rounded-md border p-3">
                  <legend className="sr-only">{line.item.name}</legend>
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex min-w-0 items-center gap-3">
                      <Thumbnail url={line.item.imageUrl} size="sm" />
                      <span className="min-w-0 font-medium break-words" aria-hidden>
                        <bdi>{line.item.name}</bdi>
                      </span>
                    </div>
                    <div className="flex shrink-0 items-center justify-between gap-3">
                      <span className="text-muted-foreground text-sm">
                        {t('returns.new.out')}: <QuantityText value={lineOut} /> ·{' '}
                        <MoneyText value={line.unitDeposit} />
                      </span>
                      <Button type="button" variant="ghost" size="sm" onClick={() => allAccepted(line.id)}>
                        {t('returns.new.allAccepted')}
                      </Button>
                    </div>
                  </div>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                    <Field>
                      <FieldLabel htmlFor={`accepted-${line.id}`}>{t('returns.fields.accepted')}</FieldLabel>
                      <Controller
                        control={form.control}
                        name={`rows.${key}.accepted`}
                        render={({ field }) => (
                          <QuantityInput
                            id={`accepted-${line.id}`}
                            value={field.value}
                            onChange={(next) => {
                              field.onChange(next);
                              countChanged();
                            }}
                            aria-invalid={Boolean(acceptedError)}
                            aria-describedby={`accepted-${line.id}-error`}
                          />
                        )}
                      />
                      <FieldError id={`accepted-${line.id}-error`} message={acceptedError} />
                    </Field>
                    <Field>
                      <FieldLabel htmlFor={`damaged-${line.id}`}>{t('returns.fields.damaged')}</FieldLabel>
                      <Controller
                        control={form.control}
                        name={`rows.${key}.damaged`}
                        render={({ field }) => (
                          <QuantityInput
                            id={`damaged-${line.id}`}
                            value={field.value}
                            onChange={(next) => {
                              field.onChange(next);
                              countChanged();
                              // The refund's maximum moves with the damaged count.
                              form.clearErrors(`rows.${key}.damagedRefund`);
                              // No damaged pallets, nothing to refund for them.
                              if (!next) form.setValue(`rows.${key}.damagedRefund`, 0);
                            }}
                            aria-invalid={Boolean(acceptedError)}
                            aria-describedby={`accepted-${line.id}-error`}
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
                            value={field.value}
                            onChange={(next) => {
                              field.onChange(next);
                              form.clearErrors(`rows.${key}.damagedRefund`);
                            }}
                            disabled={damaged === 0}
                            suffix={t('common.currency')}
                            aria-invalid={Boolean(refundError)}
                            aria-describedby={`refund-${line.id}-split refund-${line.id}-error`}
                          />
                        )}
                      />
                      <FieldError id={`refund-${line.id}-error`} message={refundError} />
                      {/* What the amount does: given back out of these pallets' deposit, the rest kept (Q146). */}
                      {damaged > 0 && !overOut && !refundOver ? (
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
                </fieldset>
              );
            })}
            <FieldError id="lines-error" message={errors.root?.message} />
          </CardContent>
        </Card>

        <Card>
          <CardContent className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <DateField control={form.control} name="date" id="date" label={t('returns.fields.date')} min={order.date} />
            <Field className="md:col-span-2">
              <FieldLabel htmlFor="notes">{t('returns.fields.notes')}</FieldLabel>
              <Textarea id="notes" rows={2} maxLength={1000} {...form.register('notes')} />
            </Field>
          </CardContent>
        </Card>
      </form>

      <SummaryPanel
        title={t('returns.new.summary')}
        // The phone's bar names cash only when this return can be recorded and pays some out.
        keyLabel={t(!anyInvalid && summary.cashRefund > 0 ? 'returns.new.cashRefund' : 'returns.new.refundDue')}
        keyFigure={<MoneyText value={!anyInvalid && summary.cashRefund > 0 ? summary.cashRefund : summary.refundDue} />}
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
        {anyInvalid ? null : summary.cashRefund > 0 ? (
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
