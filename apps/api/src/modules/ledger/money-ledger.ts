import { Injectable } from '@nestjs/common';
import { businessDateToDb, type LedgerEntrySource, type LedgerEntryType } from '@pallet/shared';
import { toDbMoney } from '../../common/utils/money';
import type { LedgerEntry, Prisma } from '../../generated/prisma/client';

/** One row of the money ledger (§4.7.2); the database checks that type, source and references agree. */
export interface MoneyEntryInput {
  orderId: number;
  type: LedgerEntryType;
  source: LedgerEntrySource;
  amount: number;
  /** A business date; null only on the automatic hand-over payment, which takes the order's date. */
  date: string | null;
  isAutomatic?: boolean;
  returnId?: number | null;
  reversesEntryId?: number | null;
  note?: string | null;
}

/**
 * The only writer of `ledger_entries` (§4.6). The table is append-only — grants and a trigger refuse
 * updates and deletes — so a correction is always a new, reversing row.
 */
@Injectable()
export class MoneyLedger {
  record(tx: Prisma.TransactionClient, entry: MoneyEntryInput, userId: number): Promise<LedgerEntry> {
    if (!Number.isSafeInteger(entry.amount) || entry.amount <= 0) {
      // A caller bug, not a user error: every ledger row moves a positive whole amount.
      throw new Error(`A ledger row must move a positive whole amount, not ${entry.amount}`);
    }
    return tx.ledgerEntry.create({
      data: {
        orderId: entry.orderId,
        type: entry.type,
        source: entry.source,
        amount: toDbMoney(entry.amount),
        date: entry.date === null ? null : businessDateToDb(entry.date),
        isAutomatic: entry.isAutomatic ?? false,
        returnId: entry.returnId ?? null,
        reversesEntryId: entry.reversesEntryId ?? null,
        note: entry.note ?? null,
        createdByUserId: userId,
      },
    });
  }
}
