import { SEARCH_MAX_LENGTH } from '@pallet/shared';
import type { LucideIcon } from 'lucide-react';
import { ListFilter, SearchX } from 'lucide-react';
import { RadioGroup as RadioGroupPrimitive } from 'radix-ui';
import { useEffect, useRef, useState } from 'react';
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
  onOpenChange,
  children,
}: {
  search?: React.ReactNode;
  activeCount: number;
  onClear: () => void;
  /** Shown beside the button on a phone too, where the sheet holding the failing filter is closed. */
  error?: string;
  /**
   * From `md`, whether the filter card is on screen; `false` leaves only the search box (Q53). A page that passes
   * this renders a `FiltersToggle` in its header.
   */
  open?: boolean;
  /**
   * Passing this hands the phone sheet to the page's own `FiltersToggle`, so the one trigger sits beside the
   * search box instead of the sheet adding a second button on a row of its own (Q64).
   */
  onOpenChange?: (open: boolean) => void;
  children: React.ReactNode;
}) {
  const { t } = useTranslation();
  const wide = useMediaQuery(MD_QUERY);
  // Controlled by the page when it renders the trigger itself; otherwise this component owns both.
  const controlled = onOpenChange !== undefined;
  // The sheet keeps its own state either way: mounted already open it would start life leaving, and the
  // exit it never finishes leaves a closed sheet lying over the page, swallowing the next tap.
  const [open, setOpenState] = useState(false);
  const setOpen = (next: boolean): void => {
    setOpenState(next);
    // Closing from inside the sheet puts the page's own toggle back in step.
    if (!next) onOpenChange?.(false);
  };

  // The page's flag is a press, not a state: it opens the sheet on the render that flips it, so a flag left
  // on by widening cannot pop the sheet open again when the phone turns back.
  const [previousOpen, setPreviousOpen] = useState(desktopOpen);
  if (controlled && previousOpen !== desktopOpen) {
    setPreviousOpen(desktopOpen);
    if (!wide) setOpenState(desktopOpen);
  }

  /**
   * Crossing into the narrow layout puts that flag back down. A card left open would otherwise sit there
   * with no sheet to show for it, and the next press would spend itself turning the flag off again.
   */
  const closeFilters = useRef(onOpenChange);
  useEffect(() => {
    closeFilters.current = onOpenChange;
  });
  useEffect(() => {
    if (!wide) closeFilters.current?.(false);
  }, [wide]);

  if (wide) {
    // The sheet is gone from this layout; left open, it would pop up again when the phone turns back.
    if (open) setOpenState(false);
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

  const trigger = controlled ? null : (
    // Controlled: the page's own toggle opens this sheet, so there is no second button here (Q64).
    <SheetTrigger asChild>
      <Button variant="outline" size="icon" className="relative shrink-0" aria-label={t('common.filters.title')}>
        <ListFilter aria-hidden />
        {activeCount > 0 ? <FilterCount count={activeCount} /> : null}
      </Button>
    </SheetTrigger>
  );
  const bar =
    search || trigger ? (
      <div className="flex items-center gap-2">
        {search ? <div className="min-w-0 flex-1">{search}</div> : null}
        {trigger}
      </div>
    ) : null;
  const shownError = error && !open ? error : null;

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      {/* Nothing of its own to show — the page draws the search box and the trigger — so no empty row either. */}
      {bar || shownError ? (
        <div className="flex w-full flex-col gap-2">
          {bar}
          {shownError ? (
            <p role="alert" className="text-destructive text-sm">
              {shownError}
            </p>
          ) : null}
        </div>
      ) : null}
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
  );
}

/**
 * How many filters are on, over the funnel of an icon-only button. Inside the button's own box so it
 * cannot widen the square, and `aria-hidden` because the button's label already names the control.
 */
function FilterCount({ count }: { count: number }) {
  return (
    <span
      aria-hidden
      className="bg-primary text-primary-foreground absolute end-1 top-1 flex size-4 items-center justify-center rounded-full text-[10px] font-medium tabular-nums lg:hidden"
    >
      {count}
    </span>
  );
}

/**
 * The header button that shows or hides a list's filter card from `md` (Q53) and opens the sheet below it,
 * counting the active filters. Only the funnel until `lg`: on a phone or a tablet the word costs a row that
 * the search box needs, and the icon carries the meaning (Q64). The accessible name is there at every size.
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
  const wide = useMediaQuery(MD_QUERY);
  return (
    <Button
      variant="outline"
      aria-expanded={open}
      // The card it names only exists from `md`; below that this button opens the sheet, a dialog of its own.
      aria-controls={wide ? LIST_FILTERS_ID : undefined}
      aria-label={t('common.filters.title')}
      onClick={onToggle}
      className="relative size-12 shrink-0 p-0 lg:h-12 lg:w-auto lg:px-4 lg:py-2"
    >
      <ListFilter aria-hidden />
      <span className="hidden lg:inline">{t('common.filters.title')}</span>
      {activeCount > 0 ? (
        <>
          <FilterCount count={activeCount} />
          <Badge className="hidden px-1.5 tabular-nums lg:inline-flex">{activeCount}</Badge>
        </>
      ) : null}
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
