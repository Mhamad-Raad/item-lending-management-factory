import { MIN_BUSINESS_DATE } from '@pallet/shared';
import { UserPlus } from 'lucide-react';
import { useState } from 'react';
import { Controller, type UseFormReturn } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { DateField } from '@/components/app/date-field';
import { EntityCombobox } from '@/components/app/entity-combobox';
import { Field, FieldError, FieldLabel } from '@/components/app/field';
import { Tip } from '@/components/app/tip';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { DriverDialog } from '@/features/drivers/driver-dialog';
import { useDialogState } from '@/hooks/use-dialog-state';
import { useCan } from '@/lib/auth';
import type { OrderFormValues } from './order-form';

/** The one thing the driver field's dialog opens for: a stable value, so each opening is told from the last. */
const NEW_DRIVER = { kind: 'new' } as const;

/**
 * The driver, date and notes of an order: the part of the new and the edit form that is the same (§7.4.1). A driver
 * who is not on file yet is added from here, without leaving the order being typed (Q135).
 */
export function OrderDriverField({ form }: { form: UseFormReturn<OrderFormValues> }) {
  const { t } = useTranslation();
  const mayCreate = useCan('drivers.create');
  const [adding, setAdding] = useState(false);
  const dialog = useDialogState(adding ? NEW_DRIVER : null);
  const error = form.formState.errors.driverId;
  const choose = (driverId: number): void =>
    form.setValue('driverId', driverId, { shouldDirty: true, shouldTouch: true, shouldValidate: true });

  return (
    <Field>
      <FieldLabel htmlFor="driverId">{t('orders.fields.driver')}</FieldLabel>
      <div className="flex gap-2">
        <div className="min-w-0 flex-1">
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
        </div>
        {mayCreate ? (
          // An icon alone: beside a label the picker has no room left for a driver's name in the form's two columns.
          <Tip label={t('orders.fields.newDriver')}>
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="shrink-0"
              aria-label={t('orders.fields.newDriver')}
              onClick={() => setAdding(true)}
            >
              <UserPlus aria-hidden />
            </Button>
          </Tip>
        ) : null}
      </div>
      <FieldError id="driverId-error" message={error?.message} />
      {dialog.value ? (
        <DriverDialog
          key={dialog.key}
          open={dialog.open}
          onOpenChange={(next) => !next && setAdding(false)}
          onSaved={(driver) => choose(driver.id)}
          onUseExisting={choose}
        />
      ) : null}
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

/**
 * Shown when the customer could not be loaded: the live credit check has nothing to go on, so it says so rather than
 * letting an order look within the limit. The server still checks the limit on save (§4.4).
 */
export function CreditCheckUnavailable({ failed }: { failed: boolean }) {
  const { t } = useTranslation();
  if (!failed) return null;
  return (
    <Alert className="md:col-span-2">
      <AlertDescription>{t('orders.new.creditUnavailable')}</AlertDescription>
    </Alert>
  );
}
