import type { LucideIcon } from 'lucide-react';
import { SearchX } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { EmptyState } from '@/components/app/states';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';

export function SearchBox({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const { t } = useTranslation();
  return (
    <Input
      aria-label={t('common.search')}
      placeholder={t('common.search')}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className="w-full sm:max-w-xs"
    />
  );
}

/** A list filter that is on or off; off is the default and leaves the URL clean. */
export function FilterSwitch({
  id,
  label,
  checked,
  onCheckedChange,
}: {
  id: string;
  label: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <Switch id={id} checked={checked} onCheckedChange={onCheckedChange} />
      <Label htmlFor={id} className="font-normal">
        {label}
      </Label>
    </div>
  );
}

/**
 * An empty list says why (§7.3): with filters on, that nothing matches and how to clear them;
 * without, what the list is for and — when the user may — how to add the first entry.
 */
export function ListEmpty({
  filtered,
  onClearFilters,
  icon,
  title,
  action,
}: {
  filtered: boolean;
  onClearFilters: () => void;
  icon: LucideIcon;
  title: string;
  action?: React.ReactNode;
}) {
  const { t } = useTranslation();
  if (filtered) {
    return (
      <EmptyState
        icon={SearchX}
        title={t('common.empty.filtered')}
        action={
          <Button variant="outline" onClick={onClearFilters}>
            {t('common.actions.clearFilters')}
          </Button>
        }
      />
    );
  }
  return <EmptyState icon={icon} title={title} action={action} />;
}
