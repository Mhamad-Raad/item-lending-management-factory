import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TranslationKey } from '@/i18n/keys';
import { Pagination } from '@/components/app/pagination';
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { DURATION } from '@/lib/motion';
import { nextSort, sortStateOf } from '@/lib/sort-cycle';
import { isolated } from '@/components/app/bdi';
import { cn } from '@/lib/utils';

export interface DataColumn<T> {
  id: string;
  /** i18n key of the header, also the label on the phone card. */
  header: TranslationKey;
  cell: (row: T) => React.ReactNode;
  /** What the card shows instead of `cell`, where a row of the table does not read as a card (Q66). */
  mobileCell?: (row: T) => React.ReactNode;
  /** The `sort` value this column orders by; a column without one is not sortable. */
  sortKey?: string;
  align?: 'start' | 'end';
  hideBelow?: 'md' | 'lg' | 'xl' | '2xl';
  /** Free text such as a name: wraps onto a second line in a bounded width. Every other cell stays on one line. */
  wrap?: boolean;
  /**
   * Its place on the card that replaces the table below `lg`; the first column is the title (Q65).
   *
   * `title` heads the card, with `badge` and then `actions` at that line's end, and `subtitle` under it.
   * `figure` joins the grid of numbers, two to a row with its header above its value; `footer` joins the
   * quiet line that closes the card. `meta` — the default — keeps the label-beside-value row of a short card.
   */
  mobile?: 'title' | 'subtitle' | 'badge' | 'actions' | 'figure' | 'footer' | 'meta' | 'hidden';
}

interface CardCell<T> {
  column: DataColumn<T>;
  cell: React.ReactNode;
}

interface DataTableProps<T> {
  /** Names the table for screen readers. */
  label: string;
  columns: DataColumn<T>[];
  rows: T[];
  rowKey: (row: T) => string | number;
  /** Wraps the first cell in the row's link: the tab stop, and what a click anywhere on the row opens. */
  rowLink?: (row: T, children: React.ReactNode) => React.ReactNode;
  total: number;
  page: number;
  pageSize: number;
  /** The `sort` in effect; `defaultSort` is what the list uses when the URL names none. */
  sort?: string;
  defaultSort?: string;
  onSortChange?: (sort: string | undefined) => void;
  onPageChange: (page: number) => void;
  /**
   * Called instead of `onPageChange` when the page is past the end and the table steps back to the last
   * one. A list whose page lives in the URL replaces the history entry here: a pushed one would bring the
   * user straight back to the empty page on Back, which steps forward again — a Back-button trap.
   */
  onPageOverflow?: (lastPage: number) => void;
  onPageSizeChange?: (pageSize: number) => void;
  /** Search box and filters, above the table. */
  toolbar?: React.ReactNode;
  isFetching?: boolean;
  /** Rendered instead of the table when the list has no records at all. */
  empty: React.ReactNode;
}

/** A row motion can fade in and out. */
const MotionTableRow = motion.create(TableRow);

/** §7.14: row animations only up to this many rows. */
const ROW_ANIMATION_LIMIT = 50;

const HIDE_BELOW = {
  md: 'hidden md:table-cell',
  lg: 'hidden lg:table-cell',
  xl: 'hidden xl:table-cell',
  '2xl': 'hidden 2xl:table-cell',
} as const;

/** A click on a row opens its link, unless the click was on something interactive of its own. */
function openRowLink(event: React.MouseEvent<HTMLElement>): void {
  if ((event.target as HTMLElement).closest('a, button, input, [role="button"], [role="switch"]')) return;
  event.currentTarget.querySelector<HTMLAnchorElement>('a[href]')?.click();
}

/**
 * Counts the times a list was replaced outright — a new page, sort or filter, no row carried over. Keyed on it,
 * the rows' `AnimatePresence` starts afresh instead of fading the old rows out: motion puts leaving rows
 * ahead of the arriving ones, so a whole old page would sit on top of the new one, still taking clicks.
 */
function useReplacements(keys: readonly React.Key[]): number {
  const [state, setState] = useState({ keys, count: 0 });
  if (keys !== state.keys && keys.join() !== state.keys.join()) {
    const replaced = state.keys.length > 0 && !keys.some((key) => state.keys.includes(key));
    setState({ keys, count: replaced ? state.count + 1 : state.count });
  }
  return state.count;
}

/**
 * Every list in the app (§7.5): sortable headers, pagination with a page size, a sticky header,
 * and below `lg` cards instead of a table: at a tablet's width the columns no longer fit, and the table
 * scrolled sideways with the status clipped off its end (Q65). The cards go two to a row from `md`.
 */
