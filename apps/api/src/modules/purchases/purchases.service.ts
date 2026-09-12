import { Injectable } from '@nestjs/common';
import {
  businessDateToDb,
  dbDateToBusiness,
  type InitialBatchBody,
  type PageDto,
  type PurchaseBatchCreateBody,
  type PurchaseBatchDto,
  type PurchaseBatchListQuery,
  type PurchaseBatchUpdateBody,
} from '@pallet/shared';
import type { AuthContext } from '../../common/auth-context';
import { Clock } from '../../common/clock';
import { ApiError } from '../../common/errors/api-error';
import { assertNotInFuture } from '../../common/utils/dates';
import { safeProduct, toDbMoney, toSafeMoney } from '../../common/utils/money';
import { parseSort } from '../../common/utils/sort';
import type { Prisma, PurchaseBatch } from '../../generated/prisma/client';
import { lockBatch, lockItems } from '../../prisma/locks';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { StockLedger } from '../stock/stock-ledger';
import { batchAuditSnapshot, toPurchaseBatchDto, type BatchRow } from './purchases.mapper';
import { runInTransaction } from '../../prisma/transaction';

const SORT_FIELDS = { date: 'date', quantity: 'quantity', createdAt: 'createdAt' } as const;
const WITH_REFS = {
  item: { select: { name: true } },
  createdBy: { select: { id: true, username: true, displayName: true } },
} as const;

/**
 * Purchase batches (§6.16). A deleted batch is invisible to every endpoint; what it did to the stock
 * stays in the ledger and the audit log.
 */
