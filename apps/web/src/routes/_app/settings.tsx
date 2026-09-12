import { zodResolver } from '@hookform/resolvers/zod';
import { SettingsUpdateBody, type SettingsDto } from '@pallet/shared';
import { queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Field, FieldDescription, FieldError, FieldLabel } from '@/components/app/field';
import { ImageUploadField, type UploadedImage } from '@/components/app/image-upload-field';
import { PageHeader } from '@/components/app/page-header';
import { PageSkeleton, QueryErrorState } from '@/components/app/states';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { usePageTitle } from '@/hooks/use-page-title';
import { useUnsavedChangesGuard } from '@/hooks/use-unsaved-changes-guard';
import { apiFetch } from '@/lib/api-client';
import { handleApiError } from '@/lib/errors';
import { qk } from '@/lib/query-keys';
import { prefetch } from '@/lib/prefetch';
import { requireAdmin } from '@/lib/route-guards';

export const Route = createFileRoute('/_app/settings')({
  beforeLoad: () => requireAdmin(),
  loader: ({ context }) => prefetch(context.queryClient, settingsQuery()),
  component: SettingsPage,
});

function settingsQuery() {
  return queryOptions({
    queryKey: qk.settings(),
    queryFn: () => apiFetch<SettingsDto>('/settings'),
    // Changes rarely, and only by an admin (§7.8.1).
    staleTime: 5 * 60_000,
  });
}

const TEXT_FIELDS = ['factoryName', 'phone', 'address'] as const;

function SettingsPage() {
  const { t } = useTranslation();
  usePageTitle('settings.title');

  const settings = useQuery(settingsQuery());

  if (settings.isPending) return <PageSkeleton rows={4} />;
  if (settings.isError) return <QueryErrorState error={settings.error} onRetry={() => void settings.refetch()} />;

  return (
    <>
      <PageHeader title={t('settings.title')} description={t('settings.receiptHint')} />
      {/* Keyed by version: a save — here or in another tab — remounts the form with what is stored. */}
      <SettingsForm key={settings.data.version} settings={settings.data} />
    </>
  );
}

function SettingsForm({ settings }: { settings: SettingsDto }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [logo, setLogo] = useState<UploadedImage | null>(
    settings.logoUploadId !== null && settings.logoUrl !== null
      ? { id: settings.logoUploadId, url: settings.logoUrl }
      : null,
  );

  const [uploadingLogo, setUploadingLogo] = useState(false);

  const form = useForm({
    resolver: zodResolver(SettingsUpdateBody),
    defaultValues: {
      version: settings.version,
      factoryName: settings.factoryName,
      phone: settings.phone,
      address: settings.address,
      logoUploadId: settings.logoUploadId,
    },
    mode: 'onTouched',
  });
  const logoChanged = (logo?.id ?? null) !== settings.logoUploadId;
  // A save remounts this form (it is keyed by version), which clears the guard with it.
  const guard = useUnsavedChangesGuard(form.formState.isDirty || logoChanged);

  const save = useMutation({
    mutationFn: (body: SettingsUpdateBody) => apiFetch<SettingsDto>('/settings', { method: 'PUT', body }),
    onSuccess: (updated) => {
      queryClient.setQueryData(qk.settings(), updated);
      toast.success(t('settings.saved'));
    },
    onError: (error) =>
      handleApiError(error, {
        setError: form.setError,
        fields: TEXT_FIELDS,
        onReload: () => void queryClient.invalidateQueries({ queryKey: qk.settings() }),
      }),
  });

  const onSubmit = form.handleSubmit((values) => save.mutate({ ...values, logoUploadId: logo?.id ?? null }));

  return (
    <Card>
      <CardContent>
        <form onSubmit={onSubmit} className="flex max-w-xl flex-col gap-4" noValidate>
          {TEXT_FIELDS.map((name) => (
            <Field key={name}>
              <FieldLabel htmlFor={name}>{t(`settings.fields.${name}`)}</FieldLabel>
              <Input
                id={name}
                // A phone number reads left to right in every language of the app.
                dir={name === 'phone' ? 'ltr' : undefined}
                aria-invalid={Boolean(form.formState.errors[name])}
                aria-describedby={`${name}-error`}
                {...form.register(name)}
              />
              <FieldError id={`${name}-error`} message={form.formState.errors[name]?.message} />
            </Field>
          ))}

          <Field>
            <FieldLabel htmlFor="logo">{t('settings.fields.logo')}</FieldLabel>
            <ImageUploadField
              id="logo"
              kind="FACTORY_LOGO"
              value={logo}
              onChange={setLogo}
              onUploadingChange={setUploadingLogo}
            />
            <FieldDescription>{t('common.upload.hint')}</FieldDescription>
          </Field>

          {/* Held while a logo is still uploading, or the save would carry the old one. */}
          <Button type="submit" disabled={save.isPending || uploadingLogo} className="self-start">
            {t('common.actions.save')}
          </Button>
          {guard.dialog}
        </form>
      </CardContent>
    </Card>
  );
}
