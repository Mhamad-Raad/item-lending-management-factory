import { describe, expect, it } from 'vitest';
import { pageArgs, pageSqlLimit, toPage } from './pagination';

describe('pagination', () => {
  it('skips the pages before the one asked for', () => {
    expect(pageArgs({ page: 1, pageSize: 25 })).toEqual({ skip: 0, take: 25 });
    expect(pageArgs({ page: 3, pageSize: 10 })).toEqual({ skip: 20, take: 10 });
  });

  it('writes the same page as bound LIMIT and OFFSET parameters', () => {
    const sql = pageSqlLimit({ page: 3, pageSize: 10 });
    expect(sql.sql).toBe('LIMIT ? OFFSET ?');
    expect(sql.values).toEqual([10, 20]);
  });

  it('wraps the items in the list envelope', () => {
    expect(toPage(['a', 'b'], { page: 2, pageSize: 2 }, 5)).toEqual({
      items: ['a', 'b'],
      page: 2,
      pageSize: 2,
      total: 5,
    });
  });
});