@Injectable()
export class PurchasesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
    private readonly audit: AuditService,
    private readonly stock: StockLedger,
  ) {}

  async list(query: PurchaseBatchListQuery, canViewCost: boolean): Promise<PageDto<PurchaseBatchDto>> {
    if (query.dateFrom && query.dateTo && query.dateFrom > query.dateTo) {
      throw new ApiError('DATE_RANGE_INVALID', { dateFrom: query.dateFrom, dateTo: query.dateTo });
    }

    const where: Prisma.PurchaseBatchWhereInput = {
      deletedAt: null,
      ...(query.itemId ? { itemId: query.itemId } : {}),
      ...(query.dateFrom || query.dateTo
        ? {
            date: {
              ...(query.dateFrom ? { gte: businessDateToDb(query.dateFrom) } : {}),
              ...(query.dateTo ? { lte: businessDateToDb(query.dateTo) } : {}),
            },
          }
        : {}),
    };
    const { field, direction } = parseSort<keyof typeof SORT_FIELDS>(query.sort);

    const [total, rows] = await Promise.all([
      this.prisma.purchaseBatch.count({ where }),
      this.prisma.purchaseBatch.findMany({
        where,
        include: WITH_REFS,
        orderBy: [{ [SORT_FIELDS[field]]: direction }, { id: direction }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
    ]);

    return {
      items: rows.map((row) => toPurchaseBatchDto(row, canViewCost)),
      page: query.page,
      pageSize: query.pageSize,
      total,
    };
  }

  /** Cost is write-without-read: a user may enter a cost they are not allowed to see back (§6.16). */
  async create(body: PurchaseBatchCreateBody, actor: AuthContext): Promise<PurchaseBatchDto> {
    assertNotInFuture(this.clock, body.date, 'date');
    safeProduct(body.quantity, body.unitCost, 'unitCost');

    return runInTransaction(this.prisma, async (tx) => {
      await lockItems(tx, [body.itemId]);
      const item = await tx.item.findUnique({ where: { id: body.itemId }, select: { name: true, archivedAt: true } });
      if (!item) throw new ApiError('ITEM_NOT_FOUND', { itemId: body.itemId });
      if (item.archivedAt) throw new ApiError('ITEM_ARCHIVED', { itemId: body.itemId });

      const batch = await this.insertBatch(tx, body.itemId, body, actor.userId);
      await this.auditCreate(tx, batch, item.name);
      return toPurchaseBatchDto(await this.reload(tx, batch.id), actor.canViewCost);
    });
  }

  /**
   * Writes a batch and its BATCH_ADD movement. The caller holds the item's lock and has checked the
   * date and the cost total — also the path of an item's first batch (§6.15).
   */
  async insertBatch(
    tx: Prisma.TransactionClient,
    itemId: number,
    input: InitialBatchBody,
    userId: number,
  ): Promise<PurchaseBatch> {
    const batch = await tx.purchaseBatch.create({
      data: {
        itemId,
        date: businessDateToDb(input.date),
        quantity: input.quantity,
        unitCost: toDbMoney(input.unitCost),
        totalCost: toDbMoney(input.quantity * input.unitCost),
        note: input.note ?? null,
        createdByUserId: userId,
      },
    });
    await this.stock.apply(tx, [{ itemId, quantity: input.quantity, reason: 'BATCH_ADD', batchId: batch.id }], userId);
    return batch;
  }

  /** The history row of a new batch. Its summary never carries cost (§11.3); its snapshot does. */
  async auditCreate(tx: Prisma.TransactionClient, batch: PurchaseBatch, itemName: string): Promise<void> {
    await this.audit.record(tx, {
      action: 'CREATE',
      entityType: 'PURCHASE_BATCH',
      entityId: String(batch.id),
      summaryParams: { itemName, quantity: batch.quantity, date: dbDateToBusiness(batch.date) },
      after: batchAuditSnapshot(batch, itemName),
    });
  }

  /** §6.16 PATCH: the stock moves by the difference in quantity, never below zero. */
  async update(batchId: number, body: PurchaseBatchUpdateBody, actor: AuthContext): Promise<PurchaseBatchDto> {
    return runInTransaction(this.prisma, async (tx) => {
      const before = await this.lockLive(tx, batchId);
      if (before.version !== body.version) throw new ApiError('VERSION_CONFLICT', { currentVersion: before.version });
      if (body.date !== undefined) assertNotInFuture(this.clock, body.date, 'date');

      const current = {
        date: dbDateToBusiness(before.date),
        quantity: before.quantity,
        unitCost: toSafeMoney(before.unitCost),
        note: before.note,
      };
      // Field names only: `unitCost` may appear as a name, never as a value (§11.3).
      const fields = (['date', 'quantity', 'unitCost', 'note'] as const).filter(
        (field) => body[field] !== undefined && body[field] !== current[field],
      );
      // Q37: a correction that changes nothing writes nothing — no version bump, no history row.
      if (fields.length === 0) return toPurchaseBatchDto(before, actor.canViewCost);

      const quantity = body.quantity ?? current.quantity;
      const unitCost = body.unitCost ?? current.unitCost;
      const totalCost = safeProduct(quantity, unitCost, body.unitCost === undefined ? 'quantity' : 'unitCost');

      const delta = quantity - current.quantity;
      if (delta !== 0) {
        await this.stock.apply(
          tx,
          [{ itemId: before.itemId, quantity: delta, reason: 'BATCH_EDIT', batchId }],
          actor.userId,
        );
      }

      const after = await tx.purchaseBatch.update({
        where: { id: batchId },
        data: {
          date: body.date === undefined ? undefined : businessDateToDb(body.date),
          quantity,
          unitCost: toDbMoney(unitCost),
          totalCost: toDbMoney(totalCost),
          note: body.note,
          version: { increment: 1 },
        },
        include: WITH_REFS,
      });
      await this.audit.record(tx, {
        action: 'UPDATE',
        entityType: 'PURCHASE_BATCH',
        entityId: String(batchId),
        summaryParams: { itemName: before.item.name, quantity: after.quantity, fields },
        before: batchAuditSnapshot(before, before.item.name),
        after: batchAuditSnapshot(after, after.item.name),
      });

      return toPurchaseBatchDto(after, actor.canViewCost);
    });
  }

  /** A soft delete that takes the batch's pallets back out of stock — refused if they are gone. */
  async remove(batchId: number, version: number, actor: AuthContext): Promise<void> {
    await runInTransaction(this.prisma, async (tx) => {
      const before = await this.lockLive(tx, batchId);
      if (before.version !== version) throw new ApiError('VERSION_CONFLICT', { currentVersion: before.version });

      await this.stock.apply(
        tx,
        [{ itemId: before.itemId, quantity: -before.quantity, reason: 'BATCH_DELETE', batchId }],
        actor.userId,
      );
      const after = await tx.purchaseBatch.update({
        where: { id: batchId },
        data: { deletedAt: this.clock.now(), deletedByUserId: actor.userId, version: { increment: 1 } },
      });

      await this.audit.record(tx, {
        action: 'DELETE',
        entityType: 'PURCHASE_BATCH',
        entityId: String(batchId),
        summaryParams: { itemName: before.item.name, quantity: before.quantity },
        before: batchAuditSnapshot(before, before.item.name),
        after: batchAuditSnapshot(after, before.item.name),
      });
    });
  }

  /**
   * Locks a batch that is not deleted, in the global order: its item first, then the batch. The item
   * id is read unlocked to know what to lock, and everything is re-read under the locks.
   */
  private async lockLive(tx: Prisma.TransactionClient, batchId: number): Promise<BatchRow> {
    const found = await tx.purchaseBatch.findUnique({ where: { id: batchId }, select: { itemId: true } });
    if (!found) throw new ApiError('BATCH_NOT_FOUND', { batchId });

    await lockItems(tx, [found.itemId]);
    await lockBatch(tx, batchId);
    const batch = await tx.purchaseBatch.findUnique({ where: { id: batchId }, include: WITH_REFS });
    if (!batch || batch.deletedAt) throw new ApiError('BATCH_NOT_FOUND', { batchId });
    return batch;
  }

  private reload(tx: Prisma.TransactionClient, batchId: number): Promise<BatchRow> {
    return tx.purchaseBatch.findUniqueOrThrow({ where: { id: batchId }, include: WITH_REFS });
  }
}
