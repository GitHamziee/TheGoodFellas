import { Component, HostListener, computed, input, model } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { LucideChevronLeft, LucideChevronRight } from '@lucide/angular';
import { pacificIsoDate, pacificStartOfDay, pacificToday } from '../../core/format-utils';
import { DateInput } from './date-input';

/** [start, end) epoch-ms bounds of a Pacific calendar day given as yyyy-MM-dd. */
export function dayBounds(iso: string): [number, number] {
  const [y, m, d] = iso.split('-').map(Number);
  return [pacificStartOfDay(y, m, d), pacificStartOfDay(y, m, d + 1)];
}

/** [start, end) bounds covering `from` through `to` inclusive; `to` empty means just `from`. */
export function rangeBounds(from: string, to: string): [number, number] {
  return [dayBounds(from)[0], dayBounds(to || from)[1]];
}

/** "Oct 1 – Oct 7" style label for a from/to pair. */
export function rangeLabel(from: string, to: string): string {
  const fmt = (iso: string) => {
    const [y, m, d] = iso.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
  };
  return `${fmt(from)} – ${fmt(to)}`;
}

function daysBetween(a: string, b: string): number {
  const [ay, am, ad] = a.split('-').map(Number);
  const [by, bm, bd] = b.split('-').map(Number);
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86_400_000);
}

