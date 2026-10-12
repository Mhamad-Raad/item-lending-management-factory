-- Q137: a payment's receipt says what the order owed before and after it, as it was when the money came in, so
-- a reprint years later says what the original said. The figure is the one the payment was checked against, kept
-- on the payment's own row from now on. The ledger is append-only, so the payments recorded before this column
-- keep NULL here; their receipt replays the order when it is printed (`replayOwedBefore`).
ALTER TABLE "ledger_entries" ADD COLUMN "owed_before" BIGINT;

ALTER TABLE ledger_entries
  ADD CONSTRAINT ledger_entries_owed_before_check
    CHECK ((type = 'PAYMENT' OR owed_before IS NULL) AND (owed_before IS NULL OR owed_before >= amount));
