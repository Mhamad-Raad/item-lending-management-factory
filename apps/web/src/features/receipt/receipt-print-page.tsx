import type { ErrorCode, ReceiptFactoryDto } from '@pallet/shared';
import type { UseQueryResult } from '@tanstack/react-query';
import { Printer, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { QueryErrorState } from '@/components/app/states';
import { Button } from '@/components/ui/button';
import receiptStyles from '@/features/receipt/receipt.css?inline';
import type { TranslationKey } from '@/i18n/keys';
import { isApiError } from '@/lib/api-error';
import { tr } from './receipt-i18n';

/**
 * A receipt's own tab (§7.16.1, Q137). It prints itself once, when the data, the fonts and the logo are
 * ready — a receipt printed before its font loads comes out in the wrong script width.
 */
export function ReceiptPrintPage<T extends { factory: ReceiptFactoryDto }>({
  query,
  refusal,
  children,
}: {
  query: UseQueryResult<T>;
  /** The API's answer that means "this has no receipt", said on the page in Sorani instead of the generic error. */
  refusal: { code: ErrorCode; message: TranslationKey };
  children: (data: T, onLogoSettled: () => void) => ReactNode;
}) {
  const { t } = useTranslation();
  const printed = useRef(false);
  const [logoSettled, setLogoSettled] = useState(false);
  const settleLogo = useCallback(() => setLogoSettled(true), []);

  const ready = query.data !== undefined && (query.data.factory.logoUrl === null || logoSettled);
  useEffect(() => {
    if (!ready || printed.current) return;
    printed.current = true;
    void document.fonts.ready.then(() => window.print());
  }, [ready]);

  // A reprint is what the server says now, not what this tab first read (Q134): the button reads it again, and
  // the paper is printed by the effect that follows the render of that answer — the read's own promise settles
  // before React has put the new figures on the page. A failed read prints nothing.
  const reprintAt = useRef<number | null>(null);
  const { dataUpdatedAt, isFetching, isError, refetch } = query;
  useEffect(() => {
    if (reprintAt.current === null || isFetching) return;
    const fresh = !isError && dataUpdatedAt >= reprintAt.current;
    reprintAt.current = null;
    if (fresh) window.print();
  }, [dataUpdatedAt, isFetching, isError]);
  const reprint = (): void => {
    reprintAt.current = Date.now();
    void refetch();
  };

  const toolbar = (
    <div className="receipt-toolbar flex justify-center gap-2 p-4 print:hidden">
      <Button onClick={reprint} disabled={!query.data || query.isFetching}>
        <Printer aria-hidden />
        {t('receipt.print')}
      </Button>
      <Button variant="outline" onClick={() => window.close()}>
        <X aria-hidden />
        {t('common.actions.close')}
      </Button>
    </div>
  );

  const refused = query.isError && isApiError(query.error, refusal.code);
  // A failed re-read (focus, the Print button) keeps the paper on screen under the error, unless the answer is the
  // refusal; a reprint after one prints nothing (the effect above).
  if (query.isError && (refused || query.data === undefined)) {
    return (
      <div className="flex flex-col items-center gap-4 p-8">
        {refused ? (
          <p className="font-medium" lang="ckb" dir="rtl">
            {tr(refusal.message)}
          </p>
        ) : (
          <QueryErrorState error={query.error} onRetry={() => void query.refetch()} />
        )}
        {toolbar}
      </div>
    );
  }

  return (
    <>
      {/* Inline, so the print rules and the page grey live and die with this tab: imported as a
          stylesheet, the build folds them into the app's CSS and every page wears them. */}
      <style>{receiptStyles}</style>
      {toolbar}
      {query.isError ? (
        // A re-read failed (a Print press, a return to the tab): nothing was printed, and the paper below is the
        // last answer, so say so rather than leave the press unanswered.
        <div className="receipt-toolbar print:hidden">
          <QueryErrorState error={query.error} onRetry={() => void query.refetch()} />
        </div>
      ) : null}
      {query.data !== undefined ? (
        children(query.data, settleLogo)
      ) : (
        <p role="status" className="text-muted-foreground p-8 text-center print:hidden">
          {t('common.loading')}
        </p>
      )}
    </>
  );
}
