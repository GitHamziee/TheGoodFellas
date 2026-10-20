import { Component, effect, inject, signal } from '@angular/core';
import { AnalyticsService, UserOutcomeRow } from '../../../core/services/analytics.service';
import { OutcomeAnalytics } from '../outcome-analytics';
import { pacificIsoDate, pacificToday } from '../../../core/format-utils';
import { Period, PeriodFilter, periodBounds } from '../../../shared/ui/period-filter';
import { reloadOnChange } from '../../../core/live-reload';

@Component({
  selector: 'app-analytics-junior',
  imports: [OutcomeAnalytics, PeriodFilter],
  template: `
    <div class="period-bar">
      <app-period-filter [(period)]="period" [(anchor)]="anchor" />
    </div>
    <app-outcome-analytics
      subtitle="How each junior closer's leads end up. Click a junior closer for their full lead history and in-depth breakdown."
      peopleLabel="Junior closers"
      emptyTitle="No junior closers yet"
      emptyHint="Create junior closer accounts and their lead outcomes will show up here."
      [source]="rows()"
      [loading]="loading()"
      [detailLinks]="true"
    />
  `,
  styles: `.period-bar { padding: 0 0 0.75rem; }`,
})
export class AnalyticsJunior {
  private readonly liveReload = reloadOnChange(() => this.load());
  private readonly analyticsService = inject(AnalyticsService);

  readonly rows = signal<UserOutcomeRow[]>([]);
  readonly loading = signal(true);
  readonly period = signal<Period>('day');
  readonly anchor = signal(pacificIsoDate(pacificToday()));

  // Also covers the first load — no ngOnInit, which used to fetch the same data a second time.
  private readonly refetchOnPeriod = effect(() => {
    this.period();
    this.anchor();
    void this.load();
  });

  async load(): Promise<void> {
    try {
      this.rows.set(await this.analyticsService.juniorClosers(periodBounds(this.period(), this.anchor())));
    } finally {
      this.loading.set(false);
    }
  }
}
