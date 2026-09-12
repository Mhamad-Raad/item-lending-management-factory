import { zodResolver } from '@hookform/resolvers/zod';
import { StockAdjustmentCreateBody, formatNumber, type ItemDto, type StockAdjustmentResultDto } from '@pallet/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Field, FieldDescription, FieldError, FieldLabel } from '@/components/app/field';
import { QuantityInput } from '@/components/app/numeric-input';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { apiFetch } from '@/lib/api-client';
import { handleApiError } from '@/lib/errors';
import { invalidateStock, stockShortageMessage } from './api';

/** A signed correction with its reason (§7.3.16): found pallets are added, broken ones taken out. */
export function AdjustStockDialog({
  item,
  open,
  onOpenChange,
}: {
  item: ItemDto;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const form = useForm({
    resolver: zodResolver(StockAdjustmentCreateBody),
    mode: 'onTouched',
    defaultValues: { quantity: undefined, note: '' },
  });
  const quantity = useWatch({ control: form.control, name: 'quantity' });
  const errors = form.formState.errors;

  const close = (): void => {
    form.reset();
    onOpenChange(false);
  };

  const adjust = useMutation({
    mutationFn: (body: StockAdjustmentCreateBody) =>
      apiFetch<StockAdjustmentResultDto>(`/items/${item.id}/stock-adjustments`, { method: 'POST', body }),
    onSuccess: async () => {
      await invalidateStock(queryClient);
      toast.success(t('items.adjust.done'));
      close();
    },
    onError: (error) => {
      const shortage = stockShortageMessage(error, t);
      if (shortage) toast.error(shortage);
      else handleApiError(error, { setError: form.setError, fields: ['quantity', 'note'] });
    },
  });

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? onOpenChange(true) : close())}>
      <DialogContent closeLabel={t('common.actions.close')}>
        <DialogHeader>
          <DialogTitle>{t('items.adjust.title')}</DialogTitle>
          <DialogDescription>
            {t('items.adjust.description', { onHand: formatNumber(item.quantityOnHand) })}
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={form.handleSubmit((values) => adjust.mutate(values))}
          className="flex flex-col gap-4"
          noValidate
        >
          <Field>
            <FieldLabel htmlFor="adjust-quantity">{t('items.adjust.quantity')}</FieldLabel>
            <Controller
              control={form.control}
              name="quantity"
              render={({ field }) => (
                <QuantityInput
                  id="adjust-quantity"
                  allowNegative
                  value={field.value}
                  onChange={(value) => field.onChange(value ?? undefined)}
                  onBlur={field.onBlur}
                  aria-invalid={Boolean(errors.quantity)}
                  aria-describedby="adjust-quantity-help adjust-quantity-error"
                />
              )}
            />
            <FieldDescription id="adjust-quantity-help">{t('items.adjust.quantityHelp')}</FieldDescription>
            {/* The shared schema calls zero `too_small`, which has no minimum to name here. */}
            <FieldError
              id="adjust-quantity-error"
              message={quantity === 0 ? 'items.adjust.notZero' : errors.quantity?.message}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="adjust-note">{t('items.adjust.note')}</FieldLabel>
            <Input
              id="adjust-note"
              aria-invalid={Boolean(errors.note)}
              aria-describedby="adjust-note-error"
              {...form.register('note')}
            />
            <FieldError id="adjust-note-error" message={errors.note?.message} />
          </Field>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={close}>
              {t('common.actions.cancel')}
            </Button>
            <Button type="submit" disabled={adjust.isPending}>
              {t('items.adjust.submit')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
