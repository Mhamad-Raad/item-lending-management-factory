import type { ReceiptDto } from '@pallet/shared';
import { useQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { Printer, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { QueryErrorState } from '@/components/app/states';
import { Button } from '@/components/ui/button';
import { Receipt } from '@/features/receipt/receipt';
import receiptStyles from '@/features/receipt/receipt.css?inline';
import { usePageTitle } from '@/hooks/use-page-title';
import { apiFetch } from '@/lib/api-client';
import { ApiError } from '@/lib/api-error';
import { qk } from '@/lib/query-keys';
import { requirePermission } from '@/lib/route-guards';

export const Route = createFileRoute('/_print/print/orders/$orderId')({
  beforeLoad: () => requirePermission('orders.view'),
  component: ReceiptPage,
});

/**
 * The receipt's own tab (§7.16.1). It prints itself once, when the data, the fonts and the logo are
 * ready — a receipt printed before its font loads comes out in the wrong script width.
 */
function ReceiptPage() {
  const { t } = useTranslation();
  const { orderId } = Route.useParams();
  usePageTitle('receipt.pageTitle');
  const receipt = useQuery({
    queryKey: qk.orders.receipt(Number(orderId)),
    queryFn: () => apiFetch<ReceiptDto>(`/orders/${orderId}/receipt`),
  });
  const printed = useRef(false);
  const [logoSettled, setLogoSettled] = useState(false);
  const settleLogo = useCallback(() => setLogoSettled(true), []);

  const ready = receipt.data !== undefined && (receipt.data.factory.logoUrl === null || logoSettled);
  useEffect(() => {
    if (!ready || printed.current) return;
    printed.current = true;
    void document.fonts.ready.then(() => window.print());
  }, [ready]);

  const toolbar = (
    <div className="receipt-toolbar flex justify-center gap-2 p-4 print:hidden">
      <Button onClick={() => window.print()} disabled={!receipt.data}>
        <Printer aria-hidden />
        {t('receipt.print')}
      </Button>
      <Button variant="outline" onClick={() => window.close()}>
        <X aria-hidden />
        {t('common.actions.close')}
      </Button>
    </div>
  );

  if (receipt.isError) {
    const cancelled = receipt.error instanceof ApiError && receipt.error.code === 'ORDER_CANCELLED';
    return (
      <div className="flex flex-col items-center gap-4 p-8">
        {cancelled ? (
          <p className="font-medium" lang="ckb" dir="rtl">
            {t('receipt.cancelledError', { lng: 'ckb' })}
          </p>
        ) : (
          <QueryErrorState error={receipt.error} onRetry={() => void receipt.refetch()} />
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
      {receipt.data ? <Receipt receipt={receipt.data} onLogoSettled={settleLogo} /> : null}
    </>
  );
}
