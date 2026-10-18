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

/** One figure of the footer, in dinars (§7.16.3, Q150). */
function Total({ label, amount, size, weight }: { label: string; amount: number; size: string; weight: number }) {
  return (
    <div style={{ fontSize: size, fontWeight: weight }}>
      {label}: <span className="num">{formatMoney(amount)}</span> {tr('receipt.currency')}
    </div>
  );
}

/**
 * A row of the table: one of this order's lines, the heading over the customer's earlier orders' lines still out,
 * or one of those — its order's number before the item, and in the total column what of it is still out (Q150).
 * A row past the last stays empty, so the grid keeps its height.
 */
function Row({ row }: { row: ReceiptRowDto | null }) {
  if (row?.kind === 'olderHeading') {
    return (
      <tr className="older-heading">
        <td colSpan={8}>{tr('receipt.olderHeading')}</td>
      </tr>
    );
  }
  return (
    <tr className={row?.kind === 'older' ? 'older' : undefined}>
      <td className="num num-cell">{row ? row.no : ''}</td>
      <td className="col-item">
        {row?.kind === 'older' ? (
          <>
            <span className="num">{row.orderNumberDisplay}</span> ·{' '}
          </>
        ) : null}
        <bdi>{row?.itemName ?? ''}</bdi>
      </td>
      <NumberCell text={row && formatNumber(row.quantity)} fits={FITS.quantity} />
      <NumberCell text={row && formatNumber(row.returnedAccepted)} fits={FITS.quantity} />
      <NumberCell text={row && formatNumber(row.returnedDamaged)} fits={FITS.quantity} />
      <NumberCell text={row && formatNumber(row.outQuantity)} fits={FITS.quantity} />
      <NumberCell text={row && formatMoney(row.unitDeposit)} fits={FITS.unitDeposit} />
      <NumberCell
        text={row && formatMoney(row.kind === 'older' ? row.outValue : row.lineTotal)}
        fits={FITS.lineTotal}
      />
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

      <div className={sheet.showTotal && receipt.older ? 'block-footer with-older' : 'block-footer'}>
        {sheet.showTotal && receipt.older ? (
          <>
            <Total label={tr('receipt.orderTotal')} amount={receipt.depositTotal} size="10pt" weight={600} />
            <Total label={tr('receipt.olderOutValue')} amount={receipt.older.outValue} size="10pt" weight={600} />
            <Total label={tr('receipt.combinedTotal')} amount={receipt.older.combinedTotal} size="11pt" weight={700} />
          </>
        ) : sheet.showTotal ? (
          <Total label={tr('receipt.depositTotal')} amount={receipt.depositTotal} size="11pt" weight={700} />
        ) : (
          <div style={{ fontSize: '9pt', fontStyle: 'italic' }}>{tr('receipt.continued')}</div>
        )}
        <div style={{ fontSize: '10pt', fontWeight: 600 }}>
          {tr('receipt.paymentType')}:{' '}
          {tr(receipt.paymentType === 'CASH' ? 'receipt.paymentCash' : 'receipt.paymentLent')}
        </div>
        <div style={{ fontSize: '8.5pt', display: 'flex', justifyContent: 'space-between' }}>
          {/* The returned figures are the order's position on this day, not on the hand-over's (Q134). */}
          <span>
            {tr('receipt.printedOn')}: <span className="num">{formatBusinessDate(receipt.printedOn)}</span>
          </span>
          <span>{tr('receipt.sheetOf', { x: sheet.sheetNumber, y: sheet.sheetCount })}</span>
        </div>
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
      <ReceiptPaper>
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
    <ReceiptPaper>
      {receipt.sheets.map((sheet) => (
        <ReceiptSheet key={sheet.sheetNumber} half={(first) => copy(sheet, first)} />
      ))}
    </ReceiptPaper>
  );
}
