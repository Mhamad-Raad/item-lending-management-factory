import { zodResolver } from '@hookform/resolvers/zod';
import {
  BusinessDate,
  Money,
  Quantity,
  businessToday,
  optionalText,
  type PurchaseBatchCreateBody,
  type PurchaseBatchDto,
  type PurchaseBatchUpdateBody,
} from '@pallet/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Controller, useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { z } from 'zod';
import { DatePicker } from '@/components/app/date-picker';
import { Field, FieldError, FieldLabel } from '@/components/app/field';
import { MoneyInput, QuantityInput } from '@/components/app/numeric-input';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { apiFetch } from '@/lib/api-client';
import { handleApiError } from '@/lib/errors';
import { invalidateStock, stockShortageMessage } from './api';

/**
 * The batch fields of §6.16. The cost is required on a new batch; editing one, a viewer without
 * `items.viewCost` never sees the cost, so the field is not offered and the stored cost stays.
 */
function batchFormSchema(costRequired: boolean) {
  return z
    .object({ date: BusinessDate, quantity: Quantity, unitCost: Money.optional(), note: optionalText(500) })
    .superRefine((values, ctx) => {
      if (costRequired && values.unitCost === undefined) {
        ctx.addIssue({ code: 'custom', path: ['unitCost'], params: { code: 'required' } });
      }
    });
}

/** Records a delivery for an item, or corrects one (§7.3.16). */
export function BatchDialog({
  itemId,
  batch,
  open,
  onOpenChange,
}: {
  itemId: number;
  /** The batch being corrected; absent for a new one. */
  batch?: PurchaseBatchDto;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const showCost = !batch || batch.unitCost !== undefined;
  const form = useForm({
    resolver: zodResolver(batchFormSchema(showCost)),
    mode: 'onTouched',
    defaultValues: {
      date: batch?.date ?? businessToday(),
      quantity: batch?.quantity,
      unitCost: batch?.unitCost,
      note: batch?.note ?? '',
    },
  });
  const errors = form.formState.errors;

  // No reset on closing: the page mounts the dialog afresh on every opening, and a reset here would show the
  // fields snapping back while the dialog fades out.
  const close = (): void => onOpenChange(false);

  const save = useMutation({
    mutationFn: (values: z.output<ReturnType<typeof batchFormSchema>>) => {
      if (batch) {
        const body: PurchaseBatchUpdateBody = {
          version: batch.version,
          date: values.date,
          quantity: values.quantity,
          note: values.note ?? null,
          ...(values.unitCost === undefined ? {} : { unitCost: values.unitCost }),
        };
        return apiFetch<PurchaseBatchDto>(`/purchase-batches/${batch.id}`, { method: 'PATCH', body });
      }
      // The schema requires the cost on a new batch; a missing one here is a bug, never a zero cost.
      const { unitCost } = values;
      if (unitCost === undefined) throw new Error('A new purchase batch must carry its unit cost');
      const body: PurchaseBatchCreateBody = {
        itemId,
        date: values.date,
        quantity: values.quantity,
        unitCost,
        note: values.note ?? null,
      };
      return apiFetch<PurchaseBatchDto>('/purchase-batches', { method: 'POST', body });
    },
    onSuccess: async () => {
      await invalidateStock(queryClient);
      toast.success(t(batch ? 'purchases.saved' : 'purchases.created'));
      close();
    },
    onError: (error) => {
      const shortage = stockShortageMessage(error, t);
      if (shortage) {
        toast.error(shortage);
        return;
      }
      handleApiError(error, {
        setError: form.setError,
        fields: ['date', 'quantity', 'unitCost', 'note'],
        fieldMap: { BUSINESS_DATE_IN_FUTURE: 'date' },
        onReload: () => {
          void invalidateStock(queryClient);
          close();
        },
      });
    },
  });

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? onOpenChange(true) : close())}>
      <DialogContent closeLabel={t('common.actions.close')}>
        <DialogHeader>
          <DialogTitle>{t(batch ? 'purchases.editTitle' : 'purchases.newTitle')}</DialogTitle>
        </DialogHeader>
        <form onSubmit={form.handleSubmit((values) => save.mutate(values))} className="flex flex-col gap-4" noValidate>
          <Field>
            <FieldLabel htmlFor="batch-date">{t('purchases.fields.date')}</FieldLabel>
            <Controller
              control={form.control}
              name="date"
              render={({ field }) => (
                <DatePicker
                  id="batch-date"
                  value={field.value}
                  onChange={(value) => field.onChange(value ?? undefined)}
                  onBlur={field.onBlur}
                  max={businessToday()}
                  invalid={Boolean(errors.date)}
                  describedBy="batch-date-error"
                />
              )}
            />
            <FieldError id="batch-date-error" message={errors.date?.message} />
          </Field>
          <Field>
            <FieldLabel htmlFor="batch-quantity">{t('purchases.fields.quantity')}</FieldLabel>
            <Controller
              control={form.control}
              name="quantity"
              render={({ field }) => (
                <QuantityInput
                  id="batch-quantity"
                  value={field.value}
                  onChange={(value) => field.onChange(value ?? undefined)}
                  onBlur={field.onBlur}
                  aria-invalid={Boolean(errors.quantity)}
                  aria-describedby="batch-quantity-error"
                />
              )}
            />
            <FieldError id="batch-quantity-error" message={errors.quantity?.message} />
          </Field>
          {showCost ? (
            <Field>
              <FieldLabel htmlFor="batch-unitCost">{t('purchases.fields.unitCost')}</FieldLabel>
              <Controller
                control={form.control}
                name="unitCost"
                render={({ field }) => (
                  <MoneyInput
                    id="batch-unitCost"
                    value={field.value}
                    onChange={(value) => field.onChange(value ?? undefined)}
                    onBlur={field.onBlur}
                    aria-invalid={Boolean(errors.unitCost)}
                    aria-describedby="batch-unitCost-error"
                  />
                )}
              />
              <FieldError id="batch-unitCost-error" message={errors.unitCost?.message} />
            </Field>
          ) : null}
          <Field>
            <FieldLabel htmlFor="batch-note">{t('purchases.fields.note')}</FieldLabel>
            <Input id="batch-note" aria-describedby="batch-note-error" {...form.register('note')} />
            <FieldError id="batch-note-error" message={errors.note?.message} />
          </Field>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={close}>
              {t('common.actions.cancel')}
            </Button>
            <Button type="submit" disabled={save.isPending}>
              {t('common.actions.save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