/** yyyy-MM-dd shifted by whole days (calendar maths, so DST can't skew it). */
export function shiftIsoDay(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/**
 * Sheet-style day navigator: a tab per recent day (with that day's lead count), prev/next
 * arrows, a date picker for older days, and an "All dates" escape hatch. `day` is a
 * yyyy-MM-dd string in Pacific time, or '' for every day. `counts` maps yyyy-MM-dd → count.
 */
@Component({
  selector: 'app-day-bar',
  imports: [FormsModule, DateInput, LucideChevronLeft, LucideChevronRight],
  template: `
    <div class="daybar">
      <div class="daybar__nav">
        <button type="button" class="btn btn--sm btn--icon btn--ghost" aria-label="Previous day" [disabled]="!day()" (click)="step(-1)">
          <svg lucideChevronLeft></svg>
        </button>
        <button type="button" class="btn btn--sm btn--icon btn--ghost" aria-label="Next day" [disabled]="!day() || day() >= today()" (click)="step(1)">
          <svg lucideChevronRight></svg>
        </button>
      </div>

      <div class="daybar__tabs" role="tablist">
        @for (t of tabs(); track t.iso) {
          <button type="button" class="daytab" role="tab" [class.active]="day() === t.iso && !dayTo()" [class.empty]="!countFor(t.iso)" (click)="pickDay(t.iso)">
            <span class="daytab__label">{{ t.label }}</span>
            <span class="daytab__n">{{ countFor(t.iso) }}</span>
          </button>
        }
        <button type="button" class="daytab" role="tab" [class.active]="!day()" (click)="pickDay('')">
          <span class="daytab__label">All dates</span>
          <span class="daytab__n">{{ total() }}</span>
        </button>
      </div>

      <div class="daybar__range" [class.on]="!!dayTo()">
        <div class="daybar__pick">
          <app-date-input min="2000-01-01" [max]="today()" [ngModel]="day()" (ngModelChange)="setFrom($event)" aria-label="From date" />
        </div>
        <span class="daybar__sep">to</span>
        <div class="daybar__pick">
          <app-date-input [min]="day() || '2000-01-01'" [max]="today()" [ngModel]="dayTo()" (ngModelChange)="setTo($event)" aria-label="To date (optional)" />
        </div>
        @if (dayTo()) {
          <button type="button" class="btn btn--sm btn--ghost" (click)="dayTo.set('')">Clear range</button>
        }
      </div>
    </div>
  `,
  styles: `
    .daybar { display: flex; align-items: center; gap: 0.6rem; flex-wrap: wrap; margin-bottom: 1.1rem; }
    .daybar__nav { display: flex; gap: 0.2rem; }
    .daybar__tabs {
      display: flex; gap: 0.25rem; padding: 0.22rem; flex-wrap: wrap;
      border: 1px solid var(--border); border-radius: var(--radius-md); background: var(--surface);
    }
    .daytab {
      display: inline-flex; align-items: center; gap: 0.4rem; padding: 0.38rem 0.75rem;
      border: 0; border-radius: var(--radius-sm); background: transparent; color: var(--gray-500);
      font: inherit; font-size: 0.78rem; font-weight: 600; cursor: pointer; white-space: nowrap;
      transition: background 0.13s ease, color 0.13s ease;
    }
    .daytab:hover { background: var(--gray-50); color: var(--text); }
    .daytab.empty:not(.active) { opacity: 0.45; }
    .daytab.active { background: var(--ink-900); color: var(--gold-300); }
    .daytab__n { font-size: 0.72rem; opacity: 0.75; font-variant-numeric: tabular-nums; }
    .daybar__range { display: flex; align-items: center; gap: 0.4rem; flex-wrap: wrap; }
    .daybar__sep { font-size: 0.75rem; font-weight: 600; color: var(--gray-500); }
    .daybar__pick { width: 10.5rem; }
  `,
})
export class DayBar {
  /** Selected Pacific day as yyyy-MM-dd, or '' for all dates. */
  readonly day = model('');
  /** End of a date range (inclusive), or '' for a single day. Only meaningful while `day` is set. */
  readonly dayTo = model('');
  readonly counts = input<Record<string, number>>({});
  readonly total = input(0);
  /** How many days back the tab strip reaches (today included). */
  readonly span = input(5);

  protected readonly today = computed(() => pacificIsoDate(pacificToday()));

  protected readonly tabs = computed(() => {
    const today = this.today();
    const out: { iso: string; label: string }[] = [];
    for (let i = 0; i < this.span(); i++) {
      const iso = shiftIsoDay(today, -i);
      out.push({ iso, label: i === 0 ? 'Today' : i === 1 ? 'Yesterday' : this.shortLabel(iso) });
    }
    // A day picked from the calendar that is older than the strip still gets its own tab.
    const picked = this.dayTo() ? '' : this.day();
    if (picked && !out.some((t) => t.iso === picked)) out.push({ iso: picked, label: this.shortLabel(picked) });
    return out;
  });

  /** ← / → step between days, unless the user is typing or a modal is open. */
  @HostListener('document:keydown', ['$event'])
  onKey(e: KeyboardEvent): void {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
    const t = e.target as HTMLElement | null;
    if (t && (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable)) return;
    if (document.querySelector('app-modal')) return;
    if (!this.day()) return;
    this.step(e.key === 'ArrowLeft' ? -1 : 1);
  }

  protected countFor(iso: string): number {
    return this.counts()[iso] || 0;
  }

  protected pickDay(iso: string): void {
    this.day.set(iso);
    this.dayTo.set('');
  }

  protected setFrom(iso: string): void {
    this.day.set(iso);
    if (!iso || (this.dayTo() && this.dayTo() < iso)) this.dayTo.set('');
  }

  protected setTo(iso: string): void {
    // A "to" without a "from" can't mean anything; a "to" before the "from" is ignored.
    this.dayTo.set(this.day() && iso >= this.day() ? iso : '');
  }

  /** Steps a single day by one, or a range by its own length. */
  protected step(by: number): void {
    const from = this.day();
    if (!from) return;
    const to = this.dayTo();
    const len = to ? daysBetween(from, to) + 1 : 1;
    const nextFrom = shiftIsoDay(from, by * len);
    const nextTo = to ? shiftIsoDay(to, by * len) : '';
    if ((nextTo || nextFrom) > this.today()) return;
    this.day.set(nextFrom);
    this.dayTo.set(nextTo);
  }

  private shortLabel(iso: string): string {
    const [y, m, d] = iso.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', {
      weekday: 'short',
      month: 'numeric',
      day: 'numeric',
      timeZone: 'UTC',
    });
  }
}
