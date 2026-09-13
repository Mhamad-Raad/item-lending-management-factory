import {
  formatMoney,
  formatNumber,
  type CustomerDto,
  type DriverDto,
  type ItemDto,
  type PageDto,
  type UserListItemDto,
} from '@pallet/shared';
import { useQuery } from '@tanstack/react-query';
import type { TFunction } from 'i18next';
import { ChevronsUpDown } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Thumbnail } from '@/components/app/thumbnail';
import { Button } from '@/components/ui/button';
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useDebouncedValue } from '@/hooks/use-debounced-value';
import { apiFetch } from '@/lib/api-client';
import { qk } from '@/lib/query-keys';
import { cn } from '@/lib/utils';

export type EntityKind = 'customer' | 'driver' | 'item' | 'user';

interface Option {
  id: number;
  label: string;
  detail: string;
  imageUrl?: string | null;
}

const PATHS = { customer: '/customers', driver: '/drivers', item: '/items', user: '/users' } as const;
const KEYS = { customer: qk.customers, driver: qk.drivers, item: qk.items, user: qk.users } as const;
/** Users are never archived, so their list takes no such filter. */
const ARCHIVABLE = new Set<EntityKind>(['customer', 'driver', 'item']);

/** What an option shows for each kind (§7.5). */
function toOption(kind: EntityKind, row: unknown, t: TFunction): Option {
  switch (kind) {
    case 'customer': {
      const customer = row as CustomerDto;
      return { id: customer.id, label: customer.name, detail: customer.phone };
    }
    case 'driver': {
      const driver = row as DriverDto;
      return { id: driver.id, label: driver.name, detail: driver.carNumber };
    }
    case 'item': {
      const item = row as ItemDto;
      return {
        id: item.id,
        label: item.name,
        detail: t('common.combobox.itemDetail', {
          onHand: formatNumber(item.quantityOnHand),
          deposit: formatMoney(item.depositPrice),
        }),
        imageUrl: item.imageUrl,
      };
    }
    case 'user': {
      const user = row as UserListItemDto;
      return { id: user.id, label: user.displayName, detail: user.username };
    }
  }
}

/**
 * A searchable select over one of the list endpoints (§7.5): typing asks the server, 250 ms after the
 * last key, for the first 20 matches. The chosen entity is shown from its own record, so it stays
 * labelled even when it is not among the current matches.
 */
export function EntityCombobox({
  id,
  kind,
  value,
  onChange,
  placeholder,
  includeArchived = false,
  excludeIds = [],
  disabled = false,
  invalid = false,
  autoFocus = false,
  'aria-label': ariaLabel,
}: {
  id?: string;
  /** The accessible name when no `<label htmlFor={id}>` names the picker, as in a list's filters. */
  'aria-label'?: string;
  kind: EntityKind;
  value: number | null;
  onChange: (value: number | null) => void;
  placeholder: string;
  includeArchived?: boolean;
  excludeIds?: readonly number[];
  disabled?: boolean;
  invalid?: boolean;
  /** The first field of a flow takes focus when the page opens (§7.4.1). */
  autoFocus?: boolean;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const q = useDebouncedValue(search, 250).trim() || undefined;

  const params = { q, pageSize: 20, ...(ARCHIVABLE.has(kind) ? { includeArchived } : {}) };
  const matches = useQuery({
    queryKey: KEYS[kind].list(params),
    queryFn: () => apiFetch<PageDto<unknown>>(PATHS[kind], { query: params }),
    enabled: open,
    staleTime: 60_000,
  });
  const selected = useQuery({
    queryKey: KEYS[kind].detail(value ?? 0),
    queryFn: () => apiFetch<unknown>(`${PATHS[kind]}/${value}`),
    enabled: value !== null,
    staleTime: 60_000,
  });

  const options = (matches.data?.items ?? [])
    .map((row) => toOption(kind, row, t))
    .filter((option) => !excludeIds.includes(option.id));
  const chosen = value !== null && selected.data ? toOption(kind, selected.data, t) : null;

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setSearch('');
      }}
    >
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          role="combobox"
          autoFocus={autoFocus}
          aria-label={ariaLabel}
          aria-expanded={open}
          aria-invalid={invalid}
          disabled={disabled}
          className="h-10 w-full justify-between font-normal [contain:inline-size]"
          onKeyDown={(event) => {
            // Typing on the closed select opens it with what was typed (§7.15).
            if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
              event.preventDefault();
              setSearch(event.key);
              setOpen(true);
            }
          }}
        >
          <span className="flex min-w-0 items-center gap-2">
            {chosen && kind === 'item' ? <Thumbnail url={chosen.imageUrl} size="sm" /> : null}
            <bdi className={cn('truncate', !chosen && 'text-muted-foreground')}>{chosen?.label ?? placeholder}</bdi>
          </span>
          <ChevronsUpDown className="size-4 opacity-50" aria-hidden />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-(--radix-popover-trigger-width) min-w-64 p-0">
        <Command shouldFilter={false}>
          <CommandInput value={search} onValueChange={setSearch} placeholder={t('common.combobox.search')} />
          <CommandList>
            {matches.isPending ? (
              <p className="text-muted-foreground py-6 text-center text-sm">{t('common.combobox.loading')}</p>
            ) : (
              <CommandEmpty>{t('common.combobox.empty')}</CommandEmpty>
            )}
            {options.map((option) => (
              <CommandItem
                key={option.id}
                value={String(option.id)}
                onSelect={() => {
                  onChange(option.id);
                  setOpen(false);
                  setSearch('');
                }}
              >
                {kind === 'item' ? <Thumbnail url={option.imageUrl} size="sm" /> : null}
                <span className="flex min-w-0 flex-col">
                  <span className="truncate">
                    <bdi>{option.label}</bdi>
                  </span>
                  <span className="text-muted-foreground truncate text-xs" dir="auto">
                    {option.detail}
                  </span>
                </span>
              </CommandItem>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
