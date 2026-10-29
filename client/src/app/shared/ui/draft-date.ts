import { Component, computed, input, model, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DraftSchedule } from '../../core/models/lead.model';
import { DRAFT_SCHEDULE_OPTIONS, draftScheduleDate } from '../../core/lead-options';
import { formatDate, todayDateInput } from '../../core/format-utils';
import { DateInput } from './date-input';
import { Select } from './select';

const SPECIFIC_DATE = 'DATE';
const MONTHS_AHEAD = 12;

/** "2026-12" -> "December 2026" */
function monthLabel(month: string): string {
  const [year, mon] = month.split('-').map(Number);
  return new Date(Date.UTC(year, mon - 1, 1)).toLocaleString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
}

function addMonths(month: string, n: number): string {
  const [year, mon] = month.split('-').map(Number);
  const d = new Date(Date.UTC(year, mon - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/**
 * A draft day: a recurring schedule in a chosen month, or a specific calendar date.
 * Either way `date` holds the exact draft date ("2nd Wednesday" + December 2026 → 2026-12-09);
 * `schedule` is set only when one of the schedules was picked.
 * `<app-draft-date [(date)]="form.initialDraftDate" [(schedule)]="form.initialDraftSchedule">`.
 */
@Component({
  selector: 'app-draft-date',
  imports: [FormsModule, Select, DateInput],
  template: `
    <app-select
      [options]="options"
      [ngModel]="mode()"
      [ngModelOptions]="{ standalone: true }"
      [invalid]="invalid() && !mode()"
      placeholder="Select a draft day…"
      (ngModelChange)="pick($event)"
    />
    @if (schedule()) {
      <div class="draft-month">
        <app-select
          aria-label="Draft month"
          [options]="monthOptions()"
          [ngModel]="month()"
          [ngModelOptions]="{ standalone: true }"
          [invalid]="invalid() && !date()"
          placeholder="Select a month…"
          (ngModelChange)="pickMonth($event)"
        />
        @if (date()) {
          <span class="hint">{{ formatDate(date()) }}</span>
        }
      </div>
    } @else if (mode() === SPECIFIC_DATE) {
      <app-date-input
        class="draft-date"
        aria-label="Draft date"
        min="2000-01-01"
        max="2100-12-31"
        [ngModel]="date()"
        [ngModelOptions]="{ standalone: true }"
        [invalid]="invalid() && !date()"
        (ngModelChange)="setDate($event)"
      ></app-date-input>
    }
  `,
  styles: `
    :host { display: block; }
    .draft-date { margin-top: 0.5rem; }
    .draft-month { margin-top: 0.5rem; display: flex; align-items: center; gap: 0.75rem; }
    .draft-month app-select { flex: 1; min-width: 0; }
  `,
})
export class DraftDate {
  readonly date = model<string | null | undefined>();
  readonly schedule = model<DraftSchedule | null | undefined>();
  readonly invalid = input(false);

  protected readonly SPECIFIC_DATE = SPECIFIC_DATE;
  protected readonly formatDate = formatDate;
  protected readonly options = [...DRAFT_SCHEDULE_OPTIONS, { value: SPECIFIC_DATE, label: 'Specific date' }];
  /** "Specific date" chosen but no date typed yet. */
  private readonly pickingDate = signal(false);
  protected readonly mode = computed(() => this.schedule() || (this.date() || this.pickingDate() ? SPECIFIC_DATE : undefined));
  protected readonly month = computed(() => this.date()?.slice(0, 7));

  /** This month and the next twelve, plus the saved month if it's outside that range. */
  protected readonly monthOptions = computed(() => {
    const current = todayDateInput().slice(0, 7);
    const months = Array.from({ length: MONTHS_AHEAD + 1 }, (_, i) => addMonths(current, i));
    const saved = this.month();
    if (saved && !months.includes(saved)) months.unshift(saved);
    return months.map((m) => ({ value: m, label: monthLabel(m) }));
  });

  protected pick(value: string | undefined): void {
    this.pickingDate.set(value === SPECIFIC_DATE);
    if (!value || value === SPECIFIC_DATE) {
      this.schedule.set(undefined);
      this.date.set(undefined);
      return;
    }
    const schedule = value as DraftSchedule;
    this.schedule.set(schedule);
    this.date.set(draftScheduleDate(schedule, this.month() ?? this.nextMonthFor(schedule)));
  }

  protected pickMonth(month: string | undefined): void {
    const schedule = this.schedule();
    this.date.set(schedule && month ? draftScheduleDate(schedule, month) : undefined);
  }

  /** Keeps the date box open while its text is cleared or half-typed. */
  protected setDate(value: string): void {
    this.pickingDate.set(true);
    this.date.set(value || undefined);
  }

  /** This month if the schedule's day hasn't passed yet, otherwise next month. */
  private nextMonthFor(schedule: DraftSchedule): string {
    const today = todayDateInput();
    const current = today.slice(0, 7);
    return draftScheduleDate(schedule, current) >= today ? current : addMonths(current, 1);
  }
}
