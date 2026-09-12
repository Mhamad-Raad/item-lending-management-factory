import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Pagination } from '@/components/app/pagination';
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { cn } from '@/lib/utils';

export interface DataColumn<T> {
  id: string;
  /** i18n key of the header, also the label on the phone card. */
  header: string;
  cell: (row: T) => React.ReactNode;
  /** The `sort` value this column orders by; a column without one is not sortable. */
  sortKey?: string;
  align?: 'start' | 'end';
  hideBelow?: 'md' | 'lg';
  /** Its place on the card that replaces the table below `md`; the first column is the title. */
  mobile?: 'title' | 'subtitle' | 'meta' | 'hidden';
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
  onPageSizeChange?: (pageSize: number) => void;
  /** Search box and filters, above the table. */
  toolbar?: React.ReactNode;
  isFetching?: boolean;
  /** Rendered instead of the table when the list has no records at all. */
  empty: React.ReactNode;
}

const HIDE_BELOW = { md: 'hidden md:table-cell', lg: 'hidden lg:table-cell' } as const;

type SortState = 'ascending' | 'descending' | 'none';

function sortStateOf(column: { sortKey?: string }, sort: string | undefined): SortState {
  if (!column.sortKey || !sort) return 'none';
  if (sort === column.sortKey) return 'ascending';
  return sort === `-${column.sortKey}` ? 'descending' : 'none';
}

/** Ascending, then descending, then back to the list's default order (§7.5). */
function nextSort(sortKey: string, state: SortState): string | undefined {
  if (state === 'none') return sortKey;
  return state === 'ascending' ? `-${sortKey}` : undefined;
}

/** A click on a row opens its link, unless the click was on something interactive of its own. */
function openRowLink(event: React.MouseEvent<HTMLElement>): void {
  if ((event.target as HTMLElement).closest('a, button, input, [role="button"], [role="switch"]')) return;
  event.currentTarget.querySelector<HTMLAnchorElement>('a[href]')?.click();
}

/**
 * Every list in the app (§7.5): sortable headers, pagination with a page size, a sticky header,
 * and below `md` one card per row instead of a table that would scroll sideways.
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
    if (rows.length === 0 && page > lastPage) onPageChange(lastPage);
  }, [rows.length, page, lastPage, onPageChange]);

  const [firstColumn] = columns;
  const renderCell = (column: DataColumn<T>, row: T): React.ReactNode =>
    column === firstColumn && rowLink ? rowLink(row, column.cell(row)) : column.cell(row);
  const mobileRole = (column: DataColumn<T>): NonNullable<DataColumn<T>['mobile']> =>
    column.mobile ?? (column === firstColumn ? 'title' : 'meta');

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

          <div className="hidden max-h-[calc(100dvh-14rem)] overflow-auto rounded-md border md:block">
            <table aria-label={label} aria-busy={isFetching} className="w-full caption-bottom text-sm">
              <TableHeader className="bg-background sticky top-0 z-10">
                <TableRow className="hover:bg-transparent">
                  {columns.map((column) => {
                    const state = sortStateOf(column, activeSort);
                    const Icon = state === 'ascending' ? ArrowUp : state === 'descending' ? ArrowDown : ArrowUpDown;
                    return (
                      <TableHead
                        key={column.id}
                        scope="col"
                        aria-sort={column.sortKey ? state : undefined}
                        className={cn(
                          column.align === 'end' && 'text-end',
                          column.hideBelow && HIDE_BELOW[column.hideBelow],
                        )}
                      >
                        {column.sortKey && onSortChange ? (
                          <button
                            type="button"
                            className="hover:text-foreground focus-visible:ring-ring/50 inline-flex items-center gap-1 rounded-sm outline-none focus-visible:ring-[3px]"
                            onClick={() => onSortChange(nextSort(column.sortKey as string, state))}
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
                {rows.map((row) => (
                  <TableRow
                    key={rowKey(row)}
                    className={cn(rowLink && 'cursor-pointer')}
                    onClick={rowLink ? openRowLink : undefined}
                  >
                    {columns.map((column) => (
                      <TableCell
                        key={column.id}
                        className={cn(
                          column.align === 'end' && 'text-end tabular-nums',
                          column.hideBelow && HIDE_BELOW[column.hideBelow],
                        )}
                      >
                        {renderCell(column, row)}
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </table>
          </div>

          <ul aria-label={label} className="flex flex-col gap-2 md:hidden">
            {rows.map((row) => (
              <li
                key={rowKey(row)}
                className={cn('flex flex-col gap-2 rounded-lg border p-4', rowLink && 'cursor-pointer')}
                onClick={rowLink ? openRowLink : undefined}
              >
                {columns
                  .filter((column) => mobileRole(column) === 'title')
                  .map((column) => (
                    <div key={column.id} className="font-medium">
                      {renderCell(column, row)}
                    </div>
                  ))}
                {columns
                  .filter((column) => mobileRole(column) === 'subtitle')
                  .map((column) => (
                    <div key={column.id} className="text-muted-foreground text-sm">
                      {renderCell(column, row)}
                    </div>
                  ))}
                <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
                  {columns
                    .filter((column) => mobileRole(column) === 'meta')
                    .map((column) => (
                      <div key={column.id} className="contents">
                        <dt className="text-muted-foreground">{t(column.header)}</dt>
                        <dd>{renderCell(column, row)}</dd>
                      </div>
                    ))}
                </dl>
              </li>
            ))}
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
