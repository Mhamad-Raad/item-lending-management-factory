import { formatBusinessDate, formatMoney, formatNumber, type ReceiptDto, type ReceiptSheetDto } from '@pallet/shared';
import { tr } from './receipt-i18n';
import { ReceiptCustomer, ReceiptFactory, ReceiptPaper, ReceiptSheet, ReceiptTitle } from './receipt-parts';

/**
 * How many characters each numeric column holds at the receipt's 10 pt (§7.16.3). A longer figure — only the
 * largest the inputs allow — is set smaller rather than left to run into the next column.
 */
const FITS = { quantity: 7, unitDeposit: 9, lineTotal: 11 } as const;

function NumberCell({ text, fits }: { text: string | null; fits: number }) {
  return <td className={text && text.length > fits ? 'num num-cell num-tight' : 'num num-cell'}>{text ?? ''}</td>;
}

function Half({
  receipt,
  sheet,
  onLogoSettled,
}: {
  receipt: ReceiptDto;
  sheet: ReceiptSheetDto;
  onLogoSettled?: () => void;
}) {
  const rows = Array.from({ length: receipt.linesPerHalf }, (_, index) => sheet.lines[index] ?? null);
  const firstNumber = (sheet.sheetNumber - 1) * receipt.linesPerHalf + 1;
  const { factory, customer, driver } = receipt;

  return (
    <>
      <div className="block-header">
        <ReceiptFactory factory={factory} onLogoSettled={onLogoSettled} />
        <ReceiptTitle
          title={tr('receipt.title')}
          numberLabel={tr('receipt.receiptNumber')}
          number={receipt.orderNumberDisplay}
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
            {rows.map((line, index) => (
              <tr key={index}>
                <td className="num num-cell">{line ? firstNumber + index : ''}</td>
                <td className="col-item">
                  <bdi>{line?.itemName ?? ''}</bdi>
                </td>
                <NumberCell text={line && formatNumber(line.quantity)} fits={FITS.quantity} />
                <NumberCell text={line && formatNumber(line.returnedAccepted)} fits={FITS.quantity} />
                <NumberCell text={line && formatNumber(line.returnedDamaged)} fits={FITS.quantity} />
                <NumberCell text={line && formatNumber(line.outQuantity)} fits={FITS.quantity} />
                <NumberCell text={line && formatMoney(line.unitDeposit)} fits={FITS.unitDeposit} />
                <NumberCell text={line && formatMoney(line.lineTotal)} fits={FITS.lineTotal} />
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="block-footer">
        {sheet.showTotal ? (
          <div style={{ fontSize: '11pt', fontWeight: 700 }}>
            {tr('receipt.depositTotal')}: <span className="num">{formatMoney(receipt.depositTotal)}</span>{' '}
            {tr('receipt.currency')}
          </div>
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
 * The hand-over receipt (§7.16): one A4 sheet per chunk the server made, each printing its chunk twice
 * — the factory's copy and the customer's — above and below a dashed cut line. Each line also says what
 * of it has come back so far (Q134), so a reprint after a return is the order's current position.
 */
export function Receipt({ receipt, onLogoSettled }: { receipt: ReceiptDto; onLogoSettled?: () => void }) {
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
