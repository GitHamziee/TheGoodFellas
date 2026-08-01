import { Signal, WritableSignal, computed, signal } from '@angular/core';

export type SortDir = 'asc' | 'desc';

export interface ListViewOptions<T> {
  /** The loaded rows. */
  source: Signal<T[]>;
  /** Values a free-text search should match against. */
  searchFields: (item: T) => (string | null | undefined)[];
  /** Value the status pills filter on. Omit for lists with no status filter. */
  statusOf?: (item: T) => string;
  /** Sortable columns → the value to compare. */
  sorters?: Record<string, (item: T) => string | number | null | undefined>;
  /** Column sorted on first render. */
  initialSort?: { key: string; dir: SortDir };
  pageSize?: number;
}

export interface ListView<T> {
  search: WritableSignal<string>;
  status: WritableSignal<string>;
  page: WritableSignal<number>;
  sortKey: WritableSignal<string | null>;
  sortDir: WritableSignal<SortDir>;
  /** Everything matching search + status, before paging. */
  filtered: Signal<T[]>;
  /** The current page's rows. */
  rows: Signal<T[]>;
  total: Signal<number>;
  totalPages: Signal<number>;
  pageSize: number;
  /** True when filters are hiding rows that exist in the source. */
  isFiltered: Signal<boolean>;
  setSearch(value: string): void;
  setStatus(value: string): void;
  toggleSort(key: string): void;
  clearFilters(): void;
}

/**
 * Client-side search / status filter / sort / pagination over an already-loaded array.
 * Datasets here are one team's pipeline, so filtering in memory avoids adding
 * query-param plumbing to every endpoint. Move server-side if volume grows.
 */
export function createListView<T>(opts: ListViewOptions<T>): ListView<T> {
  const pageSize = opts.pageSize ?? 10;

  const search = signal('');
  const status = signal('');
  const page = signal(1);
  const sortKey = signal<string | null>(opts.initialSort?.key ?? null);
  const sortDir = signal<SortDir>(opts.initialSort?.dir ?? 'desc');

  const filtered = computed(() => {
    const term = search().trim().toLowerCase();
    const statusValue = status();
    let rows = opts.source();

    if (statusValue) {
      rows = rows.filter((item) => opts.statusOf?.(item) === statusValue);
    }

    if (term) {
      rows = rows.filter((item) =>
        opts
          .searchFields(item)
          .some((field) => field != null && String(field).toLowerCase().includes(term)),
      );
    }

    const key = sortKey();
    const sorter = key ? opts.sorters?.[key] : undefined;
    if (sorter) {
      const dir = sortDir() === 'asc' ? 1 : -1;
      rows = [...rows].sort((a, b) => {
        const av = sorter(a);
        const bv = sorter(b);
        if (av == null && bv == null) return 0;
        if (av == null) return 1;
        if (bv == null) return -1;
        if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * dir;
        return String(av).localeCompare(String(bv)) * dir;
      });
    }

    return rows;
  });

  const total = computed(() => filtered().length);
  const totalPages = computed(() => Math.max(1, Math.ceil(total() / pageSize)));

  const rows = computed(() => {
    // Clamp rather than reset, so deleting the last row of page 3 lands on page 2.
    const current = Math.min(page(), totalPages());
    const start = (current - 1) * pageSize;
    return filtered().slice(start, start + pageSize);
  });

  const isFiltered = computed(() => search().trim() !== '' || status() !== '');

  return {
    search,
    status,
    page,
    sortKey,
    sortDir,
    filtered,
    rows,
    total,
    totalPages,
    pageSize,
    isFiltered,
    setSearch(value: string) {
      search.set(value);
      page.set(1);
    },
    setStatus(value: string) {
      status.set(value);
      page.set(1);
    },
    toggleSort(key: string) {
      if (sortKey() === key) {
        sortDir.update((d) => (d === 'asc' ? 'desc' : 'asc'));
      } else {
        sortKey.set(key);
        sortDir.set('asc');
      }
      page.set(1);
    },
    clearFilters() {
      search.set('');
      status.set('');
      page.set(1);
    },
  };
}
