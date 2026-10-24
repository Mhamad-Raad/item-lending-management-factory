import { useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import type { TranslationKey } from '@/i18n/keys';
import { MoneyText } from '@/components/app/money-text';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet';

/**
 * The live summary of a daily flow (§7.4): a sticky side panel on `≥ lg`; below that, a bar fixed to
 * the bottom with the key figure and the submit button, which opens the full summary in a sheet.
 * The submit button is rendered by the caller in both places, so it stays inside the form.
 */
export function SummaryPanel({
  title,
  keyFigure,
  keyLabel,
  submit,
  children,
}: {
  title: string;
  /** The one number the bar shows: the deposit total, the refund due. */
  keyFigure: React.ReactNode;
  /** What that number is; the panel's title when the title already says it. */
  keyLabel?: string;
  submit: React.ReactNode;
  children: React.ReactNode;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);

  return (
    <>
      <aside aria-label={title} className="hidden lg:block">
        <div className="sticky top-4 flex flex-col gap-4 rounded-lg border p-4">
          <h2 className="font-semibold">{title}</h2>
          {children}
          {submit}
        </div>
      </aside>

      {/* On <body>, not in the page: the page slides in with a transform, and a fixed bar inside it would
          ride along at the foot of the form until the slide ends. The submit button reaches its form by `form`. */}
      {createPortal(
        <div
          data-slot="summary-bar"
          className="bg-background fixed inset-x-0 bottom-0 z-40 flex items-center gap-3 border-t p-3 lg:hidden"
        >
          <button
            type="button"
            className="flex min-w-0 flex-1 flex-col items-start text-start"
            onClick={() => setOpen(true)}
          >
            <span className="text-muted-foreground text-xs">{keyLabel ?? title}</span>
            <span className="truncate text-lg font-semibold">{keyFigure}</span>
          </button>
          {submit}
        </div>,
        document.body,
      )}
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent closeLabel={t('common.actions.close')}>
          <SheetTitle className="font-semibold">{title}</SheetTitle>
          {children}
          <Button type="button" variant="outline" onClick={() => setOpen(false)}>
            {t('common.actions.close')}
          </Button>
        </SheetContent>
      </Sheet>
    </>
  );
}

/**
 * The summary's figures in the page, for the screens that have no side panel (below `lg`: phones, an upright tablet),
 * where the bar shows one figure only (Q162). Its rows are fixed — the same ones whatever is typed, zeros and all — so
 * it never changes height above the row being typed in, which would push that row away under the finger (Safari does
 * not anchor the scroll). What comes and goes (each order's part, the notices) stays in the panel and its sheet.
 */
export function SummaryCard({
  title,
  figures,
  cashRefund,
}: {
  title: string;
  figures: readonly (readonly [TranslationKey, React.ReactNode])[];
  /** The cash handed back, 0 while nothing can be recorded: one row more, always there. */
  cashRefund: number;
}) {
  return (
    <section aria-label={title} className="flex flex-col gap-4 rounded-lg border p-4 lg:hidden">
      <h2 className="font-semibold">{title}</h2>
      <SummaryFigures rows={[...figures, ['returns.new.cashRefund', <MoneyText key="cash" value={cashRefund} />]]} />
    </section>
  );
}

/** A summary's figures, label and value a row each, as the panel, its sheet and the page's card draw them. */
export function SummaryFigures({ rows }: { rows: readonly (readonly [TranslationKey, React.ReactNode])[] }) {
  const { t } = useTranslation();
  return (
    <dl className="flex flex-col gap-3 text-sm">
      {rows.map(([label, value]) => (
        <div key={label} className="flex justify-between gap-2">
          <dt className="text-muted-foreground">{t(label)}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}
