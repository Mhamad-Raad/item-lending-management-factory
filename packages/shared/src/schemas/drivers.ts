import { z } from 'zod';
import {
  AT_LEAST_ONE_FIELD_ERROR,
  BoolQuery,
  Name200,
  PageQuery,
  Phone,
  SearchQuery,
  Version,
  hasFieldBesidesVersion,
  sortParam,
} from './common.js';

/** Free text: plate formats vary between governorates (§5). */
const CarNumber = z.string().trim().min(1).max(50);

export const DriverListQuery = z.strictObject({
  ...PageQuery,
  q: SearchQuery,
  includeArchived: BoolQuery.default(false),
  sort: sortParam(['name', 'createdAt'], 'name'),
});
export type DriverListQuery = z.infer<typeof DriverListQuery>;

/** No duplicate-phone warning for drivers (Q13). */
export const DriverCreateBody = z.strictObject({ name: Name200, phone: Phone, carNumber: CarNumber });
export type DriverCreateBody = z.infer<typeof DriverCreateBody>;

export const DriverUpdateBody = z
  .strictObject({
    version: Version,
    name: Name200.optional(),
    phone: Phone.optional(),
    carNumber: CarNumber.optional(),
  })
  .refine(hasFieldBesidesVersion, AT_LEAST_ONE_FIELD_ERROR);
export type DriverUpdateBody = z.infer<typeof DriverUpdateBody>;