export function DataTable<T>({
  label,
  columns,
  rows,
  rowKey,
  rowLink,
  total,
  page,
  pageSize,
  sort,
  defaultSort,
  onSortChange,
  onPageChange,
  onPageOverflow = onPageChange,
  onPageSizeChange,
  toolbar,
  isFetching = false,
  empty,
}: DataTableProps<T>) {
  const { t } = useTranslation();
  const activeSort = sort ?? defaultSort;
  const lastPage = Math.max(1, Math.ceil(total / pageSize));

  // A page past the end — the last row of the last page archived, an old bookmark — steps back to
  // the last page rather than reading as an empty list.
  useEffect(() => {
    if (rows.length === 0 && page > lastPage) onPageOverflow(lastPage);
  }, [rows.length, page, lastPage, onPageOverflow]);

  // Rows and cards that arrive fade in and those that leave fade out (§7.14), on lists short enough for
  // it to stay smooth; a longer page renders plainly.
  const animated = rows.length <= ROW_ANIMATION_LIMIT;
  const replacements = useReplacements(rows.map(rowKey));
  const Row = animated ? MotionTableRow : TableRow;
  const Card = animated ? motion.li : 'li';
  const rowMotion = animated
    ? {
        initial: { opacity: 0, y: 4 },
        animate: { opacity: 1, y: 0 },
        exit: { opacity: 0 },
        transition: { duration: DURATION.fast },
      }
    : {};
  const [firstColumn] = columns;
  const renderCell = (column: DataColumn<T>, row: T): React.ReactNode => {
    const value = isolated(column.cell(row));
    return column === firstColumn && rowLink ? rowLink(row, value) : value;
  };
  const mobileRole = (column: DataColumn<T>): NonNullable<DataColumn<T>['mobile']> =>
    column.mobile ?? (column === firstColumn ? 'title' : 'meta');
  /**
   * A card's columns drawn once and grouped by their slot. A column may draw itself differently here
   * (`mobileCell`), and a cell with nothing to say is dropped, so a slot whose cells are all empty can be
   * left out with its wrapper instead of printing a label over a blank.
   */
  const cardSlots = (row: T): Record<NonNullable<DataColumn<T>['mobile']>, CardCell<T>[]> => {
    const slots = {
      title: [],
      subtitle: [],
      badge: [],
      actions: [],
      figure: [],
      footer: [],
      meta: [],
      hidden: [],
    } as Record<NonNullable<DataColumn<T>['mobile']>, CardCell<T>[]>;
    for (const column of columns) {
      const cell = column.mobileCell ? isolated(column.mobileCell(row)) : renderCell(column, row);
      if (cell === null || cell === undefined || cell === false) continue;
      slots[mobileRole(column)].push({ column, cell });
    }
    return slots;
  };

  return (
    <div className="flex flex-col gap-3">
      {toolbar ? <div className="flex flex-wrap items-center gap-3">{toolbar}</div> : null}

      {total === 0 ? (
        empty
      ) : (
        <>
          {/* A thin bar while a new page or sort loads; the rows stay until the answer arrives. */}
          <div className="relative h-0.5 overflow-hidden rounded" aria-hidden>
            {isFetching ? <div className="bg-primary absolute inset-0 animate-pulse" /> : null}
          </div>

          <div className="bg-card hidden max-h-[calc(100dvh-14rem)] overflow-auto rounded-xl border shadow-sm lg:block">
            <table aria-label={label} aria-busy={isFetching} className="w-full caption-bottom text-base">
              <TableHeader className="sticky top-0 z-10">
                <TableRow className="hover:bg-transparent">
                  {columns.map((column) => {
                    const state = sortStateOf(column.sortKey, activeSort);
                    const Icon = state === 'ascending' ? ArrowUp : state === 'descending' ? ArrowDown : ArrowUpDown;
                    return (
                      <TableHead
                        key={column.id}
                        aria-sort={column.sortKey ? state : undefined}
                        className={cn(
                          column.align === 'end' && 'text-end',
                          column.hideBelow && HIDE_BELOW[column.hideBelow],
                        )}
                      >
                        {column.sortKey && onSortChange ? (
                          <button
                            type="button"
                            className="hover:text-foreground inline-flex items-center gap-1 rounded-sm outline-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                            onClick={() => onSortChange(nextSort(column.sortKey as string, activeSort, defaultSort))}
                          >
                            {t(column.header)}
                            <Icon className={cn('size-3.5', state === 'none' && 'opacity-40')} aria-hidden />
                          </button>
                        ) : (
                          t(column.header)
                        )}
                      </TableHead>
                    );
                  })}
                </TableRow>
              </TableHeader>
              <TableBody>
                {/* The first list fades nothing in; a replacing one does. */}
                <AnimatePresence key={replacements} initial={replacements > 0}>
                  {rows.map((row) => (
                    <Row
                      key={rowKey(row)}
                      {...rowMotion}
                      className={cn(rowLink && 'cursor-pointer')}
                      onClick={rowLink ? openRowLink : undefined}
                    >
                      {columns.map((column) => (
                        <TableCell
                          key={column.id}
                          className={cn(
                            column.wrap ? 'max-w-80 min-w-48' : 'whitespace-nowrap',
                            column.align === 'end' && 'text-end tabular-nums',
                            column.hideBelow && HIDE_BELOW[column.hideBelow],
                          )}
                        >
                          {renderCell(column, row)}
                        </TableCell>
                      ))}
                    </Row>
                  ))}
                </AnimatePresence>
              </TableBody>
            </table>
          </div>

          <ul aria-label={label} className="grid grid-cols-1 gap-2 md:grid-cols-2 lg:hidden">
            <AnimatePresence key={replacements} initial={replacements > 0}>
              {rows.map((row) => {
                const slots = cardSlots(row);
                return (
                  <Card
                    key={rowKey(row)}
                    {...rowMotion}
                    className={cn(
                      'bg-card flex flex-col gap-2 rounded-xl border p-4 shadow-sm',
                      rowLink && 'hover:border-primary/40 cursor-pointer transition-colors',
                    )}
                    onClick={rowLink ? openRowLink : undefined}
                  >
                    {/* The card's head: what this row is, the badges that say its state, and its own actions. */}
                    <div className="flex items-center gap-2">
                      <div className="min-w-0 flex-1 font-medium">
                        {slots.title.map(({ column, cell }) => (
                          <div key={column.id}>{cell}</div>
                        ))}
                        {slots.subtitle.map(({ column, cell }) => (
                          <div key={column.id} className="text-muted-foreground text-sm font-normal">
                            {cell}
                          </div>
                        ))}
                      </div>
                      {slots.badge.length > 0 || slots.actions.length > 0 ? (
                        <div className="flex shrink-0 items-center gap-1">
                          {slots.badge.length > 0 ? (
                            <div className="flex flex-wrap justify-end gap-1">
                              {slots.badge.map(({ column, cell }) => (
                                <div key={column.id}>{cell}</div>
                              ))}
                            </div>
                          ) : null}
                          {slots.actions.map(({ column, cell }) => (
                            <div key={column.id}>{cell}</div>
                          ))}
                        </div>
                      ) : null}
                    </div>

                    {/* The numbers, two to a row with their header above them, so they can be compared down a column. */}
                    {slots.figure.length > 0 ? (
                      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 border-t pt-2 text-sm">
                        {slots.figure.map(({ column, cell }) => (
                          <div key={column.id} className="flex min-w-0 flex-col">
                            <dt className="text-muted-foreground text-xs">{t(column.header)}</dt>
                            <dd>{cell}</dd>
                          </div>
                        ))}
                      </dl>
                    ) : null}

                    {slots.meta.length > 0 ? (
                      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
                        {slots.meta.map(({ column, cell }) => (
                          <div key={column.id} className="contents">
                            <dt className="text-muted-foreground">{t(column.header)}</dt>
                            <dd>{cell}</dd>
                          </div>
                        ))}
                      </dl>
                    ) : null}

                    {/* Everything else that names the row rather than measures it, on one quiet line. */}
                    {slots.footer.length > 0 ? (
                      <div className="text-muted-foreground flex flex-wrap items-center gap-x-3 gap-y-1 border-t pt-2 text-sm">
                        {slots.footer.map(({ column, cell }) => (
                          <div key={column.id} className="flex min-w-0 items-center gap-1.5">
                            <span className="sr-only">{t(column.header)}</span>
                            {cell}
                          </div>
                        ))}
                      </div>
                    ) : null}
                  </Card>
                );
              })}
            </AnimatePresence>
          </ul>

          <Pagination
            page={page}
            pageSize={pageSize}
            total={total}
            onPageChange={onPageChange}
            onPageSizeChange={onPageSizeChange}
          />
        </>
      )}
    </div>
  );
}
