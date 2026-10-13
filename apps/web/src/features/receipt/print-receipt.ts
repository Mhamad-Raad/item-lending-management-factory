/**
 * What the app's print buttons ask for (Q140): the receipt to print in place, drawn by `ReceiptPrinter` (mounted once
 * in the app's layout). Call from a press.
 */

type JobRequest = { kind: 'order' | 'transactions'; orderId: number } | { kind: 'money'; entryId: number };
/** `seq` tells two presses for the same receipt apart: each one prints. */
export type Job = JobRequest & { seq: number };

// The one print asked for last; a press while another is being prepared replaces it.
let current: Job | null = null;
let seq = 0;
const listeners = new Set<() => void>();

function start(request: JobRequest): void {
  seq += 1;
  current = { ...request, seq };
  for (const listener of listeners) listener();
}

/** Forgets the last print: the layout that draws it is leaving (a sign-out), and the next must not print it again. */
export function clearPrintJob(): void {
  if (current === null) return;
  current = null;
  for (const listener of listeners) listener();
}

export function currentJob(): Job | null {
  return current;
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The hand-over receipt of an order (§7.16), printed in place (Q140). */
export function printOrderReceipt(orderId: number): void {
  start({ kind: 'order', orderId });
}

/** The receipt of a payment or a refund (§7.16.6), printed in place (Q140). */
export function printMoneyReceipt(entryId: number): void {
  start({ kind: 'money', entryId });
}

/** Every payment and refund of an order on one paper (§7.16.7, Q139), printed in place (Q140). */
export function printTransactionsReceipt(orderId: number): void {
  start({ kind: 'transactions', orderId });
}
