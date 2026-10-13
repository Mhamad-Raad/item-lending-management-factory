import { formatBusinessDate, type ReceiptFactoryDto } from '@pallet/shared';
import { Scissors } from 'lucide-react';
import type { ReactNode } from 'react';
import { tr } from './receipt-i18n';

/** The start side of a receipt's header (§7.16.3): the logo, the factory's name, phone and address. */
export function ReceiptFactory({ factory, onLogoSettled }: { factory: ReceiptFactoryDto; onLogoSettled?: () => void }) {
  return (
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
  );
}

/** The customer's box of a receipt's parties block (§7.16.3): name, phone, address. */
export function ReceiptCustomer({ customer }: { customer: { name: string; phone: string; address: string } }) {
  return (
    <div>
      <div className="box-title">{tr('receipt.customer')}</div>
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
  );
}

/**
 * The end side of a receipt's header: its title, its number under its own label, and its date. The transactions
 * receipt has no number of its own (Q139).
 */
export function ReceiptTitle({
  title,
  numbered,
  date,
}: {
  title: string;
  numbered?: { label: string; number: string };
  date: string;
}) {
  return (
    <div>
      <div style={{ fontSize: '12pt', fontWeight: 700 }}>{title}</div>
      {numbered ? (
        <div>
          {numbered.label}: <span className="num">{numbered.number}</span>
        </div>
      ) : null}
      <div>
        {tr('receipt.date')}: <span className="num">{formatBusinessDate(date)}</span>
      </div>
    </div>
  );
}

/** The order's box of a money receipt's parties block (Q137, Q139): its number and its date. */
export function ReceiptOrder({ order }: { order: { orderNumberDisplay: string; date: string } }) {
  return (
    <div>
      <div className="box-title">{tr('receipt.money.order')}</div>
      <div>
        {tr('receipt.money.orderNumber')}: <span className="num">{order.orderNumberDisplay}</span>
      </div>
      <div>
        {tr('receipt.money.orderDate')}: <span className="num">{formatBusinessDate(order.date)}</span>
      </div>
    </div>
  );
}

/**
 * A figure in a lines table: `fits` is how many characters its column holds at the receipt's 10 pt (§7.16.3); a
 * longer one — only the largest the inputs allow — is set smaller rather than left to run into the next column.
 */
export function NumberCell({ text, fits, className }: { text: string | null; fits: number; className?: string }) {
  const classes = ['num', 'num-cell', text && text.length > fits ? 'num-tight' : null, className].filter(Boolean);
  return <td className={classes.join(' ')}>{text ?? ''}</td>;
}

/** A receipt's paper: always right to left and Sorani (§7.16.1). */
export function ReceiptPaper({ children }: { children: ReactNode }) {
  return (
    <div className="receipt" dir="rtl" lang="ckb">
      {children}
    </div>
  );
}

/**
 * One A4 sheet printing the same half twice — the factory's copy and the customer's — above and below the dashed
 * cut line (§7.16.2). `half(first)` draws one copy; only the first waits on the logo before printing.
 */
export function ReceiptSheet({ half }: { half: (first: boolean) => ReactNode }) {
  return (
    <div className="sheet">
      <div className="half">{half(true)}</div>
      <div className="half">
        <Scissors className="cut-mark" aria-hidden />
        {half(false)}
      </div>
    </div>
  );
}
