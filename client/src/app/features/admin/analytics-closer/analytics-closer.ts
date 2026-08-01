import { Component, OnInit, inject, signal } from '@angular/core';
import { AnalyticsService, UserOutcomeRow } from '../../../core/services/analytics.service';
import { OutcomeAnalytics } from '../outcome-analytics';

@Component({
  selector: 'app-analytics-closer',
  imports: [OutcomeAnalytics],
  template: `
    <app-outcome-analytics
      title="Analytics — Closers"
      subtitle="How the leads each closer enriched and submitted end up, once a client has decided."
      peopleLabel="Closers"
      emptyTitle="No closers yet"
      emptyHint="Create closer accounts and their lead outcomes will show up here."
      [source]="rows()"
      [loading]="loading()"
    />
  `,
})
export class AnalyticsCloser implements OnInit {
  private readonly analyticsService = inject(AnalyticsService);

  readonly rows = signal<UserOutcomeRow[]>([]);
  readonly loading = signal(true);

  async ngOnInit(): Promise<void> {
    try {
      this.rows.set(await this.analyticsService.closers());
    } finally {
      this.loading.set(false);
    }
  }
}
