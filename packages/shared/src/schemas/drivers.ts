import { z } from 'zod';
import {
  AT_LEAST_ONE_FIELD_ERROR,
  BoolQuery,
  IdParam,
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

export const DriverPhoneCheckQuery = z.strictObject({ phone: Phone, excludeId: IdParam.optional() });
export type DriverPhoneCheckQuery = z.infer<typeof DriverPhoneCheckQuery>;

export const DriverCreateBody = z.strictObject({
  name: Name200,
  phone: Phone,
  carNumber: CarNumber,
  /** Set once the user has seen the duplicate-phone warning and saves anyway (Q135), as for customers (A13). */
  confirmDuplicatePhone: z.boolean().default(false),
});
export type DriverCreateBody = z.infer<typeof DriverCreateBody>;

/** `confirmDuplicatePhone` is a flag, not a change, so it does not satisfy "at least one field". */
export const DriverUpdateBody = z
  .strictObject({
    version: Version,
    name: Name200.optional(),
    phone: Phone.optional(),
    carNumber: CarNumber.optional(),
    confirmDuplicatePhone: z.boolean().default(false),
  })
  .refine((body) => hasFieldBesidesVersion({ ...body, confirmDuplicatePhone: undefined }), AT_LEAST_ONE_FIELD_ERROR);
export type DriverUpdateBody = z.infer<typeof DriverUpdateBody>;
