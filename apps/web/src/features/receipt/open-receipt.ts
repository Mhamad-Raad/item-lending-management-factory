/** A receipt's tab prints itself (§7.16.1). A tab opens only from a press: call these from a click. */
function openReceiptTab(path: string): void {
  window.open(path, '_blank', 'noopener');
}

/** The hand-over receipt of an order (§7.16). */
export function openOrderReceipt(orderId: number): void {
  openReceiptTab(`/print/orders/${orderId}`);
}

/** The receipt of a payment or a refund (§7.16.6). */
export function openMoneyReceipt(entryId: number): void {
  openReceiptTab(`/print/ledger/${entryId}`);
}
