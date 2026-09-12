import { OrderCreateBody, PAYMENT_TYPES, type ItemDto, type PaymentType } from '@pallet/shared';
import { useQueries } from '@tanstack/react-query';
import { z } from 'zod';
import { itemQuery } from '@/features/items/api';
import type { LineRow } from './order-lines';

/** The new and edit order forms, as react-hook-form holds them: every empty box is null. */
export interface OrderFormValues {
  customerId: number | null;
  driverId: number | null;
  date: string | null;
  paymentType: PaymentType | null;
  notes: string;
  lines: LineRow[];
}

/**
 * The form's values checked by the shared `OrderCreateBody` (§7.9), so the page reports exactly what
 * the API would refuse, on the same fields. An edit form holds its order's customer and payment type,
 * which it cannot change, so the same check applies.
 */
export const OrderFormSchema = z
  .object({
    customerId: z.number().nullable(),
    driverId: z.number().nullable(),
    date: z.string().nullable(),
    paymentType: z.enum(PAYMENT_TYPES).nullable(),
    notes: z.string(),
    lines: z.array(
      z.object({ itemId: z.number().nullable(), quantity: z.number().nullable(), unitDeposit: z.number().nullable() }),
    ),
  })
  .superRefine((values, ctx) => {
    const result = OrderCreateBody.safeParse({
      customerId: values.customerId ?? undefined,
      driverId: values.driverId ?? undefined,
      date: values.date ?? undefined,
      paymentType: values.paymentType ?? undefined,
      notes: values.notes,
      lines: values.lines.map((line) => ({
        itemId: line.itemId ?? undefined,
        quantity: line.quantity ?? undefined,
        ...(line.unitDeposit === null ? {} : { unitDeposit: line.unitDeposit }),
      })),
    });
    if (result.success) return;
    for (const issue of result.error.issues) {
      ctx.addIssue({ code: 'custom', path: issue.path, message: issue.message });
    }
  });

/** The chosen items, by id: their deposits and stock drive the defaults, the hints and the totals. */
export function useOrderItems(itemIds: readonly (number | null)[]): Map<number, ItemDto> {
  const ids = [...new Set(itemIds.filter((itemId): itemId is number => itemId !== null))];
  const results = useQueries({ queries: ids.map((itemId) => itemQuery(itemId)) });
  return new Map(results.flatMap((result) => (result.data ? [[result.data.id, result.data] as const] : [])));
}
