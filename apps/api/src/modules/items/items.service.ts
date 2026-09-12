import { Injectable } from '@nestjs/common';
import type {
  ItemCreateBody,
  ItemDto,
  ItemListQuery,
  ItemUpdateBody,
  PageDto,
  StockAdjustmentCreateBody,
  StockAdjustmentResultDto,
  StockMovementDto,
  StockMovementListQuery,
} from '@pallet/shared';
import type { AuthContext } from '../../common/auth-context';
import { Clock } from '../../common/clock';
import { ApiError } from '../../common/errors/api-error';
import { assertNotInFuture } from '../../common/utils/dates';
import { safeProduct, toDbMoney, toSafeMoney } from '../../common/utils/money';
import { escapeLikePattern } from '../../common/utils/search';
import { parseSort } from '../../common/utils/sort';
import type { Prisma } from '../../generated/prisma/client';
import { lockItems } from '../../prisma/locks';
import { PrismaService } from '../../prisma/prisma.service';
import { pickSnapshot, toAuditSnapshot } from '../audit/audit-snapshot';
import { AuditService } from '../audit/audit.service';
import { batchAuditSnapshot } from '../purchases/purchases.mapper';
import { PurchasesService } from '../purchases/purchases.service';
import { StockLedger } from '../stock/stock-ledger';
import { UploadsService } from '../uploads/uploads.service';
import { NO_ACTIVITY, toItemDto, toStockMovementDto, type ItemRow } from './items.mapper';
import { queryItemDerived, queryStockMovements } from './items.queries';

const SORT_FIELDS = {
  name: 'name',
  quantityOnHand: 'quantityOnHand',
  depositPrice: 'depositPrice',
  createdAt: 'createdAt',
} as const;
const WITH_IMAGE = { image: { select: { fileName: true } } } as const;
const EDITABLE_FIELDS = ['name', 'depositPrice', 'minStock', 'imageUploadId'] as const;

