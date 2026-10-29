import { useSyncExternalStore } from 'react';
import { toast } from 'sonner';
import i18n from '@/i18n';

/**
 * What the app's print buttons ask for (Q140): the receipt to print in place, drawn by `ReceiptPrinter` (mounted once
 * in the app's layout). Call from a press.
 */

export type JobRequest =
  | { kind: 'order' | 'transactions'; orderId: number }
  | { kind: 'money'; entryId: number }
  | { kind: 'customer-return'; customerReturnId: number }
  | { kind: 'return'; returnId: number }
  | { kind: 'hand-back'; palletCreditId: number };

/** `seq` tells two presses for the same receipt apart: each one prints. */
export type Job = JobRequest & { seq: number };

// The one print asked for last; a press while another is being prepared replaces it — the same receipt's code and
// read, still on their way, are shared, not fetched again.
let current: Job | null = null;
// `current` while it is being read and drawn — not yet printed, nor failed —, for its button's spinner (Q180).
let preparing: Job | null = null;
// The "preparing" notice (Q180): shown at the press, closed when it prints, fails or the app is left. One while a print
// is being prepared, kept steady through presses again; a new one after, so it never merges into the last one's closing.
let notice: string | null = null;
let seq = 0;
const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) listener();
}

function closeNotice(): void {
  if (notice !== null) toast.dismiss(notice);
  notice = null;
}

/** Prints `request` in place (Q140): what every print button presses (`PrintButton`). Call from a press. */
export function printRequest(request: JobRequest): void {
  seq += 1;
  current = { ...request, seq };
  preparing = current;
  // The notice at once, before the receipt's code and the receipt arrive (Q180).
  notice ??= `receipt-preparing-${seq}`;
  toast.loading(i18n.t('receipt.preparing'), { id: notice });
  notify();
}

/** The job `seq` has printed, or failed: its notice and spinner end, unless a later press is still being prepared. */
export function finishPrintJob(jobSeq: number): void {
  if (preparing?.seq !== jobSeq) return;
  closeNotice();
  preparing = null;
  notify();
}

/** Forgets the last print: the layout that draws it is leaving (a sign-out), and the next must not print it again. */
export function clearPrintJob(): void {
  closeNotice();
  if (current === null) return;
  current = null;
  preparing = null;
  notify();
}

/** One string per receipt: two requests for the same receipt give the same. */
function receiptKey(request: JobRequest): string {
  switch (request.kind) {
    case 'order':
    case 'transactions':
      return `${request.kind}:${request.orderId}`;
    case 'money':
      return `money:${request.entryId}`;
    case 'customer-return':
      return `customer-return:${request.customerReturnId}`;
    case 'return':
      return `return:${request.returnId}`;
    case 'hand-back':
      return `hand-back:${request.palletCreditId}`;
  }
}

function isPreparing(request: JobRequest): boolean {
  return preparing !== null && receiptKey(preparing) === receiptKey(request);
}

/**
 * Whether `request` is the receipt being prepared: the buttons that print it show a spinner (Q180), and stay
 * pressable. A yes or no, so a press re-draws only the icons whose answer changes.
 */
export function usePrintPreparing(request: JobRequest): boolean {
  return useSyncExternalStore(subscribe, () => isPreparing(request));
}

export function currentJob(): Job | null {
  return current;
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * What a return's own receipt is (Q166), the one rule of every place that prints it: its refund's money receipt when
 * it paid cash back (Q137), else its own paper in the same design.
 */
export function returnPaper(returnId: number, refundEntryId: number | null): JobRequest {
  return refundEntryId === null ? { kind: 'return', returnId } : { kind: 'money', entryId: refundEntryId };
}
