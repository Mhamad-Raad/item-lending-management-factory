import { formatBusinessDate, formatMoney, formatNumber, type ReceiptDto, type ReceiptSheetDto } from '@pallet/shared';
import { Scissors } from 'lucide-react';
import i18n from '@/i18n';

/** The receipt is always Kurdish Sorani, whatever the UI language (§7.16.1). */
const tr = i18n.getFixedT('ckb');

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
        <div style={{ display: 'flex', gap: '3mm' }}>
          {factory.logoUrl ? (
            <img
              src={factory.logoUrl}
              alt=""
              style={{ maxHeight: '18mm', maxWidth: '30mm', objectFit: 'contain' }}
              onLoad={onLogoSettled}
              onError={onLogoSettled}
            />
          ) : null}
          <div>
            <div style={{ fontSize: '13pt', fontWeight: 700 }}>
              <bdi>{factory.name}</bdi>
            </div>
            <div style={{ fontSize: '8.5pt' }}>
              {tr('receipt.factoryPhone')}: <bdi className="num">{factory.phone}</bdi>
            </div>
            <div style={{ fontSize: '8.5pt' }} className="clamp">
              {tr('receipt.factoryAddress')}: <bdi>{factory.address}</bdi>
            </div>
          </div>
        </div>
        <div>
          <div style={{ fontSize: '12pt', fontWeight: 700 }}>{tr('receipt.title')}</div>
          <div>
            {tr('receipt.receiptNumber')}: <span className="num">{receipt.orderNumberDisplay}</span>
          </div>
          <div>
            {tr('receipt.date')}: <span className="num">{formatBusinessDate(receipt.date)}</span>
          </div>
        </div>
      </div>

      <div className="block-parties">
        <div>
          <div style={{ fontSize: '9pt', fontWeight: 600 }}>{tr('receipt.customer')}</div>
          <div className="clamp">
            {tr('receipt.name')}: <bdi>{customer.name}</bdi>
          </div>
          <div>
            {tr('receipt.phone')}: <bdi className="num">{customer.phone}</bdi>
          </div>
          <div className="clamp">
            {tr('receipt.address')}: <bdi>{customer.address}</bdi>
          </div>
        </div>
        <div>
          <div style={{ fontSize: '9pt', fontWeight: 600 }}>{tr('receipt.driver')}</div>
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
                <td className="num num-cell">{line ? formatNumber(line.quantity) : ''}</td>
                <td className="num num-cell">{line ? formatMoney(line.unitDeposit) : ''}</td>
                <td className="num num-cell">{line ? formatMoney(line.lineTotal) : ''}</td>
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
        <div style={{ fontSize: '8.5pt', textAlign: 'end' }}>
          {tr('receipt.sheetOf', { x: sheet.sheetNumber, y: sheet.sheetCount })}
        </div>
      </div>
    </>
  );
}

/**
 * The hand-over receipt (§7.16): one A4 sheet per chunk the server made, each printing its chunk twice
 * — the factory's copy and the customer's — above and below a dashed cut line.
 */
export function Receipt({ receipt, onLogoSettled }: { receipt: ReceiptDto; onLogoSettled?: () => void }) {
  return (
    <div className="receipt" dir="rtl" lang="ckb">
      {receipt.sheets.map((sheet) => (
        <div key={sheet.sheetNumber} className="sheet">
          <div className="half">
            <Half receipt={receipt} sheet={sheet} onLogoSettled={sheet.sheetNumber === 1 ? onLogoSettled : undefined} />
          </div>
          <div className="half">
            <Scissors className="cut-mark" aria-hidden />
            <Half receipt={receipt} sheet={sheet} />
          </div>
        </div>
      ))}
    </div>
  );
}
