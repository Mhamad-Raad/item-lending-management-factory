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

/** The end side of a receipt's header: its title, its number under its own label, and its date. */
export function ReceiptTitle({
  title,
  numberLabel,
  number,
  date,
}: {
  title: string;
  numberLabel: string;
  number: string;
  date: string;
}) {
  return (
    <div>
      <div style={{ fontSize: '12pt', fontWeight: 700 }}>{title}</div>
      <div>
        {numberLabel}: <span className="num">{number}</span>
      </div>
      <div>
        {tr('receipt.date')}: <span className="num">{formatBusinessDate(date)}</span>
      </div>
    </div>
  );
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