@Injectable()
export class ItemsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
    private readonly audit: AuditService,
    private readonly uploads: UploadsService,
    private readonly stock: StockLedger,
    private readonly purchases: PurchasesService,
  ) {}

  async list(query: ItemListQuery): Promise<PageDto<ItemDto>> {
    const where: Prisma.ItemWhereInput = {
      ...(query.includeArchived ? {} : { archivedAt: null }),
      ...(query.q ? { name: { contains: escapeLikePattern(query.q), mode: 'insensitive' } } : {}),
      // A column compared with another column: Prisma's field reference, not a literal.
      ...(query.lowStockOnly
        ? { minStock: { not: null }, quantityOnHand: { lte: this.prisma.item.fields.minStock } }
        : {}),
    };
    const { field, direction } = parseSort<keyof typeof SORT_FIELDS>(query.sort);

    const [total, rows] = await Promise.all([
      this.prisma.item.count({ where }),
      this.prisma.item.findMany({
        where,
        include: WITH_IMAGE,
        orderBy: [{ [SORT_FIELDS[field]]: direction }, { id: 'asc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
    ]);
    const derived = await queryItemDerived(
      this.prisma,
      rows.map((row) => row.id),
    );

    return {
      items: rows.map((row) => toItemDto(row, derived.get(row.id) ?? NO_ACTIVITY)),
      page: query.page,
      pageSize: query.pageSize,
      total,
    };
  }

  /** Archived items are returned too: an order that references one must still show it. */
  get(itemId: number): Promise<ItemDto> {
    return this.load(this.prisma, itemId);
  }

  /** §6.15 and §4.8.9: the item, and when asked for, its first batch — in one transaction. */
  async create(body: ItemCreateBody, actor: AuthContext): Promise<ItemDto> {
    const batch = body.initialBatch;
    if (batch) {
      // The item needs `items.create`; its first delivery is a purchase, which needs its own right.
      if (!actor.permissions.has('purchases.create')) {
        throw new ApiError('PERMISSION_DENIED', { required: ['purchases.create'] });
      }
    }

    return this.prisma.$transaction(async (tx) => {
      if (body.imageUploadId !== null) await this.uploads.assertKind(tx, body.imageUploadId, 'ITEM_IMAGE');
      if (batch) {
        assertNotInFuture(this.clock, batch.date, 'initialBatch.date');
        safeProduct(batch.quantity, batch.unitCost, 'initialBatch.unitCost');
      }

      const created = await tx.item.create({
        data: {
          name: body.name,
          depositPrice: toDbMoney(body.depositPrice),
          minStock: body.minStock,
          imageUploadId: body.imageUploadId,
          createdByUserId: actor.userId,
        },
      });
      // Nobody else can see the row before commit, but the ledger's precondition holds everywhere.
      await lockItems(tx, [created.id]);
      const insertedBatch = batch ? await this.purchases.insertBatch(tx, created.id, batch, actor.userId) : null;
      const item = await tx.item.findUniqueOrThrow({ where: { id: created.id }, include: WITH_IMAGE });

      // The primary entity's row first, then the batch's (§11.3).
      await this.audit.record(tx, {
        action: 'CREATE',
        entityType: 'ITEM',
        entityId: String(item.id),
        summaryParams: { name: item.name, depositPrice: body.depositPrice, initialQuantity: batch?.quantity ?? 0 },
        after: {
          ...toAuditSnapshot('ITEM', item),
          ...(insertedBatch ? { initialBatch: batchAuditSnapshot(insertedBatch, item.name) } : {}),
        },
      });
      if (insertedBatch) await this.purchases.auditCreate(tx, insertedBatch, item.name);

      return toItemDto(item, NO_ACTIVITY);
    });
  }

  /** A new deposit price applies to new orders only; existing lines keep the price they were lent at. */
  async update(itemId: number, body: ItemUpdateBody): Promise<ItemDto> {
    return this.prisma.$transaction(async (tx) => {
      await lockItems(tx, [itemId]);
      const before = await this.findEditable(tx, itemId);
      if (before.version !== body.version) throw new ApiError('VERSION_CONFLICT', { currentVersion: before.version });
      if (body.imageUploadId !== undefined && body.imageUploadId !== null) {
        await this.uploads.assertKind(tx, body.imageUploadId, 'ITEM_IMAGE');
      }

      const current = { ...before, depositPrice: toSafeMoney(before.depositPrice) };
      const changed = EDITABLE_FIELDS.filter((field) => body[field] !== undefined && body[field] !== current[field]);
      // Q37: a save that changes nothing writes nothing — no version bump, no history row.
      if (changed.length === 0) return this.toDto(tx, before);

      const after = await tx.item.update({
        where: { id: itemId },
        data: {
          name: body.name,
          depositPrice: body.depositPrice === undefined ? undefined : toDbMoney(body.depositPrice),
          minStock: body.minStock,
          imageUploadId: body.imageUploadId,
          version: { increment: 1 },
        },
        include: WITH_IMAGE,
      });

      await this.audit.record(tx, {
        action: 'UPDATE',
        entityType: 'ITEM',
        entityId: String(itemId),
        summaryParams: { name: after.name, fields: changed },
        before: pickSnapshot(toAuditSnapshot('ITEM', before), changed),
        after: pickSnapshot(toAuditSnapshot('ITEM', after), changed),
      });
      return this.toDto(tx, after);
    });
  }

  /** Always an archive (A1): stock, open order lines and history all stay. */
  async archive(itemId: number, version: number, actor: AuthContext): Promise<ItemDto> {
    return this.prisma.$transaction(async (tx) => {
      await lockItems(tx, [itemId]);
      const before = await tx.item.findUnique({ where: { id: itemId }, include: WITH_IMAGE });
      if (!before) throw new ApiError('ITEM_NOT_FOUND', { itemId });
      if (before.archivedAt) throw new ApiError('ITEM_ALREADY_ARCHIVED', { itemId });
      if (before.version !== version) throw new ApiError('VERSION_CONFLICT', { currentVersion: before.version });

      const after = await tx.item.update({
        where: { id: itemId },
        data: { archivedAt: this.clock.now(), archivedByUserId: actor.userId, version: { increment: 1 } },
        include: WITH_IMAGE,
      });
      await this.audit.record(tx, {
        action: 'DELETE',
        entityType: 'ITEM',
        entityId: String(itemId),
        summaryParams: { name: after.name },
        before: toAuditSnapshot('ITEM', before),
        after: toAuditSnapshot('ITEM', after),
      });
      return this.toDto(tx, after);
    });
  }

  /**
   * §4.8.9. Allowed on an archived item — a recount does not care whether the item is still sold.
   * Additive and serialised by the item lock, so it takes no version and leaves the item's alone.
   */
  async adjustStock(
    itemId: number,
    body: StockAdjustmentCreateBody,
    actor: AuthContext,
  ): Promise<StockAdjustmentResultDto> {
    return this.prisma.$transaction(async (tx) => {
      await lockItems(tx, [itemId]);
      const before = await tx.item.findUnique({ where: { id: itemId }, select: { name: true, quantityOnHand: true } });
      if (!before) throw new ApiError('ITEM_NOT_FOUND', { itemId });

      await this.stock.apply(
        tx,
        [{ itemId, quantity: body.quantity, reason: 'MANUAL_ADJUSTMENT', note: body.note }],
        actor.userId,
      );
      const item = await this.load(tx, itemId);
      // Under the item's lock, the newest row of its ledger is the one just written.
      const {
        rows: [movement],
      } = await queryStockMovements(tx, itemId, undefined, 1, 1);
      if (!movement) throw new Error('The stock ledger wrote no row for a manual adjustment');

      await this.audit.record(tx, {
        action: 'STOCK_ADJUST',
        entityType: 'ITEM',
        entityId: String(itemId),
        summaryParams: { name: before.name, quantity: body.quantity },
        // §11.2: the stock before, then the stock after with the movement that made it.
        before: { quantityOnHand: before.quantityOnHand },
        after: { quantityOnHand: item.quantityOnHand, movement: { quantity: body.quantity, note: body.note } },
      });

      return { item, movement: toStockMovementDto(movement) };
    });
  }

  async movements(itemId: number, query: StockMovementListQuery): Promise<PageDto<StockMovementDto>> {
    const exists = await this.prisma.item.findUnique({ where: { id: itemId }, select: { id: true } });
    if (!exists) throw new ApiError('ITEM_NOT_FOUND', { itemId });

    const { rows, total } = await queryStockMovements(this.prisma, itemId, query.reason, query.page, query.pageSize);
    return { items: rows.map(toStockMovementDto), page: query.page, pageSize: query.pageSize, total };
  }

  /** An item that exists and is not archived, under the caller's lock. */
  private async findEditable(tx: Prisma.TransactionClient, itemId: number): Promise<ItemRow> {
    const item = await tx.item.findUnique({ where: { id: itemId }, include: WITH_IMAGE });
    if (!item) throw new ApiError('ITEM_NOT_FOUND', { itemId });
    if (item.archivedAt) throw new ApiError('ITEM_ARCHIVED', { itemId });
    return item;
  }

  private async load(client: Prisma.TransactionClient, itemId: number): Promise<ItemDto> {
    const row = await client.item.findUnique({ where: { id: itemId }, include: WITH_IMAGE });
    if (!row) throw new ApiError('ITEM_NOT_FOUND', { itemId });
    return this.toDto(client, row);
  }

  private async toDto(client: Prisma.TransactionClient, row: ItemRow): Promise<ItemDto> {
    const derived = await queryItemDerived(client, [row.id]);
    return toItemDto(row, derived.get(row.id) ?? NO_ACTIVITY);
  }
}
