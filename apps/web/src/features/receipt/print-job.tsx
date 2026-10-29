import type {
  CustomerReturnReceiptDto,
  HandBackReceiptDto,
  MoneyReceiptDto,
  ReceiptDto,
  ReturnReceiptDto,
  TransactionsReceiptDto,
} from '@pallet/shared';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import receiptStyles from '@/features/receipt/receipt.css?inline';
import { handleApiError } from '@/lib/errors';
import {
  customerReturnReceiptQuery,
  handBackReceiptQuery,
  moneyReceiptQuery,
  orderReceiptQuery,
  returnReceiptQuery,
  transactionsReceiptQuery,
} from './api';
import { fontsSettled, useLogoGate, usePrintOnce } from './auto-print';
import { HandBackReceipt } from './hand-back-receipt';
import { CustomerReturnReceipt, MoneyReceipt, ReturnReceipt } from './money-receipt';
import { finishPrintJob, type Job } from './print-receipt';
import { Receipt } from './receipt';
import { TransactionsReceipt } from './transactions-receipt';

type Paper =
  | { kind: 'order'; data: ReceiptDto }
  | { kind: 'money'; data: MoneyReceiptDto }
  | { kind: 'customer-return'; data: CustomerReturnReceiptDto }
  | { kind: 'return'; data: ReturnReceiptDto }
  | { kind: 'hand-back'; data: HandBackReceiptDto }
  | { kind: 'transactions'; data: TransactionsReceiptDto };

/**
 * The receipt a job asks for, read afresh with the page's own session. No retries: a press is answered at once, never
 * by a print dialog that opens seconds later on whatever page the user has moved to.
 */
function readPaper(queryClient: QueryClient, job: Job): Promise<Paper> {
  switch (job.kind) {
    case 'order':
      return queryClient
        .fetchQuery({ ...orderReceiptQuery(job.orderId), retry: false })
        .then((data) => ({ kind: 'order', data }));
    case 'money':
      return queryClient
        .fetchQuery({ ...moneyReceiptQuery(job.entryId), retry: false })
        .then((data) => ({ kind: 'money', data }));
    case 'customer-return':
      return queryClient
        .fetchQuery({ ...customerReturnReceiptQuery(job.customerReturnId), retry: false })
        .then((data) => ({ kind: 'customer-return', data }));
    case 'return':
      return queryClient
        .fetchQuery({ ...returnReceiptQuery(job.returnId), retry: false })
        .then((data) => ({ kind: 'return', data }));
    case 'hand-back':
      return queryClient
        .fetchQuery({ ...handBackReceiptQuery(job.palletCreditId), retry: false })
        .then((data) => ({ kind: 'hand-back', data }));
    case 'transactions':
      return queryClient
        .fetchQuery({ ...transactionsReceiptQuery(job.orderId), retry: false })
        .then((data) => ({ kind: 'transactions', data }));
  }
}

/** The same components the receipt routes draw. */
function drawPaper(paper: Paper, onLogoSettled: () => void): ReactNode {
  switch (paper.kind) {
    case 'order':
      return <Receipt receipt={paper.data} onLogoSettled={onLogoSettled} />;
    case 'money':
      return <MoneyReceipt receipt={paper.data} onLogoSettled={onLogoSettled} />;
    case 'customer-return':
      return <CustomerReturnReceipt receipt={paper.data} onLogoSettled={onLogoSettled} />;
    case 'return':
      return <ReturnReceipt receipt={paper.data} onLogoSettled={onLogoSettled} />;
    case 'hand-back':
      return <HandBackReceipt receipt={paper.data} onLogoSettled={onLogoSettled} />;
    case 'transactions':
      return <TransactionsReceipt receipt={paper.data} onLogoSettled={onLogoSettled} />;
  }
}

/**
 * One press of a print button (Q140): the read, then the paper in its frame. The press showed the notice; the print,
 * or a failure, closes it (Q180).
 */
export function PrintJob({ job }: { job: Job }) {
  const queryClient = useQueryClient();
  const [paper, setPaper] = useState<Paper | null>(null);

  useEffect(() => {
    let live = true;
    readPaper(queryClient, job).then(
      (next) => {
        if (live) setPaper(next);
      },
      (error: unknown) => {
        if (!live) return;
        finishPrintJob(job.seq);
        // Said on the page the user is on, as any other failure: a cancelled order, a reversal row, a lost connection.
        handleApiError(error);
      },
    );
    return () => {
      live = false;
    };
  }, [job, queryClient]);

  const printing = useCallback(() => finishPrintJob(job.seq), [job.seq]);

  return paper ? (
    <PrintFrame hasLogo={paper.data.factory.logoUrl !== null} onPrint={printing}>
      {(onLogoSettled) => drawPaper(paper, onLogoSettled)}
    </PrintFrame>
  ) : null;
}

