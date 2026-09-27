import { describe, expect, it } from 'vitest';
import { ApiError } from '../errors/api-error';
import { assertVersion, changedFields } from './versioning';

describe('assertVersion', () => {
  it('passes when the request names the stored version', () => {
    expect(() => assertVersion(3, 3)).not.toThrow();
  });

  it('refuses any other version with the one stored now', () => {
    expect(() => assertVersion(4, 3)).toThrow(
      expect.objectContaining({ code: 'VERSION_CONFLICT', details: { currentVersion: 4 } }),
    );
    expect(() => assertVersion(4, 3)).toThrow(ApiError);
  });
});

describe('changedFields', () => {
  const fields = ['name', 'minStock', 'note'] as const;
  const current = { name: 'Euro', minStock: 5 as number | null, note: null as string | null };

  it('names only the fields the body sets to something new, in the order given', () => {
    expect(changedFields({ note: 'x', name: 'Block' }, current, fields)).toEqual(['name', 'note']);
  });

  it('ignores absent fields and unchanged values', () => {
    expect(changedFields({ name: 'Euro', minStock: 5 }, current, fields)).toEqual([]);
    expect(changedFields({}, current, fields)).toEqual([]);
  });

  it('treats null as a value: clearing a field is a change', () => {
    expect(changedFields({ minStock: null }, current, fields)).toEqual(['minStock']);
    expect(changedFields({ note: null }, current, fields)).toEqual([]);
  });
});
