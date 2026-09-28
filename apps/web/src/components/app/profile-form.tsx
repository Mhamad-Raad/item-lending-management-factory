import { zodResolver } from '@hookform/resolvers/zod';
import { MeUpdateBody, type MeDto } from '@pallet/shared';
import { useEffect } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Field, FieldDescription, FieldError, FieldLabel } from '@/components/app/field';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useUnsavedChangesGuard } from '@/hooks/use-unsaved-changes-guard';
import { apiFetch } from '@/lib/api-client';
import { authStore, refreshMe } from '@/lib/auth';
import { handleApiError } from '@/lib/errors';

/** The request schema without the name the form started from, which the form itself remembers. */
const ProfileFormSchema = MeUpdateBody.pick({ displayName: true });

/**
 * The signed-in user's own profile (§7.3.21, Q94): the display name is theirs to change; the username
 * (the sign-in name) and the role stay with the administrators and are shown read-only. The saved name
 * goes straight into the auth store, so the sidebar and the greeting change at once. A save names the name
 * the form started from (Q105): an admin changing the user's permissions meanwhile is no conflict, a new
 * name is. When the signed-in user is refreshed, the form follows a new name only while nothing is typed.
 */
export function ProfileForm({ user }: { user: MeDto }) {
  const { t } = useTranslation();

  const form = useForm({
    resolver: zodResolver(ProfileFormSchema),
    defaultValues: { displayName: user.displayName },
    mode: 'onTouched',
  });
  const guard = useUnsavedChangesGuard(form.formState.isDirty);
  const unchanged = useWatch({ control: form.control, name: 'displayName' }).trim() === user.displayName;

  // A name saved elsewhere (another tab, an admin) replaces an untouched field; typed text is never lost.
  useEffect(() => {
    if (!form.formState.isDirty && form.formState.defaultValues?.displayName !== user.displayName) {
      form.reset({ displayName: user.displayName });
    }
  }, [form, user.displayName]);

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      const me = await apiFetch<MeDto>('/auth/me', {
        method: 'PATCH',
        body: { displayName: values.displayName, expectedDisplayName: form.formState.defaultValues?.displayName ?? '' },
      });
      form.reset({ displayName: me.displayName });
      authStore.setUser(me);
      toast.success(t('account.profile.saved'));
    } catch (error) {
      handleApiError(error, {
        setError: form.setError,
        fields: ['displayName'],
        // Reloading takes the stored name, over what was typed: the user chose to.
        onReload: () =>
          void refreshMe()
            .then((me) => form.reset({ displayName: me.displayName }))
            .catch((reloadError: unknown) => handleApiError(reloadError)),
      });
    }
  });

  return (
    <>
      <form onSubmit={(event) => void onSubmit(event)} className="flex flex-col gap-4" noValidate>
        <dl className="grid gap-4 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-muted-foreground">{t('account.profile.username')}</dt>
            <dd className="font-medium">
              <bdi>{user.username}</bdi>
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">{t('account.profile.role')}</dt>
            <dd className="font-medium">{t(`enums.role.${user.role}`)}</dd>
          </div>
        </dl>
        <FieldDescription>{t('account.profile.adminManaged')}</FieldDescription>

        <Field>
          <FieldLabel htmlFor="displayName">{t('account.profile.displayName')}</FieldLabel>
          <Input
            id="displayName"
            autoComplete="name"
            aria-invalid={Boolean(form.formState.errors.displayName)}
            aria-describedby="displayName-error"
            {...form.register('displayName')}
          />
          <FieldError id="displayName-error" message={form.formState.errors.displayName?.message} />
        </Field>

        <Button type="submit" disabled={form.formState.isSubmitting || unchanged} className="self-start">
          {t('common.actions.save')}
        </Button>
      </form>
      {guard.dialog}
    </>
  );
}