/** A blank document, its own origin's (`srcdoc`), resolving addresses (the logo, the stylesheets) against the page's. */
const BLANK = '<!doctype html><html lang="ckb" dir="rtl"><head><meta charset="utf-8"></head><body></body></html>';

/** Laid out at A4 (a frame that is not laid out may not print) but never seen or pressed. */
const FRAME_STYLE: CSSProperties = {
  position: 'fixed',
  top: 0,
  insetInlineStart: 0,
  width: '210mm',
  height: '297mm',
  border: 0,
  opacity: 0,
  pointerEvents: 'none',
  zIndex: -1,
};

/**
 * WebKit alone (Safari, and every browser on an iPhone or iPad, whose engine it is): Blink's user agent also names
 * AppleWebKit, so it is told apart by its own engine names. iOS Chrome and Firefox say `CriOS` and `FxiOS`, not these.
 */
const WEBKIT = /AppleWebKit/.test(navigator.userAgent) && !/(Chrome|Chromium|Edg|OPR)\//.test(navigator.userAgent);

/**
 * Prints the frame's document alone. WebKit's `print()` on a frame may print the whole page around it; its `print`
 * command prints the frame. Elsewhere `print()` does (Blink answers the command too, but by its own path).
 */
function printFrame(view: Window): void {
  // Deprecated, but the only way WebKit prints a frame's own document.
  if (WEBKIT && view.document.execCommand('print', false)) return;
  view.print();
}

interface FrameDocument {
  view: Window;
  doc: Document;
  /** Settles when the copied stylesheets have loaded (or failed). */
  styled: Promise<void>;
}

/**
 * A blank frame carrying the app's stylesheets (its fonts) and the receipt CSS, with `children` drawn into it. It
 * prints once its styles, the logo and the fonts are ready (§7.16.1) and stays until the next print or the end of the
 * session: on a phone the print sheet may still be reading it after `print()` has returned. It holds a static paper,
 * nothing else: no second copy of the app runs in it. Kept out of the page's own prints (`print:hidden`).
 */
function PrintFrame({
  hasLogo,
  onPrint,
  children,
}: {
  hasLogo: boolean;
  onPrint: () => void;
  children: (onLogoSettled: () => void) => ReactNode;
}) {
  const [frame, setFrame] = useState<FrameDocument | null>(null);
  const { logoReady, onLogoSettled } = useLogoGate(hasLogo);

  // Each load of the frame is set up afresh: a browser may load the initial blank document before `srcdoc`'s.
  const setUp = (element: HTMLIFrameElement): void => {
    const view = element.contentWindow;
    const doc = element.contentDocument;
    if (!view || !doc || frame?.doc === doc) return;
    doc.title = document.title;
    const loads: Promise<void>[] = [];
    for (const node of document.head.querySelectorAll('link[rel="stylesheet"], style')) {
      const copy = doc.importNode(node, true);
      if (copy instanceof Element && copy.tagName === 'LINK') {
        loads.push(
          new Promise((resolve) => {
            copy.addEventListener('load', () => resolve(), { once: true });
            copy.addEventListener('error', () => resolve(), { once: true });
          }),
        );
      }
      doc.head.append(copy);
    }
    const receiptCss = doc.createElement('style');
    receiptCss.textContent = receiptStyles;
    doc.head.append(receiptCss);
    setFrame({ view, doc, styled: Promise.all(loads).then(() => undefined) });
  };

  usePrintOnce(
    frame !== null && logoReady,
    useCallback(async () => {
      if (!frame) return;
      await frame.styled;
      await fontsSettled(frame.doc);
      onPrint();
      printFrame(frame.view);
    }, [frame, onPrint]),
  );

  return (
    <>
      <iframe
        srcDoc={BLANK}
        title=""
        tabIndex={-1}
        aria-hidden
        data-receipt-frame=""
        className="print:hidden"
        style={FRAME_STYLE}
        onLoad={(event) => setUp(event.currentTarget)}
      />
      {frame ? createPortal(children(onLogoSettled), frame.doc.body) : null}
    </>
  );
}
