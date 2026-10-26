import {
  formatBusinessDate,
  formatMoney,
  formatNumber,
  type ReceiptDto,
  type ReceiptRowDto,
  type ReceiptSheetDto,
} from '@pallet/shared';
import { tr } from './receipt-i18n';
import {
  NumberCell,
  ReceiptCustomer,
  ReceiptFactory,
  ReceiptPage,
  ReceiptPaper,
  ReceiptSheet,
  ReceiptTitle,
} from './receipt-parts';

/** How many characters each numeric column holds at the receipt's 10 pt (§7.16.3; `NumberCell`). */
const FITS = { quantity: 7, unitDeposit: 9, lineTotal: 11 } as const;

/**
 * One row of the footer's totals, in dinars (§7.16.3, Q150): `order` this order's deposit, `older` the earlier
 * pallets', `grand` the figure the receipt ends on (Q151).
 */
function Total({ label, amount, kind }: { label: string; amount: number; kind: 'order' | 'older' | 'grand' }) {
  return (
    <div className={`sum sum-${kind}`}>
      <span>{label}: </span>
      <span>
        <span className="num">{formatMoney(amount)}</span> {tr('receipt.currency')}
      </span>
    </div>
  );
}

/**
 * A row of the table: one of this order's lines, the heading over what the customer still holds of earlier orders, or
 * one of those (Q150). An earlier row is an item at one price over all the earlier orders and shows only what is
 * still out (Q158): its name takes the quantity, accepted and damaged cells, which say nothing of it, and its total
 * column is what of it is still out. A row past the last stays empty, so the grid keeps its height.
 */
function Row({ row }: { row: ReceiptRowDto | null }) {
  if (row?.kind === 'olderHeading') {
    return (
      <tr className="older-heading">
        <td colSpan={8}>{tr('receipt.olderHeading')}</td>
      </tr>
    );
  }
  if (row?.kind === 'fromCredit') {
    // Pallets the factory owed them, handed over with no deposit (Q170): they are theirs, so nothing is out.
    return (
      <tr>
        <td className="num num-cell">{row.no}</td>
        <td className="col-item">
          <bdi>{row.itemName}</bdi> · {tr('receipt.fromCredit')}
        </td>
        <NumberCell text={formatNumber(row.quantity)} fits={FITS.quantity} />
        <td />
        <td />
        <td />
        <NumberCell text={formatMoney(0)} fits={FITS.unitDeposit} />
        <NumberCell text={formatMoney(0)} fits={FITS.lineTotal} className="line-total" />
      </tr>
    );
  }
  if (row?.kind === 'older') {
    return (
      <tr className="older">
        <td className="num num-cell">{row.no}</td>
        <td className="col-item" colSpan={4}>
          <bdi>{row.itemName}</bdi>
        </td>
        <NumberCell text={formatNumber(row.outQuantity)} fits={FITS.quantity} />
        <NumberCell text={formatMoney(row.unitDeposit)} fits={FITS.unitDeposit} />
        <NumberCell text={formatMoney(row.outValue)} fits={FITS.lineTotal} className="line-total" />
      </tr>
    );
  }
  return (
    <tr>
      <td className="num num-cell">{row ? row.no : ''}</td>
      <td className="col-item">
        <bdi>{row?.itemName ?? ''}</bdi>
      </td>
      <NumberCell text={row && formatNumber(row.quantity)} fits={FITS.quantity} />
      <NumberCell text={row && formatNumber(row.returnedAccepted)} fits={FITS.quantity} />
      <NumberCell text={row && formatNumber(row.returnedDamaged)} fits={FITS.quantity} />
      <NumberCell text={row && formatNumber(row.outQuantity)} fits={FITS.quantity} />
      <NumberCell text={row && formatMoney(row.unitDeposit)} fits={FITS.unitDeposit} />
      <NumberCell text={row && formatMoney(row.lineTotal)} fits={FITS.lineTotal} className="line-total" />
    </tr>
  );
}

