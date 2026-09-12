-- Q39: a cancelled order's lines are zeroed by recomputeOrder (§4.2), which the original check
-- refused because it knows nothing of the order. The zeroed state — nothing out, nothing returned —
-- is now accepted too; reconciliation R2 still compares every line with computeOrderTotals.
ALTER TABLE order_lines DROP CONSTRAINT order_lines_out_quantity_matches_check;
ALTER TABLE order_lines
  ADD CONSTRAINT order_lines_out_quantity_matches_check CHECK (
    out_quantity = quantity - returned_accepted - returned_damaged
    OR (out_quantity = 0 AND returned_accepted = 0 AND returned_damaged = 0)
  );
