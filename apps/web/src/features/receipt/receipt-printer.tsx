import { lazy, Suspense, useEffect, useSyncExternalStore } from 'react';
import { clearPrintJob, currentJob, subscribe } from './print-receipt';

// The receipts' components and CSS load with the first print, not with every page of the app.
const PrintJob = lazy(() => import('./print-job').then((module) => ({ default: module.PrintJob })));

/**
 * Prints the receipts the app's buttons ask for without leaving the page (Q140), mounted once in the app's layout.
 * The receipt is read with this page's own session, drawn by the same components as the receipt routes into a blank
 * frame that is never seen, and printed from that frame — so the print dialog opens over the page the user is on and
 * shows the receipt's paper alone, styled as on its own page. Leaving the app (a sign-out) forgets the last print, so
 * the next session never prints it again.
 */
export function ReceiptPrinter() {
  const job = useSyncExternalStore(subscribe, currentJob);
  useEffect(() => clearPrintJob, []);
  return job ? (
    <Suspense fallback={null}>
      <PrintJob key={job.seq} job={job} />
    </Suspense>
  ) : null;
}
