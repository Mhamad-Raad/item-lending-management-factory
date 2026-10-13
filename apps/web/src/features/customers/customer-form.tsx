import { zodResolver } from '@hookform/resolvers/zod';
import {
  CustomerCreateBody,
  type CustomerDto,
  type CustomerPhoneMatchDto,
  type CustomerUpdateBody,
} from '@pallet/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import {
  Contact,
  MapPin,
  Phone,
  PhoneCall,
  Save,
  TriangleAlert,
  UserRound,
  Wallet,
  X,
  type LucideIcon,
} from 'lucide-react';
import { useState } from 'react';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { ConfirmDialog } from '@/components/app/confirm-dialog';
import { Field, FieldDescription, FieldError, FieldLabel } from '@/components/app/field';
import { FormSection } from '@/components/app/form-section';
import { MoneyInput } from '@/components/app/numeric-input';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { usePhoneMatches } from '@/hooks/use-phone-matches';
import { useUnsavedChangesGuard } from '@/hooks/use-unsaved-changes-guard';
import { apiFetch } from '@/lib/api-client';
import { detailsOf } from '@/lib/api-error';
import { useAuth } from '@/lib/auth';
import { handleApiError } from '@/lib/errors';
import { qk } from '@/lib/query-keys';
import { invalidateCustomers } from './api';
import { isolate } from '@/lib/bidi';

type CustomerFormValues = CustomerCreateBody;
const FIELDS = ['name', 'phone', 'altPhone', 'address', 'creditLimit'] as const;

/**
 * The live duplicate check (§7.3.11): 400 ms after a phone becomes valid, the same comparison the
 * save makes. Matches are a warning with links, never a block (A13).
 */
function PhoneDuplicateWarning({ phone, excludeId }: { phone: string | null | undefined; excludeId?: number }) {
  const { t } = useTranslation();
  const matches = usePhoneMatches<CustomerPhoneMatchDto>(phone, {
    path: '/customers/phone-check',
    key: qk.customers.phoneCheck,
    excludeId,
  });
  if (matches.length === 0) return null;
  return (
    <p role="status" className="text-warning flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
      <TriangleAlert className="size-4 shrink-0" aria-hidden />
      {t('customers.form.phoneDuplicateWarning')}
      {matches.map((match) => (
        <Link
          key={`${match.customerId}-${match.matchedField}`}
          to="/customers/$customerId"
          params={{ customerId: String(match.customerId) }}
          className="font-medium underline underline-offset-4"
        >
          <bdi>{match.name}</bdi>
        </Link>
      ))}
    </p>
  );
}

/** A field's label with its icon before the words; the icon is decoration, the words name the field. */
function IconLabel({
  htmlFor,
  icon: Icon,
  children,
}: {
  htmlFor: string;
  icon: LucideIcon;
  children: React.ReactNode;
}) {
  return (
    <FieldLabel htmlFor={htmlFor}>
      <Icon className="text-muted-foreground size-4" aria-hidden />
      {children}
    </FieldLabel>
  );
}

