import {
  formatMoney,
  formatNumber,
  type CustomerReturnReceiptDto,
  type ReturnReceiptDto,
  type ReturnReceiptLineDto,
  type MoneyReceiptDto,
  type UserRefDto,
} from '@pallet/shared';
import { tr } from './receipt-i18n';
import {
  PaperFooter,
  ReceiptCustomer,
  ReceiptFactory,
  ReceiptOrder,
  ReceiptPage,
  ReceiptPaper,
  ReceiptSheet,
  ReceiptTitle,
} from './receipt-parts';
import { reversedStamp } from './receipt-stamp';

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
  /** A return's pallets, by type (Q167); none on a payment. */
  lines: ReturnReceiptLineDto[];
}

/** How many pallet types a return's half holds beside its money; more give each copy a page of its own (Q167). */
const RETURN_LINES_PER_HALF = 2;

/** What a return took back, a row per pallet type (Q167); the damaged column only when some came back damaged. */
function ReturnLines({ lines }: { lines: ReturnReceiptLineDto[] }) {
  const damaged = lines.some((line) => line.damaged > 0);
  // Pallets beyond what was out, owed to the customer (Q170): a column only when some came back so.
  const extra = lines.some((line) => line.extra > 0);
  return (
    <div className="block-return-lines">
      <table className="lines">
        <thead>
          <tr>
            <th scope="col" className="col-item">
              {tr('receipt.item')}
            </th>
            <th scope="col" className="col-qty">
              {tr('receipt.returnedAccepted')}
            </th>
            {damaged ? (
              <th scope="col" className="col-qty">
                {tr('receipt.returnedDamaged')}
              </th>
            ) : null}
            <th scope="col" className="col-unit">
              {tr('receipt.unitDeposit')}
            </th>
            <th scope="col" className="col-total">
              {tr('receipt.lineTotal')}
            </th>
            {extra ? (
              <th scope="col" className="col-qty">
                {tr('receipt.extra')}
              </th>
            ) : null}
            {/* What the customer still holds of it, over all their orders, as printed (Q169). */}
            <th scope="col" className="col-qty">
              {tr('receipt.outQuantity')}
            </th>
          </tr>
        </thead>
        <tbody>
          {lines.map((line, index) => (
            <tr key={index}>
              <td className="col-item">
                <bdi>{line.itemName}</bdi>
              </td>
              <td className="num num-cell">{formatNumber(line.accepted)}</td>
              {damaged ? <td className="num num-cell">{formatNumber(line.damaged)}</td> : null}
              <td>
                <span className="num">{formatMoney(line.unitDeposit)}</span> {tr('receipt.currency')}
              </td>
              <td>
                <span className="num">{formatMoney(line.total)}</span> {tr('receipt.currency')}
              </td>
              {extra ? <td className="num num-cell">{line.extra > 0 ? formatNumber(line.extra) : ''}</td> : null}
              <td className="num num-cell">{formatNumber(line.withCustomer)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
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

      {paper.lines.length > 0 ? <ReturnLines lines={paper.lines} /> : null}

      <div className={paper.lines.length > 0 ? 'block-money with-lines' : 'block-money'}>
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

      <PaperFooter recordedBy={paper.recordedBy.displayName} printedOn={paper.printedOn} stamp={paper.stamp} />
    </>
  );
}

function MoneySheet({ paper, onLogoSettled }: { paper: MoneyPaper; onLogoSettled?: (() => void) | undefined }) {
  // Too many pallet types for a half: the factory's copy on a page, then the customer's (Q167, as Q150).
  if (paper.lines.length > RETURN_LINES_PER_HALF) {
    return (
      <ReceiptPaper>
        <ReceiptPage>
          <Half paper={paper} onLogoSettled={onLogoSettled} />
        </ReceiptPage>
        <ReceiptPage>
          <Half paper={paper} />
        </ReceiptPage>
      </ReceiptPaper>
    );
  }
  return (
    <ReceiptPaper>
      <ReceiptSheet half={(first) => <Half paper={paper} onLogoSettled={first ? onLogoSettled : undefined} />} />
    </ReceiptPaper>
  );
}

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
        lines: receipt.lines,
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
        lines: receipt.lines,
      }}
    />
  );
}

/**
 * One return's paper (Q166), for a return that paid no cash back: the customer return's design for that return
 * alone, with its order and under its number. Corrected or deleted since, it is stamped.
 */
export function ReturnReceipt({ receipt, onLogoSettled }: { receipt: ReturnReceiptDto; onLogoSettled?: () => void }) {
  return (
    <MoneySheet
      onLogoSettled={onLogoSettled}
      paper={{
        title: tr('receipt.money.refundTitle'),
        numberLabel: tr('receipt.money.returnNumber'),
        number: receipt.receiptNumberDisplay,
        date: receipt.date,
        order: receipt.order,
        owedBefore: receipt.owedBefore,
        credit: receipt.credit,
        amountLabel: tr('receipt.money.refunded'),
        amount: receipt.amount,
        owedAfter: receipt.owedAfter,
        remark: receipt.note,
        recordedBy: receipt.recordedBy,
        printedOn: receipt.printedOn,
        stamp: reversedStamp('receipt.money.reversed', receipt.reversedOn),
        factory: receipt.factory,
        customer: receipt.customer,
        lines: receipt.lines,
      }}
    />
  );
}
