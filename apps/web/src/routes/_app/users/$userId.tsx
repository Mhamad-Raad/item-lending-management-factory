import {
  GRANTABLE_PERMISSION_KEYS,
  ROLES,
  formatTimestamp,
  type GrantablePermissionKey,
  type Role,
  type UserDto,
} from '@pallet/shared';
import { queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Switch } from '@/components/ui/switch';
import { usePageTitle } from '@/hooks/use-page-title';
import { apiFetch } from '@/lib/api-client';
import { useAuth } from '@/lib/auth';
import { handleApiError } from '@/lib/errors';
import { generatePassword } from '@/lib/generate-password';
import { qk } from '@/lib/query-keys';
import { prefetch } from '@/lib/prefetch';
import { requireAdmin } from '@/lib/route-guards';

export const Route = createFileRoute('/_app/users/$userId')({
  beforeLoad: () => requireAdmin(),
  loader: ({ context, params }) => prefetch(context.queryClient, userQuery(Number(params.userId))),
  component: UserDetailPage,
});

function userQuery(id: number) {
  return queryOptions({ queryKey: qk.users.detail(id), queryFn: () => apiFetch<UserDto>(`/users/${id}`) });
}

function UserDetailPage() {
  const { t } = useTranslation();
  const { userId } = Route.useParams();
  const id = Number(userId);
  const queryClient = useQueryClient();
  const { user: self } = useAuth();
  usePageTitle('users.detail.title');

  const user = useQuery(userQuery(id));

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

      {/* Keyed by version: a save elsewhere remounts the cards with what the server now stores. */}
      <ProfileCard key={`profile-${user.data.version}`} user={user.data} isSelf={isSelf} onSaved={invalidate} />
      <PermissionsCard key={`permissions-${user.data.version}`} user={user.data} onSaved={invalidate} />
      <SecurityCard user={user.data} onDone={invalidate} />

      <p className="text-muted-foreground text-sm">
        {t('users.detail.activeSessions', { count: user.data.activeSessionCount })} ·{' '}
        <span dir="ltr">{formatTimestamp(user.data.createdAt)}</span>
      </p>
    </>
  );
}

/**
 * Display name, role and active state (§7.3.19). The controls that would lock the acting admin
 * out of their own account — deactivating or demoting themselves — stay disabled with a hint; the
 * API refuses them too, so this is courtesy rather than the guard.
 */
function ProfileCard({ user, isSelf, onSaved }: { user: UserDto; isSelf: boolean; onSaved: () => Promise<void> }) {
  const { t } = useTranslation();
  const [displayName, setDisplayName] = useState(user.displayName);
  const [confirmDeactivate, setConfirmDeactivate] = useState(false);

  const patch = useMutation({
    mutationFn: (body: { displayName?: string; role?: Role; isActive?: boolean }) =>
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
      <CardContent className="flex flex-col gap-6">
        <Field>
          <FieldLabel htmlFor="displayName">{t('users.fields.displayName')}</FieldLabel>
          <div className="flex gap-2">
            <Input id="displayName" value={displayName} onChange={(event) => setDisplayName(event.target.value)} />
            <Button
              disabled={patch.isPending || displayName.trim() === user.displayName}
              onClick={() => patch.mutate({ displayName: displayName.trim() })}
            >
              {t('common.actions.save')}
            </Button>
          </div>
        </Field>

        <Field>
          <FieldLabel>{t('users.fields.role')}</FieldLabel>
          <RadioGroup
            value={user.role}
            disabled={isSelf || patch.isPending}
            onValueChange={(value) => patch.mutate({ role: value as Role })}
            className="flex gap-6"
          >
            {ROLES.map((role: Role) => (
              <div key={role} className="flex items-center gap-2">
                <RadioGroupItem id={`role-${role}`} value={role} />
                <Label htmlFor={`role-${role}`} className="font-normal">
                  {t(`enums.role.${role}`)}
                </Label>
              </div>
            ))}
          </RadioGroup>
          {isSelf ? <p className="text-muted-foreground text-sm">{t('users.detail.selfDemoteHint')}</p> : null}
        </Field>

        <div className="flex items-center justify-between gap-4">
          <div className="flex flex-col">
            <span className="text-sm font-medium">{t('users.fields.status')}</span>
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
  const isAdmin = user.role === 'ADMIN';

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

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('users.permissions.title')}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {isAdmin ? (
          // An administrator holds everything: shown as a full, untouchable matrix (§7.3.19).
          <>
            <p className="text-muted-foreground text-sm">{t('users.permissions.adminImplicit')}</p>
            <PermissionMatrix value={GRANTABLE_PERMISSION_KEYS} onChange={() => undefined} disabled />
          </>
        ) : (
          <>
            <PermissionMatrix value={selected} onChange={setSelected} disabled={save.isPending} />
            <div>
              <Button onClick={() => save.mutate()} disabled={save.isPending}>
                {t('users.permissions.save')}
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function SecurityCard({ user, onDone }: { user: UserDto; onDone: () => Promise<void> }) {
  const { t } = useTranslation();
  const [resetOpen, setResetOpen] = useState(false);
  const [confirmLogoutAll, setConfirmLogoutAll] = useState(false);

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
      <CardContent className="flex flex-wrap gap-2">
        <Button variant="outline" onClick={() => setResetOpen(true)}>
          {t('users.security.resetPassword')}
        </Button>
        <Button variant="destructive" onClick={() => setConfirmLogoutAll(true)}>
          {t('users.security.logoutAll')}
        </Button>
      </CardContent>

      <ResetPasswordDialog user={user} open={resetOpen} onOpenChange={setResetOpen} onDone={onDone} />
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

/** A reset ends every session the user has, so it asks before it acts (§7.3, §7.3.19). */
function ResetPasswordDialog({
  user,
  open,
  onOpenChange,
  onDone,
}: {
  user: UserDto;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDone: () => Promise<void>;
}) {
  const { t } = useTranslation();
  const [newPassword, setNewPassword] = useState('');

  const reset = useMutation({
    mutationFn: () => apiFetch<void>(`/users/${user.id}/reset-password`, { method: 'POST', body: { newPassword } }),
    onSuccess: async () => {
      toast.success(t('users.security.passwordReset'));
      setNewPassword('');
      onOpenChange(false);
      await onDone();
    },
    onError: (error) => handleApiError(error),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent closeLabel={t('common.actions.close')} className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('users.security.resetPassword')}</DialogTitle>
          <DialogDescription>{t('users.security.resetPasswordConfirm', { name: user.displayName })}</DialogDescription>
        </DialogHeader>
        <Field>
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
        </Field>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={reset.isPending}>
            {t('common.actions.cancel')}
          </Button>
          <Button
            variant="destructive"
            onClick={() => reset.mutate()}
            disabled={reset.isPending || newPassword.length === 0}
          >
            {t('users.security.resetPassword')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
