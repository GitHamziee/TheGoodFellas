import { signal } from '@angular/core';
import { createListView } from './list-view';

interface Row {
  name: string;
  status: string;
  amount: number | null;
}

const ROWS: Row[] = Array.from({ length: 25 }, (_, i) => ({
  name: `Customer ${i + 1}`,
  status: i % 2 === 0 ? 'NEW' : 'SUBMITTED',
  amount: i === 3 ? null : i * 10,
}));

function view(rows: Row[] = ROWS) {
  const source = signal(rows);
  const list = createListView<Row>({
    source,
    searchFields: (r) => [r.name],
    statusOf: (r) => r.status,
    sorters: { name: (r) => r.name, amount: (r) => r.amount },
  });
  return { source, list };
}

describe('createListView', () => {
  it('pages the loaded rows', () => {
    const { list } = view();
    expect(list.total()).toBe(25);
    expect(list.totalPages()).toBe(3);
    expect(list.rows().length).toBe(10);
    list.page.set(3);
    expect(list.rows().length).toBe(5);
  });

  it('searches case-insensitively and resets to page 1', () => {
    const { list } = view();
    list.page.set(2);
    list.setSearch('customer 1');
    expect(list.page()).toBe(1);
    // 1, 10–19
    expect(list.total()).toBe(11);
    expect(list.isFiltered()).toBe(true);
  });

  it('filters by status', () => {
    const { list } = view();
    list.setStatus('SUBMITTED');
    expect(list.total()).toBe(12);
    expect(list.filtered().every((r) => r.status === 'SUBMITTED')).toBe(true);
  });

  it('sorts numbers, keeps nulls last, and toggles direction', () => {
    const { list } = view();
    list.toggleSort('amount');
    expect(list.sortDir()).toBe('asc');
    expect(list.filtered()[0].amount).toBe(0);
    expect(list.filtered().at(-1)!.amount).toBeNull();
    list.toggleSort('amount');
    expect(list.sortDir()).toBe('desc');
    expect(list.filtered()[0].amount).toBe(240);
    expect(list.filtered().at(-1)!.amount).toBeNull();
  });

  it('clamps the page when rows disappear', () => {
    const { source, list } = view();
    list.page.set(3);
    source.set(ROWS.slice(0, 12));
    expect(list.rows().map((r) => r.name)).toEqual(['Customer 11', 'Customer 12']);
  });

  it('clears filters', () => {
    const { list } = view();
    list.setSearch('x');
    list.setStatus('NEW');
    list.clearFilters();
    expect(list.isFiltered()).toBe(false);
    expect(list.total()).toBe(25);
  });
});
