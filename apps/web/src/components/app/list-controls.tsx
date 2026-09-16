import { SEARCH_MAX_LENGTH } from '@pallet/shared';
import type { LucideIcon } from 'lucide-react';
import { ListFilter, SearchX } from 'lucide-react';
import { RadioGroup as RadioGroupPrimitive } from 'radix-ui';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { EmptyState } from '@/components/app/states';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { MD_QUERY, useMediaQuery } from '@/hooks/use-media-query';
import { isRtl, usePreferences } from '@/lib/preferences';
import { cn } from '@/lib/utils';

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

/** The filter card's id, so the header button that shows it can name what it controls. */
export const LIST_FILTERS_ID = 'list-filters';

/**
 * A list's search box and filters. From `md` they sit in one wrapping row above the list, or only the
 * search box while the page keeps the card hidden (`open`, Q53). On a phone a row of five pickers would
 * fill the first screen before any result, so only the search box stays and the filters move into a
 * bottom sheet behind a button counting the active ones. The filters are rendered in one place at a time,
 * so their ids and labels are never duplicated. Each filter takes `w-full` in the sheet: give fixed widths
 * from `md` only (`md:w-56`).
 */
export function ListFilters({
  search,
  activeCount,
  onClear,
  error,
  open: desktopOpen = true,
  children,
}: {
  search?: React.ReactNode;
  activeCount: number;
  onClear: () => void;
  /** Shown beside the button on a phone too, where the sheet holding the failing filter is closed. */
  error?: string;
  /**
   * From `md`, whether the filter card is on screen; `false` leaves only the search box (Q53). A page that passes
   * this renders a `FiltersToggle` in its header. The phone sheet keeps its own button whatever this says.
   */
  open?: boolean;
  children: React.ReactNode;
}) {
  const { t } = useTranslation();
  const wide = useMediaQuery(MD_QUERY);
  const [open, setOpen] = useState(false);

  if (wide) {
    // The sheet is gone from this layout; left open, it would pop up again when the phone turns back.
    if (open) setOpen(false);
    if (!desktopOpen) {
      // The error outlives the card: a reversed range closed away would otherwise leave a blank, silent list.
      if (!search && !error) return null;
      return (
        <div className="flex w-full flex-col gap-2">
          {search}
          {error ? (
            <p role="alert" className="text-destructive text-sm">
              {error}
            </p>
          ) : null}
        </div>
      );
    }
    return (
      // A toolbar card of its own, so the filters read as one control set above the list.
      <div
        id={LIST_FILTERS_ID}
        className="bg-card flex w-full flex-wrap items-end gap-3 rounded-xl border p-3 shadow-sm"
      >
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

/**
 * The header button that shows or hides a list's filter card from `md` (Q53), counting the active filters
 * the way the phone button does. Hidden below `md`, where `ListFilters` has its own sheet button.
 */
export function FiltersToggle({
  open,
  onToggle,
  activeCount,
}: {
  open: boolean;
  onToggle: () => void;
  activeCount: number;
}) {
  const { t } = useTranslation();
  return (
    <Button
      variant="outline"
      aria-expanded={open}
      aria-controls={LIST_FILTERS_ID}
      onClick={onToggle}
      className="hidden md:inline-flex"
    >
      <ListFilter aria-hidden />
      {t('common.filters.title')}
      {activeCount > 0 ? <Badge className="px-1.5 tabular-nums">{activeCount}</Badge> : null}
    </Button>
  );
}

/**
 * A list filter with a few named states, drawn as one segmented control like the order status tabs (Q56):
 * a radio group underneath, so the arrow keys move between the segments in the reading direction.
 */
export function FilterSegment<V extends string>({
  label,
  value,
  options,
  onChange,
  disabled = false,
}: {
  /** The accessible name of the group. */
  label: string;
  value: V;
  options: readonly { value: V; label: string }[];
  onChange: (value: V) => void;
  disabled?: boolean;
}) {
  const { language } = usePreferences();
  return (
    <RadioGroupPrimitive.Root
      aria-label={label}
      value={value}
      disabled={disabled}
      onValueChange={(next) => onChange(next as V)}
      dir={isRtl(language) ? 'rtl' : 'ltr'}
      className="bg-muted text-muted-foreground inline-flex h-12 w-fit max-w-full items-center overflow-x-auto rounded-lg p-1"
    >
      {options.map((option) => (
        <RadioGroupPrimitive.Item
          key={option.value}
          value={option.value}
          className={cn(
            'inline-flex h-full items-center justify-center rounded-md px-3 text-sm font-medium whitespace-nowrap transition-colors outline-none',
            'data-[state=checked]:bg-background data-[state=checked]:text-foreground data-[state=checked]:shadow-sm',
            'disabled:cursor-not-allowed disabled:opacity-50',
            'focus-visible:ring-ring focus-visible:ring-offset-background focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none',
          )}
        >
          {option.label}
        </RadioGroupPrimitive.Item>
      ))}
    </RadioGroupPrimitive.Root>
  );
}

/**
 * A yes-or-no list filter as a two-segment choice (Q56): the plain state first ("All", "Active"), then the
 * narrowing one, which names the group. Off is the default and leaves the URL clean.
 */
export function FilterChoice({
  label,
  offLabel,
  checked,
  onCheckedChange,
}: {
  label: string;
  offLabel: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
}) {
  return (
    <FilterSegment
      label={label}
      value={checked ? 'on' : 'off'}
      options={[
        { value: 'off', label: offLabel },
        { value: 'on', label },
      ]}
      onChange={(value) => onCheckedChange(value === 'on')}
    />
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
