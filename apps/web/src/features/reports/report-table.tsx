import { ArrowDown, ArrowUp } from 'lucide-react';
import { Fragment } from 'react';
import { useTranslation } from 'react-i18next';
import { nextSort, sortStateOf } from '@/lib/sort-cycle';
import { cn } from '@/lib/utils';

export interface ReportColumn<T> {
  id: string;
  header: string;
  cell: (row: T) => React.ReactNode;
  align?: 'start' | 'end';
  /** Sortable on the page (snapshot reports, §12.1). */
  sortValue?: (row: T) => number | string;
}

/**
 * A report's table (§7.3.17): every row at once, a sticky header that repeats on each printed page, and a
 * totals footer. Wide reports scroll inside their own box, never the page.
 */
export function ReportTable<T>({
  label,
  columns,
  rows,
  rowKey,
  totals,
  sort,
  defaultSort,
  onSortChange,
  rowClassName,
  expanded,
  emptyText,
}: {
  label: string;
  columns: ReportColumn<T>[];
  rows: readonly T[];
  rowKey: (row: T) => string | number;
  /** Cells of the totals row, by column id. */
  totals?: Partial<Record<string, React.ReactNode>>;
  /** `field` or `-field`; sorting happens here, on the loaded rows. */
  sort?: string;
  /** The order the API returns the rows in, shown as the sort in effect when the URL names none. */
  defaultSort?: string;
  onSortChange?: (sort: string | undefined) => void;
  rowClassName?: (row: T) => string | undefined;
  /** A row rendered under a row, such as its per-item breakdown or a subtotal. */
  expanded?: (row: T) => React.ReactNode;
  emptyText: string;
}) {
  const { t } = useTranslation();
  const active = sort ?? defaultSort;
  const field = active?.replace(/^-/, '');
  const descending = active?.startsWith('-') ?? false;
  const column = columns.find((candidate) => candidate.id === field && candidate.sortValue);
  const ordered = column?.sortValue
    ? [...rows].sort((x, y) => {
        const a = column.sortValue?.(x) ?? 0;
        const b = column.sortValue?.(y) ?? 0;
        const order = typeof a === 'number' && typeof b === 'number' ? a - b : String(a).localeCompare(String(b));
        return descending ? -order : order;
      })
    : rows;

  return (
    // A scroll box of its own on screen, so the header and totals can stick to it; on paper the table
    // runs its full length.
    <div className="max-h-[calc(100dvh-14rem)] max-w-full overflow-auto rounded-md border print:max-h-none print:overflow-visible">
      <table aria-label={label} className="w-full text-sm">
        <thead className="bg-background sticky top-0 z-10">
          <tr className="border-b">
            {columns.map((col) => {
              const state = sortStateOf(col.sortValue ? col.id : undefined, active);
              return (
                <th
                  key={col.id}
                  scope="col"
                  aria-sort={col.sortValue ? state : undefined}
                  className={cn(
                    'h-10 px-3 font-medium whitespace-nowrap',
                    col.align === 'end' ? 'text-end' : 'text-start',
                  )}
                >
                  {col.sortValue && onSortChange ? (
                    <button
                      type="button"
                      onClick={() => onSortChange(nextSort(col.id, active, defaultSort))}
                      className={cn(
                        'inline-flex min-h-10 items-center gap-1 md:min-h-0',
                        col.align === 'end' && 'flex-row-reverse',
                      )}
                    >
                      {col.header}
                      {state !== 'none' ? (
                        state === 'descending' ? (
                          <ArrowDown className="size-3" aria-hidden />
                        ) : (
                          <ArrowUp className="size-3" aria-hidden />
                        )
                      ) : null}
                    </button>
                  ) : (
                    col.header
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {ordered.length === 0 ? (
            <tr>
              <td colSpan={columns.length} className="text-muted-foreground px-3 py-6 text-center">
                {emptyText}
              </td>
            </tr>
          ) : (
            ordered.map((row) => (
              <Fragment key={rowKey(row)}>
                <tr className={cn('border-b last:border-b-0', rowClassName?.(row))}>
                  {columns.map((col) => (
                    <td
                      key={col.id}
                      className={cn(
                        'px-3 py-2 align-top',
                        col.align === 'end' ? 'text-end tabular-nums' : 'text-start',
                      )}
                    >
                      {col.cell(row)}
                    </td>
                  ))}
                </tr>
                {expanded?.(row)}
              </Fragment>
            ))
          )}
        </tbody>
        {totals ? (
          <tfoot className="bg-muted/60 sticky bottom-0 border-t font-semibold">
            <tr>
              {columns.map((col, index) => (
                <td
                  key={col.id}
                  className={cn('px-3 py-2', col.align === 'end' ? 'text-end tabular-nums' : 'text-start')}
                >
                  {totals[col.id] ?? (index === 0 ? t('reports.total') : null)}
                </td>
              ))}
            </tr>
          </tfoot>
        ) : null}
      </table>
    </div>
  );
}
