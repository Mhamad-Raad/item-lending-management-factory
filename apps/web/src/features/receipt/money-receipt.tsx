import { formatBusinessDate, formatMoney, type MoneyReceiptDto } from '@pallet/shared';
import { isolate } from '@/lib/bidi';
import { tr } from './receipt-i18n';
import { ReceiptCustomer, ReceiptFactory, ReceiptPaper, ReceiptSheet, ReceiptTitle } from './receipt-parts';

function MoneyRow({ label, value, strong = false }: { label: string; value: number; strong?: boolean }) {
  return (
    <tr className={strong ? 'key' : undefined}>
      <th scope="row">{label}</th>
      <td>
        <span className="num">{formatMoney(value)}</span> {tr('receipt.currency')}
      </td>
    </tr>
  );
}

function Half({ receipt, onLogoSettled }: { receipt: MoneyReceiptDto; onLogoSettled?: () => void }) {
  const { factory, customer, order } = receipt;
  const isPayment = receipt.kind === 'PAYMENT';
  // What the paper says beside the money: the payment's note, or that it was taken at the hand-over.
  // A line edit's re-issued payment was not taken at the hand-over, so only the hand-over's own says so.
  const remark = receipt.note ?? (receipt.source === 'ORDER_CREATE' ? tr('receipt.money.atHandover') : null);

  return (
    <>
      <div className="block-header">
        <ReceiptFactory factory={factory} onLogoSettled={onLogoSettled} />
        {/* Not the hand-over receipt's number label: the two numberings overlap, and each paper must say which. */}
        <ReceiptTitle
          title={tr(isPayment ? 'receipt.money.paymentTitle' : 'receipt.money.refundTitle')}
          numberLabel={tr('receipt.money.receiptNumber')}
          number={receipt.receiptNumberDisplay}
          date={receipt.date}
        />
      </div>

      <div className="block-parties">
        <ReceiptCustomer customer={customer} />
        <div>
          <div className="box-title">{tr('receipt.money.order')}</div>
          <div>
            {tr('receipt.money.orderNumber')}: <span className="num">{order.orderNumberDisplay}</span>
          </div>
          <div>
            {tr('receipt.money.orderDate')}: <span className="num">{formatBusinessDate(order.date)}</span>
          </div>
        </div>
      </div>

      <div className="block-money">
        {/* The order's balance when the money moved, not today's: a reprint says what the original said (Q137). */}
        <table className="money">
          <tbody>
            {receipt.owedBefore !== null ? (
              <MoneyRow label={tr('receipt.money.owedBefore')} value={receipt.owedBefore} />
            ) : null}
            {receipt.credit !== null ? <MoneyRow label={tr('receipt.money.credit')} value={receipt.credit} /> : null}
            <MoneyRow
              label={tr(isPayment ? 'receipt.money.received' : 'receipt.money.refunded')}
              value={receipt.amount}
              strong
            />
            {receipt.owedAfter !== null ? (
              <MoneyRow label={tr('receipt.money.owedAfter')} value={receipt.owedAfter} />
            ) : null}
            {remark !== null ? (
              <tr>
                <th scope="row">{tr('receipt.money.note')}</th>
                {/* Its own direction, so a Latin note is clipped at its end, not its start. */}
                <td className="text clamp" dir="auto">
                  {remark}
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      <div className="block-footer money-footer">
        <div className="footer-lines">
          <div className="clamp">
            {tr('receipt.money.recordedBy')}: <bdi>{receipt.recordedBy.displayName}</bdi>
          </div>
          <div style={{ fontSize: '8.5pt' }}>
            {tr('receipt.printedOn')}: <span className="num">{formatBusinessDate(receipt.printedOn)}</span>
          </div>
        </div>
        {receipt.reversedOn !== null ? (
          // A deleted payment or a reversed refund still prints, so history can be shown, but never as valid money.
          <div className="stamp">
            {tr('receipt.money.reversed', { date: isolate(formatBusinessDate(receipt.reversedOn)) })}
          </div>
        ) : null}
      </div>
    </>
  );
}

/**
 * The receipt of one payment or refund (Q137): one A4 sheet printing it twice — the factory's copy and the
 * customer's — above and below a dashed cut line, as the hand-over receipt does.
 */
export function MoneyReceipt({ receipt, onLogoSettled }: { receipt: MoneyReceiptDto; onLogoSettled?: () => void }) {
  return (
    <ReceiptPaper>
      <ReceiptSheet half={(first) => <Half receipt={receipt} onLogoSettled={first ? onLogoSettled : undefined} />} />
    </ReceiptPaper>
  );
}
