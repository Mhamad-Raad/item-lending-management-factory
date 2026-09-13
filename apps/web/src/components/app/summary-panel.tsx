import { useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
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
