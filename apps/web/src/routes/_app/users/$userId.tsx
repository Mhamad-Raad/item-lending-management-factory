import type { GrantablePermissionKey, UserDto } from '@pallet/shared';
import { formatTimestamp } from '@pallet/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { ConfirmDialog } from '@/components/app/confirm-dialog';
import { Field, FieldLabel } from '@/components/app/field';
import { PageHeader } from '@/components/app/page-header';
import { PasswordInput } from '@/components/app/password-input';
import { PermissionMatrix } from '@/components/app/permission-matrix';
import { PageSkeleton, QueryErrorState } from '@/components/app/states';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { usePageTitle } from '@/hooks/use-page-title';
import { apiFetch } from '@/lib/api-client';
import { useAuth } from '@/lib/auth';
import { handleApiError } from '@/lib/errors';
import { generatePassword } from '@/lib/generate-password';
import { qk } from '@/lib/query-keys';
import { requireAdmin } from '@/lib/route-guards';

export const Route = createFileRoute('/_app/users/$userId')({
  beforeLoad: () => requireAdmin(),
  component: UserDetailPage,
});

function UserDetailPage() {
  const { t } = useTranslation();
  const { userId } = Route.useParams();
  const id = Number(userId);
  const queryClient = useQueryClient();
  const { user: self } = useAuth();
  usePageTitle('users.detail.title');

  const user = useQuery({
    queryKey: qk.users.detail(id),
    queryFn: () => apiFetch<UserDto>(`/users/${id}`),
  });

  const invalidate = async (): Promise<void> => {
    await queryClient.invalidateQueries({ queryKey: qk.users.all() });
  };

  if (user.isPending) return <PageSkeleton />;
  if (user.isError) return <QueryErrorState error={user.error} onRetry={() => void user.refetch()} />;

  const isSelf = self?.id === id;

  return (
    <>
      <PageHeader
        title={user.data.displayName}
        description={user.data.username}
        actions={
          <Badge variant={user.data.isActive ? 'success' : 'secondary'}>
            {t(user.data.isActive ? 'users.status.active' : 'users.status.inactive')}
          </Badge>
        }
      />

      <ProfileCard key={user.data.version} user={user.data} isSelf={isSelf} onSaved={invalidate} />
      {/* Keyed by version: a save elsewhere remounts the card with what the server now stores. */}
      <PermissionsCard key={user.data.version} user={user.data} onSaved={invalidate} />
      <SecurityCard user={user.data} onDone={invalidate} />

      <p className="text-muted-foreground text-sm">
        {t('users.detail.activeSessions', { count: user.data.activeSessionCount })} ·{' '}
        <span dir="ltr">{formatTimestamp(user.data.createdAt)}</span>
      </p>
    </>
  );
}

function ProfileCard({ user, isSelf, onSaved }: { user: UserDto; isSelf: boolean; onSaved: () => Promise<void> }) {
  const { t } = useTranslation();
  const [displayName, setDisplayName] = useState(user.displayName);
  const [confirmDeactivate, setConfirmDeactivate] = useState(false);

  const patch = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      apiFetch<UserDto>(`/users/${user.id}`, { method: 'PATCH', body: { version: user.version, ...body } }),
    onSuccess: async () => {
      toast.success(t('users.detail.saved'));
      await onSaved();
    },
    onError: (error) => handleApiError(error, { onReload: () => void onSaved() }),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('users.detail.profile')}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <Field>
          <FieldLabel htmlFor="displayName">{t('users.fields.displayName')}</FieldLabel>
          <div className="flex gap-2">
            <Input id="displayName" value={displayName} onChange={(event) => setDisplayName(event.target.value)} />
            <Button
              disabled={patch.isPending || displayName === user.displayName}
              onClick={() => patch.mutate({ displayName })}
            >
              {t('common.actions.save')}
            </Button>
          </div>
        </Field>

        <div className="flex items-center justify-between gap-4">
          <div className="flex flex-col">
            <span className="text-sm font-medium">{t('users.fields.status')}</span>
            {/* An admin cannot lock themselves out, so their own switch stays disabled (§6.12). */}
            <span className="text-muted-foreground text-sm">
              {t(isSelf ? 'users.detail.selfDeactivateHint' : 'users.detail.deactivateHint')}
            </span>
          </div>
          <Switch
            checked={user.isActive}
            disabled={isSelf || patch.isPending}
            aria-label={t('users.fields.status')}
            onCheckedChange={(checked) => {
              if (checked) patch.mutate({ isActive: true });
              else setConfirmDeactivate(true);
            }}
          />
        </div>
      </CardContent>

      <ConfirmDialog
        open={confirmDeactivate}
        onOpenChange={setConfirmDeactivate}
        title={t('users.detail.deactivateTitle')}
        description={t('users.detail.deactivateConfirm', { name: user.displayName })}
        confirmLabel={t('users.detail.deactivate')}
        pending={patch.isPending}
        onConfirm={() => {
          patch.mutate({ isActive: false });
          setConfirmDeactivate(false);
        }}
      />
    </Card>
  );
}

