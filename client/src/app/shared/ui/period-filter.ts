import { Component, computed, model } from '@angular/core';
import { LucideChevronLeft, LucideChevronRight } from '@lucide/angular';
import { pacificIsoDate, pacificToday } from '../../core/format-utils';
import { rangeBounds, shiftIsoDay } from './day-bar';

export type Period = 'day' | 'week' | 'month' | 'all';

const PERIODS: { key: Period; label: string }[] = [
  { key: 'day', label: 'Day' },
  { key: 'week', label: 'Week' },
  { key: 'month', label: 'Month' },
  { key: 'all', label: 'All' },
];

const pad = (n: number) => String(n).padStart(2, '0');

/** Monday (yyyy-MM-dd) of the week an ISO day falls in. A Sunday belongs to the week that just ended. */
function mondayOf(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  const dow = (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7;
  return shiftIsoDay(iso, -dow);
}

function monthStart(iso: string, offset = 0): string {
  const [y, m] = iso.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + offset, 1));
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-01`;
}

/**
 * Inclusive yyyy-MM-dd bounds of the period containing `anchor`, never reaching past `today`.
 * Weeks run Monday–Saturday, so on a Thursday the current week is Monday–Thursday and on a
 * Monday it is that single day.
 */
export function periodRange(period: Period, anchor: string, today: string): { from: string; to: string } {
  let from = anchor;
  let to = anchor;
  if (period === 'week') {
    from = mondayOf(anchor);
    to = shiftIsoDay(from, 5);
  } else if (period === 'month') {
    from = monthStart(anchor);
    to = shiftIsoDay(monthStart(anchor, 1), -1);
  }
  return { from, to: to > today ? today : to };
}

/** [start, end) epoch-ms bounds of the period, ready to compare against a lead's timestamp. */
export function periodBounds(period: Period, anchor: string): [number, number] {
  const today = pacificIsoDate(pacificToday());
  if (period === 'all') return [0, rangeBounds(today, today)[1]];
  const { from, to } = periodRange(period, anchor, today);
  return rangeBounds(from, to);
}

/** Rows whose `createdAt` falls inside the selected period. */
export function inPeriod<T extends { createdAt: string }>(rows: T[], period: Period, anchor: string): T[] {
  if (period === 'all') return rows;
  const [start, end] = periodBounds(period, anchor);
  return rows.filter((r) => {
    const t = new Date(r.createdAt).getTime();
    return t >= start && t < end;
  });
}

/**
 * Quick Day / Week / Month / All switcher with prev/next arrows. Two-way binds `period` and `anchor`
 * (any yyyy-MM-dd inside the period shown); the parent turns them into a date range with
 * `periodBounds`. Defaults to today, by day.
 */
@Component({
  selector: 'app-period-filter',
  imports: [LucideChevronLeft, LucideChevronRight],
  template: `
    <div class="pf">
      <div class="pf__seg" role="tablist" aria-label="Time period">
        @for (p of periods; track p.key) {
          <button type="button" role="tab" class="pf__tab" [class.active]="period() === p.key" [attr.aria-selected]="period() === p.key" (click)="period.set(p.key)">
            {{ p.label }}
          </button>
        }
      </div>
      @if (period() !== 'all') {
      <div class="pf__nav">
        <button type="button" class="btn btn--sm btn--icon btn--ghost" aria-label="Previous" (click)="step(-1)">
          <svg lucideChevronLeft></svg>
        </button>
        <span class="pf__label">{{ label() }}</span>
        <button type="button" class="btn btn--sm btn--icon btn--ghost" aria-label="Next" [disabled]="!canNext()" (click)="step(1)">
          <svg lucideChevronRight></svg>
        </button>
      </div>
      }
    </div>
  `,
  styles: `
    .pf { display: flex; align-items: center; gap: 0.6rem; flex-wrap: wrap; justify-content: flex-end; }
    .pf__seg {
      display: flex; gap: 0.2rem; padding: 0.22rem;
      border: 1px solid var(--border); border-radius: var(--radius-md); background: var(--surface);
    }
    .pf__tab {
      padding: 0.38rem 0.85rem; border: 0; border-radius: var(--radius-sm); background: transparent;
      color: var(--gray-500); font: inherit; font-size: 0.78rem; font-weight: 600; cursor: pointer;
      transition: background 0.13s ease, color 0.13s ease;
    }
    .pf__tab:hover { background: var(--gray-50); color: var(--text); }
    .pf__tab.active { background: var(--ink-900); color: var(--gold-300); }
    .pf__nav { display: flex; align-items: center; gap: 0.2rem; }
    .pf__label { min-width: 8.5rem; text-align: center; font-size: 0.82rem; font-weight: 600; font-variant-numeric: tabular-nums; }
  `,
})
export class PeriodFilter {
  readonly period = model<Period>('day');
  /** Any yyyy-MM-dd inside the period being shown. */
  readonly anchor = model(pacificIsoDate(pacificToday()));

  protected readonly periods = PERIODS;
  private readonly today = pacificIsoDate(pacificToday());

  protected readonly range = computed(() => periodRange(this.period(), this.anchor(), this.today));

  protected readonly label = computed(() => {
    const { from, to } = this.range();
    const date = (iso: string, opts: Intl.DateTimeFormatOptions) => {
      const [y, m, d] = iso.split('-').map(Number);
      return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', { ...opts, timeZone: 'UTC' });
    };
    switch (this.period()) {
      case 'day':
        return from === this.today ? 'Today' : date(from, { weekday: 'short', month: 'short', day: 'numeric' });
      case 'week':
        return `${date(from, { month: 'short', day: 'numeric' })} – ${date(to, { month: 'short', day: 'numeric' })}`;
      case 'month':
        return date(from, { month: 'long', year: 'numeric' });
      case 'all':
        return 'All time';
    }
  });

  protected readonly canNext = computed(() => this.next() <= this.today);

  /** Start of the period after the one shown. */
  private next(): string {
    const { from } = this.range();
    switch (this.period()) {
      case 'day':
        return shiftIsoDay(from, 1);
      case 'week':
        return shiftIsoDay(from, 7);
      case 'month':
      case 'all':
        return monthStart(from, 1);
    }
  }

  protected step(by: -1 | 1): void {
    const { from } = this.range();
    const target =
      by === 1
        ? this.next()
        : this.period() === 'day'
          ? shiftIsoDay(from, -1)
          : this.period() === 'week'
            ? shiftIsoDay(from, -7)
            : monthStart(from, -1);
    if (target <= this.today) this.anchor.set(target);
  }
}
