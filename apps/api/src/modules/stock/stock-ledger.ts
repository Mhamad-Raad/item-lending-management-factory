import { Injectable } from '@nestjs/common';
import { ApiError } from '../../common/errors/api-error';
import type { Prisma } from '../../generated/prisma/client';

type BatchReason = 'BATCH_ADD' | 'BATCH_EDIT' | 'BATCH_DELETE';
type OrderReason = 'ORDER_CREATE' | 'ORDER_LINE_EDIT' | 'ORDER_CANCEL';
type ReturnReason = 'RETURN_ACCEPTED' | 'RETURN_EDIT' | 'RETURN_DELETE';

/** One row of the stock ledger, carrying exactly the references its reason requires (§4.7.1). */
export type StockMovementInput = { itemId: number; quantity: number } & (
  | { reason: BatchReason; batchId: number }
  | { reason: OrderReason; orderId: number }
  | { reason: ReturnReason; orderId: number; returnId: number }
  | { reason: 'MANUAL_ADJUSTMENT'; note: string }
);

/**
 * The only writer of `items.quantity_on_hand` (§4.6). All the movements of one operation go through
 * a single call, so the negativity check sees each item's net change: an edit that moves pallets out
 * and back in is judged on the difference, not on its first half.
 */
@Injectable()
export class StockLedger {
  /**
   * Precondition: the caller holds `lockItems` on every item involved. Refuses with
   * STOCK_INSUFFICIENT — listing every item that would go below zero — before writing anything.
   */
  async apply(tx: Prisma.TransactionClient, movements: readonly StockMovementInput[], userId: number): Promise<void> {
    if (movements.length === 0) return;
    if (movements.some((movement) => movement.quantity === 0 || !Number.isInteger(movement.quantity))) {
      // A caller bug, not a user error: the table refuses zero rows, and so does this.
      throw new Error('A stock movement must move a whole, non-zero quantity');
    }

    const net = await this.assertAvailable(tx, movements);

    // Additions before removals: the item history shows a running balance by row id, and taken in this order it never
    // dips below the lower of the stock before and after, both of which the check above keeps at zero or more.
    const ordered = [...movements.filter((m) => m.quantity > 0), ...movements.filter((m) => m.quantity < 0)];
    await tx.stockMovement.createMany({
      data: ordered.map((movement) => ({
        itemId: movement.itemId,
        quantity: movement.quantity,
        reason: movement.reason,
        batchId: 'batchId' in movement ? movement.batchId : null,
        orderId: 'orderId' in movement ? movement.orderId : null,
        returnId: 'returnId' in movement ? movement.returnId : null,
        note: 'note' in movement ? movement.note : null,
        createdByUserId: userId,
      })),
    });

    for (const [itemId, change] of net) {
      if (change === 0) continue;
      // Raw on purpose: a Prisma update would stamp `updated_at`, and a stock movement is not an
      // edit of the item — its `version` and `updated_at` stay as they are (§4.6).
      await tx.$executeRaw`UPDATE items SET quantity_on_hand = quantity_on_hand + ${change} WHERE id = ${itemId}`;
    }
  }

  /**
   * Refuses with STOCK_INSUFFICIENT — every item that would go below zero, with what was asked for
   * and what there is — and otherwise returns each item's net change. The caller holds the locks.
   */
  async assertAvailable(
    tx: Prisma.TransactionClient,
    movements: readonly { itemId: number; quantity: number }[],
  ): Promise<Map<number, number>> {
    const net = new Map<number, number>();
    for (const movement of movements) net.set(movement.itemId, (net.get(movement.itemId) ?? 0) + movement.quantity);

    const items = await tx.item.findMany({
      where: { id: { in: [...net.keys()] } },
      select: { id: true, quantityOnHand: true },
    });
    const onHand = new Map(items.map((item) => [item.id, item.quantityOnHand]));
    const short = [...net]
      .filter(([itemId, change]) => (onHand.get(itemId) ?? 0) + change < 0)
      .map(([itemId, change]) => ({ itemId, requested: -change, available: onHand.get(itemId) ?? 0 }));
    if (short.length > 0) throw new ApiError('STOCK_INSUFFICIENT', { items: short });
    return net;
  }
}
