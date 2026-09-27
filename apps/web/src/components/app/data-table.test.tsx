// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import '@/i18n';
import { DataTable } from './data-table';

afterEach(cleanup);

const table = (props: { page: number; onPageChange: () => void; onPageOverflow?: (page: number) => void }) => (
  <DataTable<{ id: number }>
    label="Rows"
    columns={[{ id: 'id', header: 'common.search', cell: (row) => row.id }]}
    rows={[]}
    rowKey={(row) => row.id}
    total={45}
    pageSize={20}
    empty={<p>empty</p>}
    {...props}
  />
);

describe('DataTable page past the end', () => {
  it('steps back to the last page through onPageOverflow, not a pushed page change', () => {
    const onPageChange = vi.fn();
    const onPageOverflow = vi.fn();
    render(table({ page: 9, onPageChange, onPageOverflow }));

    expect(onPageOverflow).toHaveBeenCalledWith(3);
    expect(onPageChange).not.toHaveBeenCalled();
  });

  it('falls back to onPageChange where no overflow handler is given (a list kept in state)', () => {
    const onPageChange = vi.fn();
    render(table({ page: 9, onPageChange }));

    expect(onPageChange).toHaveBeenCalledWith(3);
  });
});
