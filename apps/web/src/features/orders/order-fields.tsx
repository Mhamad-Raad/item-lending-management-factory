import { MIN_BUSINESS_DATE } from '@pallet/shared';
import { Controller, type UseFormReturn } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { DateField } from '@/components/app/date-field';
import { EntityCombobox } from '@/components/app/entity-combobox';
import { Field, FieldError, FieldLabel } from '@/components/app/field';
import { Textarea } from '@/components/ui/textarea';
import type { OrderFormValues } from './order-form';

/** The driver, date and notes of an order: the part of the new and the edit form that is the same (§7.4.1). */
export function OrderDriverField({ form }: { form: UseFormReturn<OrderFormValues> }) {
  const { t } = useTranslation();
  const error = form.formState.errors.driverId;
  return (
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
            invalid={Boolean(error)}
            placeholder={t('orders.fields.chooseDriver')}
          />
        )}
      />
      <FieldError id="driverId-error" message={error?.message} />
    </Field>
  );
}

export function OrderDateField({ form }: { form: UseFormReturn<OrderFormValues> }) {
  const { t } = useTranslation();
  return (
    <DateField control={form.control} name="date" id="date" label={t('orders.fields.date')} min={MIN_BUSINESS_DATE} />
  );
}

export function OrderNotesField({ form, className }: { form: UseFormReturn<OrderFormValues>; className?: string }) {
  const { t } = useTranslation();
  return (
    <Field className={className}>
      <FieldLabel htmlFor="notes">{t('orders.fields.notes')}</FieldLabel>
      <Textarea id="notes" rows={3} aria-describedby="notes-error" {...form.register('notes')} />
      <FieldError id="notes-error" message={form.formState.errors.notes?.message} />
    </Field>
  );
}
