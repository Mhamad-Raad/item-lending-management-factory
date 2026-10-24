import {
  formatBusinessDate,
  formatMoney,
  type CustomerReturnReceiptDto,
  type MoneyReceiptDto,
  type UserRefDto,
} from '@pallet/shared';
import { isolate } from '@/lib/bidi';
import { tr } from './receipt-i18n';
import {
  ReceiptCustomer,
  ReceiptFactory,
  ReceiptOrder,
  ReceiptPaper,
  ReceiptSheet,
  ReceiptTitle,
} from './receipt-parts';

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

/** What one half of a money receipt prints: a payment's or a refund's (Q137), or a customer return's (Q161). */
interface MoneyPaper {
  title: string;
  numberLabel: string;
  number: string;
  date: string;
  /** The order the money moved on; none on a customer return's, which is over several. */
  order: { orderNumberDisplay: string; date: string } | null;
  owedBefore: number | null;
  credit: number | null;
  amountLabel: string;
  amount: number;
  owedAfter: number | null;
  remark: string | null;
  recordedBy: UserRefDto;
  printedOn: string;
  /** The red stamp of a reversal, or null while the money stands. */
  stamp: string | null;
  factory: MoneyReceiptDto['factory'];
  customer: MoneyReceiptDto['customer'];
}

function Half({ paper, onLogoSettled }: { paper: MoneyPaper; onLogoSettled?: () => void }) {
  return (
    <>
      <div className="block-header">
        <ReceiptFactory factory={paper.factory} onLogoSettled={onLogoSettled} />
        {/* Not the hand-over receipt's number label: the numberings overlap, and each paper must say which. */}
        <ReceiptTitle
          title={paper.title}
          numbered={{ label: paper.numberLabel, number: paper.number }}
          date={paper.date}
        />
      </div>

      <div className="block-parties">
        <ReceiptCustomer customer={paper.customer} />
        {paper.order ? <ReceiptOrder order={paper.order} /> : null}
      </div>

      <div className="block-money">
        {/* The balance when the money moved, not today's: a reprint says what the original said (Q137). */}
        <table className="money">
          <tbody>
            {paper.owedBefore !== null ? (
              <MoneyRow label={tr('receipt.money.owedBefore')} value={paper.owedBefore} />
            ) : null}
            {paper.credit !== null ? <MoneyRow label={tr('receipt.money.credit')} value={paper.credit} /> : null}
            <MoneyRow label={paper.amountLabel} value={paper.amount} strong />
            {paper.owedAfter !== null ? (
              <MoneyRow label={tr('receipt.money.owedAfter')} value={paper.owedAfter} />
            ) : null}
            {paper.remark !== null ? (
              <tr>
                <th scope="row">{tr('receipt.money.note')}</th>
                {/* Its own direction, so a Latin note is clipped at its end, not its start. */}
                <td className="text clamp" dir="auto">
                  {paper.remark}
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      <div className="block-footer money-footer">
        <div className="footer-lines">
          <div className="clamp">
            {tr('receipt.money.recordedBy')}: <bdi>{paper.recordedBy.displayName}</bdi>
          </div>
          <div style={{ fontSize: '8.5pt' }}>
            {tr('receipt.printedOn')}: <span className="num">{formatBusinessDate(paper.printedOn)}</span>
          </div>
        </div>
        {/* A deleted payment or a reversed refund still prints, so history can be shown, but never as valid money. */}
        {paper.stamp !== null ? <div className="stamp">{paper.stamp}</div> : null}
      </div>
    </>
  );
}

function MoneySheet({ paper, onLogoSettled }: { paper: MoneyPaper; onLogoSettled?: (() => void) | undefined }) {
  return (
    <ReceiptPaper>
      <ReceiptSheet half={(first) => <Half paper={paper} onLogoSettled={first ? onLogoSettled : undefined} />} />
    </ReceiptPaper>
  );
}

const reversedStamp = (key: 'receipt.money.reversed' | 'receipt.money.partlyReversed', day: string | null) =>
  day === null ? null : tr(key, { date: isolate(formatBusinessDate(day)) });

/**
 * The receipt of one payment or refund (Q137): one A4 sheet printing it twice — the factory's copy and the
 * customer's — above and below a dashed cut line, as the hand-over receipt does.
 */
export function MoneyReceipt({ receipt, onLogoSettled }: { receipt: MoneyReceiptDto; onLogoSettled?: () => void }) {
  const isPayment = receipt.kind === 'PAYMENT';
  return (
    <MoneySheet
      onLogoSettled={onLogoSettled}
      paper={{
        title: tr(isPayment ? 'receipt.money.paymentTitle' : 'receipt.money.refundTitle'),
        numberLabel: tr('receipt.money.receiptNumber'),
        number: receipt.receiptNumberDisplay,
        date: receipt.date,
        order: receipt.order,
        owedBefore: receipt.owedBefore,
        credit: receipt.credit,
        amountLabel: tr(isPayment ? 'receipt.money.received' : 'receipt.money.refunded'),
        amount: receipt.amount,
        owedAfter: receipt.owedAfter,
        // What the paper says beside the money: the payment's note, or that it was taken at the hand-over.
        // A line edit's re-issued payment was not taken at the hand-over, so only the hand-over's own says so.
        remark: receipt.note ?? (receipt.source === 'ORDER_CREATE' ? tr('receipt.money.atHandover') : null),
        recordedBy: receipt.recordedBy,
        printedOn: receipt.printedOn,
        stamp: reversedStamp('receipt.money.reversed', receipt.reversedOn),
        factory: receipt.factory,
        customer: receipt.customer,
      }}
    />
  );
}

/**
 * A customer return's one paper over the orders it touched (Q161): the refund receipt's design and figures, summed,
 * without an order and under a number of its own. A return of it corrected since stamps it, as partly unless all were.
 */
export function CustomerReturnReceipt({
  receipt,
  onLogoSettled,
}: {
  receipt: CustomerReturnReceiptDto;
  onLogoSettled?: () => void;
}) {
  return (
    <MoneySheet
      onLogoSettled={onLogoSettled}
      paper={{
        title: tr('receipt.money.refundTitle'),
        numberLabel: tr('receipt.money.customerReceiptNumber'),
        number: receipt.receiptNumberDisplay,
        date: receipt.date,
        order: null,
        owedBefore: receipt.owedBefore,
        credit: receipt.credit,
        amountLabel: tr('receipt.money.refunded'),
        amount: receipt.amount,
        owedAfter: receipt.owedAfter,
        remark: receipt.note,
        recordedBy: receipt.recordedBy,
        printedOn: receipt.printedOn,
        stamp: reversedStamp(
          receipt.allReversed ? 'receipt.money.reversed' : 'receipt.money.partlyReversed',
          receipt.reversedOn,
        ),
        factory: receipt.factory,
        customer: receipt.customer,
      }}
    />
  );
}
