// @vitest-environment jsdom
import type { AuditLogDto } from '@pallet/shared';
import { cleanup, render } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import i18n from '@/i18n';
import { AuditDiff } from './audit-diff';

const ROW: AuditLogDto = {
  id: 1,
  createdAt: '2026-11-01T08:00:00.000Z',
  user: null,
  usernameAttempt: null,
  action: 'UPDATE',
  entityType: 'ORDER',
  entityId: '9',
  summaryKey: 'audit.ORDER.UPDATE',
  summaryParams: { orderNumber: 42, fields: ['driverId', 'lines', 'fromCredit'] },
  ip: null,
  requestId: null,
  before: {
    driverId: 4,
    driverName: 'Karwan Aziz',
    lines: [],
    fromCredit: [{ itemId: 1, itemName: 'Pallet A', quantity: 1 }],
  },
  after: {
    driverId: 5,
    driverName: 'Omar Salih',
    lines: [{ itemId: 1, itemName: 'Pallet A', quantity: 2, unitDeposit: 1_000, lineTotal: 2_000 }],
    fromCredit: [{ itemId: 1, itemName: 'Pallet A', quantity: 3 }],
  },
};

/** The grid's cells as text, three to a row: the field, before, after. */
const cellsOf = (container: HTMLElement) =>
  [...(container.firstElementChild?.querySelectorAll(':scope > span, :scope > div > *') ?? [])].map((cell) =>
    (cell.textContent ?? '').replace(/[⁦-⁩]/g, ''),
  );

describe('an order history row in words (Q181)', () => {
  beforeAll(async () => {
    await i18n.changeLanguage('en');
  });
  afterEach(cleanup);

  it('names the driver and the items, with what was lent and what came from the pallets owed', () => {
    const { container } = render(<AuditDiff row={ROW} />);
    expect(cellsOf(container)).toEqual([
      'Field',
      'Before',
      'After',
      '• Driver',
      'Karwan Aziz',
      'Omar Salih',
      '• Pallets',
      '—',
      'Pallet A: 2 × 1,000 IQD',
      '• Given from pallets we owed them',
      'Pallet A: 1',
      'Pallet A: 3',
    ]);
    expect(container.textContent).not.toContain('itemId');
  });

  it('shows an item by its number in a row written before names were kept', () => {
    const { container } = render(
      <AuditDiff
        row={{
          ...ROW,
          before: { lines: [{ itemId: 7, quantity: 5 }] },
          after: { lines: [{ itemId: 7, quantity: 6 }] },
        }}
      />,
    );
    expect(cellsOf(container)).toContain('#7: 6');
  });

  it('names who passed the credit limit under a label of its own', () => {
    const { container } = render(
      <AuditDiff
        row={{
          ...ROW,
          action: 'CREATE',
          before: null,
          after: { id: 9, orderNumber: 42, customerId: 3, customerName: 'Kurdistan Cement', creditOverrideByUserId: 1 },
        }}
      />,
    );
    const cells = cellsOf(container);
    expect(cells).toContain('Credit limit passed by user');
    expect(cells).toContain('#1');
    expect(cells).toContain('Kurdistan Cement');
    // The ids the names stand for are left out.
    expect(cells).not.toContain('id');
    expect(cells).not.toContain('customerId');
  });

  it("leaves an order's other rows — a credit override's figures — as they are", () => {
    const { container } = render(
      <AuditDiff row={{ ...ROW, action: 'CREDIT_OVERRIDE', before: null, after: { excess: 5_000 } }} />,
    );
    expect(container.textContent).toContain('excess');
  });
});