function PermissionsCard({ user, onSaved }: { user: UserDto; onSaved: () => Promise<void> }) {
  const { t } = useTranslation();
  const [selected, setSelected] = useState<GrantablePermissionKey[]>(user.permissions);

  const save = useMutation({
    mutationFn: () =>
      apiFetch<UserDto>(`/users/${user.id}/permissions`, {
        method: 'PUT',
        body: { version: user.version, permissions: selected },
      }),
    onSuccess: async () => {
      toast.success(t('users.permissions.saved'));
      await onSaved();
    },
    onError: (error) => handleApiError(error, { onReload: () => void onSaved() }),
  });

  if (user.role === 'ADMIN') {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{t('users.permissions.title')}</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground text-sm">{t('users.permissions.adminImplicit')}</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('users.permissions.title')}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <PermissionMatrix value={selected} onChange={setSelected} disabled={save.isPending} />
        <div>
          <Button onClick={() => save.mutate()} disabled={save.isPending}>
            {t('users.permissions.save')}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function SecurityCard({ user, onDone }: { user: UserDto; onDone: () => Promise<void> }) {
  const { t } = useTranslation();
  const [newPassword, setNewPassword] = useState('');
  const [resetOpen, setResetOpen] = useState(false);
  const [confirmLogoutAll, setConfirmLogoutAll] = useState(false);

  const reset = useMutation({
    mutationFn: () => apiFetch<void>(`/users/${user.id}/reset-password`, { method: 'POST', body: { newPassword } }),
    onSuccess: async () => {
      toast.success(t('users.security.passwordReset'));
      setResetOpen(false);
      setNewPassword('');
      await onDone();
    },
    onError: (error) => handleApiError(error),
  });

  const logoutAll = useMutation({
    mutationFn: () => apiFetch<void>(`/users/${user.id}/logout-all`, { method: 'POST' }),
    onSuccess: async () => {
      toast.success(t('users.security.loggedOut'));
      setConfirmLogoutAll(false);
      await onDone();
    },
    onError: (error) => handleApiError(error),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('users.security.title')}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col items-start gap-4">
        {resetOpen ? (
          <Field className="w-full max-w-sm">
            <FieldLabel htmlFor="newPassword">{t('users.security.newPassword')}</FieldLabel>
            <div className="flex gap-2">
              <PasswordInput
                id="newPassword"
                value={newPassword}
                autoComplete="new-password"
                onChange={(event) => setNewPassword(event.target.value)}
              />
              <Button type="button" variant="outline" onClick={() => setNewPassword(generatePassword())}>
                {t('users.new.generate')}
              </Button>
            </div>
            <div className="flex gap-2">
              <Button onClick={() => reset.mutate()} disabled={reset.isPending || newPassword.length === 0}>
                {t('users.security.resetPassword')}
              </Button>
              <Button variant="outline" onClick={() => setResetOpen(false)}>
                {t('common.actions.cancel')}
              </Button>
            </div>
          </Field>
        ) : (
          <Button variant="outline" onClick={() => setResetOpen(true)}>
            {t('users.security.resetPassword')}
          </Button>
        )}

        <Button variant="destructive" onClick={() => setConfirmLogoutAll(true)}>
          {t('users.security.logoutAll')}
        </Button>
      </CardContent>

      <ConfirmDialog
        open={confirmLogoutAll}
        onOpenChange={setConfirmLogoutAll}
        title={t('users.security.logoutAll')}
        description={t('users.security.logoutAllConfirm', { name: user.displayName })}
        confirmLabel={t('users.security.logoutAll')}
        pending={logoutAll.isPending}
        onConfirm={() => logoutAll.mutate()}
      />
    </Card>
  );
}
