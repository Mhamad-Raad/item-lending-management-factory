import { zodResolver } from '@hookform/resolvers/zod';
import { ROLES, UserCreateBody, type GrantablePermissionKey, type Role, type UserDto } from '@pallet/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { Dice5 } from 'lucide-react';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Field, FieldDescription, FieldError, FieldLabel } from '@/components/app/field';
import { PageHeader } from '@/components/app/page-header';
import { PermissionMatrix } from '@/components/app/permission-matrix';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { usePageTitle } from '@/hooks/use-page-title';
import { useUnsavedChangesGuard } from '@/hooks/use-unsaved-changes-guard';
import { apiFetch } from '@/lib/api-client';
import { handleApiError } from '@/lib/errors';
import { generatePassword } from '@/lib/generate-password';
import { qk } from '@/lib/query-keys';
import { requireAdmin } from '@/lib/route-guards';

export const Route = createFileRoute('/_app/users/new')({
  beforeLoad: () => requireAdmin(),
  component: NewUserPage,
});

function NewUserPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  usePageTitle('users.new.title');

  const form = useForm({
    resolver: zodResolver(UserCreateBody),
    defaultValues: { username: '', displayName: '', role: 'EMPLOYEE' as Role, password: '', permissions: [] },
    mode: 'onTouched',
  });
  const role = useWatch({ control: form.control, name: 'role' });
  const guard = useUnsavedChangesGuard(form.formState.isDirty);
  // Usernames are stored lower-case; lower-casing inside the registered handler keeps react-hook-form
  // in charge of validation and leaves the caret where the user put it.
  const username = form.register('username');

  const create = useMutation({
    mutationFn: (body: UserCreateBody) => apiFetch<UserDto>('/users', { method: 'POST', body }),
    onSuccess: async (user) => {
      await queryClient.invalidateQueries({ queryKey: qk.users.all() });
      toast.success(t('users.new.created'));
      guard.allowLeave();
      await navigate({ to: '/users/$userId', params: { userId: String(user.id) } });
    },
    onError: (error) =>
      handleApiError(error, {
        setError: form.setError,
        fields: ['username', 'displayName', 'password'],
        fieldMap: {
          USERNAME_TAKEN: 'username',
          PASSWORD_TOO_SHORT: 'password',
          PASSWORD_TOO_LONG: 'password',
          PASSWORD_TOO_COMMON: 'password',
        },
      }),
  });

  return (
    <>
      <PageHeader title={t('users.new.title')} />

      <form onSubmit={form.handleSubmit((values) => create.mutate(values))} className="flex flex-col gap-6" noValidate>
        <Card>
          <CardHeader>
            <CardTitle>{t('users.new.profile')}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <Field>
              <FieldLabel htmlFor="username">{t('users.fields.username')}</FieldLabel>
              <Input
                id="username"
                autoComplete="off"
                aria-describedby="username-hint username-error"
                {...username}
                onChange={(event) => {
                  event.target.value = event.target.value.toLowerCase();
                  void username.onChange(event);
                }}
              />
              <FieldDescription id="username-hint">{t('users.new.usernameHint')}</FieldDescription>
              <FieldError id="username-error" message={form.formState.errors.username?.message} />
            </Field>

            <Field>
              <FieldLabel htmlFor="displayName">{t('users.fields.displayName')}</FieldLabel>
              <Input id="displayName" aria-describedby="displayName-error" {...form.register('displayName')} />
              <FieldError id="displayName-error" message={form.formState.errors.displayName?.message} />
            </Field>

            <Field>
              <FieldLabel>{t('users.fields.role')}</FieldLabel>
              <Controller
                control={form.control}
                name="role"
                render={({ field }) => (
                  <RadioGroup
                    value={field.value}
                    onValueChange={(value) => {
                      field.onChange(value);
                      // An admin holds every permission implicitly, so a set chosen while the role
                      // was EMPLOYEE would make the create fail with PERMISSIONS_ADMIN_IMPLICIT.
                      if (value === 'ADMIN') form.setValue('permissions', []);
                    }}
                    className="flex gap-6"
                  >
                    {ROLES.map((value: Role) => (
                      <div key={value} className="flex items-center gap-2">
                        <RadioGroupItem id={`role-${value}`} value={value} />
                        <Label htmlFor={`role-${value}`} className="font-normal">
                          {t(`enums.role.${value}`)}
                        </Label>
                      </div>
                    ))}
                  </RadioGroup>
                )}
              />
            </Field>

            <Field>
              <FieldLabel htmlFor="password">{t('users.new.initialPassword')}</FieldLabel>
              <div className="flex gap-2">
                {/* Shown in clear text: the admin has to read it out to the new user. */}
                <Input
                  id="password"
                  autoComplete="off"
                  aria-describedby="password-error"
                  {...form.register('password')}
                />
                <Button type="button" variant="outline" onClick={() => form.setValue('password', generatePassword())}>
                  <Dice5 aria-hidden />
                  {t('users.new.generate')}
                </Button>
              </div>
              <FieldError id="password-error" message={form.formState.errors.password?.message} />
            </Field>
          </CardContent>
        </Card>

        {role === 'EMPLOYEE' ? (
          <Card>
            <CardHeader>
              <CardTitle>{t('users.permissions.title')}</CardTitle>
            </CardHeader>
            <CardContent>
              <Controller
                control={form.control}
                name="permissions"
                render={({ field }) => (
                  <PermissionMatrix
                    value={field.value as GrantablePermissionKey[]}
                    onChange={(next) => field.onChange(next)}
                  />
                )}
              />
            </CardContent>
          </Card>
        ) : (
          <p className="text-muted-foreground text-sm">{t('users.permissions.adminImplicit')}</p>
        )}

        <div className="flex gap-2">
          <Button type="submit" disabled={create.isPending}>
            {t('users.new.submit')}
          </Button>
          <Button type="button" variant="outline" onClick={() => void navigate({ to: '/users' })}>
            {t('common.actions.cancel')}
          </Button>
        </div>
        {guard.dialog}
      </form>
    </>
  );
}
