import { ADMIN_ONLY_PERMISSION_KEYS, GRANTABLE_PERMISSION_KEYS, type GrantablePermissionKey } from '@pallet/shared';
import { Lock } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { dynamicKey } from '@/i18n/keys';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { permissionLabelKey, togglePermission } from '@/lib/permission-selection';

const MODULES = [...new Set(GRANTABLE_PERMISSION_KEYS.map((key) => key.split('.')[0] ?? ''))];

/**
 * Ticking a permission also ticks what it needs, and unticking one also unticks whatever needed
 * it, so the set on screen is always one the API would accept (§7.3.19).
 */
export function PermissionMatrix({
  value,
  onChange,
  disabled = false,
}: {
  value: readonly GrantablePermissionKey[];
  onChange: (next: GrantablePermissionKey[]) => void;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  const selected = new Set(value);

  return (
    <div className="flex flex-col gap-6">
      {MODULES.map((module) => (
        <fieldset key={module} className="flex flex-col gap-3">
          <legend className="text-sm font-medium">{t(dynamicKey(`permissions.modules.${module}`))}</legend>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {GRANTABLE_PERMISSION_KEYS.filter((key) => key.startsWith(`${module}.`)).map((key) => (
              <div key={key} className="flex items-center gap-2">
                <Checkbox
                  id={`permission-${key}`}
                  checked={selected.has(key)}
                  disabled={disabled}
                  onCheckedChange={(checked) => onChange(togglePermission(value, key, checked === true))}
                />
                <Label htmlFor={`permission-${key}`} className="font-normal">
                  {t(permissionLabelKey(key))}
                </Label>
              </div>
            ))}
          </div>
        </fieldset>
      ))}

      <div className="text-muted-foreground flex flex-col gap-2 rounded-md border border-dashed p-3 text-sm">
        <span className="flex items-center gap-2 font-medium">
          <Lock className="size-3.5" aria-hidden />
          {t('users.permissions.adminOnlyRow')}
        </span>
        <span>{ADMIN_ONLY_PERMISSION_KEYS.map((key) => t(permissionLabelKey(key))).join(' · ')}</span>
      </div>
    </div>
  );
}
