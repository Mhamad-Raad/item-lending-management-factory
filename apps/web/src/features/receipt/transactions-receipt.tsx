import {
  formatBusinessDate,
  formatMoney,
  type TransactionsReceiptDto,
  type TransactionsReceiptSheetDto,
} from '@pallet/shared';
import { isolate } from '@/lib/bidi';
import { tr } from './receipt-i18n';
import {
  NumberCell,
  ReceiptCustomer,
  ReceiptFactory,
  ReceiptOrder,
  ReceiptPaper,
  ReceiptSheet,
  ReceiptTitle,
} from './receipt-parts';

/** What the amount column holds at the receipt's 10 pt (`NumberCell`), as the hand-over receipt's line total. */
const AMOUNT_FITS = 11;

function Total({ label, value, strong = false }: { label: string; value: number; strong?: boolean }) {
  return (
    <span style={strong ? { fontSize: '11pt', fontWeight: 700 } : { fontWeight: 600 }}>
      {label}: <span className="num">{formatMoney(value)}</span> {tr('receipt.currency')}
    </span>
  );
}

function Half({
  receipt,
  sheet,
  onLogoSettled,
}: {
  receipt: TransactionsReceiptDto;
  sheet: TransactionsReceiptSheetDto;
  onLogoSettled?: () => void;
}) {
  const rows = Array.from({ length: receipt.rowsPerHalf }, (_, index) => sheet.rows[index] ?? null);
  const firstNumber = (sheet.sheetNumber - 1) * receipt.rowsPerHalf + 1;
  const { factory, customer, order } = receipt;

  return (
    <>
      <div className="block-header">
        <ReceiptFactory factory={factory} onLogoSettled={onLogoSettled} />
        {/* No number of its own: it is the order's, in the box below, and its date is the day it was printed. */}
        <ReceiptTitle title={tr('receipt.transactions.title')} date={receipt.printedOn} />
      </div>

      <div className="block-parties">
        <ReceiptCustomer customer={customer} />
        <ReceiptOrder order={order} />
      </div>

      <div className="block-lines">
        <table className="lines">
          <thead>
            <tr>
              <th scope="col" className="col-no">
                #
              </th>
              <th scope="col" className="col-date">
                {tr('receipt.date')}
              </th>
              <th scope="col" className="col-receipt">
                {tr('receipt.transactions.receiptNumber')}
              </th>
              <th scope="col">{tr('receipt.transactions.type')}</th>
              <th scope="col" className="col-amount">
                {tr('receipt.transactions.amount')}
              </th>
              <th scope="col" className="col-status">
                {tr('receipt.transactions.status')}
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={index} className={row?.reversedOn ? 'reversed' : undefined}>
                <td className="num num-cell">{row ? firstNumber + index : ''}</td>
                <td className="num num-cell">{row ? formatBusinessDate(row.date) : ''}</td>
                <td className="num num-cell">{row?.receiptNumberDisplay ?? ''}</td>
                <td className="clamp">{row ? tr(`enums.ledgerEntryType.${row.kind}`) : ''}</td>
                <NumberCell text={row && formatMoney(row.amount)} fits={AMOUNT_FITS} className="amount" />
                {/* A reversed row stays on the paper, so the history is whole, but counts in no total (Q139). */}
                <td className="status clamp">
                  {row?.reversedOn
                    ? tr('receipt.money.reversed', { date: isolate(formatBusinessDate(row.reversedOn)) })
                    : ''}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="block-footer">
        {sheet.showTotal ? (
          <>
            <div style={{ display: 'flex', gap: '6mm' }}>
              <Total label={tr('receipt.transactions.received')} value={receipt.received} />
              <Total label={tr('receipt.transactions.refunded')} value={receipt.refunded} />
            </div>
            <Total label={tr('receipt.transactions.owed')} value={receipt.owed} strong />
          </>
        ) : (
          <div style={{ fontSize: '9pt', fontStyle: 'italic' }}>{tr('receipt.continued')}</div>
        )}
        <div style={{ fontSize: '8.5pt', textAlign: 'end' }}>
          {tr('receipt.sheetOf', { x: sheet.sheetNumber, y: sheet.sheetCount })}
        </div>
      </div>
    </>
  );
}

/**
 * Every payment and refund of an order (Q139): six rows to a half like the hand-over receipt's lines, each A4
 * sheet printing its rows twice — the factory's copy and the customer's — and the totals on the last sheet.
 */
export function TransactionsReceipt({
  receipt,
  onLogoSettled,
}: {
  receipt: TransactionsReceiptDto;
  onLogoSettled?: () => void;
}) {
  return (
    <ReceiptPaper>
      {receipt.sheets.map((sheet) => (
        <ReceiptSheet
          key={sheet.sheetNumber}
          half={(first) => (
            <Half
              receipt={receipt}
              sheet={sheet}
              onLogoSettled={first && sheet.sheetNumber === 1 ? onLogoSettled : undefined}
            />
          )}
        />
      ))}
    </ReceiptPaper>
  );
}
