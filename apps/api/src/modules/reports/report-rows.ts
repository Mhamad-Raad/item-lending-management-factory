import type { ItemRefDto } from '@pallet/shared';

/** §12.1: each row array stops at 5,000; asking for one more tells whether it was cut. */
export const ROW_CAP = 5_000;

/** Item columns and per-item rows in name order, the id breaking a tie. */
export function byItemName(x: ItemRefDto, y: ItemRefDto): number {
  return x.name.localeCompare(y.name) || x.id - y.id;
}
