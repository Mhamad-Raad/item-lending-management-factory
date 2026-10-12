import { toSafeMoney } from '../../common/utils/money';
import type { Prisma } from '../../generated/prisma/client';

/** How near in time a return may be to a payment before the two can no longer be put in order by their clocks. */
const CLOSE_CALL_SECONDS = 10;

/**
 * What an order owed just before a manual payment recorded before `ledger_entries.owed_before` existed (Q137),
 * replayed from the order's rows: the deposit, less the money rows with a smaller id on the order (ids are taken
 * under the order's lock, so they are in recording order), less the credit of the returns that stood at that
 * moment. A return and a payment can only be told apart by time: `created_at` is stamped as the row is written
 * and `reversed_at` from the API's clock, both after the order's lock is taken, so they are in order — but two
 * clocks and millisecond ties leave a margin, and the answer is null, the receipt printing the amount alone, where
 * it cannot be trusted: a return created or reversed within seconds of the payment, a deposit that may have changed since (a
 * deleted payment frees the lines, and an edit of them after it could have changed it), or a figure below the
 * payment, which the payment's own check rules out.
 */
export async function replayOwedBefore(db: Prisma.TransactionClient, entryId: number): Promise<number | null> {
  const rows = await db.$queryRaw<{ replayed: bigint; amount: bigint; trusted: boolean }[]>`
    SELECT
      (o.deposit_total
        - COALESCE((
            SELECT SUM(CASE l.type
                         WHEN 'PAYMENT' THEN l.amount
                         WHEN 'PAYMENT_REVERSAL' THEN -l.amount
                         WHEN 'REFUND' THEN -l.amount
                         WHEN 'REFUND_REVERSAL' THEN l.amount
                       END)::bigint
            FROM ledger_entries l
            WHERE l.order_id = p.order_id AND l.id < p.id
          ), 0)
        - COALESCE((
            SELECT SUM(r.refund_due)::bigint
            FROM returns r
            WHERE r.order_id = p.order_id
              AND r.created_at <= p.created_at
              AND (r.reversed_at IS NULL OR r.reversed_at > p.created_at)
          ), 0)
      )::bigint AS replayed,
      p.amount,
      NOT EXISTS (
        SELECT 1 FROM returns r
        WHERE r.order_id = p.order_id
          AND (abs(extract(epoch FROM r.created_at - p.created_at)) < ${CLOSE_CALL_SECONDS}
            OR abs(extract(epoch FROM r.reversed_at - p.created_at)) < ${CLOSE_CALL_SECONDS})
      )
      AND NOT (
        EXISTS (SELECT 1 FROM ledger_entries rev WHERE rev.reverses_entry_id = p.id)
        AND (
          -- An edit that changed the lines, as its history row names it (§11.3, its fields); a header edit (notes,
          -- driver, date) leaves the deposit alone.
          EXISTS (
            SELECT 1 FROM audit_logs a
            WHERE a.entity_type = 'ORDER' AND a.entity_id = p.order_id::text AND a.action = 'UPDATE'
              AND a.created_at > p.created_at
              AND a.summary_params -> 'fields' @> '["lines"]'::jsonb
          )
          -- And, not resting on the history's wording alone, the stock a quantity change moved.
          OR EXISTS (
            SELECT 1 FROM stock_movements m
            WHERE m.order_id = p.order_id AND m.reason = 'ORDER_LINE_EDIT' AND m.created_at > p.created_at
          )
        )
      ) AS trusted
    FROM ledger_entries p
    JOIN orders o ON o.id = p.order_id
    WHERE p.id = ${entryId} AND p.type = 'PAYMENT' AND NOT p.is_automatic`;
  const row = rows[0];
  if (!row || !row.trusted || row.replayed < row.amount) return null;
  return toSafeMoney(row.replayed);
}
