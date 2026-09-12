import { zodResolver } from '@hookform/resolvers/zod';
import {
  CustomerCreateBody,
  Phone,
  type CustomerDto,
  type CustomerPhoneCheckDto,
  type CustomerPhoneMatchDto,
  type CustomerUpdateBody,
} from '@pallet/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { TriangleAlert } from 'lucide-react';
import { useState } from 'react';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { ConfirmDialog } from '@/components/app/confirm-dialog';
import { Field, FieldDescription, FieldError, FieldLabel } from '@/components/app/field';
import { MoneyInput } from '@/components/app/numeric-input';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { useDebouncedValue } from '@/hooks/use-debounced-value';
import { useUnsavedChangesGuard } from '@/hooks/use-unsaved-changes-guard';
import { apiFetch } from '@/lib/api-client';
import { ApiError } from '@/lib/api-error';
import { handleApiError } from '@/lib/errors';
import { qk } from '@/lib/query-keys';
import { invalidateCustomers } from './api';

type CustomerFormValues = CustomerCreateBody;
const FIELDS = ['name', 'phone', 'altPhone', 'address', 'creditLimit'] as const;

/**
 * The live duplicate check (§7.3.11): 400 ms after a phone becomes valid, the same comparison the
 * save makes. Matches are a warning with links, never a block (A13).
 */
function PhoneDuplicateWarning({ phone, excludeId }: { phone: string | null | undefined; excludeId?: number }) {
  const { t } = useTranslation();
  const typed = useDebouncedValue(phone ?? '', 400);
  const parsed = Phone.safeParse(typed);
  const normalized = parsed.success ? parsed.data : null;

  const check = useQuery({
    queryKey: qk.customers.phoneCheck(normalized ?? '', excludeId),
    queryFn: () =>
      apiFetch<CustomerPhoneCheckDto>('/customers/phone-check', { query: { phone: normalized, excludeId } }),
    enabled: normalized !== null,
    staleTime: 30_000,
  });

  const matches = normalized !== null ? (check.data?.matches ?? []) : [];
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
          {match.name}
        </Link>
      ))}
    </p>
  );
}

/** Creates or edits a customer (§7.3.11). */
export function CustomerForm({ customer }: { customer?: CustomerDto }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
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
      if (error instanceof ApiError && error.code === 'CUSTOMER_PHONE_DUPLICATE') {
        setDuplicates({ matches: (error.details?.matches as CustomerPhoneMatchDto[] | undefined) ?? [], values });
        return;
      }
      setDuplicates(null);
      handleApiError(error, {
        setError: form.setError,
        fields: FIELDS,
        onReload: customer
          ? () => void queryClient.invalidateQueries({ queryKey: qk.customers.detail(customer.id) })
          : undefined,
      });
    },
  });

  const textField = (name: 'name' | 'address', dir?: 'ltr') => (
    <Field>
      <FieldLabel htmlFor={name}>{t(`customers.fields.${name}`)}</FieldLabel>
      <Input
        id={name}
        dir={dir}
        aria-invalid={Boolean(errors[name])}
        aria-describedby={`${name}-error`}
        {...form.register(name)}
      />
      <FieldError id={`${name}-error`} message={errors[name]?.message} />
    </Field>
  );

  return (
    <form
      onSubmit={form.handleSubmit((values) => save.mutate({ values, confirm: false }))}
      className="flex max-w-2xl flex-col gap-6"
      noValidate
    >
      <Card>
        <CardContent className="flex flex-col gap-4">
          {textField('name')}

          <Field>
            <FieldLabel htmlFor="phone">{t('customers.fields.phone')}</FieldLabel>
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
            <FieldLabel htmlFor="altPhone">{t('customers.fields.altPhone')}</FieldLabel>
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

          {textField('address')}

          <Field>
            <FieldLabel htmlFor="creditLimit">{t('customers.fields.creditLimit')}</FieldLabel>
            <Controller
              control={form.control}
              name="creditLimit"
              render={({ field }) => (
                <MoneyInput
                  id="creditLimit"
                  value={field.value}
                  onChange={field.onChange}
                  onBlur={field.onBlur}
                  aria-invalid={Boolean(errors.creditLimit)}
                  aria-describedby="creditLimit-help creditLimit-error"
                />
              )}
            />
            <FieldDescription id="creditLimit-help">{t('customers.form.creditLimitHelp')}</FieldDescription>
            <FieldError id="creditLimit-error" message={errors.creditLimit?.message} />
          </Field>
        </CardContent>
      </Card>

      <div className="flex gap-2">
        <Button type="submit" disabled={save.isPending}>
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
          {t('common.actions.cancel')}
        </Button>
      </div>

      <ConfirmDialog
        open={duplicates !== null}
        onOpenChange={(open) => !open && setDuplicates(null)}
        destructive={false}
        title={t('customers.form.duplicateTitle')}
        description={t('customers.form.duplicateBody', {
          names: duplicates?.matches.map((match) => match.name).join(t('common.listSeparator')) ?? '',
        })}
        confirmLabel={t('customers.form.saveAnyway')}
        pending={save.isPending}
        onConfirm={() => duplicates && save.mutate({ values: duplicates.values, confirm: true })}
      />
      {guard.dialog}
    </form>
  );
}
