import type { OrderDetailDto } from '@pallet/shared';
import { ApiError } from '../../common/errors/api-error';
import type { Prisma } from '../../generated/prisma/client';
import { ORDER_DETAIL_INCLUDE, toOrderDetailDto } from './orders.mapper';

/** An order in full, as every order endpoint answers (§6.19); inside a transaction, as it will commit. */
export async function loadOrderDetail(client: Prisma.TransactionClient, orderId: number): Promise<OrderDetailDto> {
  const order = await client.order.findUnique({ where: { id: orderId }, include: ORDER_DETAIL_INCLUDE });
  if (!order) throw new ApiError('ORDER_NOT_FOUND', { orderId });
  return toOrderDetailDto(order);
}
