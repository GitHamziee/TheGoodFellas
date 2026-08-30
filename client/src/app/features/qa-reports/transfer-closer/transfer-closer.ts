import { Component, OnInit, inject, signal } from '@angular/core';
import { AnalyticsService, UserOutcomeRow } from '../../../core/services/analytics.service';
import { OutcomeAnalytics } from '../../admin/outcome-analytics';

/** Transfer Report — how QA scored the leads each Closer enriched. */
@Component({
  selector: 'app-qa-transfer-closer',
  imports: [OutcomeAnalytics],
  template: `
    <app-outcome-analytics
      subtitle="How QA scored each closer's lead enrichment."
      peopleLabel="Closers"
      totalLabel="Leads reviewed"
      goodLabel="Pass"
      badLabel="Fail"
      rateLabel="Pass rate"
      noneLabel="No reviews yet"
      unitLabel="reviews"
      emptyTitle="No reviews yet"
      emptyHint="Once QA reviews a closer's enrichment, results show up here."
      [source]="rows()"
      [loading]="loading()"
    />
  `,
})
export class QaTransferCloser implements OnInit {
  private readonly analyticsService = inject(AnalyticsService);

  readonly rows = signal<UserOutcomeRow[]>([]);
  readonly loading = signal(true);

  async ngOnInit(): Promise<void> {
    try {
      this.rows.set(await this.analyticsService.qaClosers());
    } finally {
      this.loading.set(false);
    }
  }
}