/** Creates or edits a customer (§7.3.11), in two sections: who they are and how to reach them, and their credit (Q145). */
export function CustomerForm({ customer }: { customer?: CustomerDto }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  // The API refuses anyone else a credit limit change (Q71); the field only says so ahead of time.
  const mayEditCreditLimit = useAuth().user?.role === 'ADMIN';
  const [duplicates, setDuplicates] = useState<{ matches: CustomerPhoneMatchDto[]; values: CustomerFormValues } | null>(
    null,
  );

  const form = useForm({
    resolver: zodResolver(CustomerCreateBody),
    mode: 'onTouched',
    defaultValues: {
      name: customer?.name ?? '',
      phone: customer?.phone ?? '',
      altPhone: customer?.altPhone ?? null,
      address: customer?.address ?? '',
      creditLimit: customer?.creditLimit ?? null,
      confirmDuplicatePhone: false,
    },
  });
  const [phone, altPhone] = useWatch({ control: form.control, name: ['phone', 'altPhone'] });
  const errors = form.formState.errors;
  const guard = useUnsavedChangesGuard(form.formState.isDirty);

  const save = useMutation({
    mutationFn: ({ values, confirm }: { values: CustomerFormValues; confirm: boolean }) => {
      const fields = { ...values, confirmDuplicatePhone: confirm };
      if (customer) {
        const body: CustomerUpdateBody = { version: customer.version, ...fields };
        return apiFetch<CustomerDto>(`/customers/${customer.id}`, { method: 'PATCH', body });
      }
      return apiFetch<CustomerDto>('/customers', { method: 'POST', body: fields });
    },
    onSuccess: async (saved) => {
      setDuplicates(null);
      await invalidateCustomers(queryClient);
      toast.success(t(customer ? 'customers.form.saved' : 'customers.form.created'));
      guard.allowLeave();
      await navigate({ to: '/customers/$customerId', params: { customerId: String(saved.id) } });
    },
    onError: (error, { values }) => {
      // Another customer holds the number: ask once, then save anyway if the user says so (A13).
      const duplicate = detailsOf(error, 'CUSTOMER_PHONE_DUPLICATE');
      if (duplicate) {
        setDuplicates({ matches: duplicate.matches, values });
        return;
      }
      setDuplicates(null);
      handleApiError(error, {
        setError: form.setError,
        fields: FIELDS,
        fieldMap: { CUSTOMER_CREDIT_LIMIT_ADMIN_ONLY: 'creditLimit' },
        onReload: customer
          ? () => void queryClient.invalidateQueries({ queryKey: qk.customers.detail(customer.id) })
          : undefined,
      });
    },
  });

  const textField = (name: 'name' | 'address', icon: LucideIcon, className?: string) => (
    <Field className={className}>
      <IconLabel htmlFor={name} icon={icon}>
        {t(`customers.fields.${name}`)}
      </IconLabel>
      <Input
        id={name}
        aria-invalid={Boolean(errors[name])}
        aria-describedby={`${name}-error`}
        {...form.register(name)}
      />
      <FieldError id={`${name}-error`} message={errors[name]?.message} />
    </Field>
  );

  return (
    <form
      onSubmit={(event) => void form.handleSubmit((values) => save.mutate({ values, confirm: false }))(event)}
      className="flex max-w-3xl flex-col gap-6"
      noValidate
    >
      <FormSection
        icon={Contact}
        title={t('customers.form.contactSection')}
        hint={t('customers.form.contactSectionHint')}
      >
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {textField('name', UserRound, 'md:col-span-2')}

          <Field>
            <IconLabel htmlFor="phone" icon={Phone}>
              {t('customers.fields.phone')}
            </IconLabel>
            {/* A phone number reads left to right in every language of the app. */}
            <Input
              id="phone"
              dir="ltr"
              inputMode="tel"
              autoComplete="off"
              aria-invalid={Boolean(errors.phone)}
              aria-describedby="phone-error"
              {...form.register('phone')}
            />
            <FieldError id="phone-error" message={errors.phone?.message} />
            <PhoneDuplicateWarning phone={phone} excludeId={customer?.id} />
          </Field>

          <Field>
            <IconLabel htmlFor="altPhone" icon={PhoneCall}>
              {t('customers.fields.altPhone')}
            </IconLabel>
            <Controller
              control={form.control}
              name="altPhone"
              render={({ field }) => (
                <Input
                  id="altPhone"
                  dir="ltr"
                  inputMode="tel"
                  autoComplete="off"
                  value={field.value ?? ''}
                  onChange={(event) => field.onChange(event.target.value === '' ? null : event.target.value)}
                  onBlur={field.onBlur}
                  aria-invalid={Boolean(errors.altPhone)}
                  aria-describedby="altPhone-error"
                />
              )}
            />
            <FieldError id="altPhone-error" message={errors.altPhone?.message} />
            <PhoneDuplicateWarning phone={altPhone} excludeId={customer?.id} />
          </Field>

          {textField('address', MapPin, 'md:col-span-2')}
        </div>
      </FormSection>

      <FormSection
        icon={Wallet}
        tone="warning"
        title={t('customers.form.creditSection')}
        hint={t('customers.form.creditSectionHint')}
      >
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Field>
            <IconLabel htmlFor="creditLimit" icon={Wallet}>
              {t('customers.fields.creditLimit')}
            </IconLabel>
            <Controller
              control={form.control}
              name="creditLimit"
              render={({ field }) => (
                <MoneyInput
                  id="creditLimit"
                  value={field.value}
                  onChange={field.onChange}
                  onBlur={field.onBlur}
                  disabled={!mayEditCreditLimit}
                  aria-invalid={Boolean(errors.creditLimit)}
                  aria-describedby="creditLimit-help creditLimit-error"
                />
              )}
            />
            <FieldDescription id="creditLimit-help">
              {t(mayEditCreditLimit ? 'customers.form.creditLimitHelp' : 'customers.form.creditLimitAdminOnly')}
            </FieldDescription>
            <FieldError id="creditLimit-error" message={errors.creditLimit?.message} />
          </Field>
        </div>
      </FormSection>

      <div className="flex gap-2">
        <Button type="submit" disabled={save.isPending}>
          <Save aria-hidden />
          {t('common.actions.save')}
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={() =>
            void (customer
              ? navigate({ to: '/customers/$customerId', params: { customerId: String(customer.id) } })
              : navigate({ to: '/customers' }))
          }
        >
          <X aria-hidden />
          {t('common.actions.cancel')}
        </Button>
      </div>

      <ConfirmDialog
        open={duplicates !== null}
        onOpenChange={(open) => !open && setDuplicates(null)}
        destructive={false}
        title={t('customers.form.duplicateTitle')}
        description={t('customers.form.duplicateBody', {
          names: duplicates?.matches.map((match) => isolate(match.name)).join(t('common.listSeparator')) ?? '',
        })}
        confirmLabel={t('customers.form.saveAnyway')}
        pending={save.isPending}
        onConfirm={() => duplicates && save.mutate({ values: duplicates.values, confirm: true })}
      />
      {guard.dialog}
    </form>
  );
}
