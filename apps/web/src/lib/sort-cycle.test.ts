import { describe, expect, it } from 'vitest';
import { nextSort, sortStateOf } from './sort-cycle';

describe('sort cycle (§7.5)', () => {
  it('goes ascending, descending, then back to the default order', () => {
    expect(nextSort('date', undefined, '-orderNumber')).toBe('date');
    expect(nextSort('date', 'date', '-orderNumber')).toBe('-date');
    expect(nextSort('date', '-date', '-orderNumber')).toBeUndefined();
  });

  it('moves on the first click of the column the default order already sorts by', () => {
    // Opened as `?sort=-owed`, or with no sort on a list whose default is `-owed`: clearing the sort
    // would leave the rows where they are, so the click turns to ascending instead.
    expect(nextSort('owed', '-owed', '-owed')).toBe('owed');
    expect(nextSort('name', 'name', 'name')).toBe('-name');
    expect(nextSort('name', '-name', 'name')).toBeUndefined();
  });

  it('reads the state of a column from the sort in effect', () => {
    expect(sortStateOf('owed', '-owed')).toBe('descending');
    expect(sortStateOf('owed', 'owed')).toBe('ascending');
    expect(sortStateOf('owed', 'held')).toBe('none');
    expect(sortStateOf(undefined, 'owed')).toBe('none');
  });
});
