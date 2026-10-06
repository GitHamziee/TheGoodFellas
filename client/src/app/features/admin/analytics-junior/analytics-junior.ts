import { Component, OnInit, inject, signal } from '@angular/core';
import { AnalyticsService, UserOutcomeRow } from '../../../core/services/analytics.service';
import { OutcomeAnalytics } from '../outcome-analytics';
import { reloadOnChange } from '../../../core/live-reload';

@Component({
  selector: 'app-analytics-junior',
  imports: [OutcomeAnalytics],
  template: `
    <app-outcome-analytics
      subtitle="How each junior closer's submitted leads end up, once a client has decided."
      peopleLabel="Junior closers"
      emptyTitle="No junior closers yet"
      emptyHint="Create junior closer accounts and their lead outcomes will show up here."
      [source]="rows()"
      [loading]="loading()"
    />
  `,
})
export class AnalyticsJunior implements OnInit {
  private readonly liveReload = reloadOnChange(() => this.ngOnInit());
  private readonly analyticsService = inject(AnalyticsService);

  readonly rows = signal<UserOutcomeRow[]>([]);
  readonly loading = signal(true);

  async ngOnInit(): Promise<void> {
    try {
      this.rows.set(await this.analyticsService.juniorClosers());
    } finally {
      this.loading.set(false);
    }
  }
}
