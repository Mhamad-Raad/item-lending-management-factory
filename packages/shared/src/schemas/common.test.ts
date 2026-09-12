import { describe, expect, it } from 'vitest';
import type { z } from 'zod';
import { MONEY_INPUT_MAX } from '../domain/ledger-math.js';
import { BoolQuery, BusinessDate, Money, Quantity, optionalText } from './common.js';
import { ItemUpdateBody } from './items.js';
import { PurchaseBatchCreateBody } from './purchases.js';
import { mapZodError } from './zod-issues.js';

/** The field errors the API would send back for this input, as the web app receives them. */
function fieldErrors(schema: z.ZodType, input: unknown): { path: string; code: string }[] {
  const result = schema.safeParse(input);
  if (result.success) return [];
  return mapZodError(result.error).map(({ path, code }) => ({ path, code }));
}

describe('U9: shared schemas', () => {
  it('reject an unknown key in a strict object', () => {
    const body = { itemId: 1, date: '2026-09-01', quantity: 10, unitCost: 700, discount: 5 };

    expect(fieldErrors(PurchaseBatchCreateBody, body)).toEqual([{ path: 'discount', code: 'unknown_key' }]);
  });

  it('reject money above the input ceiling and a quantity of zero', () => {
    expect(fieldErrors(Money, MONEY_INPUT_MAX + 1)).toEqual([{ path: '', code: 'too_big' }]);
    expect(fieldErrors(Money, MONEY_INPUT_MAX)).toEqual([]);
    expect(fieldErrors(Quantity, 0)).toEqual([{ path: '', code: 'too_small' }]);
  });

  it('accept only real calendar days, and none before 2000, each with its own code', () => {
    expect(fieldErrors(BusinessDate, '2026-02-28')).toEqual([]);
    // These three codes are what the web app translates; a generic `invalid_type` would not say why.
    expect(fieldErrors(BusinessDate, '2026-02-30')).toEqual([{ path: '', code: 'invalid_date' }]);
    expect(fieldErrors(BusinessDate, '26-02-01')).toEqual([{ path: '', code: 'invalid_date' }]);
    expect(fieldErrors(BusinessDate, 'yesterday')).toEqual([{ path: '', code: 'invalid_date' }]);
    expect(fieldErrors(BusinessDate, '1999-12-31')).toEqual([{ path: '', code: 'too_small' }]);
  });

  it('store an emptied text box as null, and leave an absent one alone', () => {
    const note = optionalText(10);

    expect(note.parse('  ')).toBeNull();
    expect(note.parse(null)).toBeNull();
    expect(note.parse(undefined)).toBeUndefined();
    expect(note.parse(' kept ')).toBe('kept');
  });

  it('read a boolean query as exactly true or false', () => {
    expect(BoolQuery.parse('true')).toBe(true);
    expect(BoolQuery.parse('false')).toBe(false);
    expect(fieldErrors(BoolQuery, 'yes')).toEqual([{ path: '', code: 'invalid_enum' }]);
  });

  it('refuse a PATCH body that changes nothing', () => {
    expect(fieldErrors(ItemUpdateBody, { version: 3 })).toEqual([{ path: '', code: 'required' }]);
    expect(fieldErrors(ItemUpdateBody, { version: 3, minStock: null })).toEqual([]);
  });
});
