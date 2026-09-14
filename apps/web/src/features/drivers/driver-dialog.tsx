import { zodResolver } from '@hookform/resolvers/zod';
import { DriverCreateBody, type DriverDto, type DriverUpdateBody } from '@pallet/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Field, FieldError, FieldLabel } from '@/components/app/field';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { apiFetch } from '@/lib/api-client';
import { handleApiError } from '@/lib/errors';
import { qk } from '@/lib/query-keys';

const FIELDS = ['name', 'phone', 'carNumber'] as const;

/** Drivers are created and edited in a dialog, not on a page of their own (§7.3.13). */
export function DriverDialog({
  driver,
  open,
  onOpenChange,
}: {
  /** The driver being edited; absent for a new one. */
  driver?: DriverDto;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const form = useForm({
    resolver: zodResolver(DriverCreateBody),
    mode: 'onTouched',
    defaultValues: { name: driver?.name ?? '', phone: driver?.phone ?? '', carNumber: driver?.carNumber ?? '' },
  });
  const errors = form.formState.errors;

  // No reset on closing: the page mounts the dialog afresh on every opening, and a reset here would show the
  // fields snapping back while the dialog fades out.
  const close = (): void => onOpenChange(false);

  const save = useMutation({
    mutationFn: (values: DriverCreateBody) => {
      if (driver) {
        const body: DriverUpdateBody = { version: driver.version, ...values };
        return apiFetch<DriverDto>(`/drivers/${driver.id}`, { method: 'PATCH', body });
      }
      return apiFetch<DriverDto>('/drivers', { method: 'POST', body: values });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: qk.drivers.all() });
      toast.success(t(driver ? 'drivers.dialog.saved' : 'drivers.dialog.created'));
      close();
    },
    onError: (error) =>
      handleApiError(error, {
        setError: form.setError,
        fields: FIELDS,
        onReload: () => {
          void queryClient.invalidateQueries({ queryKey: qk.drivers.all() });
          close();
        },
      }),
  });

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? onOpenChange(true) : close())}>
      <DialogContent closeLabel={t('common.actions.close')}>
        <DialogHeader>
          <DialogTitle>{t(driver ? 'drivers.dialog.editTitle' : 'drivers.dialog.newTitle')}</DialogTitle>
        </DialogHeader>
        <form onSubmit={form.handleSubmit((values) => save.mutate(values))} className="flex flex-col gap-4" noValidate>
          {FIELDS.map((name) => (
            <Field key={name}>
              <FieldLabel htmlFor={`driver-${name}`}>{t(`drivers.fields.${name}`)}</FieldLabel>
              <Input
                id={`driver-${name}`}
                // A phone number reads left to right in every language of the app.
                dir={name === 'phone' ? 'ltr' : undefined}
                inputMode={name === 'phone' ? 'tel' : undefined}
                aria-invalid={Boolean(errors[name])}
                aria-describedby={`driver-${name}-error`}
                {...form.register(name)}
              />
              <FieldError id={`driver-${name}-error`} message={errors[name]?.message} />
            </Field>
          ))}
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
