import { formatNumber, type HandBackReceiptDto } from '@pallet/shared';
import { tr } from './receipt-i18n';
import {
  PaperFooter,
  ReceiptCustomer,
  ReceiptFactory,
  ReceiptPaper,
  ReceiptSheet,
  ReceiptTitle,
} from './receipt-parts';
import { reversedStamp } from './receipt-stamp';

/** One copy of a give-back's paper (Q172): the factory, the customer, the pallets, what was owed before and after. */
function Half({ receipt, onLogoSettled }: { receipt: HandBackReceiptDto; onLogoSettled?: (() => void) | undefined }) {
  return (
    <>
      <div className="block-header">
        <ReceiptFactory factory={receipt.factory} onLogoSettled={onLogoSettled} />
        <ReceiptTitle
          title={tr('receipt.handBack.title')}
          numbered={{ label: tr('receipt.handBack.number'), number: receipt.receiptNumberDisplay }}
          date={receipt.date}
        />
      </div>

      <div className="block-parties">
        <ReceiptCustomer customer={receipt.customer} />
      </div>

      <div className="block-return-lines">
        <table className="lines">
          <thead>
            <tr>
              <th scope="col" className="col-item">
                {tr('receipt.item')}
              </th>
              <th scope="col" className="col-qty">
                {tr('receipt.handBack.owedBefore')}
              </th>
              <th scope="col" className="col-qty">
                {tr('receipt.handBack.givenBack')}
              </th>
              <th scope="col" className="col-qty">
                {tr('receipt.handBack.owedAfter')}
              </th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td className="col-item">
                <bdi>{receipt.itemName}</bdi>
              </td>
              <td className="num num-cell">{formatNumber(receipt.owedBefore)}</td>
              <td className="num num-cell">
                <strong>{formatNumber(receipt.quantity)}</strong>
              </td>
              <td className="num num-cell">{formatNumber(receipt.owedAfter)}</td>
            </tr>
          </tbody>
        </table>
        {receipt.note ? (
          <div className="clamp" style={{ marginTop: '2mm' }}>
            {/* The note isolated in its own direction, so a Latin note keeps its order beside the label. */}
            {tr('receipt.money.note')}: <bdi dir="auto">{receipt.note}</bdi>
          </div>
        ) : null}
      </div>

      <PaperFooter
        recordedBy={receipt.recordedBy.displayName}
        printedOn={receipt.printedOn}
        stamp={reversedStamp('receipt.handBack.undone', receipt.reversedOn)}
      />
    </>
  );
}

/**
 * Pallets the factory owed, given back (Q172): one A4 sheet printing the paper twice — the factory's copy and the
 * customer's, who signs for the pallets — as the other papers do. No money moves, so it has no money figures.
 */
export function HandBackReceipt({
  receipt,
  onLogoSettled,
}: {
  receipt: HandBackReceiptDto;
  onLogoSettled?: () => void;
}) {
  return (
    <ReceiptPaper>
      <ReceiptSheet half={(first) => <Half receipt={receipt} onLogoSettled={first ? onLogoSettled : undefined} />} />
    </ReceiptPaper>
  );
}
