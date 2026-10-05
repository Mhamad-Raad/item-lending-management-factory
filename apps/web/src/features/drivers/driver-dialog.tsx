import { zodResolver } from '@hookform/resolvers/zod';
import { DriverCreateBody, type DriverDto, type DriverPhoneMatchDto, type DriverUpdateBody } from '@pallet/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { TriangleAlert } from 'lucide-react';
import { useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Field, FieldError, FieldLabel } from '@/components/app/field';
import { PhoneInput } from '@/components/app/phone-input';
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
import { usePhoneMatches } from '@/hooks/use-phone-matches';
import { apiFetch } from '@/lib/api-client';
import { detailsOf } from '@/lib/api-error';
import { isolate } from '@/lib/bidi';
import { handleApiError } from '@/lib/errors';
import { qk } from '@/lib/query-keys';

type DriverFormValues = DriverCreateBody;
const FIELDS = ['name', 'phone', 'carNumber'] as const;

/**
 * The live duplicate check (§7.3.13, Q135): 400 ms after the phone becomes valid, the same comparison the save
 * makes. A match is a warning, never a block. The names are not links: the dialog may sit on an order being typed.
 */
function PhoneDuplicateWarning({ phone, excludeId }: { phone: string; excludeId?: number }) {
  const { t } = useTranslation();
  const matches = usePhoneMatches<DriverPhoneMatchDto>(phone, {
    path: '/drivers/phone-check',
    key: qk.drivers.phoneCheck,
    excludeId,
  });
  if (matches.length === 0) return null;
  return (
    <p role="status" className="text-warning flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
      <TriangleAlert className="size-4 shrink-0" aria-hidden />
      {t('drivers.dialog.phoneDuplicateWarning')}
      {matches.map((match) => (
        <bdi key={match.driverId} className="font-medium">
          {match.name}
        </bdi>
      ))}
    </p>
  );
}

/**
 * Drivers are created and edited in a dialog, not on a page of their own (§7.3.13) — from the drivers list, and
 * from an order's driver field for one who is not on file yet (§7.4.1, Q135).
 */
