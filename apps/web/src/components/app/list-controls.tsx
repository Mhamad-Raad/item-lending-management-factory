import { SEARCH_MAX_LENGTH } from '@pallet/shared';
import type { LucideIcon } from 'lucide-react';
import { ListFilter, SearchX } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { EmptyState } from '@/components/app/states';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { Switch } from '@/components/ui/switch';
import { MD_QUERY, useMediaQuery } from '@/hooks/use-media-query';

export function SearchBox({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const { t } = useTranslation();
  return (
    <Input
      aria-label={t('common.search')}
      placeholder={t('common.search')}
      value={value}
      maxLength={SEARCH_MAX_LENGTH}
      onChange={(event) => onChange(event.target.value)}
      className="w-full sm:max-w-xs"
    />
  );
}

/**
 * A list's search box and filters. From `md` they sit in one wrapping row above the list. On a phone
 * a row of five pickers would fill the first screen before any result, so only the search box stays
 * and the filters move into a bottom sheet behind a button counting the active ones. The filters are
 * rendered in one place at a time, so their ids and labels are never duplicated. Each filter takes
 * `w-full` in the sheet: give fixed widths from `md` only (`md:w-56`).
 */
export function ListFilters({
  search,
  activeCount,
  onClear,
  error,
  children,
}: {
  search?: React.ReactNode;
  activeCount: number;
  onClear: () => void;
  /** Shown beside the button on a phone too, where the sheet holding the failing filter is closed. */
  error?: string;
  children: React.ReactNode;
}) {
  const { t } = useTranslation();
  const wide = useMediaQuery(MD_QUERY);
  const [open, setOpen] = useState(false);

  if (wide) {
    // The sheet is gone from this layout; left open, it would pop up again when the phone turns back.
    if (open) setOpen(false);
    return (
      <div className="flex w-full flex-wrap items-end gap-3">
        {search}
        {children}
      </div>
    );
  }

  return (
    <div className="flex w-full flex-col gap-2">
      <div className="flex items-center gap-2">
        {search ? <div className="min-w-0 flex-1">{search}</div> : null}
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetTrigger asChild>
            <Button variant="outline" className={search ? undefined : 'w-full'}>
              <ListFilter aria-hidden />
              {t('common.filters.title')}
              {activeCount > 0 ? <Badge className="px-1.5 tabular-nums">{activeCount}</Badge> : null}
            </Button>
          </SheetTrigger>
          <SheetContent side="bottom" closeLabel={t('common.actions.close')} aria-describedby={undefined}>
            <SheetTitle className="text-lg font-semibold">{t('common.filters.title')}</SheetTitle>
            <div className="flex flex-col gap-3">{children}</div>
            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" disabled={activeCount === 0} onClick={onClear}>
                {t('common.actions.clearFilters')}
              </Button>
              <Button className="flex-1" onClick={() => setOpen(false)}>
                {t('common.actions.done')}
              </Button>
            </div>
          </SheetContent>
        </Sheet>
      </div>
      {error && !open ? (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      ) : null}
    </div>
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
