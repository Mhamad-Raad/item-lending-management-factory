import { cn } from '@/lib/utils';

/** The table scrolls inside its own container; the page itself never scrolls sideways (§7.15). */
export function Table({ className, ...props }: React.ComponentProps<'table'>) {
  return (
    <div data-slot="table-container" className="relative w-full overflow-x-auto">
      <table data-slot="table" className={cn('w-full caption-bottom text-sm', className)} {...props} />
    </div>
  );
}

export function TableHeader({ className, ...props }: React.ComponentProps<'thead'>) {
  // A tinted band, so the column names read apart from the rows under them (Q50).
  return <thead data-slot="table-header" className={cn('bg-table-header [&_tr]:border-b', className)} {...props} />;
}

export function TableBody({ className, ...props }: React.ComponentProps<'tbody'>) {
  return (
    <tbody
      data-slot="table-body"
      // Every other row striped, so a long row stays on its line across the table; hover outranks the stripe.
      className={cn('[&_tr:last-child]:border-0 [&>tr:nth-child(even):not(:hover)]:bg-table-stripe', className)}
      {...props}
    />
  );
}

export function TableRow({ className, ...props }: React.ComponentProps<'tr'>) {
  return (
    <tr
      data-slot="table-row"
      className={cn('hover:bg-accent/70 data-[state=selected]:bg-muted border-b transition-colors', className)}
      {...props}
    />
  );
}

/** A column header unless told otherwise, so every table names its columns (§7.15). */
export function TableHead({ className, scope = 'col', ...props }: React.ComponentProps<'th'>) {
  return (
    <th
      scope={scope}
      data-slot="table-head"
      className={cn(
        'text-muted-foreground h-11 px-3 text-start align-middle text-xs font-semibold tracking-wide whitespace-nowrap',
        className,
      )}
      {...props}
    />
  );
}

export function TableCell({ className, ...props }: React.ComponentProps<'td'>) {
  return <td data-slot="table-cell" className={cn('p-3 align-middle', className)} {...props} />;
}