export function DriverDialog({
  driver,
  open,
  onOpenChange,
  onSaved,
  onUseExisting,
}: {
  /** The driver being edited; absent for a new one. */
  driver?: DriverDto;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Told the saved driver, so an order can take a driver created on the spot. */
  onSaved?: (driver: DriverDto) => void;
  /** Where the caller is choosing a driver: a number already on file may be answered by taking its driver. */
  onUseExisting?: (driverId: number) => void;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [duplicates, setDuplicates] = useState<{ matches: DriverPhoneMatchDto[]; values: DriverFormValues } | null>(
    null,
  );
  const form = useForm({
    resolver: zodResolver(DriverCreateBody),
    mode: 'onTouched',
    defaultValues: {
      name: driver?.name ?? '',
      phone: driver?.phone ?? '',
      carNumber: driver?.carNumber ?? '',
      confirmDuplicatePhone: false,
    },
  });
  const phone = useWatch({ control: form.control, name: 'phone' });
  const errors = form.formState.errors;

  // No reset on closing: the page mounts the dialog afresh on every opening, and a reset here would show the
  // fields snapping back while the dialog fades out.
  const close = (): void => onOpenChange(false);

  const save = useMutation({
    mutationFn: ({ values, confirm }: { values: DriverFormValues; confirm: boolean }) => {
      const fields = { ...values, confirmDuplicatePhone: confirm };
      if (driver) {
        const body: DriverUpdateBody = { version: driver.version, ...fields };
        return apiFetch<DriverDto>(`/drivers/${driver.id}`, { method: 'PATCH', body });
      }
      return apiFetch<DriverDto>('/drivers', { method: 'POST', body: fields });
    },
    onSuccess: async (saved) => {
      // The lists and records are read again. The live phone checks are only marked out of date: asked again now,
      // the one under this dialog's phone box would find the driver just saved and warn of it.
      const phoneChecks: readonly unknown[] = qk.drivers.phoneChecks();
      void queryClient.invalidateQueries({ queryKey: phoneChecks, refetchType: 'none' });
      await queryClient.invalidateQueries({
        queryKey: qk.drivers.all(),
        predicate: (query) => query.queryKey[1] !== phoneChecks[1],
      });
      // After the invalidation, which would mark it stale again: a picker shows the new driver without asking.
      queryClient.setQueryData(qk.drivers.detail(saved.id), saved);
      toast.success(t(driver ? 'drivers.dialog.saved' : 'drivers.dialog.created'));
      onSaved?.(saved);
      close();
    },
    onError: (error, { values }) => {
      // Another driver holds the number: ask once, then save anyway if the user says so (Q135).
      const duplicate = detailsOf(error, 'DRIVER_PHONE_DUPLICATE');
      if (duplicate) {
        setDuplicates({ matches: duplicate.matches, values });
        return;
      }
      setDuplicates(null);
      handleApiError(error, {
        setError: form.setError,
        fields: FIELDS,
        onReload: () => {
          void queryClient.invalidateQueries({ queryKey: qk.drivers.all() });
          close();
        },
      });
    },
  });

  // While a save is on its way the dialog stays: dismissed, its answer would still arrive — and on an order replace
  // a driver chosen in the meantime.
  const dismiss = (): void => {
    if (!save.isPending) close();
  };

  // Only a driver who can still be chosen is offered: an archived one takes no new order.
  const usable = onUseExisting ? (duplicates?.matches ?? []).filter((match) => !match.archived) : [];

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? onOpenChange(true) : dismiss())}>
      <DialogContent closeLabel={t('common.actions.close')}>
        <DialogHeader>
          <DialogTitle>
            {duplicates
              ? t('drivers.dialog.duplicateTitle')
              : t(driver ? 'drivers.dialog.editTitle' : 'drivers.dialog.newTitle')}
          </DialogTitle>
          {duplicates ? (
            <DialogDescription>
              {t('drivers.dialog.duplicateBody', {
                names: duplicates.matches.map((match) => isolate(match.name)).join(t('common.listSeparator')),
              })}
            </DialogDescription>
          ) : null}
        </DialogHeader>
        {/* The warning takes the dialog's place rather than opening a second one above it; the form stays mounted
            underneath, so going back finds what was typed. */}
        {duplicates ? (
          // Several drivers may share the number, and a name may be long: the buttons wrap, and so do their labels.
          <DialogFooter className="sm:flex-wrap">
            <Button
              type="button"
              variant="outline"
              autoFocus
              onClick={() => setDuplicates(null)}
              disabled={save.isPending}
            >
              {t('common.actions.cancel')}
            </Button>
            {usable.map((match) => (
              <Button
                key={match.driverId}
                type="button"
                variant="outline"
                className="h-auto min-h-12 max-w-full py-2 whitespace-normal"
                disabled={save.isPending}
                onClick={() => {
                  onUseExisting?.(match.driverId);
                  close();
                }}
              >
                {t('drivers.dialog.useExisting', { name: isolate(match.name) })}
              </Button>
            ))}
            <Button
              type="button"
              disabled={save.isPending}
              onClick={() => save.mutate({ values: duplicates.values, confirm: true })}
            >
              {t('drivers.dialog.saveAnyway')}
            </Button>
          </DialogFooter>
        ) : null}
        <form
          hidden={duplicates !== null}
          onSubmit={(event) => void form.handleSubmit((values) => save.mutate({ values, confirm: false }))(event)}
          className="flex flex-col gap-4"
          noValidate
        >
          {FIELDS.map((name) => (
            <Field key={name}>
              <FieldLabel htmlFor={`driver-${name}`}>{t(`drivers.fields.${name}`)}</FieldLabel>
              {name === 'phone' && !save.isSuccess ? (
                <PhoneInput
                  id="driver-phone"
                  aria-invalid={Boolean(errors.phone)}
                  aria-describedby="driver-phone-error"
                  {...form.register('phone')}
                />
              ) : (
                <Input
                  id={`driver-${name}`}
                  aria-invalid={Boolean(errors[name])}
                  aria-describedby={`driver-${name}-error`}
                  {...form.register(name)}
                />
              )}
              <FieldError id={`driver-${name}-error`} message={errors[name]?.message} />
              {name === 'phone' ? <PhoneDuplicateWarning phone={phone} excludeId={driver?.id} /> : null}
            </Field>
          ))}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={dismiss} disabled={save.isPending}>
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