function Copy({
  receipt,
  sheet,
  onLogoSettled,
}: {
  receipt: ReceiptDto;
  sheet: ReceiptSheetDto;
  onLogoSettled?: () => void;
}) {
  const rows = Array.from({ length: receipt.rowsPerCopy }, (_, index) => sheet.rows[index] ?? null);
  const { factory, customer, driver } = receipt;

  return (
    <>
      <div className="block-header">
        <ReceiptFactory factory={factory} onLogoSettled={onLogoSettled} />
        <ReceiptTitle
          title={tr('receipt.title')}
          numbered={{ label: tr('receipt.receiptNumber'), number: receipt.orderNumberDisplay }}
          date={receipt.date}
        />
      </div>

      <div className="block-parties">
        <ReceiptCustomer customer={customer} />
        <div>
          <div className="box-title">{tr('receipt.driver')}</div>
          <div className="clamp">
            {tr('receipt.name')}: <bdi>{driver.name}</bdi>
          </div>
          <div>
            {tr('receipt.phone')}: <bdi className="num">{driver.phone}</bdi>
          </div>
          <div>
            {tr('receipt.carNumber')}: <bdi className="num">{driver.carNumber}</bdi>
          </div>
        </div>
      </div>

      <div className="block-lines">
        <table className="lines">
          <thead>
            <tr>
              <th scope="col" className="col-no">
                #
              </th>
              <th scope="col" className="col-item">
                {tr('receipt.item')}
              </th>
              <th scope="col" className="col-qty">
                {tr('receipt.quantity')}
              </th>
              {/* What became of the quantity so far (Q134), beside it and before the money: the three add up to it. */}
              <th scope="col" className="col-qty">
                {tr('receipt.returnedAccepted')}
              </th>
              <th scope="col" className="col-qty">
                {tr('receipt.returnedDamaged')}
              </th>
              <th scope="col" className="col-qty">
                {tr('receipt.outQuantity')}
              </th>
              <th scope="col" className="col-unit">
                {tr('receipt.unitDeposit')}
              </th>
              <th scope="col" className="col-total">
                {tr('receipt.lineTotal')}
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <Row key={index} row={row} />
            ))}
          </tbody>
        </table>
      </div>

      {/* The details at the start, the totals at the end: on the last sheet only, the rest say they go on (Q151). */}
      <div className={sheet.showTotal && receipt.older ? 'block-footer with-older' : 'block-footer'}>
        <div className="footer-side">
          <div className="pay">
            {tr('receipt.paymentType')}:{' '}
            {tr(receipt.paymentType === 'CASH' ? 'receipt.paymentCash' : 'receipt.paymentLent')}
          </div>
          {/* The returned figures are the order's position on this day, not on the hand-over's (Q134). */}
          <div>
            {tr('receipt.printedOn')}: <span className="num">{formatBusinessDate(receipt.printedOn)}</span>
          </div>
          <div>{tr('receipt.sheetOf', { x: sheet.sheetNumber, y: sheet.sheetCount })}</div>
        </div>
        {sheet.showTotal && receipt.older ? (
          <div className="sums">
            <Total label={tr('receipt.orderTotal')} amount={receipt.depositTotal} kind="order" />
            <Total label={tr('receipt.olderOutValue')} amount={receipt.older.outValue} kind="older" />
            <Total label={tr('receipt.combinedTotal')} amount={receipt.older.combinedTotal} kind="grand" />
          </div>
        ) : sheet.showTotal ? (
          <div className="sums">
            <Total label={tr('receipt.depositTotal')} amount={receipt.depositTotal} kind="grand" />
          </div>
        ) : (
          <div className="continued">{tr('receipt.continued')}</div>
        )}
      </div>
    </>
  );
}

/**
 * The hand-over receipt (§7.16): one chunk of rows per sheet the server made, each printed twice — the factory's
 * copy and the customer's. Six rows or fewer print both copies on one A4 sheet, above and below a dashed cut line;
 * more give each copy a page of its own, all of the factory's pages before the customer's (Q150). Each line also says what of it has come back so far (Q134), so a
 * reprint after a return is the order's current position; under them are the customer's earlier orders' pallets
 * still out (Q150).
 */
export function Receipt({ receipt, onLogoSettled }: { receipt: ReceiptDto; onLogoSettled?: () => void }) {
  const copy = (sheet: ReceiptSheetDto, first: boolean) => (
    <Copy
      receipt={receipt}
      sheet={sheet}
      onLogoSettled={first && sheet.sheetNumber === 1 ? onLogoSettled : undefined}
    />
  );
  if (receipt.layout === 'pages') {
    // All of the factory's pages, then all of the customer's: each copy comes off the printer in one stack.
    return (
      <ReceiptPaper design="handover">
        {[true, false].flatMap((first) =>
          receipt.sheets.map((sheet) => (
            <ReceiptPage key={`${first ? 'factory' : 'customer'}-${sheet.sheetNumber}`}>
              {copy(sheet, first)}
            </ReceiptPage>
          )),
        )}
      </ReceiptPaper>
    );
  }
  return (
    <ReceiptPaper design="handover">
      {receipt.sheets.map((sheet) => (
        <ReceiptSheet key={sheet.sheetNumber} half={(first) => copy(sheet, first)} />
      ))}
    </ReceiptPaper>
  );
}
